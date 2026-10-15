"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, TrendingUp } from "lucide-react";
import { MarketCard, LiveCarousel } from "@/components/market-card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/format";
import { sessionChange } from "@/lib/history";
import { useSim, WATCH_WORDS } from "@/lib/sim";
import { isChainId, isStaleChainMarket } from "@/lib/chain";
import { VERTICAL_META, type Vertical } from "@/lib/types";

const FILTERS: Array<{ key: Vertical | "all"; label: string }> = [
  { key: "all", label: "All" },
  ...Object.entries(VERTICAL_META).map(([key, v]) => ({
    key: key as Vertical,
    label: `${v.emoji} ${v.label}`,
  })),
];

const SORTS = [
  { key: "trending", label: "Trending" },
  { key: "volume", label: "Volume" },
  { key: "ending", label: "Ending soon" },
] as const;

type SortKey = (typeof SORTS)[number]["key"];

export default function Home() {
  const markets = useSim((s) => s.markets);
  const history = useSim((s) => s.history);
  const chainSynced = useSim((s) => s.chainSynced);
  const chainSyncError = useSim((s) => s.chainSyncError);
  const [filter, setFilter] = useState<Vertical | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("trending");
  const [showDemoMarkets, setShowDemoMarkets] = useState(false);

  const all = useMemo(
    () =>
      Object.values(markets).filter(
        (m) =>
          !isStaleChainMarket(m) &&
          (showDemoMarkets ? !isChainId(m.id) : isChainId(m.id))
      ),
    [markets, showDemoMarkets]
  );
  const live = all.filter((m) => m.status === "open");
  // With nothing in the current view, search/filter/sort are all no-ops — mark
  // them inactive instead of letting them look usable and do nothing.
  const nothingToList = all.length === 0;
  const inertHint = showDemoMarkets ? "No demo markets loaded" : "No on-chain markets listed";
  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = [...all].filter((m) => {
      if (filter !== "all" && m.vertical !== filter) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.event.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q)
      );
    });
    return filtered.sort((a, b) => {
      if (sort === "volume") return b.volume - a.volume;
      if (sort === "ending") {
        const ae = a.status === "open" ? a.endTime : Number.POSITIVE_INFINITY;
        const be = b.status === "open" ? b.endTime : Number.POSITIVE_INFINITY;
        return ae - be;
      }
      // trending: session momentum first, then volume
      const ac = Math.abs(sessionChange(history[a.id]));
      const bc = Math.abs(sessionChange(history[b.id]));
      if (bc !== ac) return bc - ac;
      return b.volume - a.volume;
    });
  }, [all, filter, query, sort, history]);

  const trending = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of all) {
      if (m.status !== "open") continue;
      for (const w of WATCH_WORDS[m.slug] ?? []) counts[w] = (counts[w] ?? 0) + m.volume / 1000;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [all]);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl md:rounded-3xl border border-line/80 bg-gradient-to-b from-surface to-surface-2 p-8 md:p-10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3 py-1 text-[11px] font-medium text-accent">
            <span className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-accent-strong" />
            On-chain markets · Solana devnet · SOL
          </div>
          <h1 className="max-w-xl text-3xl font-bold leading-tight tracking-tight text-fg md:text-4xl lg:text-5xl">
            Trade on what gets <span className="text-gradient">said</span>.
          </h1>
          <p className="mt-2 max-w-md text-body text-fg-muted md:text-body-lg">
            Trade markets deployed to Solana devnet. Trades, positions, and claims use the Anchor
            program; outcomes are submitted by the configured resolver.
          </p>
        </div>
      </section>

      {/* Live carousel */}
      {live.length > 0 && (
        <section>
          <SectionTitle icon={<span className="h-2 w-2 animate-pulse-live rounded-full bg-no" />}>
            Live now
          </SectionTitle>
          <LiveCarousel markets={all} />
        </section>
      )}

      {/* Trending words */}
      {trending.length > 0 && <section>
        <SectionTitle icon={<TrendingUp className="h-4 w-4 text-orange-500" />}>
          Trending words right now
        </SectionTitle>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {trending.map(([word, vol]) => (
            <span
              key={word}
              className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-3.5 py-1.5 text-xs font-semibold text-orange-700"
            >
              {word} <span className="ml-1 font-mono text-orange-500">${Math.round(vol)}k</span>
            </span>
          ))}
        </div>
      </section>}

      {/* Filters + search + sort */}
      <div className="flex flex-col gap-2">
        <div className="flex w-fit gap-1 rounded-lg border border-line bg-surface p-1">
          {[
            { demo: false, label: "On-chain" },
            { demo: true, label: "Demo markets" },
          ].map((mode) => (
            <button
              key={mode.label}
              onClick={() => setShowDemoMarkets(mode.demo)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                showDemoMarkets === mode.demo
                  ? "bg-accent-soft text-accent"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets, events…"
              disabled={nothingToList}
              title={nothingToList ? `Nothing to search — ${inertHint.toLowerCase()}` : undefined}
              className="h-9 bg-surface pl-9 text-sm"
            />
          </div>
          <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                disabled={nothingToList}
                title={nothingToList ? `Nothing to sort — ${inertHint.toLowerCase()}` : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  sort === s.key
                    ? "bg-accent-soft text-accent"
                    : "text-fg-muted hover:text-fg hover:bg-surface-2",
                  nothingToList && "cursor-not-allowed opacity-50 hover:bg-transparent"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              disabled={nothingToList}
              title={nothingToList ? `Nothing to filter — ${inertHint.toLowerCase()}` : undefined}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                filter === f.key
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-fg-muted hover:border-accent/40 hover:text-fg",
                nothingToList && "cursor-not-allowed opacity-50 hover:border-line hover:text-fg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Market list */}
      {all.length === 0 ? (
        <section className="rounded-xl border border-dashed border-line py-12 text-center">
          {showDemoMarkets ? (
            <p className="text-sm text-fg-muted">No demo markets are available.</p>
          ) : chainSyncError ? (
            <p className="text-sm text-fg-muted">
              Couldn&apos;t reach Solana devnet — retrying about every 30s.
            </p>
          ) : !chainSynced ? (
            <p className="flex items-center justify-center gap-2 text-sm text-fg-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-strong" />
              Checking Solana devnet for markets…
            </p>
          ) : (
            <>
              <p className="text-sm text-fg-muted">No on-chain markets found on Solana devnet.</p>
              <Link href="/create" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">
                Create an on-chain market
              </Link>
            </>
          )}
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2">
          {listed.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </section>
      )}

      {all.length > 0 && listed.length === 0 && (
        <div className="rounded-xl border border-dashed border-line py-16 text-center text-sm text-fg-muted">
          {query.trim()
            ? `No markets match “${query.trim()}”.`
            : "No markets in this category yet."}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-fg-muted">
      {icon}
      {children}
    </h2>
  );
}
