"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { createChart, ColorType, LineSeries, LineStyle } from "lightweight-charts";
import type { ISeriesApi } from "lightweight-charts";
import { cn } from "@/lib/format";
import { useNow } from "@/hooks/useNow";
import {
  CHART_TIMEFRAMES,
  selectChartPoints,
  selectChartSeries,
  type ChartTimeframe,
  type HistoryInput,
  type PricePoint,
  type PriceSeries,
} from "@/lib/history";
import { rgba, SERIES_COLORS } from "@/lib/theme";

/** Distinct line colors for word-race options; overflow gets generated hues. */
export const WORD_CHART_COLORS: readonly string[] = SERIES_COLORS;

/** Stable color per option index (matches the legend swatch). */
export function wordChartColor(index: number): string {
  if (index >= 0 && index < WORD_CHART_COLORS.length) return WORD_CHART_COLORS[index];
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} 70% 65%)`;
}

function toLineData(
  points: PricePoint[]
): Array<{ time: number; value: number }> {
  // lightweight-charts needs ascending unique UTCTimestamp (seconds).
  const bySec = new Map<number, number>();
  for (const p of points) {
    bySec.set(Math.floor(p.t / 1000), p.v * 100);
  }
  return [...bySec.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ time: time as number, value }));
}

function createPriceChart(container: HTMLElement) {
  return createChart(container, {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: rgba("fg-subtle"),
      fontFamily: "var(--font-mono)",
      fontSize: 11,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { color: rgba("line", 0.6) },
    },
    crosshair: {
      vertLine: {
        color: rgba("fg-subtle", 0.5),
        width: 1,
        style: 2,
        labelBackgroundColor: rgba("surface-3"),
      },
      horzLine: {
        color: rgba("fg-subtle", 0.5),
        width: 1,
        style: 2,
        labelBackgroundColor: rgba("surface-3"),
      },
    },
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: { top: 0.1, bottom: 0.25 },
    },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: { vertTouchDrag: false },
  });
}

const PRICE_FORMAT = {
  type: "custom" as const,
  formatter: (v: number) => `${Math.round(v)}%`,
};

export function PriceChart({
  data,
  className,
  showBaseline = false,
  emptyLabel = "No price history yet",
  resetKey,
}: {
  data: Array<{ time: number; value: number }>;
  className?: string;
  showBaseline?: boolean;
  emptyLabel?: string;
  resetKey?: string | number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const baselineApplied = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createPriceChart(containerRef.current);

    const lineSeries = chart.addSeries(LineSeries, {
      color: rgba("accent"),
      lineWidth: 2,
      crosshairMarkerBackgroundColor: rgba("accent"),
      crosshairMarkerBorderColor: rgba("bg"),
      crosshairMarkerRadius: 4,
      priceFormat: PRICE_FORMAT,
    });

    if (data.length > 0) {
      lineSeries.setData(
        toLineData(
          data.map((d) => ({ t: d.time, v: d.value / 100 }))
        ) as any
      );
      chart.timeScale().fitContent();
    }
    if (showBaseline) {
      try {
        lineSeries.createPriceLine({
          price: 50,
          color: rgba("fg-subtle", 0.5),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "50%",
        });
        baselineApplied.current = true;
      } catch {
        // Older lightweight-charts without createPriceLine — ignore.
      }
    }

    chartRef.current = chart;
    seriesRef.current = lineSeries as any;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    handleResize();

    return () => {
      observer.disconnect();
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!seriesRef.current || data.length === 0) return;
    try {
      // Incremental update when only the last point moved; full reset otherwise.
      const line = toLineData(
        data.map((d) => ({ t: d.time, v: d.value / 100 }))
      ) as any;
      if (line.length === 0) return;
      const prev = (seriesRef.current as any)._lastLen as number | undefined;
      if (prev !== undefined && line.length === prev) {
        seriesRef.current.update(line[line.length - 1]);
      } else {
        seriesRef.current.setData(line);
      }
      (seriesRef.current as any)._lastLen = line.length;
    } catch {
      // Fallback: full reset on out-of-order data.
      seriesRef.current.setData(
        toLineData(data.map((d) => ({ t: d.time, v: d.value / 100 }))) as any
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Reframe the visible range when the consumer asks for a reset (e.g. a
  // timeframe switch) or when data first arrives (chain markets mount empty),
  // without resetting the user's zoom on every live update.
  const isEmpty = data.length < 2;
  useEffect(() => {
    if (!isEmpty) chartRef.current?.timeScale().fitContent();
  }, [resetKey, isEmpty]);

  return (
    <div className={cn("relative", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {data.length < 2 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full border border-line bg-surface/90 px-3 py-1 text-[11px] text-fg-muted">
            {emptyLabel}
          </span>
        </div>
      )}
      {/* Sentiment gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgb(var(--yes) / 0.06) 0%, transparent 40%, transparent 60%, rgb(var(--no) / 0.06) 100%)",
        }}
      />
    </div>
  );
}

/** Multi-line chart for word-race markets — one colored line per option. */
export function PriceChartMulti({
  series,
  className,
  emptyLabel = "No price history yet",
  resetKey,
}: {
  series: Array<{ name: string; color: string; points: PricePoint[] }>;
  className?: string;
  emptyLabel?: string;
  resetKey?: string | number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createPriceChart(containerRef.current);
    chartRef.current = chart;
    const seriesMap = seriesRefs.current;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    handleResize();

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesMap.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile the chart's series with the requested list: add new options,
  // drop removed/hidden ones, recolor, and push each line's data.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const existing = seriesRefs.current;
    const next = new Set(series.map((s) => s.name));
    for (const [name, api] of [...existing]) {
      if (!next.has(name)) {
        chart.removeSeries(api);
        existing.delete(name);
      }
    }
    for (const s of series) {
      let api = existing.get(s.name);
      if (!api) {
        api = chart.addSeries(LineSeries, {
          color: s.color,
          lineWidth: 2,
          crosshairMarkerBackgroundColor: s.color,
          crosshairMarkerBorderColor: rgba("bg"),
          crosshairMarkerRadius: 4,
          priceFormat: PRICE_FORMAT,
        });
        existing.set(s.name, api);
      } else {
        api.applyOptions({ color: s.color, crosshairMarkerBackgroundColor: s.color });
      }
      api.setData(toLineData(s.points) as any);
    }
  }, [series]);

  const isEmpty = series.every((s) => s.points.length < 2);
  useEffect(() => {
    if (!isEmpty) chartRef.current?.timeScale().fitContent();
  }, [resetKey, isEmpty]);

  return (
    <div className={cn("relative", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full border border-line bg-surface/90 px-3 py-1 text-[11px] text-fg-muted">
            {emptyLabel}
          </span>
        </div>
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgb(var(--yes) / 0.06) 0%, transparent 40%, transparent 60%, rgb(var(--no) / 0.06) 100%)",
        }}
      />
    </div>
  );
}

export function PriceChartWithTimeframe({
  history,
  series,
  className,
  showBaseline = true,
}: {
  history: HistoryInput;
  /** When provided (word-race markets), renders one overlaid line per option. */
  series?: PriceSeries[];
  className?: string;
  showBaseline?: boolean;
}) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("all");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const now = useNow(30_000);

  const isMulti = !!series && series.length > 0;

  const colorIndex = useMemo(
    () => new Map((series ?? []).map((s, i) => [s.name, i])),
    [series]
  );

  const multi = useMemo(() => {
    if (!isMulti) return [];
    return selectChartSeries(series!, timeframe, now).map((s) => ({
      name: s.name,
      color: wordChartColor(colorIndex.get(s.name) ?? 0),
      points: s.points,
    }));
  }, [isMulti, series, timeframe, now, colorIndex]);

  const single = useMemo(() => {
    if (isMulti) return { chartData: [] as Array<{ time: number; value: number }>, count: 0 };
    const { points, count } = selectChartPoints(history, timeframe, now);
    return {
      chartData: points.map((p) => ({ time: p.t, value: p.v * 100 })),
      count,
    };
  }, [isMulti, history, timeframe, now]);

  const toggle = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const visible = multi.filter((s) => !hidden.has(s.name));
  const pointCount = isMulti ? multi.reduce((a, s) => a + s.points.length, 0) : single.count;

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        {CHART_TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            aria-pressed={timeframe === tf}
            className={cn(
              "rounded-field px-2.5 py-1 text-micro font-semibold transition-colors",
              timeframe === tf
                ? "bg-accent-soft text-accent"
                : "text-fg-muted hover:bg-surface-2 hover:text-fg"
            )}
          >
            {tf === "all" ? "All" : tf}
          </button>
        ))}
        <span className="tnum ml-auto font-mono text-[10px] text-fg-muted">
          {isMulti
            ? `${visible.length}/${multi.length} words`
            : `${pointCount} prints`}
        </span>
      </div>
      {isMulti && multi.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          {multi.map((s) => {
            const off = hidden.has(s.name);
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => toggle(s.name)}
                className={cn(
                  "flex items-center gap-1.5 rounded-field border px-2 py-1 text-micro font-medium transition-colors",
                  off
                    ? "border-line text-fg-muted opacity-50"
                    : "border-line text-fg hover:bg-surface-2"
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name}
              </button>
            );
          })}
        </div>
      )}
      {isMulti ? (
        <PriceChartMulti
          series={visible}
          className="h-[280px]"
          emptyLabel={visible.length === 0 ? "All options hidden" : "No price history yet"}
          resetKey={timeframe}
        />
      ) : (
        <PriceChart
          data={single.chartData}
          className="h-[280px]"
          showBaseline={showBaseline}
          resetKey={timeframe}
        />
      )}
    </div>
  );
}
