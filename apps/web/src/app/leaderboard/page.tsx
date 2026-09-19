"use client";

import { Medal } from "lucide-react";
import { cn, fmtUsd } from "@/lib/format";
import { LEADERBOARD, useSim } from "@/lib/sim";

const MEDALS = ["text-amber-600", "text-gray-cool", "text-orange-600"];

export default function LeaderboardPage() {
  const user = useSim((s) => s.user);
  const leaderboard = LEADERBOARD;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="font-serif text-xl font-bold tracking-tight text-navy">Leaderboard</h1>
        <p className="text-sm text-gray-mid">
          Weekly points from trading, winning and holding through resolution.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-warm bg-white shadow-card">
        {leaderboard.map((row, i) => (
          <div
            key={row.handle}
            className={cn(
              "flex items-center gap-3 px-4 py-3",
              i > 0 && "border-t border-gray-warm",
              row.handle === user.handle && "bg-blue-light/50"
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                i < 3 ? "bg-cream-dark " + MEDALS[i] : "text-gray-mid"
              )}
            >
              {i < 3 ? <Medal className="h-4 w-4" /> : row.rank}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-navy">
                {row.handle}
                {row.handle === user.handle && (
                  <span className="rounded bg-blue-light px-1.5 py-0.5 text-[10px] font-bold text-blue">
                    YOU
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-mid">
                {row.trades} trades · {(row.winRate * 100).toFixed(0)}% win rate
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-sm font-bold text-blue">
                {row.points.toLocaleString()} pts
              </div>
              <div
                className={cn(
                  "font-mono text-[11px]",
                  row.profit >= 0 ? "text-green" : "text-red-brand"
                )}
              >
                {row.profit >= 0 ? "+" : ""}
                {fmtUsd(row.profit, { compact: true })}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-warm bg-white p-4 shadow-card">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-mid">
          How points work
        </div>
        <ul className="space-y-1 text-sm text-gray-mid">
          <li>+2 pts per USDC traded</li>
          <li>+25 pts per winning claim</li>
          <li>+10 pts for holding through resolution</li>
        </ul>
      </div>
    </div>
  );
}
