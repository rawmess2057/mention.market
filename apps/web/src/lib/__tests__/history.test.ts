import { describe, expect, it } from "vitest";
import {
  changePct,
  normalizeHistory,
  resample,
  sessionChange,
  toChartData,
  toValues,
  windowed,
} from "../history";

describe("normalizeHistory", () => {
  it("returns empty for undefined/empty input", () => {
    expect(normalizeHistory(undefined)).toEqual([]);
    expect(normalizeHistory([])).toEqual([]);
  });

  it("materializes legacy number[] into ascending PricePoints", () => {
    const out = normalizeHistory([0.4, 0.5, 0.6]);
    expect(out).toHaveLength(3);
    expect(out[2].v).toBe(0.6);
    for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThan(out[i - 1].t);
  });

  it("sorts PricePoint input by timestamp", () => {
    const out = normalizeHistory([
      { t: 300, v: 0.3 },
      { t: 100, v: 0.1 },
      { t: 200, v: 0.2 },
    ]);
    expect(out.map((p) => p.t)).toEqual([100, 200, 300]);
  });
});

describe("toValues / toChartData", () => {
  it("toValues falls back and extracts plain values", () => {
    expect(toValues(undefined)).toEqual([]);
    expect(toValues(undefined, [0.5])).toEqual([0.5]);
    expect(
      toValues([
        { t: 1, v: 0.2 },
        { t: 2, v: 0.8 },
      ])
    ).toEqual([0.2, 0.8]);
  });

  it("toChartData scales by 100 by default", () => {
    const pts = [
      { t: 1_000, v: 0.34 },
      { t: 2_000, v: 0.55 },
    ];
    const data = toChartData(pts);
    expect(data[0].time).toBe(1_000);
    expect(data[0].value).toBeCloseTo(34, 10);
    expect(data[1].value).toBeCloseTo(55, 10);
    expect(toChartData(pts, { scale: 1 })[0].value).toBeCloseTo(0.34, 10);
  });
});

describe("resample", () => {
  it("passes through data within the cap", () => {
    const pts = [
      { t: 0, v: 0.1 },
      { t: 1, v: 0.2 },
    ];
    expect(resample(pts, 60)).toEqual(pts);
  });

  it("caps output and keeps the newest point", () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ t: i * 1000, v: i / 100 }));
    const out = resample(pts, 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("is safe on empty input", () => {
    expect(resample([], 10)).toEqual([]);
  });
});

describe("windowed", () => {
  it("keeps recent points and at least two for shape", () => {
    const pts = [
      { t: 0, v: 0.1 },
      { t: 5_000, v: 0.2 },
      { t: 10_000, v: 0.3 },
      { t: 20_000, v: 0.4 },
    ];
    expect(windowed(pts, 10_000, 25_000)).toHaveLength(2);
    expect(windowed(pts, 1, 25_000)).toHaveLength(2); // floor of 2
  });
});

describe("changePct / sessionChange", () => {
  it("computes relative change", () => {
    expect(changePct([0.25, 0.4])).toBeCloseTo(0.6, 10);
    expect(changePct([0.4, 0.36])).toBeCloseTo(-0.1, 10);
  });

  it("is safe on degenerate input", () => {
    expect(changePct([])).toBe(0);
    expect(changePct([0.5])).toBe(0);
    expect(changePct([0, 0.5])).toBe(0); // div-by-zero guard
    expect(sessionChange(undefined)).toBe(0);
  });
});