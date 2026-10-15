import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store";
import { reconcileChainMarkets } from "../chain";
import type { Market } from "../types";

function market(id: string, overrides: Partial<Market> = {}): Market {
  return {
    id,
    slug: id,
    title: id,
    event: "e",
    vertical: "streams",
    type: "binary",
    status: "open",
    createdAt: 1_800_000_000_000,
    endTime: 1_800_000_600_000,
    volume: 0,
    traders: 0,
    yesShares: 0,
    noShares: 0,
    b: 1,
    rules: "",
    creator: "c",
    creatorFeeBps: 100,
    source: "",
    sourceUrl: "",
    ...overrides,
  } as Market;
}

describe("reconcileChainMarkets", () => {
  it("drops chain markets that are gone on-chain and reports them", () => {
    const { markets, removed } = reconcileChainMarkets(
      { c9: market("c9"), c7001: market("c7001") },
      [market("c9")]
    );
    expect(Object.keys(markets)).toEqual(["c9"]);
    expect(removed).toEqual(["c7001"]);
  });

  it("keeps simulated markets even though they are not on-chain", () => {
    const { markets, removed } = reconcileChainMarkets(
      { m1: market("m1"), s1: market("s1") },
      []
    );
    expect(Object.keys(markets).sort()).toEqual(["m1", "s1"]);
    expect(removed).toEqual([]);
  });

  it("inserts markets that are new to the store", () => {
    const { markets, removed } = reconcileChainMarkets({}, [market("c100")]);
    expect(Object.keys(markets)).toEqual(["c100"]);
    expect(removed).toEqual([]);
  });
});

describe("syncChainMarkets", () => {
  beforeEach(() => {
    useStore.setState({
      markets: { c9: market("c9"), c7001: market("c7001"), m1: market("m1") },
      chainSynced: false,
      chainSyncError: false,
    });
  });

  it("prunes a closed market left over from a previous session", () => {
    useStore.getState().syncChainMarkets([market("c9")]);
    expect(Object.keys(useStore.getState().markets).sort()).toEqual(["c9", "m1"]);
  });

  it("empties the on-chain slate when devnet has no markets", () => {
    useStore.getState().syncChainMarkets([]);
    expect(Object.keys(useStore.getState().markets)).toEqual(["m1"]);
  });

  it("flags the store as synced even when devnet has no markets", () => {
    expect(useStore.getState().chainSynced).toBe(false);
    useStore.getState().syncChainMarkets([]);
    expect(useStore.getState().chainSynced).toBe(true);
    expect(useStore.getState().chainSyncError).toBe(false);
  });

  it("clears a previous sync error on the next successful poll", () => {
    useStore.getState().setChainSyncError(true);
    expect(useStore.getState().chainSyncError).toBe(true);
    useStore.getState().syncChainMarkets([market("c9")]);
    expect(useStore.getState().chainSyncError).toBe(false);
  });

  it("also drops the pruned market's chart history", () => {
    useStore.setState({
      history: { c7001: [{ t: 1, v: 0.5 }] },
      wordHistory: { c7001: { agents: [{ t: 1, v: 0.5 }] } },
    });
    useStore.getState().syncChainMarkets([]);
    expect(useStore.getState().history).toEqual({});
    expect(useStore.getState().wordHistory).toEqual({});
  });
});
