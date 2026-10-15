"use client";

import Link from "next/link";
import { memo } from "react";
import { Users, Volume2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { OutcomeRow } from "@/components/ui/outcome-row";
import { Probability, DeltaPill } from "@/components/ui/probability";
import { SplitBar } from "@/components/viz/split-bar";
import { cn, fmtSol, fmtTimeLeft } from "@/lib/format";
import { sessionChange, toValues, type HistoryInput } from "@/lib/history";
import { Sparkline } from "@/components/viz/sparkline";
import { rgba } from "@/lib/theme";
import { useStore } from "@/lib/store";
import { useNow } from "@/hooks/useNow";
import { VERTICAL_META, type Market, type Vertical } from "@/lib/types";
import { lmsrProbYes } from "@/lib/lmsr";
import { isVoided } from "@/lib/settle";

const VERTICAL_CHIP: Record<Vertical, string> = {
  streams: "bg-accent-soft",
  sports: "bg-yes-soft",
  earnings: "bg-warn-soft",
  politics: "bg-no-soft",
  podcasts: "bg-surface-2",
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
  const m = useStore((s) => s.markets[market.id]) ?? market;
  const history = useStore((s) => s.history[m.id]);
  const now = useNow(5000);

  return (
    <Link
      href={`/market/${m.slug}`}
      className="group flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-2/60"
    >
      <div className="flex items-start gap-3">
        <VerticalChip vertical={m.vertical} className="h-8 w-8 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-micro text-fg-subtle">{m.event}</div>
          <h3 className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-fg">{m.title}</h3>
        </div>
      </div>

      {m.status === "resolved" || (m.status === "resolving" && m.winningOutcome) ? (
        <Outcome m={m} />
      ) : m.type === "binary" ? (
        <BinaryOutcome m={m} history={history} />
      ) : (
        <MajorityOutcome m={m} />
      )}

      <div className="mt-auto flex items-center gap-3 pt-1 text-micro text-fg-subtle">
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

/** A decided market shows what happened, not a stale probability. */
function Outcome({ m }: { m: Market }) {
  const o = m.winningOutcome ?? "";
  const label = o === "void" ? "VOID" : m.type === "binary" ? o.toUpperCase() : `“${o}”`;
  return (
    <div className="flex items-baseline gap-2">
      <span className={cn("text-2xl font-bold tracking-tight", o === "yes" ? "text-yes" : o === "no" ? "text-no" : "text-fg")}>
        {label}
      </span>
      <span className="text-xs text-fg-muted">{m.status === "resolved" ? (o === "void" ? "refunded" : "won") : "proposed"}</span>
    </div>
  );
}

function StatusPill({ m, now }: { m: Market; now: number }) {
  if (m.status === "resolved") {
    return <span className="ml-auto text-fg-subtle">{isVoided(m) ? "Voided" : "Resolved"}</span>;
  }
  if (m.status === "locked" || (m.status === "open" && now >= m.endTime)) {
    return <span className="ml-auto rounded-md bg-warn-soft px-1.5 py-0.5 font-medium text-warn">Awaiting result</span>;
  }
  if (m.status === "resolving") {
    return <span className="ml-auto rounded-md bg-accent-soft px-1.5 py-0.5 font-medium text-accent">Challenge window</span>;
  }
  const msLeft = m.endTime - now;
  const urgent = msLeft > 0 && msLeft < 10 * 60_000;
  return (
    <span
      suppressHydrationWarning
      className={cn(
        "tnum ml-auto rounded-md px-1.5 py-0.5 font-medium",
        urgent ? "bg-no-soft text-no" : "text-fg-muted"
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
  const points = toValues(history).slice(-48);
  return (
    <div className="space-y-2.5">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="tnum text-2xl font-bold tracking-tight text-fg">{Math.round(p * 100)}%</span>
          <span className="text-xs text-fg-muted">chance</span>
          {m.status === "open" && Math.abs(change) >= 0.005 && <DeltaPill delta={change} />}
        </div>
        {points.length > 1 && (
          <Sparkline data={points} width={88} height={28} domain={[0, 1]} stroke={rgba(change < 0 ? "no" : "yes")} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <span className="tnum rounded-md bg-yes-soft py-1.5 text-center text-xs font-semibold text-yes">
          Yes {Math.round(p * 100)}¢
        </span>
        <span className="tnum rounded-md bg-no-soft py-1.5 text-center text-xs font-semibold text-no">
          No {Math.round((1 - p) * 100)}¢
        </span>
      </div>
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
      <div className="px-1.5 pt-1 text-micro text-fg-muted">
        {words.length} words · {fmtSol(pot, { compact: true })} in play
      </div>
    </div>
  );
}
