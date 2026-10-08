import { describe, expect, it } from "vitest";
import { mapChainInstruction } from "../chain";

const SOL = 1_000_000_000;

describe("mapChainInstruction", () => {
  it("maps a YES buy and scales base units to UI units", () => {
    expect(mapChainInstruction("buyBinary", { side: 0, cost: 2 * SOL }, SOL)).toEqual({
      kind: "buy",
      side: "yes",
      amount: 2,
    });
  });

  it("maps a NO buy", () => {
    expect(mapChainInstruction("buyBinary", { side: 1, cost: SOL / 2 }, SOL)).toEqual({
      kind: "buy",
      side: "no",
      amount: 0.5,
    });
  });

  it("maps a word back with the word as the side", () => {
    expect(mapChainInstruction("backWord", { word: "AI", amount: 3 * SOL }, SOL)).toEqual({
      kind: "back",
      side: "AI",
      amount: 3,
    });
  });

  it("maps a sell to shares", () => {
    expect(mapChainInstruction("sellBinary", { side: 1, shares: 15 * SOL }, SOL)).toEqual({
      kind: "sell",
      side: "no",
      amount: 15,
    });
  });

  it("maps resolutions and claims without an amount", () => {
    expect(mapChainInstruction("claimPayout", {}, SOL)).toEqual({ kind: "claim", amount: 0 });
    expect(mapChainInstruction("lockMarket", {}, SOL)).toEqual({ kind: "resolve", amount: 0 });
    expect(mapChainInstruction("finalizeResolution", {}, SOL)).toEqual({ kind: "resolve", amount: 0 });
    expect(mapChainInstruction("proposeResolution", { outcome: "yes" }, SOL)).toEqual({
      kind: "resolve",
      side: "yes",
      amount: 0,
    });
  });

  it("accepts snake_case names and BN-like numbers", () => {
    expect(
      mapChainInstruction("buy_binary", { side: 0, cost: { toNumber: () => 4 * SOL } }, SOL)
    ).toEqual({ kind: "buy", side: "yes", amount: 4 });
  });

  it("ignores non-trade instructions", () => {
    expect(mapChainInstruction("createMarket", {}, SOL)).toBeNull();
    expect(mapChainInstruction("challengeResolution", {}, SOL)).toBeNull();
    expect(mapChainInstruction("initializeConfig", {}, SOL)).toBeNull();
  });
});