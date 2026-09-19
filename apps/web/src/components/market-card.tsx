"use client";

import Link from "next/link";
import { memo } from "react";
import { Flame, Users, Volume2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { LeaderBar } from "@/components/viz/leader-bar";
import { Sparkline } from "@/components/viz/sparkline";
import { AnimatedNumber } from "@/components/viz/animated-number";
import { cn, fmtTimeLeft, fmtUsd } from "@/lib/format";
import { sessionChange, toValues, type HistoryInput } from "@/lib/history";
import { useSim } from "@/lib/sim";
import { useNow } from "@/hooks/useNow";
import { VERTICAL_META, type Market } from "@/lib/types";
import { lmsrProbYes } from "@/lib/lmsr";

export const MarketCard = memo(function MarketCard({ market }: { market: Market }) {
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const history = useSim((s) => s.history[m.id]);
  const now = useNow(5000);

  const heatIntensity = Math.min(1, m.volume / 100_000);

  return (
    <Link
      href={`/market/${m.slug}`}
      className="grad-border lift group block rounded-2xl p-4"
      style={{
        boxShadow: `0 10px 30px -10px rgba(0,0,0,${0.04 + heatIntensity * 0.06})`,
      }}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-gray-mid">
            <span>{VERTICAL_META[m.vertical].emoji}</span>
            <span className="truncate">{m.event}</span>
          </div>
          <h3 className="truncate text-[15px] font-semibold text-navy transition-colors group-hover:text-blue">
            {m.title}
          </h3>
        </div>
        <StatusBadge status={m.status} />
      </div>

      {m.type === "binary" ? <BinarySummary m={m} history={history} /> : <MajoritySummary m={m} />}

      <div className="mt-3.5 flex items-center gap-3 text-[11px] text-gray-mid">
        <span className="flex items-center gap-1">
          <Volume2 className="h-3 w-3" />
          {fmtUsd(m.volume, { compact: true })}
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {m.traders.toLocaleString()}
        </span>
        <StatusPill m={m} now={now} />
      </div>
    </Link>
  );
})

function StatusPill({ m, now }: { m: Market; now: number }) {
  if (m.status === "resolved") {
    const winner = (m.winningOutcome ?? "—").toUpperCase();
    const conf = m.confidence !== undefined ? ` ${m.confidence}%` : "";
    return (
      <span className="ml-auto rounded-md bg-green-light px-1.5 py-0.5 font-mono text-green">
        Winner: {winner}
        {conf}
      </span>
    );
  }
  if (m.status === "locked") {
    return (
      <span className="ml-auto rounded-md bg-cream-dark px-1.5 py-0.5 font-mono text-gray-mid">
        Locked
      </span>
    );
  }
  if (m.status === "resolving") {
    return (
      <span className="ml-auto rounded-md bg-blue-light px-1.5 py-0.5 font-mono text-blue">
        Resolving…
      </span>
    );
  }
  const msLeft = m.endTime - now;
  const urgent = msLeft > 0 && msLeft < 10 * 60_000;
  return (
    <span
      suppressHydrationWarning
      className={cn(
        "ml-auto rounded-md px-1.5 py-0.5 font-mono",
        urgent ? "bg-red-brand/10 text-red-brand" : "bg-blue-light text-blue"
      )}
    >
      {urgent ? `Ending ${fmtTimeLeft(msLeft)}` : fmtTimeLeft(msLeft)}
    </span>
  );
}

function ChangePill({ change }: { change: number }) {
  if (!Number.isFinite(change) || Math.abs(change) < 0.0005) {
    return (
      <span className="rounded-md bg-cream-dark px-1.5 py-0.5 font-mono text-[10px] text-gray-mid">
        ±0.0%
      </span>
    );
  }
  const up = change > 0;
  const label = `${up ? "+" : ""}${(change * 100).toFixed(1)}%`;
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 font-mono text-[10px]",
        up ? "bg-green-light text-green" : "bg-red-light text-red-brand"
      )}
    >
      {label}
    </span>
  );
}

function BinarySummary({ m, history }: { m: Market; history?: HistoryInput }) {
  const p = lmsrProbYes(m.yesShares, m.noShares, m.b);
  // Fixed brand blue — reserves green/red for YES/NO text + momentum only.
  const stroke = "#2E7DF6";
  const values = toValues(history, [p, p]);
  const change = m.status === "open" ? sessionChange(history) : 0;
  return (
    <div className="flex items-center gap-3">
      <Sparkline data={values} width={110} height={34} stroke={stroke} domain={[0, 1]} className="w-[110px]" />
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <AnimatedNumber
            value={p * 100}
            format={(v) => `${Math.round(v)}%`}
            className="font-mono text-lg font-bold text-green"
          />
          <span className="text-xs text-gray-mid">/</span>
          <span className="font-mono text-sm font-semibold text-red-brand">
            {Math.round((1 - p) * 100)}%
          </span>
        </div>
        {m.status === "open" && <ChangePill change={change} />}
      </div>
    </div>
  );
}

function MajoritySummary({ m }: { m: Market }) {
  const words = m.words ?? [];
  const pot = words.reduce((s, w) => s + w.pool, 0);
  const sorted = [...words].sort((a, b) => b.pool - a.pool).slice(0, 3);
  return (
    <div className="space-y-2">
      {sorted.map((w, i) => {
        const share = pot > 0 ? (w.pool / pot) * 100 : 0;
        return (
          <div key={w.word} className="flex items-center gap-2 text-xs">
            <span className={cn("w-28 truncate font-medium", i === 0 ? "text-navy" : "text-text-secondary")}>
              {w.word.trim()}
            </span>
            <LeaderBar
              value={share}
              className="h-1.5 flex-1"
              barClassName={
                i === 0
                  ? "bg-gradient-to-r from-blue to-blue-dark"
                  : "bg-blue/40"
              }
            />
            <span className="w-8 text-right font-mono text-[11px] text-gray-mid">
              {Math.round(share)}%
            </span>
          </div>
        );
      })}
      <div className="pt-0.5 text-[11px] text-gray-mid">
        {words.length} words · {fmtUsd(pot, { compact: true })} in play
      </div>
    </div>
  );
}

export function LiveCarousel() {
  const markets = useSim((s) => s.markets);
  const live = Object.values(markets).filter((m) => m.status === "open");
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
      {live.map((m) => (
        <div key={m.id} className="w-[290px] shrink-0 snap-start">
          <LiveCard m={m} />
        </div>
      ))}
    </div>
  );
}

function LiveCard({ m }: { m: Market }) {
  const history = useSim((s) => s.history[m.id]);
  const now = useNow(1000);
  const values = toValues(history);
  const change = sessionChange(history);

  const p = m.type === "binary" ? lmsrProbYes(m.yesShares, m.noShares, m.b) : null;

  return (
    <Link
      href={`/market/${m.slug}`}
      className="grad-border lift block h-full rounded-2xl p-4"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 rounded-full bg-red-brand/10 px-2 py-0.5 text-[10px] font-bold text-red-brand on-air-shimmer">
          <span className="h-1.5 w-1.5 rounded-full bg-red-brand" />
          ON AIR
        </span>
        <span
          suppressHydrationWarning
          className="font-mono text-[11px] text-gray-mid"
        >
          {fmtTimeLeft(m.endTime - now)}
        </span>
      </div>
      <h3 className="mb-1 truncate text-sm font-semibold text-navy">{m.title}</h3>
      <div className="mb-2 text-[11px] text-gray-mid">{m.event}</div>
      {p !== null ? (
        <div className="flex items-center justify-between gap-2">
          <Sparkline
            data={values.length >= 2 ? values : [p, p]}
            width={100}
            height={30}
            stroke="#2E7DF6"
            domain={[0, 1]}
            className="w-[100px] flex-1"
          />
          <div className="flex flex-col items-end gap-1">
            <AnimatedNumber
              value={p * 100}
              format={(v) => `${Math.round(v)}%`}
              className="font-mono text-base font-bold text-green"
            />
            <ChangePill change={change} />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-orange-600">
          <Flame className="h-3 w-3" />
          {fmtUsd(m.volume, { compact: true })} in the pot
        </div>
      )}
    </Link>
  );
}
