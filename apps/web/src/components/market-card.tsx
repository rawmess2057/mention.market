"use client";

import Link from "next/link";
import { memo, type CSSProperties } from "react";
import { Clock, Users, Volume2 } from "lucide-react";
import { OutcomeRow } from "@/components/ui/outcome-row";
import { DeltaPill } from "@/components/ui/probability";
import { QuoteTitle } from "@/components/ui/quote-title";
import { Sparkline } from "@/components/viz/sparkline";
import { cn, fmtSol, fmtTimeLeft } from "@/lib/format";
import { sessionChange, toValues, type HistoryInput } from "@/lib/history";
import { PALETTE, rgba } from "@/lib/theme";
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
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-field text-[13px]",
        VERTICAL_CHIP[vertical],
        className
      )}
      aria-hidden
    >
      {VERTICAL_META[vertical].emoji}
    </span>
  );
}

const channels = (k: keyof typeof PALETTE) => PALETTE[k].join(" ");

/**
 * The glow a card rests in: the outcome it leans toward, as hard as it leans.
 * A coin-flip market stays neutral; a 90% market is unmistakably green.
 */
function glowFor(m: Market): CSSProperties {
  const o = m.winningOutcome;
  if (o === "yes" || o === "no") return { "--glow": channels(o), "--glow-a": 0.22 } as CSSProperties;
  if (o) return { "--glow": channels("accent"), "--glow-a": 0.1 } as CSSProperties;
  if (m.type !== "binary") return { "--glow": channels("accent"), "--glow-a": 0.12 } as CSSProperties;
  const p = lmsrProbYes(m.yesShares, m.noShares, m.b);
  const lean = Math.abs(p - 0.5) * 2;
  return {
    "--glow": channels(p >= 0.5 ? "yes" : "no"),
    "--glow-a": (0.05 + lean * 0.3).toFixed(3),
  } as CSSProperties;
}

/**
 * The market card: the primary navigation unit.
 *
 * What's being listened for (the quoted phrase, in the display serif), how
 * likely the market thinks it is, and how much is riding on it. No nested
 * trade buttons: the whole card is one link, trading lives one tap away.
 */
export const MarketCard = memo(function MarketCard({ market }: { market: Market }) {
  const m = useStore((s) => s.markets[market.id]) ?? market;
  const history = useStore((s) => s.history[m.id]);
  const now = useNow(5000);
  const decided = m.status === "resolved" || (m.status === "resolving" && !!m.winningOutcome);
  const p = m.type === "binary" ? lmsrProbYes(m.yesShares, m.noShares, m.b) : null;

  return (
    <Link
      href={`/market/${m.slug}`}
      style={glowFor(m)}
      className="card-glow group relative flex flex-col gap-3.5 overflow-hidden rounded-2xl border border-line/80 bg-surface p-4 shadow-card transition-[border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card-hover active:translate-y-0 active:scale-[0.995]"
    >
      <div className="flex items-center gap-2">
        <VerticalChip vertical={m.vertical} />
        <span className="min-w-0 flex-1 truncate text-micro text-fg-subtle">{m.event}</span>
        <StatusPill m={m} now={now} />
      </div>

      <QuoteTitle title={m.title} className="line-clamp-2 text-[21px] leading-[1.15]" />

      {decided ? (
        <Outcome m={m} />
      ) : m.type === "binary" ? (
        <BinaryOutcome m={m} history={history} />
      ) : (
        <MajorityOutcome m={m} />
      )}

      <div className="mt-auto flex items-center gap-3 text-micro text-fg-subtle">
        <span className="tnum flex items-center gap-1">
          <Volume2 className="h-3 w-3" aria-hidden />
          {fmtSol(m.volume, { compact: true })}
        </span>
        <span className="tnum flex items-center gap-1">
          <Users className="h-3 w-3" aria-hidden />
          {m.traders.toLocaleString()}
        </span>
      </div>

      {/* The split, as the card's bottom edge. */}
      {p !== null && !decided && (
        <div className="absolute inset-x-0 bottom-0 flex h-[3px]" aria-hidden>
          <span className="bg-yes/70 transition-[width] duration-500" style={{ width: `${p * 100}%` }} />
          <span className="flex-1 bg-no/60" />
        </div>
      )}
    </Link>
  );
});

/** A decided market shows what happened, not a stale probability. */
function Outcome({ m }: { m: Market }) {
  const o = m.winningOutcome ?? "";
  const label = o === "void" ? "VOID" : m.type === "binary" ? o.toUpperCase() : `“${o}”`;
  return (
    <div className="flex items-baseline gap-2">
      <span
        className={cn(
          "font-mono text-[32px] font-bold leading-none tracking-tight",
          o === "yes" ? "text-yes" : o === "no" ? "text-no" : "text-fg"
        )}
      >
        {label}
      </span>
      <span className="text-xs text-fg-muted">
        {m.status === "resolved" ? (o === "void" ? "refunded" : "won") : "proposed"}
      </span>
    </div>
  );
}

function StatusPill({ m, now }: { m: Market; now: number }) {
  if (m.status === "resolved") {
    return <span className="shrink-0 text-micro text-fg-subtle">{isVoided(m) ? "Voided" : "Resolved"}</span>;
  }
  if (m.status === "locked" || (m.status === "open" && now >= m.endTime)) {
    return (
      <span className="shrink-0 rounded-pill bg-warn-soft px-2 py-0.5 text-micro font-medium text-warn">
        Awaiting result
      </span>
    );
  }
  if (m.status === "resolving") {
    return (
      <span className="shrink-0 rounded-pill bg-accent-soft px-2 py-0.5 text-micro font-medium text-accent">
        Challenge window
      </span>
    );
  }
  const msLeft = m.endTime - now;
  const urgent = msLeft > 0 && msLeft < 10 * 60_000;
  return (
    <span
      suppressHydrationWarning
      className={cn(
        "tnum flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-micro font-medium",
        urgent ? "bg-no-soft text-no" : "bg-surface-2 text-fg-muted"
      )}
    >
      <Clock className="h-3 w-3" aria-hidden />
      {fmtTimeLeft(msLeft)}
    </span>
  );
}

function BinaryOutcome({ m, history }: { m: Market; history?: HistoryInput }) {
  const p = lmsrProbYes(m.yesShares, m.noShares, m.b);
  const change = m.status === "open" ? sessionChange(history) : 0;
  const points = toValues(history).slice(-48);
  const yes = Math.round(p * 100);
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="tnum font-mono text-[34px] font-bold leading-none tracking-tight text-fg">
              {yes}
              <span className="text-lg font-semibold text-fg-subtle">%</span>
            </span>
            {m.status === "open" && Math.abs(change) >= 0.005 && <DeltaPill delta={change} className="mb-1" />}
          </div>
          <div className="mt-1 text-micro text-fg-subtle">chance they say it</div>
        </div>
        {points.length > 1 && (
          <Sparkline
            data={points}
            width={96}
            height={34}
            domain={[0, 1]}
            stroke={rgba(change < 0 ? "no" : "yes")}
            className="mb-1 opacity-80 transition-opacity group-hover:opacity-100"
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <span className="tnum rounded-field border border-yes/15 bg-yes-soft py-1.5 text-center text-xs font-semibold text-yes transition-colors group-hover:border-yes/30 group-hover:bg-yes/20">
          Yes {yes}¢
        </span>
        <span className="tnum rounded-field border border-no/15 bg-no-soft py-1.5 text-center text-xs font-semibold text-no transition-colors group-hover:border-no/30 group-hover:bg-no/20">
          No {100 - yes}¢
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
