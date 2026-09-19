"use client";

import { useMemo } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { AnimatedNumber } from "./animated-number";
import { lmsrProbYes } from "@/lib/lmsr";
import { toValues } from "@/lib/history";
import { useSim } from "@/lib/sim";
import { VERTICAL_META } from "@/lib/types";
import Link from "next/link";

export function TickerTape() {
  const markets = useSim((s) => s.markets);
  const history = useSim((s) => s.history);

  const items = useMemo(
    () =>
      Object.values(markets)
        .filter((m) => m.status === "open")
        .map((m) => {
          const h = toValues(history[m.id]);
          const cur = h.length > 0 ? h[h.length - 1] : 0.5;
          const prev = h.length > 8 ? h[h.length - 8] : cur;
          return { m, cur, delta: cur - prev };
        }),
    [markets, history]
  );

  if (items.length === 0) return null;

  const row = (
    <div className="flex shrink-0 items-center">
      {items.map(({ m, cur, delta }) => {
        const label =
          m.type === "binary"
            ? m.title.replace(/^Will they say /, "").slice(0, 22)
            : (m.words?.[0]?.word ?? "race");
        return (
          <Link
            key={m.id}
            href={`/market/${m.slug}`}
            className="flex items-center gap-1.5 whitespace-nowrap px-4 text-[11px] transition-opacity hover:opacity-70"
          >
            <span>{VERTICAL_META[m.vertical].emoji}</span>
            <span className="font-medium text-gray-mid">{label}</span>
            <AnimatedNumber
              value={cur * 100}
              format={(v) => `${Math.round(v)}%`}
              className="font-mono font-bold text-navy"
            />
            {delta >= 0 ? (
              <TrendingUp className="h-3 w-3 text-green" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-brand" />
            )}
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="relative overflow-hidden border-b border-gray-warm bg-cream-dark py-1.5">
      <div className="marquee flex w-max">
        {row}
        {row}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-cream-dark to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-cream-dark to-transparent" />
    </div>
  );
}
