/**
 * Settlement math for the per-wallet book.
 *
 * Once a market resolves, a winning position becomes "claimable": the owner can
 * claim the payout once (flipping `pos.claimed`). Nothing here touches the
 * exchange-side seed data — payouts derive purely from resolved markets and the
 * wallet's own positions.
 *
 * A voided market refunds instead (mirrors `claim.rs`): binary shares redeem at
 * 50/50, word-race backs are returned in full with no rake.
 */

import { settleMajority } from "./parimutuel";
import type { Market, Position } from "./types";

/** Reserved outcome for a voided market (`VOID_OUTCOME` in the program). */
export const VOID_OUTCOME = "void";

export function isVoided(m: Market): boolean {
  return m.status === "resolved" && m.winningOutcome === VOID_OUTCOME;
}

/** Cost basis of everything the wallet staked in this market. */
export function positionCost(pos: Position): number {
  return (
    (pos.avgYesPrice ?? 0) * (pos.yesShares ?? 0) +
    (pos.avgNoPrice ?? 0) * (pos.noShares ?? 0) +
    Object.values(pos.wordBacks ?? {}).reduce((s, v) => s + v, 0)
  );
}

export interface ClaimQuote {
  /** Winning side: "yes" | "no" for binary, the word for majority races, or "void". */
  side: string;
  /** SOL this wallet can claim. */
  payout: number;
  /** Cost basis of everything the wallet staked in this market. */
  cost: number;
}

/** Payout a wallet is owed for `pos` in resolved market `m`; null if not owed. */
export function claimPayout(m: Market, pos: Position): ClaimQuote | null {
  if (m.status !== "resolved" || !m.winningOutcome) return null;
  const side = m.winningOutcome;
  const cost = positionCost(pos);

  if (side === VOID_OUTCOME) {
    const payout =
      m.type === "binary"
        ? ((pos.yesShares ?? 0) + (pos.noShares ?? 0)) / 2
        : Object.values(pos.wordBacks ?? {}).reduce((s, v) => s + v, 0);
    return payout > 0 ? { side, payout, cost } : null;
  }

  if (m.type === "binary") {
    const isYes = side === "yes";
    const shares = isYes ? (pos.yesShares ?? 0) : (pos.noShares ?? 0);
    if (shares <= 0) return null;
    return { side, payout: shares, cost };
  }

  const backed = pos.wordBacks?.[side] ?? 0;
  if (backed <= 0) return null;
  const settled = settleMajority(m.words ?? [], side);
  return { side, payout: settled.yourShare(backed), cost };
}

/** Map of marketId -> claimable SOL for the wallet's winning, unclaimed positions. */
export function claimableAmounts(
  positions: Record<string, Position>,
  markets: Record<string, Market>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pos of Object.values(positions)) {
    const m = markets[pos.marketId];
    if (!m || pos.claimed) continue;
    const q = claimPayout(m, pos);
    if (q && q.payout > 0) out[pos.marketId] = q.payout;
  }
  return out;
}