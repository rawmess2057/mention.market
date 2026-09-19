import { describe, expect, it } from "vitest";
import { claimPayout, claimableAmounts } from "../settle";
import type { Market, Position } from "../types";

const NOW = Date.now();

function binaryMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "bm",
    slug: "bin",
    title: "Bin",
    event: "e",
    vertical: "streams",
    type: "binary",
    status: "open",
    createdAt: NOW - 60_000,
    endTime: NOW + 60_000,
    volume: 0,
    traders: 0,
    yesShares: 600,
    noShares: 400,
    b: 300,
    rules: "",
    creator: "you",
    creatorFeeBps: 100,
    source: "s",
    sourceUrl: "",
    ...overrides,
  };
}

function majorityMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "mm",
    slug: "maj",
    title: "Maj",
    event: "e",
    vertical: "podcasts",
    type: "majority",
    status: "open",
    createdAt: NOW - 60_000,
    endTime: NOW + 60_000,
    volume: 0,
    traders: 0,
    yesShares: 0,
    noShares: 0,
    b: 0,
    words: [
      { word: "a", pool: 100, bettors: 2, lastBetAt: NOW },
      { word: "b", pool: 40, bettors: 1, lastBetAt: NOW },
    ],
    rules: "",
    creator: "you",
    creatorFeeBps: 100,
    source: "s",
    sourceUrl: "",
    ...overrides,
  };
}

describe("claimPayout — binary", () => {
  it("pays 1 USDC per winning share held", () => {
    const m = binaryMarket({ status: "resolved", winningOutcome: "yes" });
    const pos: Position = { id: "p1", marketId: "bm", yesShares: 60, avgYesPrice: 0.52 };
    const q = claimPayout(m, pos);
    expect(q?.payout).toBeCloseTo(60, 6);
    expect(q?.cost).toBeCloseTo(31.2, 6);
    expect(q?.side).toBe("yes");
  });

  it("pays on NO when NO wins", () => {
    const m = binaryMarket({ status: "resolved", winningOutcome: "no" });
    const pos: Position = { id: "p1", marketId: "bm", noShares: 25, avgNoPrice: 0.47 };
    expect(claimPayout(m, pos)?.payout).toBeCloseTo(25, 6);
  });

  it("returns null while open, on losses, or with nothing held", () => {
    const open = binaryMarket();
    const losing = binaryMarket({ status: "resolved", winningOutcome: "yes" });
    const noHeld: Position = { id: "p1", marketId: "bm" };
    expect(claimPayout(open, { id: "p1", marketId: "bm", yesShares: 5 })).toBeNull();
    expect(claimPayout(losing, { id: "p1", marketId: "bm", noShares: 5 })).toBeNull();
    expect(claimPayout(losing, noHeld)).toBeNull();
  });
});

describe("claimPayout — majority", () => {
  it("splits the net pot pro-rata to the winning pool", () => {
    const m = majorityMarket({ status: "resolved", winningOutcome: "a" });
    const pos: Position = { id: "p2", marketId: "mm", wordBacks: { a: 25, b: 15 } };
    // net pot = (100 + 40) * 0.99 = 138.6; share = 25/100 -> 34.65
    expect(claimPayout(m, pos)?.payout).toBeCloseTo(34.65, 6);
    expect(claimPayout(m, pos)?.cost).toBe(40);
  });

  it("returns null when a different word wins", () => {
    const m = majorityMarket({ status: "resolved", winningOutcome: "b" });
    const pos: Position = { id: "p2", marketId: "mm", wordBacks: { a: 25 } };
    expect(claimPayout(m, pos)).toBeNull();
  });
});

describe("claimableAmounts", () => {
  it("maps only resolved, unclaimed, winning positions", () => {
    const markets = {
      bm: binaryMarket({ status: "resolved", winningOutcome: "yes" }),
      mm: majorityMarket({ status: "resolved", winningOutcome: "a" }),
      open: binaryMarket(),
    };
    const positions: Record<string, Position> = {
      bm: { id: "p1", marketId: "bm", yesShares: 60, avgYesPrice: 0.52 },
      mm: { id: "p2", marketId: "mm", wordBacks: { a: 25 } },
      mmClaimed: { id: "p3", marketId: "mm", wordBacks: { a: 25 }, claimed: true },
      open: { id: "p4", marketId: "open", yesShares: 10 },
    };
    const out = claimableAmounts(positions, markets);
    expect(out.bm).toBeCloseTo(60, 6);
    expect(out.mm).toBeCloseTo(34.65, 6);
    expect(out.mmClaimed).toBeUndefined();
    expect(out.open).toBeUndefined();
  });
});