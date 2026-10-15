/**
 * On-chain client for the mention.market Anchor program on devnet.
 *
 * Chain markets are stored in the sim store under ids like `c1`, `c9002`
 * (the leading `c` marks a market backed by a real program account). Their
 * numerical values are UI-scaled: raw lamports are divided by `SOL_DECIMALS`
 * (1e9) so the existing LMSR/display math keeps working; amounts are converted
 * back to base units only at the instruction boundary.
 */

import { Connection, PublicKey, Keypair, ComputeBudgetProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";

type ParsedTx = ParsedTransactionWithMeta;
// Import the CJS entry explicitly: anchor's ESM build drops `Wallet`/`BN`
// and webpack's interop leaves the default export empty in SSR bundles.
// (This is the same build shape the anchor CLI scripts use.)
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor/dist/cjs/index.js";
import bs58 from "bs58";
import mentionIdl from "@/lib/idl/mention.json";
import { canonicalJson } from "@mention/resolution/canonical-json";
import { buildResolutionSpec } from "@mention/resolution/spec-builder";
import { lmsrProbYes, lmsrSellReturn, lmsrSharesForCost } from "@/lib/lmsr";
import { resample } from "@/lib/history";
import type { PricePoint } from "@/lib/history";
import { fmtErr, shortAddr } from "@/lib/format";
import { VOID_OUTCOME } from "@/lib/settle";
import type {
  ActivityItem,
  Market,
  MarketStatus,
  MarketType,
  Position,
  TranscriptSnippet,
  Vertical,
} from "@/lib/types";

export const PROGRAM_ID = new PublicKey("5xA4v2SasSoE8mPnWSpePV3U4piHgag51od6mrNDU8j8");
export const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

/** Raw base units per UI unit for SOL markets. */
export const SOL_DECIMALS = 1_000_000_000;

/**
 * Compute-unit budget for value instructions. The program's on-chain integer
 * LMSR (`buy_binary`/`sell_binary`) is CU-heavy (~1.30M for a typical trade),
 * so the default 200k/1M budgets make the tx fail simulation (`ProgramFailed
 * toComplete`) — which Phantom surfaces as "Confirming is unsafe". 1.4M is the
 * protocol maximum; unused CU is not charged.
 */
export const COMPUTE_UNIT_LIMIT = 1_400_000;

/** On-chain challenge window (seconds) used to derive evidence metadata. */
export const CHALLENGE_WINDOW_SECS = 120;

/** Resolve the devnet RPC endpoint (env override, else the public endpoint). */
export function rpcEndpoint(): string {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_RPC_URL ??
    "https://api.devnet.solana.com"
  );
}

export function connection(): Connection {
  return new Connection(rpcEndpoint(), "confirmed");
}

/** Retry an RPC call with backoff; the public devnet RPC is flaky and 429s hard. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 6, baseMs = 600): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const code = (err as { code?: number } | null)?.code;
        const msg = String((err as { message?: string } | null)?.message ?? err);
        const rateLimited = code === 429 || /429|too many requests|rate limit/i.test(msg);
        const base = rateLimited ? baseMs * 2 : baseMs;
        const wait = Math.min(base * 2 ** i, 10_000) + Math.random() * 250;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

/**
 * Fetch parsed transactions for a set of signatures. The public RPC throttles
 * the batched `getParsedTransactions` method specifically ("Too many requests
 * for a specific RPC call") while single `getTransaction` calls stay reliable,
 * so we always fetch each signature individually with bounded concurrency.
 */
async function fetchParsedTxs(
  conn: Connection,
  sigs: string[]
): Promise<Array<ParsedTx | null>> {
  const out: Array<ParsedTx | null> = new Array(sigs.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < sigs.length) {
      const i = next;
      next += 1;
      out[i] = await withRetry(
        () => conn.getParsedTransaction(sigs[i], { maxSupportedTransactionVersion: 0 }),
        5,
        500
      ).catch(() => null);
    }
  };
  const concurrency = Math.min(4, sigs.length);
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

// anchor's CJS entry gates the real `Wallet` (and `workspace`) behind
// `!isBrowser`, so it is undefined in webpack browser bundles. We never send
// through the provider here — instructions are built with `.instruction()`
// and sent via the connected wallet adapter — so a structural stub satisfies
// AnchorProvider and keeps `connection`/`publicKey` for account reads.
const dummyWallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T extends Transaction>(tx: T): Promise<T> => tx,
  signAllTransactions: async <T extends Transaction>(txs: T[]): Promise<T[]> => txs,
};

const dummyProvider = new AnchorProvider(
  connection(),
  dummyWallet as never,
  { commitment: "confirmed", preflightCommitment: "confirmed" }
);

/** The read/builder program. Instructions built here are sent via the wallet. */
/**
 * Minimal surface of the Anchor program client we actually use. Anchor's
 * `Program` generic is not reconcilable with the camelCase `Mention` IDL type
 * at build time, so we carry a purpose-built shape instead.
 */
interface ChainMethodsBuilder {
  accounts(accts: never): { instruction(): Promise<TransactionInstruction> };
}
interface ProgramLite {
  account: {
    market: {
      fetch(a: PublicKey): Promise<unknown>;
      all(): Promise<Array<{ account: ChainMarketAccount; publicKey: PublicKey }>>;
    };
    position: { fetch(a: PublicKey): Promise<unknown> };
    evidenceManifest: { fetch(a: PublicKey): Promise<unknown> };
  };
  methods: {
    createMarket(...args: unknown[]): ChainMethodsBuilder;
    buyBinary(...args: unknown[]): ChainMethodsBuilder;
    sellBinary(...args: unknown[]): ChainMethodsBuilder;
    backWord(...args: unknown[]): ChainMethodsBuilder;
    claimPayout(...args: unknown[]): ChainMethodsBuilder;
    challengeResolution(...args: unknown[]): ChainMethodsBuilder;
  };
}

export const program = new Program(mentionIdl as any, dummyProvider) as unknown as ProgramLite;

/* ------------------------------------------------------------------ */
/* PDAs + helpers                                                      */
/* ------------------------------------------------------------------ */

export const CONFIG_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from("config")],
  PROGRAM_ID
)[0];

export function marketPda(id: number): PublicKey {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(id));
  return PublicKey.findProgramAddressSync([Buffer.from("market"), b], PROGRAM_ID)[0];
}

export function vaultPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], PROGRAM_ID)[0];
}

export function resolutionSpecPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("resolution-spec"), market.toBuffer()],
    PROGRAM_ID
  )[0];
}

/** EvidenceManifest PDA: seeds `[b"evidence", market, sha256]`. */
export function evidencePda(market: PublicKey, sha256: Uint8Array | number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("evidence"), market.toBuffer(), Buffer.from(sha256)],
    PROGRAM_ID
  )[0];
}

/** Challenge PDA: seeds `[b"challenge", market]` (one open dispute per market). */
export function challengePda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("challenge"), market.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function positionPda(market: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

/** Decoded anchor enums arrive as { variantKey: {} }. */
export function enumKey(o: unknown): string {
  if (o && typeof o === "object") {
    const k = Object.keys(o as Record<string, unknown>)[0];
    if (k) return k;
  }
  return String(o);
}

/** `{ streams: {} }`-style enum input the borsh coder expects. */
export function enumArg(key: string): Record<string, {}> {
  return { [key]: {} };
}

export function isChainId(marketId: string): boolean {
  return /^c\d+$/.test(marketId);
}

export function isChainMarket(m: Market): boolean {
  return isChainId(m.id);
}

/**
 * A chain market that should stay out of the live lists:
 * - `open` but past its `end_time` and never locked is dead — the program now
 *   rejects trades on it (`MarketClosed`).
 * - `resolved` with zero traders is script/test noise (evergreen seeds that no
 *   one touched); there is nothing to claim.
 * - `resolved` more than an hour ago is ancient history — our demo resolves
 *   markets live, and older resolutions still have their evidence + on-chain
 *   claim paths, just not billboards on the home page.
 */
export function isStaleChainMarket(m: Market, now = Date.now()): boolean {
  if (!isChainId(m.id)) return false;
  if (m.status === "open" && m.endTime <= now) return true;
  if (m.status === "resolved" && m.resolvedAt !== undefined && m.resolvedAt <= now - 24 * 60 * 60_000) return true;
  return false;
}

/**
 * Reconcile the store's chain markets with the accounts that actually exist
 * on-chain.
 *
 * `fetchChainMarketsAll` is a whole-program GPA, so it is authoritative: a
 * chain market missing from the response no longer exists on devnet (its
 * accounts were closed, e.g. by `scripts/cleanup.mjs`). Merging alone would
 * leave it on the home page forever — nothing else ever removes store entries —
 * and, since non-seed markets are persisted, it survives every refresh too.
 *
 * Simulated (`m…`) and seeded markets are never touched; only chain ids are
 * pruned, and `incoming` is always written so updates/inserts still land.
 */
export function reconcileChainMarkets(
  current: Record<string, Market>,
  incoming: Market[]
): { markets: Record<string, Market>; removed: string[] } {
  const live = new Set(incoming.map((m) => m.id));
  const markets: Record<string, Market> = {};
  const removed: string[] = [];
  for (const [id, m] of Object.entries(current)) {
    if (isChainId(id) && !live.has(id)) {
      removed.push(id);
      continue;
    }
    markets[id] = m;
  }
  for (const m of incoming) markets[m.id] = m;
  return { markets, removed };
}

/** Encode `[u8;32]` hashes as hex for display. */
export function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ------------------------------------------------------------------ */
/* Known chain ids (curated seeds + anything the session created)      */
/* ------------------------------------------------------------------ */

const KNOWN_KEY = "mention_chain_ids";

export const DEFAULT_CHAIN_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/** Persisted registry of on-chain market ids we should poll. */
export function knownChainIds(): number[] {
  try {
    const raw = localStorage.getItem(KNOWN_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as number[];
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    /* first load */
  }
  return [...DEFAULT_CHAIN_IDS];
}

export function rememberChainId(id: number): void {
  const ids = knownChainIds();
  if (!ids.includes(id)) {
    localStorage.setItem(KNOWN_KEY, JSON.stringify([...ids, id].sort((a, b) => a - b)));
  }
}

/** Next fresh market id: max(known)+1, never below 100. */
export function nextChainId(): number {
  return Math.max(100, Math.max(...knownChainIds()) + 1);
}

/** Does a market account already exist on devnet for this id? */
export async function marketAccountExists(id: number): Promise<boolean> {
  const info = await withRetry(() => connection().getAccountInfo(marketPda(id)), 3, 500);
  return info !== null;
}

/**
 * First market id that is still free on devnet, starting from `nextChainId()`.
 *
 * `nextChainId()` is only a *per-browser* registry, so it will happily propose
 * an id whose account already exists — created from another profile, by a
 * script, or by a session whose localStorage was cleared. `create_market`
 * `init`s the market PDA, so such a create dies inside the system program with
 * `custom program error: 0x0` ("already in use"), which Phantom reports as a
 * bare "Unexpected error" and which the user cannot recover from because the
 * id is proposed again on every retry. Probing the chain first removes that
 * whole class of failure.
 *
 * An RPC failure while probing is treated as "free": the caller reserves the
 * id before signing, so a retry still advances past it.
 */
export async function freeChainId(
  isOccupied: (id: number) => Promise<boolean> = (id) =>
    marketAccountExists(id).catch(() => false),
  limit = 64
): Promise<number> {
  let id = nextChainId();
  for (let i = 0; i < limit; i += 1) {
    if (!(await isOccupied(id))) return id;
    id += 1;
  }
  throw new Error("No free market id on devnet — run apps/program/scripts/cleanup.mjs first.");
}

/* ------------------------------------------------------------------ */
/* Create-time limits + readable errors                                */
/* ------------------------------------------------------------------ */

/**
 * Program-side limits the UI must respect *before* it asks the wallet to sign.
 * They mirror `programs/mention/src/constants.rs`; a mismatch turns a typo into
 * a devnet transaction that reverts (and a wallet error nobody can act on).
 * Lengths are UTF-8 bytes, matching Rust's `String::len()`.
 */
export const MAX_TITLE_BYTES = 64;
export const MAX_WORD_BYTES = 32;
export const MAX_WORDS_PER_MARKET = 16;
export const MIN_CREATE_MINUTES = 5;

/** UTF-8 byte length, i.e. what the program actually measures. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * The title the program receives. Word-race markets do not send the user's
 * label verbatim: the client derives `Word race: <event>`, so an event name
 * that fits on its own can still overflow `MAX_TITLE_LEN` once prefixed.
 */
export function chainCreateTitle(
  params: Pick<ChainCreateParams, "type" | "event" | "title">
): string {
  return params.type === "binary" ? params.title : `Word race: ${params.event}`;
}

/**
 * Human-readable reasons this create would be rejected on-chain. Empty means
 * the transaction the wallet is asked to sign satisfies the program's checks.
 */
export function chainCreateProblems(params: ChainCreateParams): string[] {
  const problems: string[] = [];
  const title = chainCreateTitle(params);
  const titleBytes = byteLength(title);

  if (titleBytes > MAX_TITLE_BYTES) {
    problems.push(
      params.type === "binary"
        ? `The question is ${titleBytes} bytes; the program allows ${MAX_TITLE_BYTES}. Shorten it or pick the demo launch.`
        : `"Word race: ${params.event}" is ${titleBytes} bytes; the program allows ${MAX_TITLE_BYTES}. Use a shorter event name.`
    );
  }
  // Only binary markets send the event separately — a majority title already
  // embeds it, so that case is covered by the check above.
  if (params.type === "binary" && byteLength(params.event) > MAX_TITLE_BYTES) {
    problems.push(
      `The event name is ${byteLength(params.event)} bytes; the program allows ${MAX_TITLE_BYTES}.`
    );
  }

  if (params.type === "majority") {
    if (params.words.length < 2) problems.push("A word race needs at least two words.");
    if (params.words.length > MAX_WORDS_PER_MARKET) {
      problems.push(`A word race allows at most ${MAX_WORDS_PER_MARKET} words.`);
    }
    // Reserved by the program (`ReservedWord`): it would collide with a void ruling.
    if (params.words.some((w) => w.trim().toLowerCase() === VOID_OUTCOME)) {
      problems.push(`"${VOID_OUTCOME}" is reserved for voided markets and can't be a word.`);
    }
    const longWord = params.words.find((w) => byteLength(w) > MAX_WORD_BYTES);
    if (longWord) {
      problems.push(`"${longWord}" is ${byteLength(longWord)} bytes; a word allows ${MAX_WORD_BYTES}.`);
    }
  }

  if (!Number.isFinite(params.minutes) || params.minutes < MIN_CREATE_MINUTES) {
    problems.push(`The market must run at least ${MIN_CREATE_MINUTES} minutes.`);
  }
  return problems;
}

/**
 * Anchor error code -> message, taken straight from the IDL so it can never
 * drift out of sync with `programs/mention/src/error.rs`.
 */
const PROGRAM_ERROR_MESSAGES: Record<number, string> = Object.fromEntries(
  ((mentionIdl as { errors?: Array<{ code: number; msg: string }> }).errors ?? []).map((e) => [
    e.code,
    e.msg,
  ])
);

/** System-program failures the `init`-based create hits first. */
const SYSTEM_ERROR_MESSAGES: Record<number, string> = {
  0: "Market id already in use on devnet — retry for a fresh id.",
  1: "Not enough devnet SOL to escrow this market (≈0.7 SOL reserve + rent).",
};

/**
 * Every message (and attached log line) reachable through a wrapped error.
 * Wallets nest the provider error in `.error` (Phantom puts the simulation
 * logs under `data.logs`), Anchor/RPC errors nest in `.cause`.
 */
function errorMessages(err: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const pushLogs = (value: unknown) => {
    if (Array.isArray(value)) out.push(...value.filter((l): l is string => typeof l === "string"));
  };
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const message = (cur as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) out.push(message.trim());
    const data = (cur as { data?: { logs?: unknown } }).data;
    pushLogs((cur as { logs?: unknown }).logs);
    pushLogs(data?.logs);
    cur = (cur as { error?: unknown }).error ?? (cur as { cause?: unknown }).cause;
  }
  if (typeof err === "string" && err.trim()) out.push(err.trim());
  return out;
}

/** Wrapper messages that carry no information on their own. */
const GENERIC_ERROR = /^(unexpected error|transaction failed|failed to send transaction|error)$/i;

/**
 * Turn a wallet/RPC/program failure into something a trader can act on.
 *
 * Wallets wrap the real cause (`WalletSignTransactionError: Unexpected error`
 * with the provider error in `.error`) and the program reports rejects as an
 * opaque number, so both get unwrapped here: the wrapped messages and any
 * attached program logs are scanned, a `custom program error: 0x…` / anchor
 * `Error Number: 6009` is decoded through the IDL, and only then does the raw
 * text fall through.
 */
export function chainErrorText(err: unknown): string {
  const messages = errorMessages(err);
  const blob = messages.join("\n");

  const anchorCode = blob.match(/Error Number:\s*(\d+)/);
  const hexCode = blob.match(/custom program error:\s*0x([0-9a-fA-F]+)/);
  const code = anchorCode ? Number(anchorCode[1]) : hexCode ? parseInt(hexCode[1], 16) : null;
  if (code !== null) {
    const programMessage = PROGRAM_ERROR_MESSAGES[code];
    if (programMessage) return programMessage;
    const systemMessage = SYSTEM_ERROR_MESSAGES[code];
    if (systemMessage) return systemMessage;
  }

  if (/still in use|already in use|already been initialized/i.test(blob)) {
    return SYSTEM_ERROR_MESSAGES[0];
  }
  if (/insufficient lamports|insufficient funds|negative lamports/i.test(blob)) {
    return SYSTEM_ERROR_MESSAGES[1];
  }
  if (/429|too many requests|rate limit/i.test(blob)) {
    return "Network busy (rate limited) — retry in a moment.";
  }
  if (/user rejected|request rejected|declined/i.test(blob)) {
    return "You rejected the request in your wallet.";
  }

  const specific = [...messages].reverse().find((m) => !GENERIC_ERROR.test(m.split("\n")[0].trim()));
  return fmtErr(specific ?? err);
}

/* ------------------------------------------------------------------ */
/* Account -> store view mapping                                       */
/* ------------------------------------------------------------------ */

/** Raw on-chain Market account (as decoded by the anchor client). */
export interface ChainMarketAccount {
  id: { toNumber(): number };
  title: string;
  event: string;
  vertical: object;
  marketType: object;
  status: object;
  b: { toNumber(): number };
  yesShares: { toNumber(): number };
  noShares: { toNumber(): number };
  yesCost: { toNumber(): number };
  noCost: { toNumber(): number };
  words: Array<{ word: string; pool: { toNumber(): number }; bettors: number }>;
  totalPool: { toNumber(): number };
  volume: { toNumber(): number };
  traders: number;
  creatorFeeBps: number;
  endTime: { toNumber(): number };
  winningOutcome: string;
  confidence: number;
  bond: { toNumber(): number };
  evidenceHash: number[];
  proposedAt: { toNumber(): number };
  challengeDeadline: { toNumber(): number };
  resolvedAt: { toNumber(): number };
  proposer: PublicKey;
  creator: PublicKey;
  bump: number;
}

const mins = 60_000;

/** Convert a raw Market account into the store's `Market` view (UI units). */
export function mapMarketToStore(account: ChainMarketAccount): Market {
  const id = account.id.toNumber();
  const status = enumKey(account.status) as MarketStatus;
  const marketType = enumKey(account.marketType) as MarketType;
  const scale = SOL_DECIMALS;
  const endTimeSec = account.endTime.toNumber();
  const resolving = status === "resolving" || status === "resolved";
  const explorer = `https://explorer.solana.com/address/${marketPda(id).toBase58()}?cluster=devnet`;

  const market: Market = {
    id: `c${id}`,
    slug: `c${id}`,
    title: account.title,
    event: account.event,
    vertical: enumKey(account.vertical) as Vertical,
    type: marketType,
    status,
    createdAt: endTimeSec * 1000 - 30 * mins,
    endTime: endTimeSec * 1000,
    resolvedAt: account.resolvedAt.toNumber() > 0 ? account.resolvedAt.toNumber() * 1000 : undefined,
    volume: account.volume.toNumber() / scale,
    traders: account.traders,
    yesShares: account.yesShares.toNumber() / scale,
    noShares: account.noShares.toNumber() / scale,
    b: account.b.toNumber() / scale,
    words:
      marketType === "majority"
        ? account.words.map((w) => ({
            word: w.word,
            pool: w.pool.toNumber() / scale,
            bettors: w.bettors,
            lastBetAt: endTimeSec * 1000,
          }))
        : undefined,
    rules: `Chain-resolved market: resolution is posted on-chain by the oracle, opening a 120s challenge window. All value is real devnet SOL escrowed in the program vault.`,
    winningOutcome: resolving ? account.winningOutcome : undefined,
    confidence: resolving ? account.confidence : undefined,
    evidence: resolving
      ? {
          winningOutcome: account.winningOutcome,
          confidence: account.confidence,
          proposedAt: account.proposedAt.toNumber() * 1000,
          proposedBy: account.proposer.toBase58(),
          evidenceHash: bytesToHex(account.evidenceHash),
          bondSol: account.bond.toNumber() / scale,
          challengeWindowMs: CHALLENGE_WINDOW_SECS * 1000,
          challengeDeadline:
            (account.challengeDeadline.toNumber() > 0
              ? account.challengeDeadline.toNumber()
              : account.proposedAt.toNumber() + CHALLENGE_WINDOW_SECS) * 1000,
          challenged: false,
          snippets: [],
        }
      : undefined,
    creator: account.creator.toBase58(),
    creatorFeeBps: account.creatorFeeBps,
    source: `chain #${id}`,
    sourceUrl: explorer,
  };
  return market;
}

/**
 * Convert a raw Position account into the store's `Position` view.
 *
 * Positions are SOL-denominated like every market, so the scale is the shared
 * {@link SOL_DECIMALS}.
 */
export function mapPositionToStore(
  marketId: string,
  account: PositionAccountLike
): Position {
  const scale = SOL_DECIMALS;
  const yes = account.yesShares.toNumber() / scale;
  const no = account.noShares.toNumber() / scale;
  const backs: Record<string, number> = {};
  for (const wb of account.wordBacks) backs[wb.word] = wb.amount.toNumber() / scale;
  return {
    id: `p-${marketId}`,
    marketId,
    yesShares: yes,
    noShares: no,
    avgYesPrice: yes > 0 ? account.yesCost.toNumber() / scale / yes : undefined,
    avgNoPrice: no > 0 ? account.noCost.toNumber() / scale / no : undefined,
    wordBacks: Object.keys(backs).length ? backs : undefined,
    claimed: account.claimed,
  };
}

export interface PositionAccountLike {
  yesShares: { toNumber(): number };
  noShares: { toNumber(): number };
  yesCost: { toNumber(): number };
  noCost: { toNumber(): number };
  wordBacks: Array<{ word: string; amount: { toNumber(): number } }>;
  claimed: boolean;
}

/* ------------------------------------------------------------------ */
/* Reads                                                                 */
/* ------------------------------------------------------------------ */

export async function fetchChainMarket(id: number): Promise<Market | null> {
  try {
    const account = (await program.account.market.fetch(marketPda(id))) as unknown as ChainMarketAccount;
    const market = mapMarketToStore(account);
    await attachChainEvidence(market, account);
    return market;
  } catch {
    return null; // account closed or not created yet
  }
}

export async function fetchChainMarkets(ids: number[]): Promise<Market[]> {
  const out: Market[] = [];
  for (const id of ids) {
    const m = await fetchChainMarket(id);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Fetch every on-chain market in a single RPC (GPA over the Market
 * discriminator). This is what the demo poll uses: no id registry to keep in
 * sync — any market the seed/official scripts or the UI created shows up, and
 * reseeded batches are picked up automatically.
 */
export async function fetchChainMarketsAll(): Promise<Market[]> {
  const accounts = await program.account.market.all();
  const sorted = accounts.sort((a, b) => a.account.id.toNumber() - b.account.id.toNumber());
  const markets = sorted.map(({ account }) =>
    mapMarketToStore(account as unknown as ChainMarketAccount)
  );
  await Promise.all(
    markets.map((m, i) =>
      attachChainEvidence(m, sorted[i].account as unknown as ChainMarketAccount)
    )
  );
  return markets;
}

/** Raw EvidenceManifest account: the program stores the manifest bytes verbatim. */
interface EvidenceManifestAccount {
  bytes: Uint8Array | number[];
}

/**
 * Decode the on-chain evidence manifest JSON into UI snippets. The program
 * stores the canonical manifest bytes verbatim, so this is a UTF-8 decode +
 * JSON.parse of the v1 `excerpts` array; any failure degrades to no snippets.
 */
export function decodeEvidenceSnippets(
  bytes: Uint8Array | number[] | null | undefined
): TranscriptSnippet[] {
  if (!bytes) return [];
  try {
    const text = new TextDecoder().decode(Uint8Array.from(bytes));
    const manifest = JSON.parse(text) as {
      excerpts?: Array<{ startMs?: number; speaker?: string; text?: string }>;
    };
    const excerpts = Array.isArray(manifest.excerpts) ? manifest.excerpts : [];
    return excerpts.map((e) => ({
      t: Number(e?.startMs ?? 0),
      speaker: String(e?.speaker ?? ""),
      text: String(e?.text ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * Attach committed on-chain evidence excerpts to a mapped market. Only markets
 * whose `evidenceHash` is non-zero have an EvidenceManifest PDA; the read is
 * best-effort (a market can briefly be `resolving` before evidence lands).
 */
async function attachChainEvidence(market: Market, account: ChainMarketAccount): Promise<void> {
  if (!market.evidence) return;
  const hash = account.evidenceHash;
  if (!Array.isArray(hash) || hash.length !== 32 || hash.every((b) => b === 0)) return;
  try {
    const pda = evidencePda(marketPda(account.id.toNumber()), hash);
    const ev = (await program.account.evidenceManifest.fetch(
      pda
    )) as unknown as EvidenceManifestAccount;
    market.evidence.snippets = decodeEvidenceSnippets(ev.bytes);
  } catch {
    /* evidence not committed yet or a transient RPC hiccup — leave snippets empty */
  }
}

export async function fetchChainPosition(
  marketId: number,
  owner: PublicKey
): Promise<Position | null> {
  try {
    const account = (await program.account.position.fetch(
      positionPda(marketPda(marketId), owner)
    )) as unknown as PositionAccountLike;
    return mapPositionToStore(`c${marketId}`, account);
  } catch {
    return null;
  }
}

/** Wallet SOL balance in UI units (raw lamports / 1e9). */
export async function solBalanceUi(owner: PublicKey): Promise<number> {
  try {
    return (await connection().getBalance(owner)) / SOL_DECIMALS;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* On-chain activity (trade history)                                   */
/* ------------------------------------------------------------------ */

/**
 * Anchor's `BorshInstructionCoder` camelCases the IDL, but we normalize the
 * name here so a raw snake_case name (e.g. from a fixture) maps too.
 */
function normalizeIxName(name: string): string {
  return name.replace(/_/g, "").toLowerCase();
}

function bnToNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (v && typeof (v as { toNumber?: unknown }).toNumber === "function") {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v ?? 0);
}

/**
 * Map a decoded program instruction to an {@link ActivityItem} payload, or
 * `null` for instructions that don't belong in the trade feed (market
 * creation, challenges, config/pause, oracle bookkeeping).
 *
 * Pure and RPC-free so it can be unit-tested with decoded-IDL fixtures.
 */
export function mapChainInstruction(
  name: string,
  data: Record<string, unknown>,
  scale: number
): { kind: ActivityItem["kind"]; side?: string; amount: number } | null {
  switch (normalizeIxName(name)) {
    case "buybinary":
      return {
        kind: "buy",
        side: bnToNumber(data.side) === 0 ? "yes" : "no",
        amount: bnToNumber(data.cost) / scale,
      };
    case "sellbinary":
      return {
        kind: "sell",
        side: bnToNumber(data.side) === 0 ? "yes" : "no",
        amount: bnToNumber(data.shares) / scale,
      };
    case "backword": {
      const word = String(data.word ?? "");
      return { kind: "back", side: word || undefined, amount: bnToNumber(data.amount) / scale };
    }
    case "claimpayout":
      return { kind: "claim", amount: 0 };
    case "lockmarket":
      return { kind: "resolve", amount: 0 };
    case "proposeresolution": {
      const outcome = String(data.outcome ?? "");
      return { kind: "resolve", side: outcome || undefined, amount: 0 };
    }
    case "finalizeresolution":
      return { kind: "resolve", amount: 0 };
    default:
      return null;
  }
}

interface BorshInstructionCoderLike {
  decode(data: string, encoding: "base64"): { name: string; data: Record<string, unknown> } | null;
}

interface ParsedInstructionLike {
  programId?: unknown;
  data?: string;
}

/**
 * Real on-chain trade history for a market, decoded from its account
 * signatures. The program emits no events for trades, so the only source is
 * the instructions in each transaction; `buy_binary`/`sell_binary`/`back_word`
 * carry the amount, `claim_payout`/resolution instructions are shown without
 * one (their values aren't in the instruction args).
 *
 * Best-effort: any RPC or decode failure yields `[]` rather than throwing, so
 * the feed degrades to "no history" instead of breaking the page.
 */
export async function fetchChainActivity(
  id: number,
  scale: number,
  limit = 25
): Promise<ActivityItem[]> {
  try {
    const records = await fetchDecodedChainIxs(id);
    const out: ActivityItem[] = [];
    for (const r of records) {
      const mapped = mapChainInstruction(r.name, r.data, scale);
      if (!mapped) continue;
      out.push({
        id: `${r.sig}:${r.ix}`,
        marketId: `c${id}`,
        kind: mapped.kind,
        side: mapped.side,
        amount: mapped.amount,
        user: r.user,
        at: r.at,
      });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Decoded instruction records + price-series reconstruction           */
/* ------------------------------------------------------------------ */

/** A single program instruction decoded off the chain, with provenance. */
export interface DecodedChainIx {
  /** Anchor instruction name as decoded (e.g. `buyBinary`). */
  name: string;
  /** Decoded instruction args (BN/numbers/enums as the coder returns them). */
  data: Record<string, unknown>;
  /** Block time in ms (0 when the RPC didn't report one). */
  at: number;
  /** Slot — tie-break for transactions sharing a block time. */
  slot: number;
  /** Transaction signature. */
  sig: string;
  /** Message-level instruction index (stable feed id). */
  ix: number;
  /** Short display address of the paying signer. */
  user: string;
}

/**
 * Fetch and decode every program instruction on a market's account, in
 * ascending `(blockTime, slot)` order. Paginates through the account's
 * signatures so the reconstruction below sees the full trade history instead
 * of only the most recent page.
 *
 * Best-effort: returns `[]` on any RPC/decode failure.
 */
async function fetchDecodedChainIxsUncached(id: number): Promise<DecodedChainIx[]> {
  try {
    const conn = connection();
    const addr = marketPda(id);
    const sigs: string[] = [];
    let before: string | undefined;
    const pageSize = 100;
    let pages = 0;
    while (pages < 20) {
      pages += 1;
      const batch = await withRetry(() =>
        conn.getSignaturesForAddress(addr, { limit: pageSize, before })
      );
      if (batch.length === 0) break;
      sigs.push(...batch.filter((s) => !s.err).map((s) => s.signature));
      before = batch[batch.length - 1].signature;
      if (batch.length < pageSize) break;
    }
    if (sigs.length === 0) return [];

    const txs = await fetchParsedTxs(conn, sigs);
    const coder = (program as unknown as { coder: { instruction: BorshInstructionCoderLike } })
      .coder;

    const out: DecodedChainIx[] = [];
    for (let ti = 0; ti < sigs.length; ti += 1) {
      const tx = txs[ti];
      if (!tx || tx.meta?.err) continue;
      const at = (tx.blockTime ?? 0) * 1000;
      const slot = tx.slot ?? 0;
      const signer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey;
      const user = signer ? shortAddr(signer.toBase58()) : "unknown";
      const instructions = tx.transaction.message.instructions as unknown as ParsedInstructionLike[];
      instructions.forEach((ix, ii) => {
        const pid = ix.programId as { equals?: (p: PublicKey) => boolean } | undefined;
        if (!pid?.equals || !pid.equals(PROGRAM_ID) || !ix.data) return;
        const decoded = coder.instruction.decode(ix.data, "base64");
        if (!decoded) return;
        out.push({
          name: decoded.name,
          data: decoded.data,
          at,
          slot,
          sig: sigs[ti]!,
          ix: ii,
          user,
        });
      });
    }

    return out.sort((a, b) => a.at - b.at || a.slot - b.slot);
  } catch {
    return [];
  }
}

// Decoded history is shared by the activity feed and the price-series
// reconstruction; cache non-empty results briefly and dedupe concurrent
// callers so the 15s poller and the page don't refetch the same transactions.
const ixsCache = new Map<number, { t: number; recs: DecodedChainIx[] }>();
const ixsInflight = new Map<number, Promise<DecodedChainIx[]>>();
const IXS_TTL_MS = 30_000;

export async function fetchDecodedChainIxs(id: number): Promise<DecodedChainIx[]> {
  const cached = ixsCache.get(id);
  if (cached && Date.now() - cached.t < IXS_TTL_MS) return cached.recs;
  const inflight = ixsInflight.get(id);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const recs = await fetchDecodedChainIxsUncached(id);
      if (recs.length > 0) ixsCache.set(id, { t: Date.now(), recs });
      return recs;
    } finally {
      ixsInflight.delete(id);
    }
  })();
  ixsInflight.set(id, p);
  return p;
}

/** Snapshot of the market state the price series replays / validates against. */
export interface ChainSeriesMarket {
  type: MarketType;
  /** LMSR liquidity parameter, base units. */
  b: number;
  /** Current YES/NO shares, base units (validation anchor). */
  yesShares: number;
  noShares: number;
  /** Current total pari-mutuel pool, base units (validation anchor). */
  totalPool: number;
  /** Word pools, base units (validation anchor). */
  words: Array<{ word: string; pool: number }>;
}

/**
 * Reconstruct a market's price history from its decoded trade instructions by
 * replaying the program's LMSR / pari-mutuel math in order. For binary markets
 * every `buy_binary` mints `floor(sharesForCost(...))` shares and every
 * `sell_binary` burns its exact share count, so the price at each trade is
 * `lmsrProbYes`. For majority markets `back_word` grows a word's pool and the
 * series tracks the leading word's pot share — the same convention the sim
 * chart uses.
 *
 * Pure and RPC-free so it can be unit-tested with decoded fixtures.
 *
 * Self-validating: after replaying the *whole* history the cumulative shares
 * (binary) or pools (majority) must converge to the current account state; if
 * the mirror math drifts past a small tolerance (or the history was
 * truncated), `[]` is returned so callers fall back to live-append points
 * instead of drawing a wrong curve.
 */
export function buildChainPriceSeries(
  market: ChainSeriesMarket,
  records: DecodedChainIx[],
  opts?: { cap?: number }
): PricePoint[] {
  const cap = opts?.cap ?? 240;

  if (market.type === "binary") {
    let yes = 0;
    let no = 0;
    const b = market.b;
    const points: PricePoint[] = [];
    for (const r of records) {
      const norm = normalizeIxName(r.name);
      if (norm === "buybinary") {
        const side = bnToNumber(r.data.side) === 0 ? "yes" : "no";
        const cost = bnToNumber(r.data.cost);
        if (cost > 0) {
          const shares = Math.floor(lmsrSharesForCost(yes, no, b, side, cost));
          if (shares > 0) {
            if (side === "yes") yes += shares;
            else no += shares;
            points.push({ t: r.at || Date.now(), v: lmsrProbYes(yes, no, b) });
          }
        }
      } else if (norm === "sellbinary") {
        const side = bnToNumber(r.data.side) === 0 ? "yes" : "no";
        const shares = bnToNumber(r.data.shares);
        if (shares > 0) {
          if (side === "yes") yes = Math.max(0, yes - shares);
          else no = Math.max(0, no - shares);
          points.push({ t: r.at || Date.now(), v: lmsrProbYes(yes, no, b) });
        }
      }
    }
    const tol = Math.max(2, (market.yesShares + market.noShares) * 0.01);
    if (Math.abs(yes - market.yesShares) > tol || Math.abs(no - market.noShares) > tol) {
      return [];
    }
    return points.length === 0 ? [] : resample(points, cap);
  }

  const pools = new Map(market.words.map((w) => [w.word, 0]));
  let total = 0;
  const points: PricePoint[] = [];
  for (const r of records) {
    const norm = normalizeIxName(r.name);
    if (norm !== "backword") continue;
    const word = String(r.data.word ?? "");
    const amount = bnToNumber(r.data.amount);
    if (amount <= 0) continue;
    pools.set(word, (pools.get(word) ?? 0) + amount);
    total += amount;
    points.push({
      t: r.at || Date.now(),
      v: total > 0 ? Math.max(...pools.values()) / total : 0,
    });
  }
  const poolTol = Math.max(2, (market.totalPool + pools.size) * 0.01);
  if (
    Math.abs(total - market.totalPool) > poolTol ||
    [...market.words].some((w) => Math.abs((pools.get(w.word) ?? 0) - w.pool) > poolTol)
  ) {
    return [];
  }
  return points.length === 0 ? [] : resample(points, cap);
}

/**
 * Reconstruct a word-race (majority) market's per-word price history from its
 * `back_word` instructions: replay the pools in order and emit one point per
 * word at each event timestamp (aligned x-axis across all options, each value
 * the word's share of the running pot). Self-validating like
 * `buildChainPriceSeries` — returns `{}` when the replay drifts from the
 * account state so callers can fall back to live-append points.
 */
export function buildChainWordSeries(
  market: ChainSeriesMarket,
  records: DecodedChainIx[],
  opts?: { cap?: number }
): Record<string, PricePoint[]> {
  const cap = opts?.cap ?? 240;
  const series: Record<string, PricePoint[]> = {};
  for (const w of market.words) series[w.word] = [];
  const pools = new Map(market.words.map((w) => [w.word, 0]));
  let total = 0;
  for (const r of records) {
    const norm = normalizeIxName(r.name);
    if (norm !== "backword") continue;
    const word = String(r.data.word ?? "");
    const amount = bnToNumber(r.data.amount);
    if (amount <= 0) continue;
    pools.set(word, (pools.get(word) ?? 0) + amount);
    total += amount;
    const t = r.at || Date.now();
    for (const w of market.words) {
      series[w.word].push({
        t,
        v: total > 0 ? (pools.get(w.word) ?? 0) / total : 0,
      });
    }
  }
  const poolTol = Math.max(2, (market.totalPool + pools.size) * 0.01);
  if (
    Math.abs(total - market.totalPool) > poolTol ||
    market.words.some((w) => Math.abs((pools.get(w.word) ?? 0) - w.pool) > poolTol)
  ) {
    return {};
  }
  const out: Record<string, PricePoint[]> = {};
  for (const w of market.words) {
    const pts = series[w.word];
    if (pts.length > 0) out[w.word] = resample(pts, cap);
  }
  return out;
}

const seriesCache = new Map<number, { t: number; data: ChainSeriesData }>();
const seriesInflight = new Map<number, Promise<ChainSeriesData>>();
const SERIES_TTL_MS = 30_000;

/** Reconstructed series for an on-chain market: one leader line + per-word lines. */
export interface ChainSeriesData {
  leader: PricePoint[];
  /** Word-race per-option series; empty for binary markets. */
  words: Record<string, PricePoint[]>;
}

const EMPTY_SERIES: ChainSeriesData = { leader: [], words: {} };

/**
 * Fetch the reconstructed series for an on-chain market in a single pass (one
 * account read + the decoded trade history) and return both the leader line
 * (cards/sparklines) and, for word-race markets, every option's line (chart).
 * Cached briefly and deduped to avoid hammering the rate-limited RPC.
 */
export async function fetchChainSeries(id: number): Promise<ChainSeriesData> {
  const cached = seriesCache.get(id);
  if (
    cached &&
    (cached.data.leader.length > 0 || Object.keys(cached.data.words).length > 0) &&
    Date.now() - cached.t < SERIES_TTL_MS
  ) {
    return cached.data;
  }
  const inflight = seriesInflight.get(id);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const [account, records] = await Promise.all([
        program.account.market.fetch(marketPda(id)) as unknown as ChainMarketAccount,
        fetchDecodedChainIxs(id),
      ]);
      const market: ChainSeriesMarket = {
        type: enumKey(account.marketType) as MarketType,
        b: account.b.toNumber(),
        yesShares: account.yesShares.toNumber(),
        noShares: account.noShares.toNumber(),
        totalPool: account.totalPool.toNumber(),
        words: account.words.map((w) => ({ word: w.word, pool: w.pool.toNumber() })),
      };
      const data: ChainSeriesData = {
        leader: buildChainPriceSeries(market, records, { cap: 240 }),
        words:
          market.type === "majority"
            ? buildChainWordSeries(market, records, { cap: 240 })
            : {},
      };
      if (data.leader.length > 0 || Object.keys(data.words).length > 0) {
        seriesCache.set(id, { t: Date.now(), data });
      }
      return data;
    } catch {
      return EMPTY_SERIES;
    } finally {
      seriesInflight.delete(id);
    }
  })();
  seriesInflight.set(id, p);
  return p;
}

/** Leader-only reconstructed series (kept for cards/sparklines). */
export async function fetchChainPriceSeries(id: number): Promise<PricePoint[]> {
  return (await fetchChainSeries(id)).leader;
}


/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

/** A minimal wallet-adapter-like signer (publicKey + signTransaction). */
export interface ChainSigner {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

/** Build a transaction from program instructions (always raises CU budget). */
export function signAndSend(
  signer: ChainSigner,
  ixs: TransactionInstruction[]
): Promise<string> {
  return sendAll(signer, ixs);
}

/** Sleep helper for send backoff. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send already-signed raw bytes, retrying transient/rate-limit failures.
 * Re-sending identical bytes is idempotent (the signature is deterministic), so
 * a "already processed" error means an earlier attempt actually landed.
 */
async function sendRawWithRetry(
  conn: Connection,
  raw: Uint8Array,
  sig: string
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < 6; i += 1) {
    try {
      return await conn.sendRawTransaction(raw, { preflightCommitment: "confirmed", skipPreflight: true });
    } catch (err) {
      const code = (err as { code?: number } | null)?.code;
      const msg = String((err as { message?: string } | null)?.message ?? err);
      if (/already been processed|already processed|has already been/i.test(msg)) return sig;
      lastErr = err;
      const rateLimited = code === 429 || /429|too many requests|rate limit/i.test(msg);
      const wait = Math.min((rateLimited ? 1200 : 700) * 2 ** i, 8000) + Math.random() * 250;
      await sleep(wait);
    }
  }
  throw lastErr;
}

/**
 * Send a batch of instructions for a signer. Signs once (a single wallet
 * prompt) then retries the send and confirms against the block height, so a
 * flaky/rate-limited RPC never turns into a spurious "unexpected error" or a
 * second signature prompt.
 */
export async function sendAll(
  signer: ChainSigner,
  ixs: TransactionInstruction[]
): Promise<string> {
  const conn = connection();
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }));
  tx.add(...ixs);

  const { blockhash, lastValidBlockHeight } = await withRetry(
    () => conn.getLatestBlockhash("confirmed"),
    4,
    500
  );
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = blockhash;

  const signed = await signer.signTransaction(tx);
  const sig = signed.signature ? bs58.encode(signed.signature) : "";
  const raw = signed.serialize();

  const sentSig = await sendRawWithRetry(conn, raw, sig);
  await conn.confirmTransaction(
    { signature: sentSig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return sentSig;
}

/** Accounts shared by every value-moving instruction (SOL: no token plumbing). */
function tradeAccounts(market: PublicKey, trader: PublicKey): Record<string, unknown> {
  return {
    config: CONFIG_PDA,
    market,
    vault: vaultPda(market),
    position: positionPda(market, trader),
    systemProgram: SYSTEM_PROGRAM,
  };
}

export interface ChainTradeResult {
  sig: string;
  solBalance: number;
}

export async function chainBuyBinary(
  signer: ChainSigner,
  marketId: number,
  side: "yes" | "no",
  amountUi: number
): Promise<ChainTradeResult> {
  const market = marketPda(marketId);
  const current = (await withRetry(() =>
    program.account.market.fetch(market)
  )) as unknown as ChainMarketAccount;
  const scale = SOL_DECIMALS;
  const cost = Math.round(amountUi * scale);
  const expectedUi = sharesForCostUi(current, side, amountUi, scale);
  if (expectedUi <= 0) throw new Error("No shares for that cost");
  const minShares = Math.floor(expectedUi * 0.98 * scale);
  const ix = await program.methods
    .buyBinary(side === "yes" ? 0 : 1, new BN(cost), new BN(minShares))
    .accounts({
      trader: signer.publicKey,
      ...tradeAccounts(market, signer.publicKey),
    } as never)
    .instruction();
  const sig = await sendAll(signer, [ix]);
  return { sig, solBalance: await solBalanceUi(signer.publicKey) };
}

export async function chainSellBinary(
  signer: ChainSigner,
  marketId: number,
  side: "yes" | "no",
  sharesUi: number
): Promise<ChainTradeResult> {
  const market = marketPda(marketId);
  const current = (await withRetry(() =>
    program.account.market.fetch(market)
  )) as unknown as ChainMarketAccount;
  const scale = SOL_DECIMALS;
  const shares = Math.round(sharesUi * scale);
  const proceedsUi = proceedsForSellUi(current, side, sharesUi, scale);
  if (proceedsUi <= 0) throw new Error("No proceeds for that sell");
  const minProceeds = Math.floor(proceedsUi * 0.98 * scale);
  const ix = await program.methods
    .sellBinary(side === "yes" ? 0 : 1, new BN(shares), new BN(minProceeds))
    .accounts({
      trader: signer.publicKey,
      ...tradeAccounts(market, signer.publicKey),
    } as never)
    .instruction();
  const sig = await sendAll(signer, [ix]);
  return { sig, solBalance: await solBalanceUi(signer.publicKey) };
}

export async function chainBackWord(
  signer: ChainSigner,
  marketId: number,
  word: string,
  amountUi: number
): Promise<ChainTradeResult> {
  const market = marketPda(marketId);
  const scale = SOL_DECIMALS;
  const amount = Math.round(amountUi * scale);
  const ix = await program.methods
    .backWord(word, new BN(amount))
    .accounts({
      backer: signer.publicKey,
      ...tradeAccounts(market, signer.publicKey),
    } as never)
    .instruction();
  const sig = await sendAll(signer, [ix]);
  return { sig, solBalance: await solBalanceUi(signer.publicKey) };
}

export async function chainClaim(
  signer: ChainSigner,
  marketId: number
): Promise<ChainTradeResult> {
  const market = marketPda(marketId);
  const ix = await program.methods
    .claimPayout()
    .accounts({
      claimant: signer.publicKey,
      ...tradeAccounts(market, signer.publicKey),
    } as never)
    .instruction();
  const sig = await sendAll(signer, [ix]);
  return { sig, solBalance: await solBalanceUi(signer.publicKey) };
}

export async function chainChallenge(
  signer: ChainSigner,
  marketId: number
): Promise<ChainTradeResult> {
  const market = marketPda(marketId);
  const ix = await program.methods
    .challengeResolution()
    .accounts({
      challenger: signer.publicKey,
      ...tradeAccounts(market, signer.publicKey),
      challenge: challengePda(market),
    } as never)
    .instruction();
  const sig = await sendAll(signer, [ix]);
  return { sig, solBalance: await solBalanceUi(signer.publicKey) };
}

export interface ChainCreateParams {
  title: string;
  event: string;
  vertical: Vertical;
  type: MarketType;
  words: string[];
  minutes: number;
  sourceUrl: string;
  binaryPhrase: string;
}

/**
 * UI-units liquidity for markets created from the UI. On-chain this maps to
 * `1 SOL` of `b` (base units `1e9`), matching the seeded markets so the
 * reserve ante (~0.69 SOL from the creator) stays affordable and prices move
 * sensibly. The store uses this same value (not the sim-market `max(50, …)`)
 * for chain-created markets so quotes agree with the program between polls.
 */
export const CHAIN_CREATE_B_UI = 1;

export interface ChainCreateResult {
  id: number;
  sig: string;
  solBalance: number;
}

export async function chainCreateMarket(
  signer: ChainSigner,
  params: ChainCreateParams
): Promise<ChainCreateResult> {
  // Fail before the wallet prompt: an over-long title otherwise costs a
  // signature, a devnet transaction that reverts, and a wallet error the user
  // cannot act on (6009 TitleTooLong was the failure mode on devnet).
  const problems = chainCreateProblems(params);
  if (problems.length) throw new Error(problems[0]);

  const id = await freeChainId();
  // Reserve before signing so a retry can never re-propose this id: the
  // program would reject the duplicate PDA, and the wallet would report that
  // as the same opaque error.
  rememberChainId(id);
  const market = marketPda(id);
  const bUi = CHAIN_CREATE_B_UI;
  const nowSec = Math.floor(Date.now() / 1000);
  const endTimeSec = nowSec + params.minutes * 60;
  const resolutionSpec = buildResolutionSpec({
    marketAddress: market.toBase58(),
    marketType: params.type,
    words: params.words,
    binaryPhrase: params.binaryPhrase,
    sourceUrl: params.sourceUrl,
    window: {
      startsAtMs: nowSec * 1000,
      endsAtMs: endTimeSec * 1000,
    },
  });
  const specBytes = new TextEncoder().encode(canonicalJson(resolutionSpec));
  const specHash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", specBytes));
  const scale = SOL_DECIMALS;
  const ix = await program.methods
    .createMarket(
      new BN(id),
      params.title,
      params.event,
      enumArg(params.vertical),
      enumArg(params.type),
      new BN(Math.round(bUi * scale)),
      params.words,
      new BN(endTimeSec),
      100,
      Array.from(specHash)
    )
    .accounts({
      creator: signer.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      resolutionSpec: resolutionSpecPda(market),
      systemProgram: SYSTEM_PROGRAM,
    } as never)
    .instruction();
  try {
    const sig = await sendAll(signer, [ix]);
    await persistLocalSpec(market.toBase58(), resolutionSpec);
    return { id, sig, solBalance: await solBalanceUi(signer.publicKey) };
  } catch (err) {
    // A confirmation timeout is indistinguishable from a failure from here,
    // but the market account is not: if it exists the transaction landed, so
    // report the create instead of a failure the user would "retry" straight
    // into a duplicate-PDA rejection.
    if (await marketAccountExists(id).catch(() => false)) {
      await persistLocalSpec(market.toBase58(), resolutionSpec);
      return { id, sig: "", solBalance: await solBalanceUi(signer.publicKey) };
    }
    throw new Error(chainErrorText(err));
  }
}

/**
 * Persist a freshly created market's canonical resolution spec to the
 * resolver's local store (`/api/specs`). The program commits only the spec
 * hash; without the bytes the market can never be resolved. Best-effort: a
 * failure here does not fail the creation (the market exists on-chain).
 */
async function persistLocalSpec(marketAddress: string, spec: unknown): Promise<void> {
  try {
    await fetch("/api/specs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketAddress, spec }),
    });
  } catch {
    /* non-fatal */
  }
}

/* ------------------------------------------------------------------ */
/* LMSR mirrors over the raw ChainMarketAccount (base units in,        */
/* UI units out — callers convert back with `* scale`).                */
/* ------------------------------------------------------------------ */

/**
 * Shares bought for `costUi`, in UI units.
 *
 * `lmsrSharesForCost` is the same closed form as the program's
 * `shares_for_cost`, evaluated in base units (as on-chain) and only then
 * scaled to UI units. (An earlier closed form here was dimensionally wrong and
 * returned base units, which made every buy revert with `SlippageTooHigh`.)
 */
export function sharesForCostUi(
  m: ChainMarketAccount,
  side: "yes" | "no",
  costUi: number,
  scale: number = SOL_DECIMALS
): number {
  const cost = costUi * scale;
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return (
    lmsrSharesForCost(m.yesShares.toNumber(), m.noShares.toNumber(), m.b.toNumber(), side, cost) /
    scale
  );
}

/**
 * Proceeds from selling `sharesUi`, in UI units.
 *
 * Matches the program's `sell_return` exactly (the formula was already
 * correct); only the missing `/ scale` here previously inflated
 * `min_proceeds` by 1e9 and made every sell revert.
 */
export function proceedsForSellUi(
  m: ChainMarketAccount,
  side: "yes" | "no",
  sharesUi: number,
  scale: number = SOL_DECIMALS
): number {
  const b = m.b.toNumber();
  const ys = m.yesShares.toNumber();
  const ns = m.noShares.toNumber();
  const shares = sharesUi * scale;
  if (!Number.isFinite(shares) || shares <= 0) return 0;
  return lmsrSellReturn(ys, ns, b, side, shares) / scale;
}