import { describe, expect, it } from "vitest";
import {
  SOL_DECIMALS,
  USDC_DECIMALS,
  mapMarketToStore,
  mapPositionToStore,
  proceedsForSellUi,
  scaleForAsset,
  scaleForMarket,
  sharesForCostUi,
} from "../chain";
import { lmsrBuyCost, lmsrSellReturn } from "../lmsr";
import type { Market } from "../types";

function bn(value: number) {
  return { toNumber: () => value };
}

/** Minimal raw Market account; only `asset` varies across tests. */
function chainMarketAccount(asset: "sol" | "usdc", overrides: Record<string, unknown> = {}) {
  return {
    id: bn(1),
    title: "Will the host say 'mango'?",
    event: "Streams",
    vertical: { streams: {} },
    asset: { [asset]: {} },
    marketType: { binary: {} },
    status: { open: {} },
    b: bn(1_500_000_000),
    yesShares: bn(600_000_000_000),
    noShares: bn(400_000_000_000),
    yesCost: bn(500_000_000_000),
    noCost: bn(300_000_000_000),
    words: [],
    totalPool: bn(0),
    volume: bn(10_000_000_000),
    traders: 12,
    creatorFeeBps: 100,
    endTime: bn(Math.floor(Date.now() / 1000) + 600),
    winningOutcome: "",
    confidence: 0,
    bond: bn(1_000_000_000),
    evidenceHash: [0, 0],
    proposedAt: bn(0),
    challengeDeadline: bn(0),
    resolvedAt: bn(0),
    proposer: { toBase58: () => "proposer", toBuffer: () => Buffer.alloc(32) },
    creator: { toBase58: () => "creator", toBuffer: () => Buffer.alloc(32) },
    bump: 255,
    ...overrides,
  } as never;
}

describe("scaleForAsset", () => {
  it("reads SOL at 9 decimals", () => {
    expect(scaleForAsset({ sol: {} })).toBe(SOL_DECIMALS);
    expect(SOL_DECIMALS).toBe(1_000_000_000);
  });

  it("reads USDC at 6 decimals", () => {
    expect(scaleForAsset({ usdc: {} })).toBe(USDC_DECIMALS);
    expect(USDC_DECIMALS).toBe(1_000_000);
  });

  it("throws on an unknown asset rather than defaulting to SOL", () => {
    // Defaulting to SOL here would misprice a USDC market by 1000x.
    expect(() => scaleForAsset({ btc: {} })).toThrow(/unknown market asset/);
    expect(() => scaleForAsset(undefined)).toThrow(/unknown market asset/);
    expect(() => scaleForAsset("")).toThrow(/unknown market asset/);
  });
});

describe("scaleForMarket", () => {
  it("returns the scale for a chain market", () => {
    const market = mapMarketToStore(chainMarketAccount("sol"));
    expect(scaleForMarket(market)).toBe(SOL_DECIMALS);
  });

  it("throws when the market has no asset", () => {
    const market = { id: "c1" } as Market;
    expect(() => scaleForMarket(market)).toThrow(/no asset/);
  });
});

describe("mapMarketToStore", () => {
  it("scales a SOL market by 1e9", () => {
    const m = mapMarketToStore(chainMarketAccount("sol"));
    expect(m.asset).toBe("sol");
    expect(m.volume).toBe(10);
    expect(m.b).toBe(1.5);
    expect(m.yesShares).toBe(600);
    expect(m.noShares).toBe(400);
  });

  it("scales a USDC market by 1e6, not 1e9", () => {
    const m = mapMarketToStore(chainMarketAccount("usdc"));
    expect(m.asset).toBe("usdc");
    // Same raw figure must not be divided by 1e9 — that would render 1000x small.
    expect(m.volume).toBe(10_000);
    expect(m.b).toBe(1_500);
    expect(m.yesShares).toBe(600_000);
    expect(m.noShares).toBe(400_000);
  });

  it("keeps bond, pools and avg prices on the same scale as shares", () => {
    const resolving = {
      status: { resolving: {} },
      winningOutcome: "yes",
      confidence: 88,
      proposedAt: bn(1_700_000_000),
      challengeDeadline: bn(1_700_000_120),
      words: [{ word: "mango", pool: bn(500_000_000_000), bettors: 3 }],
      marketType: { majority: {} },
    };

    const sol = mapMarketToStore(chainMarketAccount("sol", resolving));
    expect(sol.evidence?.bondUsd).toBe(1);
    expect(sol.words?.[0].pool).toBe(500);

    const usdc = mapMarketToStore(chainMarketAccount("usdc", resolving));
    expect(usdc.evidence?.bondUsd).toBe(1_000);
    expect(usdc.words?.[0].pool).toBe(500_000);
  });

  it("labels escrow with the market's own asset", () => {
    expect(mapMarketToStore(chainMarketAccount("sol")).rules).toMatch(/devnet SOL/);
    expect(mapMarketToStore(chainMarketAccount("usdc")).rules).toMatch(/devnet USDC/);
  });
});

describe("mapPositionToStore", () => {
  const position = {
    yesShares: bn(600_000_000_000),
    noShares: bn(400_000_000_000),
    yesCost: bn(500_000_000_000),
    noCost: bn(300_000_000_000),
    wordBacks: [{ word: "mango", amount: bn(2_000_000_000) }],
    claimed: false,
  };

  it("defaults to the SOL scale", () => {
    const p = mapPositionToStore("c1", position);
    expect(p.yesShares).toBe(600);
    expect(p.wordBacks?.mango).toBe(2);
    expect(p.avgYesPrice).toBeCloseTo(500 / 600);
  });

  it("honours a USDC scale passed in by the caller", () => {
    const p = mapPositionToStore("c1", position, USDC_DECIMALS);
    expect(p.yesShares).toBe(600_000);
    expect(p.noShares).toBe(400_000);
    expect(p.wordBacks?.mango).toBe(2_000);
    expect(p.avgYesPrice).toBeCloseTo(500 / 600);
  });
});

/**
 * `sharesForCostUi` / `proceedsForSellUi` feed `min_shares` / `min_proceeds`
 * directly. They previously returned base units while the callers multiplied
 * by `scale` again, so every on-chain buy and sell reverted with
 * `SlippageTooHigh` — these tests pin both the formula and the units.
 */
describe("sharesForCostUi", () => {
  // Vectors lifted verbatim from the program's lmsr.rs
  // `shares_for_cost_matches_ts` — the Rust side is the reference.
  const programVectors: Array<[number, number, number, "yes" | "no", number, number]> = [
    [100, 100, 100, "yes", 50, 83.179657],
    [100, 100, 100, "no", 25, 44.983334],
    [200, 80, 120, "yes", 75, 93.939667],
    [80, 200, 120, "no", 40, 51.903475],
    [0, 0, 100, "yes", 10, 19.090283],
    [0, 0, 100, "no", 7, 13.541893],
    [150, 150, 100, "no", 33, 57.770056],
  ];

  it.each(programVectors)(
    "matches shares_for_cost(%f, %f, %f, %s, %f)",
    (qy, qn, b, side, cost, expected) => {
      const m = chainMarketAccount("sol", {
        b: bn(b),
        yesShares: bn(qy),
        noShares: bn(qn),
      });
      expect(sharesForCostUi(m, side, cost, 1)).toBeCloseTo(expected, 4);
    }
  );

  it("returns UI units, not base units", () => {
    // The shape chainCreateMarket produces: b = 120 SOL on an empty book.
    const raw = chainMarketAccount("sol", {
      b: bn(120 * SOL_DECIMALS),
      yesShares: bn(0),
      noShares: bn(0),
    });
    const ui = sharesForCostUi(raw, "yes", 10, SOL_DECIMALS);
    const base = sharesForCostUi(raw, "yes", 10 * SOL_DECIMALS, 1);
    // Returns UI: scaling it back must land on the base-unit answer.
    expect(ui * SOL_DECIMALS).toBeCloseTo(base, -3);
    expect(ui).toBeLessThan(1_000);
  });

  it("produces a min_shares floor the program will accept", () => {
    const b = 120 * SOL_DECIMALS;
    const raw = chainMarketAccount("sol", {
      b: bn(b),
      yesShares: bn(0),
      noShares: bn(0),
    });
    const cost = 10 * SOL_DECIMALS;

    // What chainBuyBinary actually sends.
    const expectedUi = sharesForCostUi(raw, "yes", 10, SOL_DECIMALS);
    const minShares = Math.floor(expectedUi * 0.98 * SOL_DECIMALS);

    // What the program computes in trade.rs.
    let lo = 0;
    let hi = 1;
    while (lmsrBuyCost(0, 0, b, "yes", hi) < cost) hi *= 2;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (lmsrBuyCost(0, 0, b, "yes", mid) < cost) lo = mid;
      else hi = mid;
    }
    const programShares = Math.floor((lo + hi) / 2);

    expect(minShares).toBeGreaterThan(0);
    // Must sit inside the 2% band, not orders of magnitude away from it.
    expect(minShares).toBeGreaterThanOrEqual(Math.floor(programShares * 0.97));
    expect(minShares).toBeLessThanOrEqual(programShares);
  });

  it("returns 0 for a non-positive cost instead of bracketing forever", () => {
    const m = chainMarketAccount("sol");
    expect(sharesForCostUi(m, "yes", 0, SOL_DECIMALS)).toBe(0);
    expect(sharesForCostUi(m, "yes", -1, SOL_DECIMALS)).toBe(0);
    expect(sharesForCostUi(m, "no", Number.NaN, SOL_DECIMALS)).toBe(0);
  });
});

describe("proceedsForSellUi", () => {
  // Verbatim from the program's lmsr.rs `sell_return_matches_ts`.
  const programVectors: Array<[number, number, number, "yes" | "no", number, number]> = [
    [150, 100, 100, "yes", 50, 28.09298],
    [100, 150, 100, "no", 33, 19.232165],
    [250, 80, 120, "yes", 120, 85.293887],
  ];

  it.each(programVectors)(
    "matches sell_return(%f, %f, %f, %s, %f)",
    (qy, qn, b, side, shares, expected) => {
      const m = chainMarketAccount("sol", {
        b: bn(b),
        yesShares: bn(qy),
        noShares: bn(qn),
      });
      expect(proceedsForSellUi(m, side, shares, 1)).toBeCloseTo(expected, 4);
    }
  );

  it("returns UI units so min_proceeds is not inflated by 1e9", () => {
    const b = 120 * SOL_DECIMALS;
    const raw = chainMarketAccount("sol", {
      b: bn(b),
      yesShares: bn(0),
      noShares: bn(0),
    });
    const sharesUi = 5;

    const ui = proceedsForSellUi(raw, "yes", sharesUi, SOL_DECIMALS);
    const minProceeds = Math.floor(ui * 0.98 * SOL_DECIMALS);
    const programProceeds = Math.floor(
      lmsrSellReturn(0, 0, b, "yes", sharesUi * SOL_DECIMALS)
    );

    expect(ui).toBeGreaterThan(0);
    expect(minProceeds).toBeGreaterThan(0);
    expect(minProceeds).toBeLessThanOrEqual(programProceeds);
    expect(minProceeds).toBeGreaterThanOrEqual(Math.floor(programProceeds * 0.97));
  });

  it("returns 0 for a non-positive share count", () => {
    const m = chainMarketAccount("sol");
    expect(proceedsForSellUi(m, "yes", 0, SOL_DECIMALS)).toBe(0);
    expect(proceedsForSellUi(m, "no", -5, SOL_DECIMALS)).toBe(0);
  });
});
