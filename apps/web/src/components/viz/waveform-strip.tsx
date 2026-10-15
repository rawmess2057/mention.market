"use client";

import { useId, useMemo } from "react";
import { cn, seededRandom } from "@/lib/format";
import { rgba } from "@/lib/theme";

/**
 * Full-width waveform strip for the market detail page. Purely presentational:
 * bars are seeded from `seed` so the shape is stable across renders, and
 * `live` adds a gentle per-bar pulse (mirrors `WaveformAvatar`).
 */
export function WaveformStrip({
  seed = 1,
  bars = 96,
  className,
  live = false,
  color = rgba("accent"),
}: {
  seed?: number;
  bars?: number;
  className?: string;
  live?: boolean;
  color?: string;
}) {
  const gid = useId();
  const heights = useMemo(() => {
    const rand = seededRandom(seed);
    return Array.from({ length: bars }, () => {
      const base = 0.15 + rand() * 0.85;
      return Math.max(0.12, base);
    });
  }, [seed, bars]);

  const w = bars * 3;
  const h = 40;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("h-10 w-full overflow-hidden", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={`wf-${gid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="50%" stopColor={color} stopOpacity="0.9" />
          <stop offset="100%" stopColor={color} stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {heights.map((v, i) => {
        const bh = v * (h - 6);
        const x = i * 3;
        const y = (h - bh) / 2;
        return (
          <rect key={i} x={x} y={y} width={1.6} rx={0.8} height={bh} fill={`url(#wf-${gid})`}>
            {live && (
              <animate
                attributeName="height"
                values={`${bh};${Math.min(h - 6, bh * 1.8)};${bh * 0.7};${bh}`}
                dur={`${1 + (i % 7) * 0.14}s`}
                repeatCount="indefinite"
              />
            )}
            {live && (
              <animate
                attributeName="y"
                values={`${y};${(h - Math.min(h - 6, bh * 1.8)) / 2};${(h - bh * 0.7) / 2};${y}`}
                dur={`${1 + (i % 7) * 0.14}s`}
                repeatCount="indefinite"
              />
            )}
          </rect>
        );
      })}
    </svg>
  );
}
