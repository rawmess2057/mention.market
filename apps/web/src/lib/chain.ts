/**
 * On-chain client for the mention.market Anchor program on devnet.
 *
 * Chain markets are stored in the sim store under ids like `c1`, `c9002`
 * (the leading `c` marks a market backed by a real program account). Their
 * numerical values are UI-scaled: raw base units are divided by
 * `SOL_DECIMALS` (1e9) so the existing LMSR/display math keeps working;
 * amounts are converted back to lamports only at the instruction boundary.
 */

import { Connection, PublicKey, Keypair, ComputeBudgetProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
// Import the CJS entry explicitly: anchor's ESM build drops `Wallet`/`BN`
// and webpack's interop leaves the default export empty in SSR bundles.
// (This is the same build shape the anchor CLI scripts use.)
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor/dist/cjs/index.js";
import mentionIdl from "@/lib/idl/mention.json";
import { DEVNET_USDC_MINT } from "@/lib/usdc";
import type { Market, MarketStatus, MarketType, Position, Vertical } from "@/lib/types";

export const PROGRAM_ID = new PublicKey("E6CW51RhjVAiMKJMjzfUNWDDyetqninZzRSLa4nRdZDV");
export const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Raw base units per UI unit for SOL markets (SOL decides the UI scale). */
export const SOL_DECIMALS = 1_000_000_000;

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
    market: { fetch(a: PublicKey): Promise<unknown> };
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

export const SCALE_UI = SOL_DECIMALS;

export function isChainMarket(m: Market): boolean {
  return isChainId(m.id);
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

export const DEFAULT_CHAIN_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9002];

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
    volume: account.volume.toNumber() / SCALE_UI,
    traders: account.traders,
    yesShares: account.yesShares.toNumber() / SCALE_UI,
    noShares: account.noShares.toNumber() / SCALE_UI,
    b: account.b.toNumber() / SCALE_UI,
    words:
      marketType === "majority"
        ? account.words.map((w) => ({
            word: w.word,
            pool: w.pool.toNumber() / SCALE_UI,
            bettors: w.bettors,
            lastBetAt: endTimeSec * 1000,
          }))
        : undefined,
    rules:
      "Chain-resolved market: resolution is posted on-chain by the oracle, opening a 120s challenge window. All value is real devnet SOL escrowed in the program vault.",
    winningOutcome: resolving ? account.winningOutcome : undefined,
    confidence: resolving ? account.confidence : undefined,
    evidence: resolving
      ? {
          winningOutcome: account.winningOutcome,
          confidence: account.confidence,
          proposedAt: account.proposedAt.toNumber() * 1000,
          proposedBy: account.proposer.toBase58(),
          evidenceHash: bytesToHex(account.evidenceHash),
          bondUsd: account.bond.toNumber() / SCALE_UI,
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

/** Convert a raw Position account into the store's `Position` view. */
export function mapPositionToStore(marketId: string, account: PositionAccountLike): Position {
  const yes = account.yesShares.toNumber() / SCALE_UI;
  const no = account.noShares.toNumber() / SCALE_UI;
  const backs: Record<string, number> = {};
  for (const wb of account.wordBacks) backs[wb.word] = wb.amount.toNumber() / SCALE_UI;
  return {
    id: `p-${marketId}`,
    marketId,
    yesShares: yes,
    noShares: no,
    avgYesPrice: yes > 0 ? account.yesCost.toNumber() / SCALE_UI / yes : undefined,
    avgNoPrice: no > 0 ? account.noCost.toNumber() / SCALE_UI / no : undefined,
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

export async function fetchChainPosition(marketId: number, owner: PublicKey): Promise<Position | null> {
  try {
    const account = (await program.account.position.fetch(
      positionPda(marketPda(marketId), owner)
    )) as unknown as PositionAccountLike;
    return mapPositionToStore(`c${marketId}`, account);
  } catch {
    return null;
  }
}

export async function solBalanceUi(owner: PublicKey): Promise<number> {
  try {
    return (await connection().getBalance(owner)) / SCALE_UI;
  } catch {
    return 0;
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
  const cost = Math.round(amountUi * SCALE_UI);
  const expectedUi = sharesForCostUi(current, side, amountUi);
  if (expectedUi <= 0) throw new Error("No shares for that cost");
  const minShares = Math.floor(expectedUi * 0.98 * SCALE_UI);
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
  const shares = Math.round(sharesUi * SCALE_UI);
  const proceedsUi = proceedsForSellUi(current, side, sharesUi);
  if (proceedsUi <= 0) throw new Error("No proceeds for that sell");
  const minProceeds = Math.floor(proceedsUi * 0.98 * SCALE_UI);
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
  const amount = Math.round(amountUi * SCALE_UI);
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
  const bUi = Math.max(50, params.minutes * 2);
  const nowSec = Math.floor(Date.now() / 1000);
  const ix = await program.methods
    .createMarket(
      new BN(id),
      params.title,
      params.event,
      enumArg(params.vertical),
      enumArg(params.type),
      { sol: {} },
      new BN(Math.round(bUi * SCALE_UI)),
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
/* LMSR mirrors on ChainMarketAccount raw values (all in base units)   */
/* ------------------------------------------------------------------ */

export function sharesForCostUi(
  m: ChainMarketAccount,
  side: "yes" | "no",
  costUi: number
): number {
  const b = m.b.toNumber();
  const ys = m.yesShares.toNumber();
  const ns = m.noShares.toNumber();
  const cost = costUi * SCALE_UI;
  if (side === "yes") {
    const eY = Math.exp(ys / b);
    const eN = Math.exp(ns / b);
    return (b * Math.log(eY + cost / b)) - ys;
  }
  const eY = Math.exp(ys / b);
  const eN = Math.exp(ns / b);
  return (b * Math.log(eN + cost / b)) - ns;
}

export function proceedsForSellUi(
  m: ChainMarketAccount,
  side: "yes" | "no",
  sharesUi: number
): number {
  const b = m.b.toNumber();
  const ys = m.yesShares.toNumber();
  const ns = m.noShares.toNumber();
  const shares = sharesUi * SCALE_UI;
  const eY = Math.exp(ys / b);
  const eN = Math.exp(ns / b);
  if (side === "yes") {
    const after = b * Math.log(Math.exp(-shares / b) * eY + eN);
    return (b * Math.log(eY + eN)) - after;
  }
  const after = b * Math.log(eY + Math.exp(-shares / b) * eN);
  return (b * Math.log(eY + eN)) - after;
}