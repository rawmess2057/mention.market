"use client";

import { useMemo, useState } from "react";
import { Flame, ListFilter } from "lucide-react";
import { OutcomeRow } from "@/components/ui/outcome-row";
import { cn, fmtSol } from "@/lib/format";
import { useSim } from "@/lib/sim";
import { useNow } from "@/hooks/useNow";
import type { Market } from "@/lib/types";

type SortKey = "pool" | "odds";

/**
 * The word-race board.
 *
 * Selection is lifted to the page: the board decides *what* someone wants to
 * back, the ticket decides *how much* — the same split the leading platforms
 * use, and the reason a row tap can open a sheet on mobile and update the rail
 * on desktop without duplicating trade logic.
 */
export function WordBoard({
  market,
  selected,
  onSelect,
  className,
}: {
  market: Market;
  selected: string | null;
  onSelect: (word: string) => void;
  className?: string;
}) {
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const now = useNow(5000);
  const [sort, setSort] = useState<SortKey>("pool");

  const words = useMemo(() => {
    const list = [...(m.words ?? [])];
    if (sort === "odds") {
      // Best payout first — the pool is smallest, so 1 SOL buys the most.
      return list.sort((a, b) => a.pool - b.pool);
    }
    return list.sort((a, b) => b.pool - a.pool);
  }, [m.words, sort]);

  const pot = (m.words ?? []).reduce((s, w) => s + w.pool, 0);

  return (
    <section className={cn("panel overflow-hidden", className)}>
      <div className="flex items-center gap-2 border-b border-ink-200 px-4 py-3">
        <span className="label-caps text-navy">Word board</span>
        <span className="tnum text-micro text-gray-mid">
          {words.length} words · {fmtSol(pot, { compact: true })} in play
        </span>
        <div className="ml-auto flex gap-1 rounded-field bg-ink-100 p-0.5">
          {(
            [
              { key: "pool" as const, label: "Pool" },
              { key: "odds" as const, label: "Top odds" },
            ]
          ).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              aria-pressed={sort === s.key}
              className={cn(
                "rounded-[6px] px-2 py-0.5 text-micro font-semibold transition-colors",
                sort === s.key ? "bg-white text-navy shadow-sm" : "text-gray-mid hover:text-navy"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-ink-100">
        {words.map((w, i) => {
          const share = pot > 0 ? w.pool / pot : 0;
          const hot = w.lastBetAt > 0 && now - w.lastBetAt < 30_000;
          return (
            <OutcomeRow
              key={w.word}
              label={w.word.trim()}
              share={share}
              multiplier={w.pool > 0 ? (pot * 0.99) / w.pool : 0}
              leading={i === 0 && sort === "pool"}
              sub={`${w.bettors} backers · ${fmtSol(w.pool, { compact: true })} backed${hot ? " · hot" : ""}`}
              className={cn(
                "rounded-none",
                selected === w.word && "bg-blue-light/60 hover:bg-blue-light"
              )}
              onSelect={() => onSelect(w.word)}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 border-t border-ink-200 px-4 py-2.5 text-micro text-gray-mid">
        <ListFilter className="h-3 w-3" aria-hidden />
        Winners split the pot pro-rata · {m.creatorFeeBps / 100}% rake at settlement
        <Flame className="ml-auto h-3 w-3 text-no" aria-hidden />
        <span>leader</span>
      </div>
    </section>
  );
}
