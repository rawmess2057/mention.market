"use client";

import { useMemo, useState } from "react";
import { Search, TrendingUp } from "lucide-react";
import { MarketCard, LiveCarousel } from "@/components/market-card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/format";
import { sessionChange } from "@/lib/history";
import { useSim, WATCH_WORDS } from "@/lib/sim";
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
  const [filter, setFilter] = useState<Vertical | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("trending");

  const all = useMemo(() => Object.values(markets), [markets]);
  const live = all.filter((m) => m.status === "open");
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
      <section className="relative overflow-hidden rounded-3xl border border-blue/15 bg-gradient-to-br from-blue-light via-white to-cream-dark p-6 md:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-blue/8 blur-3xl" />
        <div className="relative">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue/20 bg-blue-light px-3 py-1 text-[11px] font-medium text-blue">
            <span className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-blue" />
            Live on Solana · settled in USDC
          </div>
          <h1 className="font-serif max-w-xl text-3xl font-extrabold leading-tight tracking-tight text-navy md:text-4xl">
            Trade on what gets <span className="text-gradient">said</span>.
          </h1>
          <p className="mt-2 max-w-md text-sm text-text-secondary md:text-[15px]">
            Prediction markets on specific words spoken during live streams, sports, earnings calls
            and debates. Verified by transcript evidence.
          </p>
        </div>
      </section>

      {/* Live carousel */}
      {live.length > 0 && (
        <section>
          <SectionTitle icon={<span className="h-2 w-2 animate-pulse-live rounded-full bg-red-brand" />}>
            Live now
          </SectionTitle>
          <LiveCarousel />
        </section>
      )}

      {/* Trending words */}
      <section>
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
      </section>

      {/* Filters + search + sort */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-mid" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets, events…"
              className="h-9 bg-white pl-9 text-sm"
            />
          </div>
          <div className="flex gap-1 rounded-lg border border-gray-warm bg-white p-1">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  sort === s.key
                    ? "bg-blue-light text-blue"
                    : "text-gray-mid hover:text-navy hover:bg-cream-dark"
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
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                filter === f.key
                  ? "border-blue bg-blue-light text-blue"
                  : "border-gray-warm text-gray-mid hover:border-blue/40 hover:text-navy"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Market list */}
      {all.length === 0 ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="shimmer h-[148px] rounded-2xl border border-gray-warm bg-white"
            />
          ))}
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2">
          {listed.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </section>
      )}

      {all.length > 0 && listed.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-warm py-16 text-center text-sm text-gray-mid">
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
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-mid">
      {icon}
      {children}
    </h2>
  );
}
