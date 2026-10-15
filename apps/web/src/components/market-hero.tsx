"use client";

import type { CSSProperties } from "react";
import { Users, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Probability } from "@/components/ui/probability";
import { Stat, StatRow } from "@/components/ui/stat";
import { WaveformStrip } from "@/components/viz/waveform-strip";
import { cn, fmtSol, fmtTimeLeft } from "@/lib/format";
import { sessionChange } from "@/lib/history";
import { lmsrProbYes } from "@/lib/lmsr";
import { useStore } from "@/lib/store";
import { PALETTE, rgba } from "@/lib/theme";
import { useNow } from "@/hooks/useNow";
import type { Market } from "@/lib/types";

const channels = (k: keyof typeof PALETTE) => PALETTE[k].join(" ");

/**
 * The headline of a market page: how likely, how much, and one tap to trade.
 *
 * The probability is deliberately the largest element on the page: it is the
 * product's actual output. The panel is washed in the colour of the outcome
 * the market leans toward, as strongly as it leans, so the lean reads before
 * the number does.
 */
export function MarketHero({
  market,
  onTrade,
  className,
}: {
  market: Market;
  onTrade: (opts: { side?: "yes" | "no"; word?: string }) => void;
  className?: string;
}) {
  const m = useStore((s) => s.markets[market.id]) ?? market;
  const history = useStore((s) => s.history[m.id]);
  const now = useNow(1000);

  const isBinary = m.type === "binary";
  const p = isBinary ? lmsrProbYes(m.yesShares, m.noShares, m.b) : null;
  const change = m.status === "open" ? sessionChange(history) : 0;
  const words = [...(m.words ?? [])].sort((a, b) => b.pool - a.pool);
  const pot = words.reduce((s, w) => s + w.pool, 0);
  const lead = words[0];
  const leadShare = lead && pot > 0 ? lead.pool / pot : 0;
  const open = m.status === "open" && now < m.endTime;
  const decided = (m.status === "resolved" || m.status === "resolving") && m.winningOutcome ? m.winningOutcome : null;

  const tone: "yes" | "no" | "accent" =
    decided === "yes" || decided === "no" ? decided : decided ? "accent" : p === null ? "accent" : p >= 0.5 ? "yes" : "no";
  const lean = decided ? 0.26 : p === null ? 0.14 : 0.06 + Math.abs(p - 0.5) * 2 * 0.3;
  const glow = { "--glow": channels(tone), "--glow-a": lean.toFixed(3) } as CSSProperties;

  return (
    <section style={glow} className={cn("card-glow panel overflow-hidden", className)}>
      <div className="relative p-5 md:p-6">
        {/* The sound the market is listening to. Decorative, live while trading. */}
        <WaveformStrip
          seed={m.id.length * 7 + m.title.length}
          bars={72}
          live={open}
          color={rgba(tone)}
          className="pointer-events-none absolute right-4 top-4 h-12 w-40 opacity-30 md:w-56 [mask-image:linear-gradient(90deg,transparent,black_30%,black)]"
        />

        {decided ? (
          <div>
            <div className="label-caps">{m.status === "resolved" ? "Resolved" : "Proposed outcome"}</div>
            <div
              className={cn(
                "mt-1.5 font-mono text-[56px] font-bold leading-none tracking-tight md:text-[72px]",
                decided === "yes" ? "text-yes" : decided === "no" ? "text-no" : "text-fg"
              )}
            >
              {decided === "void" ? "VOID" : isBinary ? decided.toUpperCase() : `“${decided}”`}
            </div>
            <div className="mt-2.5 text-sm text-fg-muted">
              {decided === "void"
                ? "Every position is refunded."
                : m.status === "resolved"
                  ? "Final. Winning positions can be claimed."
                  : "Final once the challenge window closes."}
            </div>
          </div>
        ) : isBinary && p !== null ? (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <Probability
              value={p}
              delta={open ? change : undefined}
              size="hero"
              label="chance they say it"
              outcomeLabel="YES"
              ariaLive
            />
            {/* Mobile only: on desktop the sticky ticket is right beside this. */}
            {open && (
              <div className="flex w-full gap-2 sm:w-auto lg:hidden">
                <Button variant="yes" size="lg" className="flex-1 sm:flex-none" onClick={() => onTrade({ side: "yes" })}>
                  Buy YES {Math.round(p * 100)}¢
                </Button>
                <Button variant="no" size="lg" className="flex-1 sm:flex-none" onClick={() => onTrade({ side: "no" })}>
                  Buy NO {Math.round((1 - p) * 100)}¢
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <div className="label-caps">Leading word</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="truncate font-display text-[40px] leading-none text-fg md:text-[52px]">
                  “{lead?.word.trim() ?? "—"}”
                </span>
                <span className="tnum font-mono text-2xl font-bold text-accent">{Math.round(leadShare * 100)}%</span>
              </div>
              <div className="mt-2 text-label text-fg-muted">
                {words.length} words in the race · {fmtSol(pot, { compact: true })} pot
              </div>
            </div>
            <Button size="lg" disabled={!open || !lead} onClick={() => lead && onTrade({ word: lead.word })}>
              Back “{lead?.word.trim() ?? "—"}”
            </Button>
          </div>
        )}

        <StatRow className="mt-5 border-t border-line/80 pt-4">
          <Stat label="Volume" icon={<Volume2 className="h-3 w-3" aria-hidden />} value={fmtSol(m.volume, { compact: true })} />
          <Stat label="Traders" icon={<Users className="h-3 w-3" aria-hidden />} value={m.traders.toLocaleString()} />
          <Stat
            label={m.status === "open" ? "Closes in" : "Status"}
            value={
              m.status === "open" ? (
                <span suppressHydrationWarning>{fmtTimeLeft(m.endTime - now)}</span>
              ) : (
                m.status[0].toUpperCase() + m.status.slice(1)
              )
            }
          />
          {isBinary && p !== null && !decided && (
            <Stat label="Implied odds" value={`${Math.round(p * 100)}¢ / ${Math.round((1 - p) * 100)}¢`} hint="YES / NO" />
          )}
        </StatRow>
      </div>

      {/* The split, as the panel's bottom edge. */}
      {p !== null && !decided && (
        <div className="flex h-1" aria-hidden>
          <span className="bg-yes/80 transition-[width] duration-500" style={{ width: `${p * 100}%` }} />
          <span className="flex-1 bg-no/70" />
        </div>
      )}
    </section>
  );
}
