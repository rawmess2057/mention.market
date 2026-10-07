import { describe, expect, it } from "vitest";
import {
  SOL_DECIMALS,
  USDC_DECIMALS,
  mapMarketToStore,
  mapPositionToStore,
  scaleForAsset,
  scaleForMarket,
} from "../chain";
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
