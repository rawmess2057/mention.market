import { describe, expect, it } from "vitest";
import {
  lmsrBuyCost,
  lmsrMaxSubsidy,
  lmsrPositionValue,
  lmsrPriceAfterBuy,
  lmsrProbYes,
  lmsrSellReturn,
} from "../lmsr";

describe("lmsrProbYes", () => {
  it("returns 0.5 when the pools are equal", () => {
    expect(lmsrProbYes(100, 100, 300)).toBeCloseTo(0.5, 10);
    expect(lmsrProbYes(0, 0, 300)).toBeCloseTo(0.5, 10);
  });

  it("is bounded to (0,1) and sums with NO to 1", () => {
    for (const [qy, qn, b] of [
      [640, 410, 300],
      [1180, 960, 500],
      [210, 260, 150],
      [1520, 1010, 400],
    ]) {
      const p = lmsrProbYes(qy, qn, b);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
      expect(p + (1 - p)).toBeCloseTo(1, 10);
    }
  });

  it("increases with more YES shares", () => {
    expect(lmsrProbYes(500, 400, 300)).toBeGreaterThan(lmsrProbYes(400, 500, 300));
  });

  it("never returns NaN for degenerate/invalid liquidity", () => {
    expect(lmsrProbYes(0, 0, 0)).toBe(0.5);
    expect(lmsrProbYes(10, 20, -5)).toBe(0.5);
    expect(lmsrProbYes(10, 20, Number.NaN)).toBe(0.5);
    expect(lmsrProbYes(Number.NaN, 20, 300)).toBe(0.5);
    expect(lmsrProbYes(10, Number.POSITIVE_INFINITY, 300)).toBe(0.5);
  });

  it("is NaN-safe on the markets that seed b=0 (word races)", () => {
    expect(Number.isNaN(lmsrProbYes(0, 0, 0))).toBe(false);
    expect(lmsrProbYes(0, 0, 0)).toBeCloseTo(0.5, 10);
  });
});

describe("lmsrBuyCost / lmsrSellReturn", () => {
  it("charges a positive, monotonic-increasing cost", () => {
    let prev = 0;
    for (const shares of [1, 5, 25, 100]) {
      const cost = lmsrBuyCost(500, 400, 300, "yes", shares);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeGreaterThan(prev);
      prev = cost;
    }
  });

  it("buying N then re-selling N recovers the exact cost", () => {
    const qy = 500;
    const qn = 400;
    const b = 300;
    const shares = 40;
    const cost = lmsrBuyCost(qy, qn, b, "yes", shares);
    const back = lmsrSellReturn(qy + shares, qn, b, "yes", shares);
    expect(back).toBeCloseTo(cost, 6);
  });

  it("is symmetric at balanced state and more expensive into a lopsided pool", () => {
    const yes = lmsrBuyCost(100, 100, 300, "yes", 50);
    const no = lmsrBuyCost(100, 100, 300, "no", 50);
    expect(yes).toBeCloseTo(no, 6);
    // Buying YES when the YES side is already leading costs more marginal price.
    expect(lmsrBuyCost(400, 100, 300, "yes", 50)).toBeGreaterThan(
      lmsrBuyCost(100, 100, 300, "yes", 50)
    );
  });

  it("cost functions stay finite with degenerate liquidity", () => {
    expect(lmsrBuyCost(0, 0, 0, "yes", 10)).toBe(0);
    expect(lmsrSellReturn(0, 0, 0, "no", 10)).toBe(0);
    expect(Number.isNaN(lmsrBuyCost(0, 0, 0, "yes", 10))).toBe(false);
  });
});

describe("lmsrPriceAfterBuy", () => {
  it("moves the price toward the bought side", () => {
    const before = lmsrProbYes(500, 400, 300);
    const after = lmsrPriceAfterBuy(500, 400, 300, "yes", 50).yes;
    expect(after).toBeGreaterThan(before);
    expect(lmsrPriceAfterBuy(500, 400, 300, "yes", 50).no).toBeCloseTo(1 - after, 10);
  });

  it("no-ops on zero shares", () => {
    const p = lmsrProbYes(500, 400, 300);
    expect(lmsrPriceAfterBuy(500, 400, 300, "no", 0).yes).toBeCloseTo(p, 10);
  });
});

describe("misc", () => {
  it("lmsrMaxSubsidy matches b * ln(2)", () => {
    expect(lmsrMaxSubsidy(300)).toBeCloseTo(300 * Math.LN2, 10);
  });

  it("lmsrPositionValue is zero for an empty position and finite otherwise", () => {
    const q = { yesShares: 0, noShares: 0 };
    expect(lmsrPositionValue(500, 400, 300, q)).toBe(0);
    const v = lmsrPositionValue(500, 400, 300, { yesShares: 20, noShares: 10 });
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });
});