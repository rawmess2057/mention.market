/**
 * Core domain types for mention.market
 */

export type Vertical = "streams" | "sports" | "earnings" | "politics" | "podcasts";

export type MarketType = "binary" | "majority";

export type MarketStatus = "open" | "locked" | "resolving" | "resolved";

export interface WordPool {
  word: string;
  pool: number;
  bettors: number;
  lastBetAt: number;
}

export interface Market {
  id: string;
  slug: string;
  title: string;
  event: string;
  vertical: Vertical;
  type: MarketType;
  status: MarketStatus;
  createdAt: number;
  startsAt?: number;
  endTime: number;
  resolvedAt?: number;
  volume: number;
  traders: number;
  yesShares: number;
  noShares: number;
  b: number;
  words?: WordPool[];
  rules: string;
  winningOutcome?: string;
  confidence?: number;
  evidence?: Evidence;
  creator: string;
  creatorFeeBps: number;
  source: string;
  sourceUrl: string;
}

export interface TranscriptSnippet {
  t: number;
  speaker: string;
  text: string;
}

export interface Evidence {
  winningOutcome: string;
  confidence: number;
  proposedAt: number;
  proposedBy: string;
  evidenceHash: string;
  bondUsd: number;
  challengeWindowMs: number;
  challengeDeadline: number;
  challenged: boolean;
  snippets: TranscriptSnippet[];
  audioClipUrl?: string;
}

export interface Position {
  id: string;
  marketId: string;
  yesShares?: number;
  noShares?: number;
  avgYesPrice?: number;
  avgNoPrice?: number;
  wordBacks?: Record<string, number>;
  claimed?: boolean;
  payout?: number;
}

export interface ActivityItem {
  id: string;
  marketId: string;
  kind: "buy" | "sell" | "back" | "resolve" | "create";
  side?: "yes" | "no" | string;
  amount: number;
  user: string;
  at: number;
}

export type TradeKind = "buy" | "sell" | "back" | "claim";

/** Per-user trade ledger entry — the source of truth for trade history + PnL. */
export interface TradeRecord {
  id: string;
  marketId: string;
  marketTitle: string;
  kind: TradeKind;
  /** "yes" | "no" for binary; the word for majority backs; winning outcome for claims. */
  side: string;
  /** USDC out (buy/back) or in (sell/claim). */
  amount: number;
  /** Binary shares granted/returned; 0 for back/claim. */
  shares: number;
  /** Share entry/exit price in USDC (binary); implied pot-share (0..1) at back time for majority; 0 otherwise. */
  price: number;
  /** Average entry price in USDC of the closes position (sells); the entry price (buys); undefined otherwise. */
  avgEntry?: number;
  /** Realized P&L of this leg (sell/claim); 0 on buys. */
  pnl: number;
  at: number;
  /** Devnet signature when the trade moved real USDC. */
  txSig?: string;
}

export interface LeaderboardRow {
  rank: number;
  handle: string;
  avatarSeed: string;
  points: number;
  profit: number;
  winRate: number;
  trades: number;
}

export interface User {
  handle: string;
  points: number;
  rank: number;
  balance: number;
  /** Connected wallet address this book belongs to ("" = guest). */
  wallet?: string;
  /** Unit the balance is denominated in. */
  balanceKind?: "usdc" | "sol";
}

export const VERTICAL_META: Record<
  Vertical,
  { label: string; emoji: string }
> = {
  streams: { label: "Streams", emoji: "🎮" },
  sports: { label: "Sports", emoji: "⚽" },
  earnings: { label: "Earnings", emoji: "📈" },
  politics: { label: "Politics", emoji: "🏛️" },
  podcasts: { label: "Podcasts", emoji: "🎙️" },
};

export const STATUS_META: Record<
  MarketStatus,
  { label: string; className: string }
> = {
  open: { label: "Live", className: "bg-live/10 text-red-brand border-red-brand/20" },
  locked: { label: "Locked", className: "bg-amber-50 text-amber-700 border-amber-200" },
  resolving: { label: "Resolving", className: "bg-blue-light text-blue border-blue/20" },
  resolved: { label: "Resolved", className: "bg-green-light text-green border-green/20" },
};
