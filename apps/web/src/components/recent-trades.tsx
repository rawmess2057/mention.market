"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, fmtAgo, fmtSol, shortAddr } from "@/lib/format";
import { useSim } from "@/lib/sim";

/**
 * Live tape of fills. Replaces the old "OrderBook" panel, which showed a
 * quick-bet form and a trade list under a name that described neither — this
 * market prices through an LMSR curve, not a bid/ask book, and the UI should
 * not imply depth that doesn't exist.
 */
export function RecentTrades({
  marketId,
  limit = 7,
  className,
}: {
  marketId: string;
  limit?: number;
  className?: string;
}) {
  const chainActivity = useSim((s) => s.chainActivity[marketId]);
  const simActivity = useSim((s) => s.activity);

  const items = useMemo(
    () =>
      [...(chainActivity ?? []), ...simActivity.filter((a) => a.marketId === marketId)]
        .sort((a, b) => b.at - a.at)
        .slice(0, limit),
    [chainActivity, simActivity, marketId, limit]
  );

  return (
    <div className={cn("panel overflow-hidden", className)}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Activity className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
        <span className="label-caps text-fg">Recent trades</span>
        <span className="ml-auto text-micro text-fg-muted">live tape</span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="rounded-none border-0 py-6"
          title="No trades yet"
          body="Be the first to take a side."
        />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((t) => {
            const resolved = t.kind === "resolve";
            const claimed = t.kind === "claim";
            const backed = t.kind === "back";
            const isYes = t.side === "yes";
            return (
              <li key={t.id} className="flex items-center gap-2 px-4 py-2 text-label">
                <span
                  className={cn(
                    "shrink-0 rounded-field px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    resolved || claimed
                      ? "bg-accent-soft text-accent"
                      : isYes
                        ? "bg-yes-soft text-yes"
                        : "bg-no-soft text-no"
                  )}
                >
                  {resolved ? "resolved" : claimed ? "claimed" : backed ? "back" : t.side}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-fg-muted">
                  {shortAddr(t.user)}
                </span>
                <span className="tnum shrink-0 font-mono font-semibold text-fg">
                  {t.amount > 0 ? fmtSol(t.amount) : ""}
                </span>
                <span className="w-14 shrink-0 text-right text-micro text-fg-muted">
                  {fmtAgo(t.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
