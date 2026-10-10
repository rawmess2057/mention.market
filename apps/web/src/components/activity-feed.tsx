"use client";

import { useSim } from "@/lib/sim";
import { cn, fmtBalance } from "@/lib/format";

export function ActivityFeed({ marketId, limit = 12 }: { marketId: string; limit?: number }) {
  const chainActivity = useSim((s) => s.chainActivity[marketId]);
  const simActivity = useSim((s) => s.activity);

  const items = [
    ...(chainActivity ?? []),
    ...simActivity.filter((a) => a.marketId === marketId),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-gray-warm bg-white p-6 text-center text-xs text-gray-mid">
        No trades yet. Be the first.
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-warm overflow-hidden rounded-xl border border-gray-warm bg-white">
      {items.map((a) => (
        <div key={a.id} className="flex items-center gap-2 px-3 py-2 text-xs">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 font-bold",
              a.kind === "resolve" || a.kind === "claim"
                ? "bg-blue-light text-blue"
                : a.side === "yes" || (a.kind === "back" && a.side)
                  ? "bg-green-light text-green"
                  : "bg-red-light text-red-brand"
            )}
          >
            {a.kind === "resolve"
              ? "RESOLVED"
              : a.kind === "claim"
                ? "CLAIMED"
                : a.kind === "back"
                  ? "BACK"
                  : a.side?.toUpperCase()}
          </span>
          <span className="font-medium text-navy">{a.user}</span>
          <span className="ml-auto font-mono text-navy">
            {a.amount > 0 ? fmtBalance(a.amount) : ""}
          </span>
          <span className="w-10 text-right text-gray-mid">
            {new Date(a.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
      ))}
    </div>
  );
}