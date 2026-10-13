"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { AnimatedNumber } from "@/components/viz/animated-number";
import { cn } from "@/lib/format";

export type ProbabilitySize = "hero" | "card" | "row";

const NUMBER: Record<ProbabilitySize, string> = {
  hero: "text-[44px] leading-[0.95] md:text-[56px]",
  card: "text-[26px] leading-none",
  row: "text-[15px] leading-none",
};

const UNIT: Record<ProbabilitySize, string> = {
  hero: "text-xl md:text-2xl",
  card: "text-sm",
  row: "text-[11px]",
};

const TONE: Record<NonNullable<ProbabilityProps["tone"]>, string> = {
  neutral: "text-navy",
  yes: "text-yes",
  no: "text-no",
};

export interface ProbabilityProps {
  /** Implied probability, 0..1. */
  value: number;
  /** Change in probability points, e.g. 0.021 = +2.1pt. */
  delta?: number;
  size?: ProbabilitySize;
  /** Caption under the number, e.g. "chance they say it". */
  label?: string;
  /** Question the percentage answers — used for the screen-reader copy. */
  outcomeLabel?: string;
  /** Timeframe for the delta pill, e.g. "today". */
  deltaLabel?: string;
  className?: string;
  tone?: "neutral" | "yes" | "no";
  /** Show the cent-denominated twin (`62¢`) — the trader-facing format. */
  showCents?: boolean;
  animate?: boolean;
  /** Announce changes politely to screen readers (throttled to the settled value). */
  ariaLive?: boolean;
}

/**
 * The single source of truth for "how likely is this?" across the app.
 *
 * Dual format on purpose: the percentage is the headline (research is clear
 * that non-traders read `62%` and not `$0.62`), the cent price rides alongside
 * for people who think in contract prices, and direction is carried by an arrow
 * *and* a sign — never by colour alone.
 */
export function Probability({
  value,
  delta,
  size = "card",
  label,
  outcomeLabel,
  deltaLabel = "session",
  className,
  tone = "neutral",
  showCents = true,
  animate = true,
  ariaLive = false,
}: ProbabilityProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const cents = Math.round(pct);
  const shown = animate ? (
    <AnimatedNumber value={pct} format={(v) => `${Math.round(v)}`} />
  ) : (
    <>{Math.round(pct)}</>
  );

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-end gap-2">
        <span
          aria-hidden={ariaLive || undefined}
          className={cn("tnum font-mono font-bold tracking-tight", NUMBER[size], TONE[tone])}
        >
          {shown}
          <span className={cn("font-semibold opacity-60", UNIT[size])}>%</span>
        </span>
        {showCents && (
          <span
            aria-hidden
            className={cn(
              "tnum rounded-field bg-ink-100 px-1.5 py-0.5 font-mono font-semibold text-ink-500",
              size === "hero" ? "text-sm" : size === "card" ? "text-[11px]" : "text-[10px]"
            )}
          >
            {cents}¢
          </span>
        )}
        {delta !== undefined && <DeltaPill delta={delta} label={deltaLabel} className="mb-1" />}
      </div>
      {label && <div className="label-caps mt-1.5">{label}</div>}
      {ariaLive && (
        <span role="status" className="sr-only">
          {outcomeLabel ? `${outcomeLabel}: ` : ""}
          {cents} percent
        </span>
      )}
    </div>
  );
}

/** Direction pill: arrow + sign + desaturated colour. */
export function DeltaPill({
  delta,
  label,
  className,
}: {
  /** Change in probability points (0.021 = +2.1pt). */
  delta: number;
  label?: string;
  className?: string;
}) {
  const flat = !Number.isFinite(delta) || Math.abs(delta) < 0.0005;
  const up = delta > 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = flat
    ? "±0.0pt"
    : `${up ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)}pt`;

  return (
    <span
      className={cn(
        "tnum inline-flex items-center gap-0.5 rounded-field px-1.5 py-0.5 font-mono text-[11px] font-semibold",
        flat
          ? "bg-ink-100 text-ink-400"
          : up
            ? "bg-yes-soft text-yes"
            : "bg-no-soft text-no",
        className
      )}
      title={label ? `${text} (${label})` : text}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {text}
      {label && <span className="font-normal opacity-70">{label}</span>}
    </span>
  );
}
