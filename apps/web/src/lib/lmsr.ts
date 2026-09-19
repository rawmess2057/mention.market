/**
 * LMSR (Logarithmic Market Scoring Rule) pricing engine for binary markets.
 *
 * State: (qYes, qNo, b)
 *   cost(qYes, qNo) = b * ln(e^(qYes/b) + e^(qNo/b))
 *   price(YES) = e^(qYes/b) / (e^(qYes/b) + e^(qNo/b))
 *
 * Prices always sum to 1, liquidity is effectively infinite, and the market
 * maker's max loss is bounded by b * ln(2).
 */

const LN2 = Math.LN2;

/** Implied probability of YES given current share counts. */
export function lmsrProbYes(qYes: number, qNo: number, b: number): number {
  // Degenerate setup (no liquidity or no shares) — bail out at 50/50 rather
  // than produce NaN (0/0) that would poison the UI and chart state.
  if (!Number.isFinite(b) || b <= 0) return 0.5;
  if (!Number.isFinite(qYes) || !Number.isFinite(qNo)) return 0.5;
  // Numerically stable: subtract max exponent
  const eY = Math.exp((qYes - Math.max(qYes, qNo)) / b);
  const eN = Math.exp((qNo - Math.max(qYes, qNo)) / b);
  return eY / (eY + eN);
}

/** Cost to buy `shares` of `side` (shares = guaranteed payout if side wins). */
export function lmsrBuyCost(
  qYes: number,
  qNo: number,
  b: number,
  side: "yes" | "no",
  shares: number
): number {
  const before = lmsrCost(qYes, qNo, b);
  const after =
    side === "yes"
      ? lmsrCost(qYes + shares, qNo, b)
      : lmsrCost(qYes, qNo + shares, b);
  return after - before;
}

/** Payout received when selling `shares` of `side` back into the AMM. */
export function lmsrSellReturn(
  qYes: number,
  qNo: number,
  b: number,
  side: "yes" | "no",
  shares: number
): number {
  const before = lmsrCost(qYes, qNo, b);
  const after =
    side === "yes"
      ? lmsrCost(qYes - shares, qNo, b)
      : lmsrCost(qYes, qNo - shares, b);
  return before - after;
}

/** New price after buying `shares` of `side` — used for the confirm sheet. */
export function lmsrPriceAfterBuy(
  qYes: number,
  qNo: number,
  b: number,
  side: "yes" | "no",
  shares: number
): { yes: number; no: number } {
  const qy = side === "yes" ? qYes + shares : qYes;
  const qn = side === "no" ? qNo + shares : qNo;
  return { yes: lmsrProbYes(qy, qn, b), no: 1 - lmsrProbYes(qy, qn, b) };
}

/** Total LMSR cost function C(q) = b * ln(e^(qYes/b) + e^(qNo/b)). */
function lmsrCost(qYes: number, qNo: number, b: number): number {
  if (!Number.isFinite(b) || b <= 0) return 0;
  const m = Math.max(qYes, qNo);
  return b * (Math.log(Math.exp((qYes - m) / b) + Math.exp((qNo - m) / b)) + m / b);
}

/** Max loss the AMM subsidizes: b * ln(2). Useful for market sizing. */
export function lmsrMaxSubsidy(b: number): number {
  return b * LN2;
}

/**
 * Instant P&L valuation of a binary position at current prices.
 * Returns the position's cash-out value if sold now.
 */
export function lmsrPositionValue(
  qYes: number,
  qNo: number,
  b: number,
  pos: { yesShares: number; noShares: number }
): number {
  let v = 0;
  if (pos.yesShares > 0) v += lmsrSellReturn(qYes, qNo, b, "yes", pos.yesShares);
  if (pos.noShares > 0) v += lmsrSellReturn(qYes, qNo, b, "no", pos.noShares);
  return v;
}
