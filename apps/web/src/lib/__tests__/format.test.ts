import { describe, expect, it } from "vitest";
import { fmtBalance, fmtUsd } from "../format";

describe("fmtBalance", () => {
  it("uses USD for the implied demo book", () => {
    expect(fmtBalance(12.5, "usdc")).toBe(fmtUsd(12.5));
  });

  it("renders SOL with an ◎ prefix and 4 decimals", () => {
    expect(fmtBalance(1.2345, "sol")).toBe("◎ 1.2345");
  });

  it("supports fixed decimals", () => {
    expect(fmtBalance(1.2345, "sol", { decimals: 2 })).toBe("◎ 1.23");
  });

  it("compacts large SOL values", () => {
    expect(fmtBalance(1512.75, "sol", { compact: true })).toBe("◎ 1.5k");
  });

  it("does not compact small SOL values", () => {
    expect(fmtBalance(512.75, "sol", { compact: true })).toBe("◎ 512.8");
  });

  it("falls back to USD when kind is undefined (guests)", () => {
    expect(fmtBalance(42, undefined)).toBe(fmtUsd(42));
  });
});