import { describe, expect, it } from "vitest";
import { impliedOdds, quoteBack, settleMajority } from "../parimutuel";
import type { WordPool } from "../types";

const words: WordPool[] = [
  { word: "agents", pool: 5_200, bettors: 214, lastBetAt: 0 },
  { word: "open source", pool: 4_150, bettors: 168, lastBetAt: 0 },
  { word: "Grok", pool: 2_640, bettors: 132, lastBetAt: 0 },
];

describe("quoteBack", () => {
  it("adds the amount to the word pool and total pot", () => {
    const q = quoteBack(words, "agents", 100);
    expect(q.poolAfter).toBe(5_300);
    expect(q.potAfter).toBe(5_200 + 4_150 + 2_640 + 100);
  });

  it("creates a pool for an unlisted word", () => {
    const q = quoteBack(words, "safety", 50);
    expect(q.poolAfter).toBe(50);
  });

  it("applies the 1% rake inside the projected payout", () => {
    // Back entire winning pool of one word → you'd collect the whole net pot.
    const solo = quoteBack([{ word: "a", pool: 0, bettors: 0, lastBetAt: 0 }], "a", 1_000);
    expect(solo.poolAfter).toBe(1_000);
    expect(solo.payoutIfWin).toBeCloseTo(1_000 * 0.99, 6);
  });

  it("is safe on empty input", () => {
    const q = quoteBack([], "ghost", 100);
    expect(q.poolAfter).toBe(100);
    expect(q.payoutIfWin).toBeCloseTo(100 * 0.99, 6);
  });
});

describe("impliedOdds", () => {
  it("returns per-word shares summing to 1", () => {
    const odds = impliedOdds(words);
    const sum = Object.values(odds).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(odds["agents"]).toBeCloseTo(5_200 / 11_990, 6);
  });

  it("returns zero shares on an empty pot", () => {
    const odds = impliedOdds([]);
    expect(odds).toEqual({});
  });
});

describe("settleMajority", () => {
  it("splits the net pot pro-rata across winners", () => {
    const s = settleMajority(words, "agents");
    expect(s.totalPot).toBe(11_990);
    expect(s.netPot).toBeCloseTo(11_990 * 0.99, 6);
    // Backing the entire winning pool collects the whole net pot.
    expect(s.yourShare(5_200)).toBeCloseTo(s.netPot, 6);
    // Pro-rata: half the winning pool → half the net pot.
    expect(s.yourShare(2_600)).toBeCloseTo(s.netPot / 2, 6);
  });

  it("pays proportionally to the amount backed (caller gates on winning word)", () => {
    const s = settleMajority(words, "agents");
    expect(s.yourShare(0)).toBe(0);
    // Pro-rata share of the net pot.
    expect(s.yourShare(2_600)).toBeCloseTo(s.netPot / 2, 6);
  });

  it("uses the configured fee", () => {
    const s = settleMajority(words, "agents", 200);
    expect(s.netPot).toBeCloseTo(11_990 * 0.98, 6);
  });

  it("is safe when the winning word is absent", () => {
    const s = settleMajority(words, "nonexistent");
    expect(s.yourShare(100)).toBe(0);
    expect(s.netPot).toBeGreaterThan(0);
  });

  it("is safe on an empty board", () => {
    const s = settleMajority([], "anything");
    expect(s.totalPot).toBe(0);
    expect(s.netPot).toBe(0);
    expect(s.yourShare(10)).toBe(0);
  });
});