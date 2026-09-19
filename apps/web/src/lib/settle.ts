/**
 * Settlement math for the per-wallet book.
 *
 * Once a market resolves, a winning position becomes "claimable": the owner can
 * claim the payout once (flipping `pos.claimed`). Nothing here touches the
 * exchange-side seed data — payouts derive purely from resolved markets and the
 * wallet's own positions.
 */

import { settleMajority } from "./parimutuel";
import type { Market, Position } from "./types";

export interface ClaimQuote {
  /** Winning side: "yes" | "no" for binary, the word for majority races. */
  side: string;
  /** USDC this wallet can claim. */
  payout: number;
  /** Cost basis of everything the wallet staked in this market. */
  cost: number;
}

/** Payout a wallet is owed for `pos` in resolved market `m`; null if not owed. */
export function claimPayout(m: Market, pos: Position): ClaimQuote | null {
  if (m.status !== "resolved" || !m.winningOutcome) return null;
  const side = m.winningOutcome;

  if (m.type === "binary") {
    const isYes = side === "yes";
    const shares = isYes ? (pos.yesShares ?? 0) : (pos.noShares ?? 0);
    if (shares <= 0) return null;
    const cost =
      (pos.avgYesPrice ?? 0) * (pos.yesShares ?? 0) +
      (pos.avgNoPrice ?? 0) * (pos.noShares ?? 0);
    return { side, payout: shares, cost };
  }

  const backed = pos.wordBacks?.[side] ?? 0;
  if (backed <= 0) return null;
  const settled = settleMajority(m.words ?? [], side);
  return {
    side,
    payout: settled.yourShare(backed),
    cost: Object.values(pos.wordBacks ?? {}).reduce((s, v) => s + v, 0),
  };
}

/** Map of marketId -> claimable USDC for the wallet's winning, unclaimed positions. */
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