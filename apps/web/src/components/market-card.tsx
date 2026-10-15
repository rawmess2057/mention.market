"use client";

import Link from "next/link";
import { memo } from "react";
import { Users, Volume2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { OutcomeRow } from "@/components/ui/outcome-row";
import { Probability, DeltaPill } from "@/components/ui/probability";
import { SplitBar } from "@/components/viz/split-bar";
import { cn, fmtSol, fmtTimeLeft } from "@/lib/format";
import { sessionChange, type HistoryInput } from "@/lib/history";
import { useSim } from "@/lib/sim";
import { useNow } from "@/hooks/useNow";
import { VERTICAL_META, type Market, type Vertical } from "@/lib/types";
import { lmsrProbYes } from "@/lib/lmsr";
import { isVoided } from "@/lib/settle";

const VERTICAL_CHIP: Record<Vertical, string> = {
  streams: "bg-blue-light",
  sports: "bg-yes-soft",
  earnings: "bg-warn-soft",
  politics: "bg-no-soft",
  podcasts: "bg-ink-100",
};

function VerticalChip({ vertical, className }: { vertical: Vertical; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-tile text-base",
        VERTICAL_CHIP[vertical],
        className
      )}
      aria-hidden
    >
      {VERTICAL_META[vertical].emoji}
    </span>
  );
}

/**
 * The market card: the primary navigation unit.
 *
 * Structure follows the pattern every leading platform converged on — what the
 * event is, how likely the market thinks it is (in both formats), and how much
 * skin is in the game — with one deliberate omission: no quick-trade buttons
 * inside the card link, because a nested trade action is where misclicks come
 * from. Trading lives one tap away on the market page.
 */
export const MarketCard = memo(function MarketCard({ market }: { market: Market }) {
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const history = useSim((s) => s.history[m.id]);
  const now = useNow(5000);

  return (
    <Link
      href={`/market/${m.slug}`}
      className="panel lift group flex flex-col gap-3 p-4 md:p-5"
    >
      <div className="flex items-start gap-3">
        <VerticalChip vertical={m.vertical} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-micro text-gray-mid">{m.event}</div>
          <h3 className="mt-0.5 line-clamp-2 text-body-lg font-semibold leading-snug text-navy transition-colors group-hover:text-blue">
            {m.title}
          </h3>
        </div>
        <StatusBadge status={m.status} />
      </div>

      {m.type === "binary" ? <BinaryOutcome m={m} history={history} /> : <MajorityOutcome m={m} />}

      <div className="mt-auto flex items-center gap-3 border-t border-ink-100 pt-3 text-micro text-gray-mid">
        <span className="tnum flex items-center gap-1">
          <Volume2 className="h-3 w-3" aria-hidden />
          {fmtSol(m.volume, { compact: true })}
        </span>
        <span className="tnum flex items-center gap-1">
          <Users className="h-3 w-3" aria-hidden />
          {m.traders.toLocaleString()}
        </span>
        <StatusPill m={m} now={now} />
      </div>
    </Link>
  );
});

function StatusPill({ m, now }: { m: Market; now: number }) {
  if (m.status === "resolved") {
    if (isVoided(m)) {
      return (
        <span className="tnum ml-auto rounded-field bg-ink-100 px-1.5 py-0.5 font-mono font-semibold text-ink-600">
          VOIDED · refunded
        </span>
      );
    }
    const winner = (m.winningOutcome ?? "—").toUpperCase();
    return (
      <span className="tnum ml-auto rounded-field bg-yes-soft px-1.5 py-0.5 font-mono font-semibold text-yes">
        {winner} won{m.confidence !== undefined ? ` · ${m.confidence}%` : ""}
      </span>
    );
  }
  if (m.status === "locked") {
    return (
      <span className="ml-auto rounded-field bg-warn-soft px-1.5 py-0.5 font-mono font-semibold text-warn">
        Locked
      </span>
    );
  }
  if (m.status === "resolving") {
    return (
      <span className="ml-auto rounded-field bg-blue-light px-1.5 py-0.5 font-mono font-semibold text-blue">
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
        "tnum ml-auto rounded-field px-1.5 py-0.5 font-mono font-semibold",
        urgent ? "bg-no-soft text-no" : "bg-ink-100 text-ink-500"
      )}
    >
      {urgent ? "Ends in " : "Closes in "}
      {fmtTimeLeft(msLeft)}
    </span>
  );
}

function BinaryOutcome({ m, history }: { m: Market; history?: HistoryInput }) {
  const p = lmsrProbYes(m.yesShares, m.noShares, m.b);
  const change = m.status === "open" ? sessionChange(history) : 0;
  return (
    <div className="space-y-2.5">
      <div className="flex items-end justify-between gap-2">
        <Probability value={p} delta={m.status === "open" ? change : undefined} size="card" />
        <div className="flex gap-1.5 pb-0.5">
          <span className="tnum rounded-field border border-yes-line bg-yes-soft px-2 py-1 font-mono text-label font-semibold text-yes">
            YES {Math.round(p * 100)}¢
          </span>
          <span className="tnum rounded-field border border-no-line bg-no-soft px-2 py-1 font-mono text-label font-semibold text-no">
            NO {Math.round((1 - p) * 100)}¢
          </span>
        </div>
      </div>
      <SplitBar yes={p} height={6} />
    </div>
  );
}

function MajorityOutcome({ m }: { m: Market }) {
  const words = m.words ?? [];
  const pot = words.reduce((s, w) => s + w.pool, 0);
  const rows = [...words].sort((a, b) => b.pool - a.pool).slice(0, 3);
  return (
    <div className="space-y-1">
      {rows.map((w, i) => (
        <OutcomeRow
          key={w.word}
          dense
          label={w.word.trim()}
          share={pot > 0 ? w.pool / pot : 0}
          multiplier={w.pool > 0 ? (pot * 0.99) / w.pool : 0}
          leading={i === 0}
          className="px-1.5"
        />
      ))}
      <div className="px-1.5 pt-1 text-micro text-gray-mid">
        {words.length} words · {fmtSol(pot, { compact: true })} in play
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
  const words = [...(m.words ?? [])].sort((a, b) => b.pool - a.pool);
  const pot = words.reduce((s, w) => s + w.pool, 0);

  return (
    <Link href={`/market/${m.slug}`} className="panel lift flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 rounded-pill bg-no-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-no">
          <span className="live-dot" aria-hidden />
          On air
        </span>
        <span suppressHydrationWarning className="tnum font-mono text-micro text-gray-mid">
          {fmtTimeLeft(m.endTime - now)}
        </span>
      </div>

      <div className="flex items-start gap-2.5">
        <VerticalChip vertical={m.vertical} className="h-8 w-8 text-sm" />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-body font-semibold leading-snug text-navy">
            {m.title}
          </h3>
          <div className="mt-0.5 truncate text-micro text-gray-mid">{m.event}</div>
        </div>
      </div>

      <div className="mt-auto">
        {p !== null ? (
          <div className="space-y-2">
            <Probability value={p} size="row" showCents={false} />
            <SplitBar yes={p} height={6} />
            <div className="flex items-center gap-1.5">
              <span className="tnum rounded-field bg-yes-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-yes">
                YES {Math.round(p * 100)}¢
              </span>
              <span className="tnum rounded-field bg-no-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-no">
                NO {Math.round((1 - p) * 100)}¢
              </span>
              <DeltaPill delta={change} className="ml-auto" />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {words.slice(0, 2).map((w, i) => (
              <OutcomeRow
                key={w.word}
                dense
                label={w.word}
                share={pot > 0 ? w.pool / pot : 0}
                leading={i === 0}
                className="px-1"
              />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
