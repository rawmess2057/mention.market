/**
 * On-chain client for the mention.market Anchor program on devnet.
 *
 * Chain markets are stored in the sim store under ids like `c1`, `c9002`
 * (the leading `c` marks a market backed by a real program account). Their
 * numerical values are UI-scaled: raw base units are divided by the market's
 * own asset scale — `SOL_DECIMALS` (1e9) for SOL, `USDC_DECIMALS` (1e6) for
 * USDC — so the existing LMSR/display math keeps working; amounts are
 * converted back to base units only at the instruction boundary.
 * Use {@link scaleForAsset} rather than a shared constant: mixing them up
 * misprices a market by three orders of magnitude.
 */

import { Connection, PublicKey, Keypair, ComputeBudgetProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
// Import the CJS entry explicitly: anchor's ESM build drops `Wallet`/`BN`
// and webpack's interop leaves the default export empty in SSR bundles.
// (This is the same build shape the anchor CLI scripts use.)
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor/dist/cjs/index.js";
import mentionIdl from "@/lib/idl/mention.json";
import { DEVNET_USDC_MINT } from "@/lib/usdc";
import { lmsrBuyCost, lmsrSellReturn } from "@/lib/lmsr";
import { shortAddr } from "@/lib/format";
import type { ActivityItem, Market, MarketStatus, MarketType, Position, Vertical } from "@/lib/types";

export const PROGRAM_ID = new PublicKey("E6CW51RhjVAiMKJMjzfUNWDDyetqninZzRSLa4nRdZDV");
export const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Raw base units per UI unit for SOL markets. */
export const SOL_DECIMALS = 1_000_000_000;
/** Raw base units per UI unit for USDC markets (devnet mint is 6dp). */
export const USDC_DECIMALS = 1_000_000;

/** On-chain challenge window (seconds) used to derive evidence metadata. */
export const CHALLENGE_WINDOW_SECS = 120;

export function connection(): Connection {
  return new Connection("https://api.devnet.solana.com", "confirmed");
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

/**
 * Raw base units per UI unit for a market's `asset` enum.
 *
 * A USDC market is 1e6 and a SOL market is 1e9, so using one scale for both
 * would misprice by 1000x. Unknown variants throw rather than silently fall
 * back to SOL — a new asset kind must be added here before it can be listed.
 */
export function scaleForAsset(asset: unknown): number {
  switch (enumKey(asset)) {
    case "sol":
      return SOL_DECIMALS;
    case "usdc":
      return USDC_DECIMALS;
    default:
      throw new Error(`unknown market asset: ${JSON.stringify(asset)}`);
  }
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
  if (m.status === "resolved" && (m.traders ?? 0) === 0) return true;
  if (m.status === "resolved" && m.resolvedAt !== undefined && m.resolvedAt <= now - 60 * 60_000) return true;
  return false;
}

/**
 * Scale for a store-level `Market`. Simulated markets have no `asset` (their
 * numbers are already UI units) and are not scaled here, so this only ever
 * sees chain markets — but a missing `asset` is a bug, not a default.
 */
export function scaleForMarket(m: Market): number {
  if (m.asset === undefined) {
    throw new Error(`market ${m.id} has no asset; expected "sol" or "usdc"`);
  }
  return scaleForAsset({ [m.asset]: {} });
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

/* ------------------------------------------------------------------ */
/* Account -> store view mapping                                       */
/* ------------------------------------------------------------------ */

/** Raw on-chain Market account (as decoded by the anchor client). */
export interface ChainMarketAccount {
  id: { toNumber(): number };
  title: string;
  event: string;
  vertical: object;
  asset: object;
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
  const scale = scaleForAsset(account.asset);
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
    asset: enumKey(account.asset) as Market["asset"],
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
    rules: `Chain-resolved market: resolution is posted on-chain by the oracle, opening a 120s challenge window. All value is real devnet ${
      enumKey(account.asset) === "usdc" ? "USDC" : "SOL"
    } escrowed in the program vault.`,
    winningOutcome: resolving ? account.winningOutcome : undefined,
    confidence: resolving ? account.confidence : undefined,
    evidence: resolving
      ? {
          winningOutcome: account.winningOutcome,
          confidence: account.confidence,
          proposedAt: account.proposedAt.toNumber() * 1000,
          proposedBy: account.proposer.toBase58(),
          evidenceHash: bytesToHex(account.evidenceHash),
          bondUsd: account.bond.toNumber() / scale,
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
 * A Position doesn't carry its market's `asset`, so the scale must be passed
 * in by a caller that has the market. It defaults to SOL only as a
 * convenience for callers that have just read a SOL market.
 */
export function mapPositionToStore(
  marketId: string,
  account: PositionAccountLike,
  scale: number = SOL_DECIMALS
): Position {
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
    return mapMarketToStore(account);
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
  return accounts
    .sort((a, b) => a.account.id.toNumber() - b.account.id.toNumber())
    .map(({ account }) => mapMarketToStore(account as unknown as ChainMarketAccount));
}

/**
 * Base units per UI unit for `marketId`'s asset. Callers that already hold a
 * `Market` should pass `scaleForAsset` straight through instead of paying for
 * this extra RPC.
 */
export async function fetchScaleForMarket(marketId: number): Promise<number> {
  const account = (await program.account.market.fetch(marketPda(marketId))) as unknown as ChainMarketAccount;
  return scaleForAsset(account.asset);
}

export async function fetchChainPosition(
  marketId: number,
  owner: PublicKey,
  scale?: number
): Promise<Position | null> {
  try {
    const account = (await program.account.position.fetch(
      positionPda(marketPda(marketId), owner)
    )) as unknown as PositionAccountLike;
    return mapPositionToStore(
      `c${marketId}`,
      account,
      scale ?? (await fetchScaleForMarket(marketId))
    );
  } catch {
    return null;
  }
}

/** Wallet SOL balance in UI units — always lamports, never a market asset. */
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
    const conn = connection();
    const sigs = (await conn.getSignaturesForAddress(marketPda(id), { limit })).filter(
      (s) => !s.err
    );
    if (sigs.length === 0) return [];

    const txs = await conn.getParsedTransactions(
      sigs.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0 }
    );
    const coder = (program as unknown as { coder: { instruction: BorshInstructionCoderLike } })
      .coder;

    const out: ActivityItem[] = [];
    txs.forEach((tx, ti) => {
      if (!tx || tx.meta?.err) return;
      const at = (tx.blockTime ?? sigs[ti]?.blockTime ?? 0) * 1000;
      const signer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey;
      const user = signer ? shortAddr(signer.toBase58()) : "unknown";
      const instructions = tx.transaction.message.instructions as unknown as ParsedInstructionLike[];

      instructions.forEach((ix, ii) => {
        const pid = ix.programId as { equals?: (p: PublicKey) => boolean } | undefined;
        if (!pid?.equals || !pid.equals(PROGRAM_ID) || !ix.data) return;
        const decoded = coder.instruction.decode(ix.data, "base64");
        if (!decoded) return;
        const mapped = mapChainInstruction(decoded.name, decoded.data, scale);
        if (!mapped) return;
        out.push({
          id: `${sigs[ti]!.signature}:${ii}`,
          marketId: `c${id}`,
          kind: mapped.kind,
          side: mapped.side,
          amount: mapped.amount,
          user,
          at,
        });
      });
    });

    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

/** A minimal wallet-adapter-like signer (publicKey + sendTransaction). */
export interface ChainSigner {
  publicKey: PublicKey;
  sendTransaction: (tx: Transaction, conn: Connection) => Promise<string>;
}

/** Build a transaction from program instructions (always raises CU budget). */
export function signAndSend(
  signer: ChainSigner,
  ixs: TransactionInstruction[]
): Promise<string> {
  return sendAll(signer, ixs);
}

export async function sendAll(
  signer: ChainSigner,
  ixs: TransactionInstruction[]
): Promise<string> {
  const conn = connection();
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }));
  tx.add(...ixs);
  const sig = await signer.sendTransaction(tx, conn);
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

/** Accounts shared by every value-moving instruction (SOL market: ATAs null). */
function tradeAccounts(market: PublicKey, trader: PublicKey): Record<string, unknown> {
  return {
    config: CONFIG_PDA,
    market,
    vault: vaultPda(market),
    position: positionPda(market, trader),
    mint: DEVNET_USDC_MINT,
    tokenProgram: TOKEN_PROGRAM,
    associatedTokenProgram: ATA_PROGRAM,
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
  const current = (await program.account.market.fetch(market)) as unknown as ChainMarketAccount;
  const scale = scaleForAsset(current.asset);
  const cost = Math.round(amountUi * scale);
  const expectedUi = sharesForCostUi(current, side, amountUi, scale);
  if (expectedUi <= 0) throw new Error("No shares for that cost");
  const minShares = Math.floor(expectedUi * 0.98 * scale);
  const ix = await program.methods
    .buyBinary(side === "yes" ? 0 : 1, new BN(cost), new BN(minShares))
    .accounts({
      trader: signer.publicKey,
      ...tradeAccounts(market, signer.publicKey),
      traderAta: null,
      vaultAta: null,
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
  const current = (await program.account.market.fetch(market)) as unknown as ChainMarketAccount;
  const scale = scaleForAsset(current.asset);
  const shares = Math.round(sharesUi * scale);
  const proceedsUi = proceedsForSellUi(current, side, sharesUi, scale);
  if (proceedsUi <= 0) throw new Error("No proceeds for that sell");
  const minProceeds = Math.floor(proceedsUi * 0.98 * scale);
  const ix = await program.methods
    .sellBinary(side === "yes" ? 0 : 1, new BN(shares), new BN(minProceeds))
    .accounts({
      trader: signer.publicKey,
      ...tradeAccounts(market, signer.publicKey),
      traderAta: null,
      vaultAta: null,
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
  const scale = await fetchScaleForMarket(marketId);
  const amount = Math.round(amountUi * scale);
  const ix = await program.methods
    .backWord(word, new BN(amount))
    .accounts({
      backer: signer.publicKey,
      ...tradeAccounts(market, signer.publicKey),
      backerAta: null,
      vaultAta: null,
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
      claimantAta: null,
      vaultAta: null,
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
      challengerAta: null,
      vaultAta: null,
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
  const id = nextChainId();
  const market = marketPda(id);
  const bUi = CHAIN_CREATE_B_UI;
  const nowSec = Math.floor(Date.now() / 1000);
  // Every market this UI creates is SOL-denominated; keep the scale in lockstep.
  const asset = enumArg("sol");
  const scale = scaleForAsset(asset);
  const ix = await program.methods
    .createMarket(
      new BN(id),
      params.title,
      params.event,
      enumArg(params.vertical),
      enumArg(params.type),
      asset,
      new BN(Math.round(bUi * scale)),
      params.words,
      new BN(nowSec + params.minutes * 60),
      100
    )
    .accounts({
      creator: signer.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      systemProgram: SYSTEM_PROGRAM,
    } as never)
    .instruction();
  const sig = await sendAll(signer, [ix]);
  rememberChainId(id);
  return { id, sig, solBalance: await solBalanceUi(signer.publicKey) };
}

/* ------------------------------------------------------------------ */
/* LMSR mirrors over the raw ChainMarketAccount (base units in,        */
/* UI units out — callers convert back with `* scale`).                */
/* ------------------------------------------------------------------ */

/**
 * Shares bought for `costUi`, in UI units.
 *
 * Solves `C(q + shares) - C(q) = cost` by monotonic binary search — the same
 * method the program's `shares_for_cost` uses, so the value agrees with the
 * on-chain result to float precision. (A closed-form inversion is not used:
 * the previous one was both dimensionally wrong and returned base units,
 * which made every buy revert with `SlippageTooHigh`.)
 */
export function sharesForCostUi(
  m: ChainMarketAccount,
  side: "yes" | "no",
  costUi: number,
  scale: number = SOL_DECIMALS
): number {
  const b = m.b.toNumber();
  const ys = m.yesShares.toNumber();
  const ns = m.noShares.toNumber();
  const cost = costUi * scale;
  if (!Number.isFinite(cost) || cost <= 0) return 0;

  let lo = 0;
  let hi = 1;
  while (lmsrBuyCost(ys, ns, b, side, hi) < cost) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (lmsrBuyCost(ys, ns, b, side, mid) < cost) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2 / scale;
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