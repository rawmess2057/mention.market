import { describe, expect, it } from "vitest";
import {
  POINTS_CLAIM,
  POINTS_HOLD_TO_RESOLVE,
  POINTS_PER_SOL,
  holdToResolvePoints,
  pointsForTrade,
} from "../sim";
import type { Position } from "../types";

describe("points rules", () => {
  it("awards 2 points per whole SOL spent", () => {
    expect(pointsForTrade(0)).toBe(0);
    expect(pointsForTrade(25)).toBe(50);
    expect(pointsForTrade(25.9)).toBe(50); // floor
    expect(pointsForTrade(-5)).toBe(0);
  });

  it("awards +10 for an open position held through resolution", () => {
    const positions: Record<string, Position> = {
      m1: { id: "p-m1", marketId: "m1", yesShares: 4, avgYesPrice: 0.6 },
    };
    expect(holdToResolvePoints(positions, "m1")).toBe(POINTS_HOLD_TO_RESOLVE);
    expect(holdToResolvePoints(positions, "m2")).toBe(0); // no position
  });

  it("does not double-pay already-claimed positions", () => {
    const positions: Record<string, Position> = {
      m1: { id: "p-m1", marketId: "m1", yesShares: 4, claimed: true, payout: 3 },
    };
    expect(holdToResolvePoints(positions, "m1")).toBe(0);
  });

  it("exposes the claim bonus as a constant", () => {
    expect(POINTS_CLAIM).toBe(25);
    expect(POINTS_PER_SOL).toBe(2);
  });
});