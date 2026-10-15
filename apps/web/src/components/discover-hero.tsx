"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, Plus } from "lucide-react";

import { MarketCard } from "@/components/market-card";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/viz/animated-number";
import { WaveformStrip } from "@/components/viz/waveform-strip";
import { fmtSol } from "@/lib/format";
import { sessionChange, type HistoryInput } from "@/lib/history";
import { DURATION, EASE } from "@/lib/motion";
import { rgba } from "@/lib/theme";
import type { Market } from "@/lib/types";
import { watchWordsFor } from "@/lib/watch-words";

const ROTATE_MS = 3200;

/**
 * Discover banner. Left: the headline, the lede, a line that cycles through
 * the phrases the open markets are listening for, the two calls to action and
 * the board's numbers. Right (desktop): the market moving hardest right now.
 * A live waveform runs along the bottom edge: the product is a microphone.
 */
export function DiscoverHero({
  trading,
  resolved,
  volume,
  history,
  loading,
}: {
  trading: Market[];
  resolved: number;
  volume: number;
  history: Record<string, HistoryInput | undefined>;
  loading: boolean;
}) {
  const featured = useMemo(() => {
    if (trading.length === 0) return null;
    return [...trading].sort((a, b) => {
      const d = Math.abs(sessionChange(history[b.id])) - Math.abs(sessionChange(history[a.id]));
      return d !== 0 ? d : b.volume - a.volume;
    })[0];
  }, [trading, history]);

  // The phrases on the board, with the stage each one comes from.
  const phrases = useMemo(
    () =>
      trading
        .map((m) => ({ id: m.id, phrase: watchWordsFor(m)[0], event: m.event }))
        .filter((p): p is { id: string; phrase: string; event: string } => Boolean(p.phrase)),
    [trading]
  );

  return (
    <section
      className="card-glow relative overflow-hidden rounded-panel border border-line bg-surface/60 shadow-card"
      style={{ "--glow": "var(--accent)", "--glow-a": 0.2 } as React.CSSProperties}
    >
      <WaveformStrip
        seed={7}
        bars={160}
        live={trading.length > 0}
        color={rgba("accent")}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-[0.26] [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)] md:h-16"
      />

      <div className="relative grid gap-8 p-6 pb-9 md:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] md:gap-10 md:p-10 md:pb-14">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-micro text-fg-muted">
            <span className="live-dot text-live" aria-hidden />
            Live on Solana devnet
            <span className="text-fg-subtle">·</span>
            settled from the transcript
          </div>

          <h1 className="mt-5 font-display text-[52px] leading-[0.95] tracking-[-0.015em] text-fg sm:text-[64px] md:text-[80px]">
            What gets <span className="quote-hit">said</span>.
          </h1>

          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-fg-muted md:text-base">
            Pick a stream, a game or a call. Trade on whether a phrase is spoken before it ends.
            The transcript settles it.
          </p>

          <ListeningLine phrases={phrases} loading={loading} />

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <Button asChild size="lg">
              <Link href="/create">
                <Plus className="h-4 w-4" aria-hidden /> Create a market
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <a href="#markets">
                Browse the board <ArrowDown className="h-4 w-4" aria-hidden />
              </a>
            </Button>
          </div>

          <dl className="mt-8 grid max-w-md grid-cols-3 gap-2.5">
            <Stat label="Trading" value={trading.length} loading={loading} live={trading.length > 0} />
            <Stat label="Volume" value={volume} loading={loading} format={(v) => fmtSol(v, { compact: true })} />
            <Stat label="Settled" value={resolved} loading={loading} />
          </dl>
        </div>

        {featured && (
          <div className="hidden md:flex md:flex-col md:justify-center">
            <div className="mb-2.5 flex items-center gap-2 text-micro text-fg-muted">
              <span className="live-dot text-yes" aria-hidden />
              Moving now
            </div>
            <div className="flex [&>a]:flex-1">
              <MarketCard market={featured} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** "Listening for “…” · stage", cycling through the open markets. */
function ListeningLine({
  phrases,
  loading,
}: {
  phrases: Array<{ id: string; phrase: string; event: string }>;
  loading: boolean;
}) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (phrases.length < 2 || reduced) return;
    const t = setInterval(() => setI((n) => n + 1), ROTATE_MS);
    return () => clearInterval(t);
  }, [phrases.length, reduced]);

  const cur = phrases.length > 0 ? phrases[i % phrases.length] : null;

  return (
    <div className="mt-5 flex h-7 items-center gap-2 text-sm text-fg-muted">
      <span className="shrink-0">Listening for</span>
      <span className="relative min-w-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {cur ? (
            <motion.span
              key={cur.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: DURATION.roll, ease: EASE }}
              className="flex min-w-0 items-center gap-2"
            >
              <span className="quote-hit shrink-0 font-display text-lg leading-none text-fg">
                “{cur.phrase}”
              </span>
              <span className="truncate text-fg-subtle">· {cur.event}</span>
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-fg-subtle"
            >
              {loading ? "the board to load…" : "the next market. Be the one to make it."}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  live,
  format = (v) => String(Math.round(v)),
}: {
  label: string;
  value: number;
  loading: boolean;
  live?: boolean;
  format?: (v: number) => string;
}) {
  return (
    <div className="glass rounded-tile border border-line px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-micro text-fg-subtle">
        {live && <span className="live-dot text-yes" aria-hidden />}
        {label}
      </dt>
      <dd className="tnum mt-0.5 whitespace-nowrap font-mono text-[17px] font-semibold text-fg">
        {loading ? "—" : <AnimatedNumber value={value} format={format} />}
      </dd>
    </div>
  );
}
