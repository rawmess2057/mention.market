"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";

import { MarketCard } from "@/components/market-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { MarketCardSkeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/useNow";
import { isChainId, isStaleChainMarket } from "@/lib/chain";
import { cn, fmtSol } from "@/lib/format";
import { sessionChange } from "@/lib/history";
import { useStore } from "@/lib/store";
import { VERTICAL_META, type Market, type Vertical } from "@/lib/types";

const FILTERS: Array<{ key: Vertical | "all"; label: string }> = [
  { key: "all", label: "All" },
  ...Object.entries(VERTICAL_META).map(([key, v]) => ({ key: key as Vertical, label: `${v.emoji} ${v.label}` })),
];

const SORTS = [
  { value: "trending", label: "Trending" },
  { value: "volume", label: "Volume" },
  { value: "ending", label: "Ending" },
] as const;
type SortKey = (typeof SORTS)[number]["value"];

/** Which shelf a market sits on. */
function phase(m: Market, now: number): "trading" | "pending" | "resolved" {
  if (m.status === "resolved") return "resolved";
  if (m.status === "open" && now < m.endTime) return "trading";
  return "pending";
}

export default function Home() {
  const markets = useStore((s) => s.markets);
  const history = useStore((s) => s.history);
  const chainSynced = useStore((s) => s.chainSynced);
  const chainSyncError = useStore((s) => s.chainSyncError);
  const now = useNow(10_000);
  const [filter, setFilter] = useState<Vertical | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("trending");

  const all = useMemo(
    () => Object.values(markets).filter((m) => isChainId(m.id) && !isStaleChainMarket(m)),
    [markets]
  );

  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((m) => (filter === "all" || m.vertical === filter) && (!q || `${m.title} ${m.event}`.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (sort === "volume") return b.volume - a.volume;
        if (sort === "ending") return a.endTime - b.endTime;
        const momentum = Math.abs(sessionChange(history[b.id])) - Math.abs(sessionChange(history[a.id]));
        return momentum !== 0 ? momentum : b.volume - a.volume;
      });
  }, [all, filter, query, sort, history]);

  const shelves = useMemo(() => {
    const by = { trading: [] as Market[], pending: [] as Market[], resolved: [] as Market[] };
    for (const m of listed) by[phase(m, now)].push(m);
    return by;
  }, [listed, now]);

  const tradingCount = all.filter((m) => phase(m, now) === "trading").length;
  const volume = all.reduce((s, m) => s + m.volume, 0);
  const loading = all.length === 0 && !chainSynced && !chainSyncError;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg md:text-3xl">Markets</h1>
          <p className="mt-1 text-sm text-fg-muted">Trade on whether a phrase gets said. Settled on Solana from the transcript.</p>
        </div>
        <div className="flex items-center gap-5">
          <Metric label="Trading" value={loading ? "—" : String(tradingCount)} live={tradingCount > 0} />
          <Metric label="Volume" value={loading ? "—" : fmtSol(volume, { compact: true })} />
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/create">
              <Plus className="h-4 w-4" aria-hidden /> Create
            </Link>
          </Button>
        </div>
      </header>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets"
              aria-label="Search markets"
              className="h-10 bg-surface pl-9"
            />
          </div>
          <Segmented aria-label="Sort" value={sort} onChange={setSort} options={SORTS} className="sm:w-72" />
        </div>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f.key
                  ? "border-accent/50 bg-accent-soft text-fg"
                  : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Grid>
          {Array.from({ length: 6 }, (_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </Grid>
      ) : all.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-16 text-center">
          {chainSyncError ? (
            <p className="text-sm text-fg-muted">Couldn&apos;t reach Solana devnet. Retrying shortly.</p>
          ) : (
            <>
              <h2 className="text-base font-semibold text-fg">No markets yet</h2>
              <p className="max-w-sm text-sm text-fg-muted">Pick an event and a phrase, and be the first market on the board.</p>
              <Button asChild size="sm">
                <Link href="/create">
                  <Plus className="h-4 w-4" aria-hidden /> Create a market
                </Link>
              </Button>
            </>
          )}
        </section>
      ) : listed.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line py-16 text-center text-sm text-fg-muted">
          {query.trim() ? `No markets match “${query.trim()}”.` : "No markets in this category yet."}
        </p>
      ) : (
        <div className="space-y-8">
          <Shelf title="Trading" markets={shelves.trading} live />
          <Shelf title="Awaiting result" markets={shelves.pending} />
          <Shelf title="Resolved" markets={shelves.resolved} />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-1.5 text-micro text-fg-subtle">
        {live && <span className="live-dot text-yes" aria-hidden />}
        {label}
      </div>
      <div className="tnum text-lg font-semibold text-fg">{value}</div>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

function Shelf({ title, markets, live }: { title: string; markets: Market[]; live?: boolean }) {
  if (markets.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
        {live && <span className="live-dot text-yes" aria-hidden />}
        {title}
        <span className="tnum font-normal text-fg-subtle">{markets.length}</span>
      </h2>
      <Grid>
        {markets.map((m) => (
          <MarketCard key={m.id} market={m} />
        ))}
      </Grid>
    </section>
  );
}
