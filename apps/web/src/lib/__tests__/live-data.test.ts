import { beforeEach, describe, expect, it } from "vitest";

import { mergeDecodedIxs, type DecodedChainIx } from "../chain";
import { useStore } from "../store";
import type { Market } from "../types";

const rec = (sig: string, at: number, ix = 0): DecodedChainIx => ({ name: "buyBinary", data: {}, at, slot: at, sig, ix, user: "u" });

describe("mergeDecodedIxs", () => {
  it("appends only unseen records, in time order", () => {
    const held = [rec("a", 1), rec("b", 2)];
    const merged = mergeDecodedIxs(held, [rec("b", 2), rec("c", 3)]);
    expect(merged.map((r) => r.sig)).toEqual(["a", "b", "c"]);
  });

  it("returns the same array when nothing is new (no needless re-render)", () => {
    const held = [rec("a", 1)];
    expect(mergeDecodedIxs(held, [rec("a", 1)])).toBe(held);
  });
});

function market(overrides: Partial<Market> = {}): Market {
  return {
    id: "c104",
    slug: "c104",
    title: 'Will the speaker say "all female team"?',
    event: "NASA",
    vertical: "streams",
    type: "binary",
    status: "resolving",
    createdAt: 0,
    endTime: 0,
    volume: 0.228,
    traders: 1,
    yesShares: 0.41,
    noShares: 0,
    b: 1,
    rules: "",
    creator: "x",
    creatorFeeBps: 100,
    source: "s",
    sourceUrl: "",
    evidence: {
      winningOutcome: "yes",
      confidence: 100,
      proposedAt: 1,
      proposedBy: "r",
      evidenceHash: "abc",
      bondSol: 1,
      challengeWindowMs: 120_000,
      challengeDeadline: 2,
      challenged: false,
      snippets: [],
    },
    ...overrides,
  };
}

describe("upsertChainMarket", () => {
  beforeEach(() => useStore.setState({ markets: {} }));

  it("keeps evidence quotes a racing websocket push doesn't carry", () => {
    const withQuote = market();
    withQuote.evidence!.snippets = [{ t: 1, speaker: "0", text: "an all female team" }];
    useStore.getState().upsertChainMarket(withQuote);
    useStore.getState().upsertChainMarket(market({ volume: 0.3 }));
    const m = useStore.getState().markets.c104;
    expect(m.volume).toBe(0.3);
    expect(m.evidence!.snippets).toHaveLength(1);
  });

  it("drops old quotes when a new proposal replaces the evidence", () => {
    const withQuote = market();
    withQuote.evidence!.snippets = [{ t: 1, speaker: "0", text: "old" }];
    useStore.getState().upsertChainMarket(withQuote);
    const next = market();
    next.evidence!.evidenceHash = "def";
    useStore.getState().upsertChainMarket(next);
    expect(useStore.getState().markets.c104.evidence!.snippets).toEqual([]);
  });
});
