"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { createChart, ColorType, LineSeries, LineStyle } from "lightweight-charts";
import type { ISeriesApi } from "lightweight-charts";
import { cn } from "@/lib/format";
import { useNow } from "@/hooks/useNow";
import {
  normalizeHistory,
  resample,
  type HistoryInput,
  type PricePoint,
} from "@/lib/history";

type Timeframe = "1m" | "5m" | "1h" | "1d";

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

export function PriceChart({
  data,
  className,
  showBaseline = false,
  emptyLabel = "No price history yet",
}: {
  data: Array<{ time: number; value: number }>;
  className?: string;
  showBaseline?: boolean;
  emptyLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const baselineApplied = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#5A5A5A",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(229, 225, 219, 0.4)" },
        horzLines: { color: "rgba(229, 225, 219, 0.4)" },
      },
      crosshair: {
        vertLine: {
          color: "rgba(46, 125, 246, 0.3)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#2E7DF6",
        },
        horzLine: {
          color: "rgba(46, 125, 246, 0.3)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#2E7DF6",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(229, 225, 219, 0.6)",
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: "rgba(229, 225, 219, 0.6)",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: "#2E7DF6",
      lineWidth: 2,
      crosshairMarkerBackgroundColor: "#2E7DF6",
      crosshairMarkerBorderColor: "#ffffff",
      crosshairMarkerRadius: 4,
      priceFormat: { type: "custom" as const, formatter: (v: number) => `${Math.round(v)}%` },
    });

    if (data.length > 0) {
      lineSeries.setData(
        toLineData(
          data.map((d) => ({ t: d.time, v: d.value / 100 }))
        ) as any
      );
    }
    if (showBaseline) {
      try {
        lineSeries.createPriceLine({
          price: 50,
          color: "rgba(90, 90, 90, 0.5)",
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

  return (
    <div className={cn("relative", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {data.length < 2 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full border border-gray-warm bg-white/90 px-3 py-1 text-[11px] text-gray-mid">
            {emptyLabel}
          </span>
        </div>
      )}
      {/* Sentiment gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(43, 117, 80, 0.06) 0%, transparent 40%, transparent 60%, rgba(199, 91, 58, 0.06) 100%)",
        }}
      />
    </div>
  );
}

export function PriceChartWithTimeframe({
  history,
  className,
  showBaseline = true,
}: {
  history: HistoryInput;
  className?: string;
  showBaseline?: boolean;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const now = useNow(30_000);

  const { chartData, pointCount } = useMemo(() => {
    const tfMs: Record<Timeframe, number> = {
      "1m": 60_000,
      "5m": 300_000,
      "1h": 3_600_000,
      "1d": 86_400_000,
    };
    const all = normalizeHistory(history);
    if (all.length === 0) return { chartData: [], pointCount: 0 };
    // Real windowing: only points inside the selected timeframe.
    // Fall back to last 20 pts (not 2) so slow markets still show shape.
    let inWindow = all.filter((p) => p.t >= now - tfMs[timeframe]);
    if (inWindow.length < 2) inWindow = all.slice(-20);
    // Cap render cost + make TF switch visibly change density.
    const sampled = resample(inWindow, 60);
    return {
      chartData: sampled.map((p) => ({ time: p.t, value: p.v * 100 })),
      pointCount: sampled.length,
    };
  }, [history, timeframe, now]);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-1 border-b border-gray-warm px-3 py-2">
        {(["1m", "5m", "1h", "1d"] as Timeframe[]).map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
              timeframe === tf
                ? "bg-blue-light text-blue"
                : "text-gray-mid hover:text-navy hover:bg-cream-dark"
            )}
          >
            {tf}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-gray-mid">
          {pointCount} pts · {timeframe}
        </span>
      </div>
      <PriceChart data={chartData} className="h-[280px]" showBaseline={showBaseline} />
    </div>
  );
}
