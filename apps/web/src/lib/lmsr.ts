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

/**
 * Largest share count a fixed `amount` buys, inverting `lmsrBuyCost` via
 * binary search (40 iterations → sub-basis-point precision).
 */
export function lmsrSharesForCost(
  qYes: number,
  qNo: number,
  b: number,
  side: "yes" | "no",
  amount: number
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const cost = (sh: number) => lmsrBuyCost(qYes, qNo, b, side, sh);
  let lo = 0;
  let hi = 1;
  while (cost(hi) < amount && hi < Number.MAX_SAFE_INTEGER / 4) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cost(mid) < amount) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface BuyQuote {
  /** Shares granted for the fixed amount. */
  shares: number;
  /** Effective entry price: amount / shares (SOL per $1-outcome share). */
  avgPrice: number;
  /** The side's implied price before the buy. */
  before: number;
  /** The side's implied price after the buy. */
  after: number;
  /** Relative move of the side's price caused solely by this buy. */
  impactPct: number;
}

/**
 * Full quote for a fixed-size buy: how the order moves the AMM's price and
 * what entry price the buyer actually gets (slippage = the implicit tax).
 */
export function lmsrBuyQuote(
  qYes: number,
  qNo: number,
  b: number,
  side: "yes" | "no",
  amount: number
): BuyQuote {
  const shares = lmsrSharesForCost(qYes, qNo, b, side, amount);
  const probYes = lmsrProbYes(qYes, qNo, b);
  const before = side === "yes" ? probYes : 1 - probYes;
  const after =
    side === "yes"
      ? lmsrPriceAfterBuy(qYes, qNo, b, side, shares).yes
      : lmsrPriceAfterBuy(qYes, qNo, b, side, shares).no;
  return {
    shares,
    avgPrice: shares > 0 ? amount / shares : 0,
    before,
    after,
    impactPct: before > 0 ? ((after - before) / before) * 100 : 0,
  };
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
