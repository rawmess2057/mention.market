import { describe, expect, it } from "vitest";
import {
  buildChainPriceSeries,
  type ChainSeriesMarket,
  type DecodedChainIx,
} from "../chain";
import { lmsrSharesForCost } from "../lmsr";
import { mergePricePoints } from "../history";

const B = 1_000_000_000; // 1 SOL of liquidity, base units

function rec(
  name: string,
  data: Record<string, unknown>,
  at = 1_700_000_000_000,
  slot = 1
): DecodedChainIx {
  return { name, data, at, slot, sig: `sig-${at}-${slot}`, ix: 0, user: "tester" };
}

function binaryMarket(p: Partial<ChainSeriesMarket> = {}): ChainSeriesMarket {
  return { type: "binary", b: B, yesShares: 0, noShares: 0, totalPool: 0, words: [], ...p };
}

describe("buildChainPriceSeries (binary)", () => {
  it("returns [] for a market with no trades", () => {
    expect(buildChainPriceSeries(binaryMarket(), [])).toEqual([]);
  });

  it("rises on a YES buy, tracking the program's minted shares", () => {
    const cost = 50_000_000; // 0.05 SOL
    const shares = Math.floor(lmsrSharesForCost(0, 0, B, "yes", cost));
    const series = buildChainPriceSeries(
      binaryMarket({ yesShares: shares }),
      [rec("buyBinary", { side: 0, cost })]
    );
    expect(series).toHaveLength(1);
    expect(series[0].v).toBeGreaterThan(0.5);
    expect(series[0].v).toBeLessThan(0.6);
  });

  it("falls back to current shares when a sell lowers the price", () => {
    const shares = Math.floor(lmsrSharesForCost(0, 0, B, "yes", 100_000_000));
    const series = buildChainPriceSeries(
      binaryMarket({ yesShares: shares - 1_000_000 }),
      [
        rec("buyBinary", { side: 0, cost: 100_000_000 }, 1_700_000_000_000, 1),
        rec("sellBinary", { side: 0, shares: 1_000_000 }, 1_700_000_010_000, 2),
      ]
    );
    expect(series).toHaveLength(2);
    expect(series[1].v).toBeLessThan(series[0].v);
    expect(series[1].v).toBeGreaterThan(0.5);
  });

  it("rejects a series whose replay diverges from the account state", () => {
    const series = buildChainPriceSeries(
      binaryMarket({ yesShares: 999_999_999_000, noShares: 0 }),
      [rec("buyBinary", { side: 0, cost: 50_000_000 })]
    );
    expect(series).toEqual([]);
  });
});

describe("buildChainPriceSeries (majority)", () => {
  it("tracks the leading word's pot share", () => {
    const market: ChainSeriesMarket = {
      type: "majority",
      b: B,
      yesShares: 0,
      noShares: 0,
      totalPool: 400,
      words: [
        { word: "AI", pool: 100 },
        { word: "crypto", pool: 300 },
      ],
    };
    const series = buildChainPriceSeries(market, [
      rec("backWord", { word: "AI", amount: 100 }, 1_700_000_000_000, 1),
      rec("backWord", { word: "crypto", amount: 300 }, 1_700_000_010_000, 2),
    ]);
    expect(series).toHaveLength(2);
    expect(series[0].v).toBeCloseTo(1); // only AI backed so far
    expect(series[1].v).toBeCloseTo(0.75); // crypto leads 300/400
  });

  it("rejects a series whose pools diverge from the account state", () => {
    const market: ChainSeriesMarket = {
      type: "majority",
      b: B,
      yesShares: 0,
      noShares: 0,
      totalPool: 10_000,
      words: [{ word: "AI", pool: 10_000 }],
    };
    expect(
      buildChainPriceSeries(market, [rec("backWord", { word: "AI", amount: 50 })])
    ).toEqual([]);
  });
});

describe("mergePricePoints", () => {
  it("dedupes by timestamp, sorts ascending and caps the tail", () => {
    const base = [
      { t: 1000, v: 0.5 },
      { t: 3000, v: 0.7 },
    ];
    const incoming = [
      { t: 3000, v: 0.8 }, // overwrites
      { t: 2000, v: 0.6 }, // out of order
      { t: 4000, v: 0.9 },
    ];
    expect(mergePricePoints(base, incoming)).toEqual([
      { t: 1000, v: 0.5 },
      { t: 2000, v: 0.6 },
      { t: 3000, v: 0.8 },
      { t: 4000, v: 0.9 },
    ]);
    expect(mergePricePoints(base, incoming, 2)).toEqual([
      { t: 3000, v: 0.8 },
      { t: 4000, v: 0.9 },
    ]);
  });
});
