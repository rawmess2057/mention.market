import { describe, expect, it } from "vitest";
import { fmtBalance, fmtSol } from "../format";

describe("fmtBalance", () => {
  it("renders SOL with an ◎ prefix and 4 decimals by default", () => {
    expect(fmtBalance(1.2345)).toBe("◎ 1.2345");
  });

  it("supports fixed decimals", () => {
    expect(fmtBalance(1.2345, { decimals: 2 })).toBe("◎ 1.23");
  });

  it("compacts large values", () => {
    expect(fmtBalance(1512.75, { compact: true })).toBe("◎ 1.5k");
  });

  it("does not compact small values", () => {
    expect(fmtBalance(512.75, { compact: true })).toBe("◎ 512.8");
  });

  it("matches fmtSol", () => {
    expect(fmtBalance(42)).toBe(fmtSol(42, { decimals: 4 }));
  });
});
