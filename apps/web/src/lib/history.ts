/**
 * Timestamped price history + resampling helpers.
 *
 * Batch 1 migration: history moves from `number[]` (implicit index time)
 * to `PricePoint[]` (explicit `t` wall-clock ms + `v` 0..1 probability/share).
 */

export interface PricePoint {
  /** Wall-clock timestamp in ms (Date.now()). */
  t: number;
  /** Value 0..1 (binary YES prob, or majority leader share). */
  v: number;
}

export type HistoryInput = PricePoint[] | number[] | undefined;

/** Normalize legacy number[] or PricePoint[] to sorted PricePoint[]. */
export function normalizeHistory(input: HistoryInput): PricePoint[] {
  if (!input || input.length === 0) return [];
  const first = input[0] as PricePoint | number;
  if (typeof first === "number") {
    const now = Date.now();
    const step = 5_000;
    return (input as number[]).map((v, i, arr) => ({
      t: now - (arr.length - 1 - i) * step,
      v,
    }));
  }
  return [...(input as PricePoint[])].sort((a, b) => a.t - b.t);
}

/** Session momentum: change over last `windowMs` (defaults to full session). */
export function sessionChange(input: HistoryInput, windowMs?: number): number {
  const all = normalizeHistory(input);
  if (all.length < 2) return 0;
  const sliced =
    windowMs !== undefined ? windowed(all, windowMs) : all;
  return changePct(sliced);
}

/** Extract plain values for sparklines / legacy consumers. */
export function toValues(input: HistoryInput, fallback: number[] = []): number[] {
  if (!input || input.length === 0) return fallback;
  const first = input[0] as PricePoint | number;
  if (typeof first === "number") return input as number[];
  return (input as PricePoint[]).map((p) => p.v);
}

/** Extract chart-ready {time,value} for lightweight-charts (value in %). */
export function toChartData(
  input: HistoryInput,
  opts?: { scale?: number }
): Array<{ time: number; value: number }> {
  const scale = opts?.scale ?? 100;
  if (!input || input.length === 0) return [];
  const first = input[0] as PricePoint | number;
  if (typeof first === "number") {
    const now = Date.now();
    const step = 5_000;
    return (input as number[]).map((v, i, arr) => ({
      time: now - (arr.length - 1 - i) * step,
      value: v * scale,
    }));
  }
  return (input as PricePoint[]).map((p) => ({ time: p.t, value: p.v * scale }));
}

/**
 * Merge two ascending price series idempotently: points keyed by timestamp
 * (ms), later wins, sorted ascending, capped to the last `cap` points.
 * Lets on-chain backfills and live poll appends coexist without duplicates
 * or gridlock on the timeline.
 */
export function mergePricePoints(
  base: PricePoint[],
  incoming: PricePoint[],
  cap = 2000
): PricePoint[] {
  const merged = new Map<number, number>();
  for (const p of base) merged.set(p.t, p.v);
  for (const p of incoming) merged.set(p.t, p.v);
  return [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-Math.max(cap, 0))
    .map(([t, v]) => ({ t, v }));
}

/**
 * Bucket points into `maxPoints` time buckets (last-write-wins per bucket).
 * Used by timeframe switching so 1m/5m/1h/1d actually change shape.
 */
export function resample(points: PricePoint[], maxPoints: number): PricePoint[] {
  if (points.length <= maxPoints) return points;
  const start = points[0].t;
  const end = points[points.length - 1].t;
  const span = Math.max(1, end - start);
  const buckets: PricePoint[][] = Array.from({ length: maxPoints }, () => []);
  for (const p of points) {
    const idx = Math.min(
      maxPoints - 1,
      Math.floor(((p.t - start) / span) * maxPoints)
    );
    buckets[idx].push(p);
  }
  return buckets
    .map((b) => b[b.length - 1])
    .filter(Boolean) as PricePoint[];
}

/** Timeframe options for the price chart. `"all"` = full available history. */
export type ChartTimeframe = "all" | "1m" | "5m" | "1h" | "1d";

export const CHART_TIMEFRAMES: ChartTimeframe[] = ["all", "1m", "5m", "1h", "1d"];

const CHART_TF_MS: Record<Exclude<ChartTimeframe, "all">, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};

/**
 * Window + resample history for a chart timeframe. `"all"` keeps the entire
 * series (so the full reconstructed/on-chain history shows by default); the
 * others window to the trailing span. A narrow window that would otherwise
 * hold < 2 points falls back to the last 20 points so slow markets still show
 * shape instead of a single dot. `maxPoints` defaults to 240 for "all" (more
 * detail) and 60 for the zoomed windows (cheaper render, visibly denser).
 */
export function selectChartPoints(
  input: HistoryInput,
  timeframe: ChartTimeframe,
  now: number,
  maxPoints?: number
): { points: PricePoint[]; count: number } {
  const all = normalizeHistory(input);
  if (all.length === 0) return { points: [], count: 0 };
  let inWindow: PricePoint[];
  if (timeframe === "all") {
    inWindow = all;
  } else {
    inWindow = all.filter((p) => p.t >= now - CHART_TF_MS[timeframe]);
    if (inWindow.length < 2) inWindow = all.slice(-20);
  }
  const points = resample(inWindow, maxPoints ?? (timeframe === "all" ? 240 : 60));
  return { points, count: points.length };
}

/** A named price series — one line on a multi-series (word-race) chart. */
export interface PriceSeries {
  name: string;
  points: PricePoint[];
}

/**
 * Merge two per-key series maps idempotently (one `mergePricePoints` pass per
 * key), so a word-race market's live appends and reconstructed backfills can
 * coexist without duplicates or eviction.
 */
export function mergeSeriesPoints(
  base: Record<string, PricePoint[]>,
  incoming: Record<string, PricePoint[]>,
  cap?: number
): Record<string, PricePoint[]> {
  const out: Record<string, PricePoint[]> = { ...base };
  for (const [key, pts] of Object.entries(incoming)) {
    out[key] = mergePricePoints(out[key] ?? [], pts, cap);
  }
  return out;
}

/**
 * Window + resample every series in a multi-series chart over one shared
 * timeframe. Series with no points in the window are dropped (so a word that
 * hasn't been backed yet doesn't render an empty legend row); the rest keep a
 * stable order matching the input.
 */
export function selectChartSeries(
  series: PriceSeries[],
  timeframe: ChartTimeframe,
  now: number,
  maxPoints?: number
): PriceSeries[] {
  const out: PriceSeries[] = [];
  for (const s of series) {
    const { points } = selectChartPoints(s.points, timeframe, now, maxPoints);
    if (points.length > 0) out.push({ name: s.name, points });
  }
  return out;
}

/** Filter to last `windowMs` of points. */
export function windowed(points: PricePoint[], windowMs: number, now = Date.now()): PricePoint[] {
  const cutoff = now - windowMs;
  const out = points.filter((p) => p.t >= cutoff);
  // Always keep at least 2 points so sparklines don't vanish.
  if (out.length >= 2) return out;
  return points.slice(-2);
}

/** Relative change (last - first) / |first|, 0 when insufficient data. */
export function changePct(points: PricePoint[] | number[]): number {
  const vals = Array.isArray(points) && points.length > 0 && typeof points[0] === "number"
    ? (points as number[])
    : toValues(points as PricePoint[]);
  if (vals.length < 2) return 0;
  const first = vals[0];
  const last = vals[vals.length - 1];
  if (first === 0) return 0;
  return (last - first) / Math.abs(first);
}
