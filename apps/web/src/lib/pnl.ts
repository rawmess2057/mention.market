/**
 * PnL accounting for the per-user trade ledger.
 *
 * Realized PnL is booked at the moment a position is closed:
 *  - sell:  proceeds - avgEntry * shares          (average-cost basis)
 *  - claim: payout     - cost basis of winning side
 * Unrealized PnL marks open binary positions to market via the LMSR
 * position value. Majority (word-race) "positions" are invested amounts,
 * not markable until settlement, so they carry zero PnL while open.
 *
 * netWorth = free-play balance + open position value + claimable winnings.
 */

import type { Market, Position, TradeRecord, Vertical } from "./types";
import { lmsrPositionValue } from "./lmsr";

/** USDC cost basis embedded in a binary position (both sides). */
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
 * Mark-to-market value of an open binary position, or the invested amount
 * for an open majority position. Returns 0 once resolution is known
 * (the payout lives in `claimable` instead).
 */
export function openPositionValue(m: Market, pos: Position): number {
  if (m.status !== "open" && m.status !== "locked") return 0;
  if (m.type === "binary") {
    return lmsrPositionValue(m.yesShares, m.noShares, m.b, {
      yesShares: pos.yesShares ?? 0,
      noShares: pos.noShares ?? 0,
    });
  }
  return majorityBacked(pos);
}

/** USDC backed across all words in a majority market. */
export function majorityBacked(pos: Position): number {
  return Object.values(pos.wordBacks ?? {}).reduce((s, v) => s + v, 0);
}

/** Unrealized PnL of an open position (mark vs. cost); 0 once resolved. */
export function unrealizedPnl(m: Market, pos: Position): number {
  if (m.type !== "binary") return 0;
  if (m.status !== "open" && m.status !== "locked") return 0;
  return openPositionValue(m, pos) - binaryCostBasis(pos);
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
 * `balance` is the free-play USDC balance (net worth = balance + book value).
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
    if (m.status === "resolving" || (!m.winningOutcome && m.status !== "resolved")) {
      openValue += openPositionValue(m, pos);
      openCost += m.type === "binary" ? binaryCostBasis(pos) : majorityBacked(pos);
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