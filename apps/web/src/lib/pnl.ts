/**
 * PnL accounting for the per-user trade ledger.
 *
 * Realized PnL is booked at the moment a position is closed:
 *  - sell:  proceeds - avgEntry * shares          (average-cost basis)
 *  - claim: payout     - cost basis of winning side
 * Unrealized PnL marks unsettled positions with `positionMark`: shares ×
 * price while trading, the proposed outcome's payout while resolving.
 * Majority (word-race) backs are invested amounts until a proposal.
 *
 * netWorth = free-play balance + open position value + claimable winnings.
 */

import type { Market, Position, TradeRecord, Vertical } from "./types";
import { lmsrProbYes } from "./lmsr";
import { claimPayout, positionCost } from "./settle";

/** SOL cost basis embedded in a binary position (both sides). */
export function binaryCostBasis(pos: Position): number {
  return (
    (pos.avgYesPrice ?? 0) * (pos.yesShares ?? 0) +
    (pos.avgNoPrice ?? 0) * (pos.noShares ?? 0)
  );
}

/** Realized PnL from selling `shares` at average entry `avgEntry`. */
export function realizedOnSell(avgEntry: number, shares: number, proceeds: number): number {
  return proceeds - avgEntry * shares;
}

/**
 * What an unsettled position is worth, and on what basis.
 *
 *  - `price`:    open/locked binary — shares × the current price (the
 *                market's implied probability), the usual prediction-market
 *                mark. (The LMSR sell-all return is an exit price, not a value:
 *                for a sole trader it always equals the cost, so P&L read 0.)
 *  - `proposed`: resolving — an outcome is proposed and only a challenge can
 *                change it, so value the position at that outcome's payout.
 *  - `backed`:   open majority — invested amount (not markable before settlement).
 *
 * Resolved markets are worth 0 here: their payout lives in `claimable`.
 */
export function positionMark(m: Market, pos: Position): { value: number; basis: "price" | "proposed" | "backed" } {
  if (m.status === "resolved") return { value: 0, basis: "price" };
  if (m.status === "resolving" && m.winningOutcome) {
    const quote = claimPayout({ ...m, status: "resolved" }, pos);
    return { value: quote?.payout ?? 0, basis: "proposed" };
  }
  if (m.type === "binary") {
    const pYes = lmsrProbYes(m.yesShares, m.noShares, m.b);
    return { value: (pos.yesShares ?? 0) * pYes + (pos.noShares ?? 0) * (1 - pYes), basis: "price" };
  }
  return { value: majorityBacked(pos), basis: "backed" };
}

/** Current value of an unsettled position ({@link positionMark}); 0 once resolved. */
export function openPositionValue(m: Market, pos: Position): number {
  return positionMark(m, pos).value;
}

/** SOL backed across all words in a majority market. */
export function majorityBacked(pos: Position): number {
  return Object.values(pos.wordBacks ?? {}).reduce((s, v) => s + v, 0);
}

/** Unrealized PnL of an unsettled position (mark vs. cost); 0 once resolved. */
export function unrealizedPnl(m: Market, pos: Position): number {
  if (m.status === "resolved") return 0;
  return openPositionValue(m, pos) - positionCost(pos);
}

export interface PnlOverview {
  realizedPnl: number;
  unrealizedPnl: number;
  netPnl: number;
  claimableTotal: number;
  openValue: number;
  openCost: number;
  netWorth: number;
  balance: number;
  tradeCount: number;
  settled: number;
  wins: number;
  losses: number;
  winRate: number;
  buyVolume: number;
}

/**
 * Aggregate the whole book from the trade ledger + positions + claimable.
 * `balance` is the free-play SOL balance (net worth = balance + book value).
 */
export function summarizePnl(
  trades: TradeRecord[],
  positions: Record<string, Position>,
  markets: Record<string, Market>,
  claimable: Record<string, number>,
  balance: number
): PnlOverview {
  let realizedPnl = 0;
  let settled = 0;
  let wins = 0;
  let buyVolume = 0;
  for (const t of trades) {
    if (t.kind === "sell" || t.kind === "claim") {
      settled += 1;
      if (t.pnl > 0) wins += 1;
      realizedPnl += t.pnl;
    } else if (t.kind === "buy" || t.kind === "back") {
      buyVolume += t.amount;
    }
  }

  let openValue = 0;
  let openCost = 0;
  for (const [mid, pos] of Object.entries(positions)) {
    const m = markets[mid];
    if (!m) continue;
    // Resolving markets count at their proposed outcome (`positionMark`);
    // resolved ones are settled (their payout is in `claimable`).
    if (m.status !== "resolved") {
      openValue += openPositionValue(m, pos);
      openCost += positionCost(pos);
    }
  }

  const claimableTotal = Object.values(claimable).reduce((s, v) => s + v, 0);
  const unrealizedPnl = openValue - openCost;

  return {
    realizedPnl,
    unrealizedPnl,
    netPnl: realizedPnl + unrealizedPnl,
    claimableTotal,
    openValue,
    openCost,
    netWorth: balance + openValue + claimableTotal,
    balance,
    tradeCount: trades.length,
    settled,
    wins,
    losses: settled - wins,
    winRate: settled > 0 ? wins / settled : 0,
    buyVolume,
  };
}

export interface VerticalBreakdown {
  vertical: Vertical;
  tradeCount: number;
  buyVolume: number;
  realizedPnl: number;
}

export function verticalBreakdown(
  trades: TradeRecord[],
  markets: Record<string, Market>
): VerticalBreakdown[] {
  const by: Record<string, VerticalBreakdown> = {};
  for (const t of trades) {
    const v = markets[t.marketId]?.vertical ?? "streams";
    const row = (by[v] ??= {
      vertical: v,
      tradeCount: 0,
      buyVolume: 0,
      realizedPnl: 0,
    });
    row.tradeCount += 1;
    if (t.kind === "buy" || t.kind === "back") row.buyVolume += t.amount;
    if (t.kind === "sell" || t.kind === "claim") row.realizedPnl += t.pnl;
  }
  return Object.values(by).sort((a, b) => b.buyVolume - a.buyVolume);
}

export interface PnlBucket {
  label: string;
  /** Realized PnL realized within the bucket. */
  realizedPnl: number;
  /** Cumulative realized PnL up to and including the bucket. */
  cumulativePnl: number;
  tradeCount: number;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Bucket realized PnL into at most `buckets` day-sized windows (most recent
 * kept). Cumulative is the running sum across the emitted buckets.
 */
export function pnlSeries(trades: TradeRecord[], buckets = 14): PnlBucket[] {
  if (trades.length === 0) return [];
  const settled = trades.filter((t) => t.kind === "sell" || t.kind === "claim");
  if (settled.length === 0) return [];

  const maxAt = settled.reduce((mx, t) => Math.max(mx, t.at), 0);
  const minAt = settled.reduce((mn, t) => Math.min(mn, t.at), 0);
  const firstDay = Math.floor(minAt / DAY);
  const lastDay = Math.floor(maxAt / DAY);
  const daySpan = lastDay - firstDay + 1;

  const groups: Map<number, { pnl: number; count: number }> = new Map();
  for (const t of settled) {
    const d = Math.floor(t.at / DAY);
    const g = groups.get(d) ?? { pnl: 0, count: 0 };
    g.pnl += t.pnl;
    g.count += 1;
    groups.set(d, g);
  }

  const days = Array.from({ length: daySpan }, (_, i) => firstDay + i)
    .filter((d) => groups.has(d))
    .slice(-buckets);

  let running = 0;
  return days.map((d) => {
    const g = groups.get(d)!;
    running += g.pnl;
    const date = new Date(d * DAY);
    return {
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      realizedPnl: g.pnl,
      cumulativePnl: running,
      tradeCount: g.count,
    };
  });
}