import { describe, expect, it } from "vitest";
import {
  binaryCostBasis,
  majorityBacked,
  openPositionValue,
  pnlSeries,
  realizedOnSell,
  summarizePnl,
  unrealizedPnl,
  verticalBreakdown,
} from "../pnl";
import type { Market, Position, TradeRecord } from "../types";

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
    words: [{ word: "a", pool: 100, bettors: 1, lastBetAt: NOW }],
    rules: "",
    creator: "you",
    creatorFeeBps: 100,
    source: "s",
    sourceUrl: "",
    ...overrides,
  };
}

const posYes: Position = { id: "p1", marketId: "bm", yesShares: 100, avgYesPrice: 0.4 };
const posMaj: Position = { id: "p2", marketId: "mm", wordBacks: { a: 25, b: 15 } };

function trade(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    id: "t",
    marketId: "bm",
    marketTitle: "Bin",
    kind: "buy",
    side: "yes",
    amount: 1,
    shares: 1,
    price: 1,
    pnl: 0,
    at: NOW,
    ...overrides,
  };
}

describe("cost basis", () => {
  it("sums both sides at average entry", () => {
    expect(binaryCostBasis({ ...posYes, noShares: 50, avgNoPrice: 0.6 })).toBeCloseTo(40 + 30, 6);
    expect(binaryCostBasis({ id: "x", marketId: "y" })).toBe(0);
  });

  it("realizedOnSell = proceeds - avgEntry * shares", () => {
    expect(realizedOnSell(0.4, 100, 62)).toBeCloseTo(22, 6);
    expect(realizedOnSell(0.4, 100, 30)).toBeCloseTo(-10, 6);
  });

  it("majorityBacked sums word backs", () => {
    expect(majorityBacked(posMaj)).toBe(40);
  });
});

describe("openPositionValue / unrealizedPnl", () => {
  it("marks open binary positions to market", () => {
    const v = openPositionValue(binaryMarket(), posYes);
    expect(v).toBeGreaterThan(0);
    expect(unrealizedPnl(binaryMarket(), posYes)).toBeCloseTo(v - 40, 6);
  });

  it("returns 0 once a binary market is resolved (payout lives in claimable)", () => {
    const resolved = binaryMarket({ status: "resolved", winningOutcome: "yes" });
    expect(openPositionValue(resolved, posYes)).toBe(0);
    expect(unrealizedPnl(resolved, posYes)).toBe(0);
  });

  it("majority positions carry invested value and zero pnl while open", () => {
    expect(openPositionValue(majorityMarket(), posMaj)).toBe(40);
    expect(unrealizedPnl(majorityMarket(), posMaj)).toBe(0);
  });
});

describe("summarizePnl", () => {
  it("aggregates realized, settled count and win rate from the ledger", () => {
    const trades = [
      trade({ kind: "buy", amount: 30, pnl: 0 }),
      trade({ kind: "sell", amount: 40, pnl: 10 }),
      trade({ kind: "sell", amount: 5, pnl: -5 }),
      trade({ kind: "claim", amount: 20, pnl: 8 }),
    ];
    const o = summarizePnl(trades, {}, {}, {}, 100);
    expect(o.realizedPnl).toBeCloseTo(13, 6);
    expect(o.settled).toBe(3);
    expect(o.wins).toBe(2);
    expect(o.losses).toBe(1);
    expect(o.winRate).toBeCloseTo(2 / 3, 6);
    expect(o.buyVolume).toBeCloseTo(30, 6);
    expect(o.tradeCount).toBe(4);
  });

  it("adds open binary mark-to-market into netWorth and unrealized", () => {
    const m = binaryMarket();
    const pos = { id: "p", marketId: "bm", yesShares: 100, avgYesPrice: 0.4 };
    const o = summarizePnl([], { bm: pos }, { bm: m }, { cc: 25 }, 500);
    expect(o.claimableTotal).toBe(25);
    expect(o.unrealizedPnl).toBeCloseTo(openPositionValue(m, pos) - 40, 6);
    expect(o.netWorth).toBeCloseTo(500 + openPositionValue(m, pos) + 25, 6);
  });

  it("excludes resolved positions from open value", () => {
    const m = binaryMarket({ status: "resolved", winningOutcome: "yes" });
    const pos = { id: "p", marketId: "bm", yesShares: 100, avgYesPrice: 0.4 };
    const o = summarizePnl([], { bm: pos }, { bm: m }, { bm: 100 }, 500);
    expect(o.openValue).toBe(0);
    expect(o.netWorth).toBe(600);
  });

  it("empty book returns zeroed stats with balance intact", () => {
    const o = summarizePnl([], {}, {}, {}, 250);
    expect(o).toMatchObject({
      realizedPnl: 0,
      unrealizedPnl: 0,
      netWorth: 250,
      winRate: 0,
      settled: 0,
    });
  });
});

describe("verticalBreakdown", () => {
  it("groups trade stats per vertical", () => {
    const trades = [
      trade({ marketId: "bm", kind: "sell", pnl: 12 }),
      trade({ marketId: "mm", kind: "back", amount: 40 }),
    ];
    const by = verticalBreakdown(trades, { bm: binaryMarket(), mm: majorityMarket() });
    const streams = by.find((v) => v.vertical === "streams")!;
    const podcasts = by.find((v) => v.vertical === "podcasts")!;
    expect(streams.realizedPnl).toBeCloseTo(12, 6);
    expect(podcasts.buyVolume).toBe(40);
    expect(podcasts.tradeCount).toBe(1);
  });

  it("falls back to streams for unknown markets and is empty on no trades", () => {
    expect(verticalBreakdown([trade({ marketId: "nope" })], {})[0].vertical).toBe("streams");
    expect(verticalBreakdown([], {})).toEqual([]);
  });
});

describe("pnlSeries", () => {
  it("buckets settled trades by day with a running cumulative", () => {
    const t0 = new Date(2026, 0, 5, 12).getTime();
    const trades = [
      trade({ kind: "sell", pnl: 10, at: t0 }),
      trade({ kind: "claim", pnl: 5, at: t0 + 24 * 3_600_000 }), // next day
    ];
    const s = pnlSeries(trades, 14);
    expect(s.length).toBe(2);
    expect(s[1].cumulativePnl).toBeCloseTo(15, 6);
    expect(s.every((b) => b.tradeCount >= 1)).toBe(true);
  });

  it("models buys but is empty when nothing is settled", () => {
    expect(pnlSeries([trade({ kind: "buy" })])).toEqual([]);
    expect(pnlSeries([])).toEqual([]);
  });

  it("caps the last `buckets` days", () => {
    const t0 = new Date(2026, 0, 1, 0).getTime();
    const trades = Array.from({ length: 40 }, (_, i) =>
      trade({ kind: "sell", pnl: 1, at: t0 + i * 24 * 3_600_000 })
    );
    expect(pnlSeries(trades, 7).length).toBeLessThanOrEqual(7);
  });
});