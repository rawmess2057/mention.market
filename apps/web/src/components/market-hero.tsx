"use client";

import { Radio, Users, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Probability } from "@/components/ui/probability";
import { Stat, StatRow } from "@/components/ui/stat";
import { WaveformStrip } from "@/components/viz/waveform-strip";
import { cn, fmtSol, fmtTimeLeft } from "@/lib/format";
import { sessionChange } from "@/lib/history";
import { lmsrProbYes } from "@/lib/lmsr";
import { useSim } from "@/lib/sim";
import { useNow } from "@/hooks/useNow";
import type { Market } from "@/lib/types";

/**
 * The headline of a market page: how likely, how much, and one tap to trade.
 *
 * The probability is deliberately the largest element on the page — it is the
 * product's actual output — and the two primary actions restate it in the
 * trader-friendly cent format so the same tap works for both audiences.
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
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const history = useSim((s) => s.history[m.id]);
  const now = useNow(1000);

  const isBinary = m.type === "binary";
  const p = isBinary ? lmsrProbYes(m.yesShares, m.noShares, m.b) : null;
  const change = m.status === "open" ? sessionChange(history) : 0;
  const words = [...(m.words ?? [])].sort((a, b) => b.pool - a.pool);
  const pot = words.reduce((s, w) => s + w.pool, 0);
  const lead = words[0];
  const leadShare = lead && pot > 0 ? lead.pool / pot : 0;
  const open = m.status === "open";

  return (
    <section className={cn("panel overflow-hidden", className)}>
      <div className="p-4 md:p-5">
        {isBinary && p !== null ? (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <Probability
              value={p}
              delta={open ? change : undefined}
              size="hero"
              label="chance they say it"
              outcomeLabel="YES"
              ariaLive
            />
            <div className="flex gap-2">
              <Button
                variant="yes"
                size="lg"
                disabled={!open}
                onClick={() => onTrade({ side: "yes" })}
              >
                Buy YES {Math.round(p * 100)}¢
              </Button>
              <Button
                variant="no"
                size="lg"
                disabled={!open}
                onClick={() => onTrade({ side: "no" })}
              >
                Buy NO {Math.round((1 - p) * 100)}¢
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <div className="label-caps">Leading word</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="truncate font-serif text-3xl font-bold tracking-tight text-navy md:text-4xl">
                  {lead?.word.trim() ?? "—"}
                </span>
                <span className="tnum font-mono text-xl font-bold text-blue">
                  {Math.round(leadShare * 100)}%
                </span>
              </div>
              <div className="mt-1.5 text-label text-gray-mid">
                {words.length} words in the race · {fmtSol(pot, { compact: true })} pot
              </div>
            </div>
            <Button
              size="lg"
              disabled={!open || !lead}
              onClick={() => lead && onTrade({ word: lead.word })}
            >
              Back “{lead?.word.trim() ?? "—"}”
            </Button>
          </div>
        )}

        <StatRow className="mt-5 border-t border-ink-100 pt-4">
          <Stat
            label="Volume"
            icon={<Volume2 className="h-3 w-3" aria-hidden />}
            value={fmtSol(m.volume, { compact: true })}
          />
          <Stat
            label="Traders"
            icon={<Users className="h-3 w-3" aria-hidden />}
            value={m.traders.toLocaleString()}
          />
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
          {isBinary && p !== null && (
            <Stat label="Implied odds" value={`${Math.round(p * 100)}¢ / ${Math.round((1 - p) * 100)}¢`} hint="YES / NO" />
          )}
        </StatRow>
      </div>

      {m.status === "open" && (
        <div className="border-t border-ink-100 bg-ink-50/60 px-4 py-2.5 md:px-5">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Radio className="live-dot text-no" aria-hidden />
            <span className="label-caps text-navy">Stream feed</span>
            <span className="ml-auto truncate text-micro text-gray-mid">{m.source}</span>
          </div>
          <WaveformStrip seed={m.slug.length * 7 + m.volume} live className="h-7" color="#2D5CFF" />
        </div>
      )}
    </section>
  );
}
