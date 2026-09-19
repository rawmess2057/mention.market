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
