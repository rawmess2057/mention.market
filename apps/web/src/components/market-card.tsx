"use client";

import Link from "next/link";
import { memo } from "react";
import { Users, Volume2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { LeaderBar } from "@/components/viz/leader-bar";
import { SplitBar } from "@/components/viz/split-bar";
import { AnimatedNumber } from "@/components/viz/animated-number";
import { cn, fmtTimeLeft } from "@/lib/format";
import { sessionChange, type HistoryInput } from "@/lib/history";
import { useSim } from "@/lib/sim";
import { useNow } from "@/hooks/useNow";
import { VERTICAL_META, type Market, type Vertical } from "@/lib/types";
import { lmsrProbYes } from "@/lib/lmsr";

const VERTICAL_CHIP: Record<Vertical, string> = {
  streams: "bg-blue-light",
  sports: "bg-green-light",
  earnings: "bg-amber-50",
  politics: "bg-red-brand-light",
  podcasts: "bg-cream-dark",
};

function VerticalChip({ vertical, className }: { vertical: Vertical; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base",
        VERTICAL_CHIP[vertical],
        className
      )}
    >
      {VERTICAL_META[vertical].emoji}
    </span>
  );
}

export const MarketCard = memo(function MarketCard({ market }: { market: Market }) {
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const history = useSim((s) => s.history[m.id]);
  const now = useNow(5000);

  const heatIntensity = Math.min(1, m.volume / 100_000);

  return (
    <Link
      href={`/market/${m.slug}`}
      className="grad-border lift group block rounded-2xl p-5 md:p-6"
      style={{
        boxShadow: `0 10px 30px -10px rgba(0,0,0,${0.04 + heatIntensity * 0.06})`,
      }}
    >
      <div className="mb-3 flex items-start gap-3">
        <VerticalChip vertical={m.vertical} />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 truncate text-[11px] text-gray-mid">{m.event}</div>
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-navy transition-colors group-hover:text-blue">
            {m.title}
          </h3>
        </div>
        <StatusBadge status={m.status} />
      </div>

      {m.type === "binary" ? <BinaryOutcome m={m} history={history} /> : <MajorityOutcome m={m} />}

      <div className="mt-3.5 flex items-center gap-3 text-[11px] text-gray-mid">
        <span className="flex items-center gap-1">
          <Volume2 className="h-3 w-3" />
          {fmtMarketAmount(m.volume, true)}
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {m.traders.toLocaleString()}
        </span>
        <StatusPill m={m} now={now} />
      </div>
    </Link>
  );
});

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

function fmtMarketAmount(amount: number, compact = false) {
  return `${amount.toLocaleString("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : 4,
  })} SOL`;
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
        up ? "bg-green-light text-green" : "bg-red-brand-light text-red-brand"
      )}
    >
      {label}
    </span>
  );
}

function BinaryOutcome({ m, history }: { m: Market; history?: HistoryInput }) {
  const p = lmsrProbYes(m.yesShares, m.noShares, m.b);
  const change = m.status === "open" ? sessionChange(history) : 0;
  const yes = Math.round(p * 100);
  const no = Math.round((1 - p) * 100);
  return (
    <div className="space-y-2.5">
      <SplitBar yes={p} />
      <div className="flex items-center gap-1.5">
        <span className="rounded-md bg-green-light px-2 py-0.5 font-mono text-[11px] font-semibold text-green">
          YES {yes}%
        </span>
        <span className="rounded-md bg-red-brand-light px-2 py-0.5 font-mono text-[11px] font-semibold text-red-brand">
          NO {no}%
        </span>
        {m.status === "open" && <ChangePill change={change} />}
      </div>
    </div>
  );
}

function MajorityOutcome({ m }: { m: Market }) {
  const words = m.words ?? [];
  const pot = words.reduce((s, w) => s + w.pool, 0);
  const sorted = [...words].sort((a, b) => b.pool - a.pool).slice(0, 3);
  return (
    <div className="space-y-2">
      {sorted.map((w, i) => {
        const share = pot > 0 ? (w.pool / pot) * 100 : 0;
        const leader = i === 0;
        return (
          <div key={w.word} className="flex items-center gap-2 text-xs">
            <span
              className={cn(
                "w-24 truncate font-medium",
                leader ? "text-navy" : "text-text-secondary"
              )}
            >
              {w.word.trim()}
            </span>
            <LeaderBar
              value={share}
              className="h-1.5 flex-1"
              barClassName={
                leader ? "bg-gradient-to-r from-green to-green/80" : "bg-blue/40"
              }
            />
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                leader ? "bg-green-light text-green" : "bg-blue-light text-blue"
              )}
            >
              {Math.round(share)}%
            </span>
          </div>
        );
      })}
      <div className="pt-0.5 text-[11px] text-gray-mid">
        {words.length} words · {fmtMarketAmount(pot, true)} in play
      </div>
    </div>
  );
}

export function LiveCarousel({ markets }: { markets: Market[] }) {
  const live = markets.filter((m) => m.status === "open");
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
  const change = sessionChange(history);

  const p = m.type === "binary" ? lmsrProbYes(m.yesShares, m.noShares, m.b) : null;

  return (
    <Link
      href={`/market/${m.slug}`}
      className="grad-border lift block h-full rounded-2xl p-4"
    >
      <div className="mb-2.5 flex items-center justify-between">
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
      <div className="mb-2 flex items-start gap-2.5">
        <VerticalChip vertical={m.vertical} className="h-8 w-8 text-sm" />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-navy">{m.title}</h3>
          <div className="mt-0.5 truncate text-[11px] text-gray-mid">{m.event}</div>
        </div>
      </div>
      {p !== null ? (
        <div className="space-y-2">
          <SplitBar yes={p} height={6} />
          <div className="flex items-center gap-1.5">
            <span className="rounded-md bg-green-light px-1.5 py-0.5 font-mono text-[10px] font-semibold text-green">
              YES {Math.round(p * 100)}%
            </span>
            <span className="rounded-md bg-red-brand-light px-1.5 py-0.5 font-mono text-[10px] font-semibold text-red-brand">
              NO {Math.round((1 - p) * 100)}%
            </span>
            <ChangePill change={change} />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <AnimatedNumber
            value={m.volume}
            format={(v) => fmtMarketAmount(v, true)}
            className="text-[11px] font-semibold text-orange-600"
          />
          <span className="text-[11px] text-orange-600">in the pot</span>
        </div>
      )}
    </Link>
  );
}
