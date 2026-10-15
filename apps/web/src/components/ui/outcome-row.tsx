"use client";

import { Flame } from "lucide-react";
import { LeaderBar } from "@/components/viz/leader-bar";
import { cn } from "@/lib/format";

/**
 * One tradeable option in a multi-outcome (word-race) market.
 *
 * Same row is reused by the market card, the market page board and the trade
 * sheet, so the number a user taps is the number they saw a moment earlier.
 */
export function OutcomeRow({
  label,
  share,
  multiplier,
  sub,
  leading = false,
  dense = false,
  className,
  onSelect,
}: {
  label: string;
  /** Share of the pool, 0..1. */
  share: number;
  /** Payout per 1 SOL if this option wins (parimutuel). */
  multiplier?: number;
  /** Secondary line — backers, volume, anything market-specific. */
  sub?: string;
  leading?: boolean;
  dense?: boolean;
  className?: string;
  onSelect?: () => void;
}) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  const Wrapper = onSelect ? "button" : "div";

  return (
    <Wrapper
      {...(onSelect ? { type: "button" as const, onClick: onSelect } : {})}
      className={cn(
        "group w-full text-left",
        dense ? "px-3 py-2" : "px-3.5 py-3",
        onSelect && "rounded-tile transition-colors hover:bg-surface-2",
        className
      )}
    >
      <div className="flex items-center gap-2">
        {leading && <Flame className="h-3.5 w-3.5 shrink-0 text-no" aria-hidden />}
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-semibold",
            dense ? "text-[13px]" : "text-sm",
            leading ? "text-fg" : "text-fg-muted"
          )}
        >
          {label}
        </span>
        {multiplier !== undefined && multiplier > 0 && (
          <span className="tnum shrink-0 rounded-field bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-fg-muted">
            {multiplier.toFixed(2)}×
          </span>
        )}
        <span
          className={cn(
            "tnum w-10 shrink-0 text-right font-mono font-bold",
            dense ? "text-[12px]" : "text-sm",
            leading ? "text-fg" : "text-fg-muted"
          )}
        >
          {Math.round(pct)}%
        </span>
      </div>

      <LeaderBar
        value={pct}
        className={cn(dense ? "mt-1.5" : "mt-2", "h-1.5")}
        barClassName={
          leading
            ? "bg-gradient-to-r from-accent-strong to-accent-strong"
            : "bg-accent-strong/35 group-hover:bg-accent-strong/50"
        }
      />

      {sub && <div className="mt-1.5 text-micro text-fg-muted">{sub}</div>}
    </Wrapper>
  );
}
