"use client";

import { useId, useMemo } from "react";
import { cn } from "@/lib/format";

export function Sparkline({
  data,
  width = 120,
  height = 36,
  stroke = "#2E7DF6",
  className,
  domain,
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  className?: string;
  /** Fixed y-domain for honest scaling (e.g. [0,1] for binary probs). Defaults to auto min/max. */
  domain?: [number, number];
}) {
  const gid = useId();

  const { path, area, lastX, lastY } = useMemo(() => {
    if (data.length < 2) return { path: "", area: "", lastX: 0, lastY: 0 };
    const lo = domain ? domain[0] : Math.min(...data);
    const hi = domain ? domain[1] : Math.max(...data);
    const min = Math.min(lo, hi);
    const max = Math.max(lo, hi);
    const range = max - min || 1;
    const px = (i: number) => (i / (data.length - 1)) * width;
    const py = (v: number) => height - 3 - ((v - min) / range) * (height - 6);
    const pts = data.map((v, i) => [px(i), py(v)] as const);

    let d = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      d += ` Q ${x0},${y0} ${mx},${(y0 + y1) / 2} T ${x1},${y1}`;
    }

    const areaD = `${d} L ${width},${height} L 0,${height} Z`;
    return {
      path: d,
      area: areaD,
      lastX: pts[pts.length - 1][0],
      lastY: pts[pts.length - 1][1],
    };
  }, [data, width, height, domain]);

  if (!path) return null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.2" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g-${gid})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={stroke}>
        <animate attributeName="opacity" values="1;0.4;1" dur="1.6s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
