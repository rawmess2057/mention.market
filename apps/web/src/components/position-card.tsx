"use client";

import { useMemo } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, fmtUsd } from "@/lib/format";
import { lmsrPositionValue } from "@/lib/lmsr";
import { useSim } from "@/lib/sim";
import type { Market } from "@/lib/types";

export function PositionCard({ market }: { market: Market }) {
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const pos = useSim((s) => s.positions[m.id]);
  const sellBinary = useSim((s) => s.sellBinary);

  const summary = useMemo<
    | null
    | { kind: "binary"; yes: number; no: number; value: number; cost: number; pnl: number }
    | { kind: "majority"; backs: Array<[string, number]>; total: number }
  >(() => {
    if (!pos) return null;
    if (m.type === "binary") {
      const yes = pos.yesShares ?? 0;
      const no = pos.noShares ?? 0;
      if (yes === 0 && no === 0) return null;
      const value = lmsrPositionValue(m.yesShares, m.noShares, m.b, {
        yesShares: yes,
        noShares: no,
      });
      const cost =
        (pos.avgYesPrice ?? 0) * yes + (pos.avgNoPrice ?? 0) * no;
      return { kind: "binary", yes, no, value, cost, pnl: value - cost };
    }
    const backs = pos.wordBacks ?? {};
    const entries = Object.entries(backs).filter(([, v]) => v > 0);
    if (entries.length === 0) return null;
    const total = entries.reduce((s, [, v]) => s + v, 0);
    return { kind: "majority", backs: entries, total };
  }, [pos, m]);

  if (!summary) return null;

  return (
    <div className="rounded-xl border border-blue/15 bg-blue-light/50 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue">
        <Wallet className="h-3.5 w-3.5" />
        Your position
      </div>

      {summary.kind === "binary" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-mid">Shares</span>
            <span className="font-mono font-semibold text-navy">
              {summary.yes > 0 && (
                <span className="text-green">{summary.yes.toFixed(1)} YES</span>
              )}
              {summary.yes > 0 && summary.no > 0 && <span className="text-gray-mid"> · </span>}
              {summary.no > 0 && <span className="text-red-brand">{summary.no.toFixed(1)} NO</span>}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-mid">Cost / Value</span>
            <span className="font-mono font-semibold text-navy">
              {fmtUsd(summary.cost)} → {fmtUsd(summary.value)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-mid">Unrealized P&L</span>
            <span
              className={cn(
                "font-mono font-bold",
                summary.pnl >= 0 ? "text-green" : "text-red-brand"
              )}
            >
              {summary.pnl >= 0 ? "+" : ""}
              {fmtUsd(summary.pnl)}
            </span>
          </div>
          {m.status === "open" && (
            <div className="flex gap-2 pt-1">
              {summary.yes > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => sellBinary(m.id, "yes", summary.yes)}
                >
                  Sell YES
                </Button>
              )}
              {summary.no > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => sellBinary(m.id, "no", summary.no)}
                >
                  Sell NO
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {summary.backs.map(
            ([word, amt]) => (
              <div key={word} className="flex items-center justify-between text-sm">
                <span className="truncate font-medium text-navy">{word}</span>
                <span className="font-mono font-semibold text-navy">{fmtUsd(amt)}</span>
              </div>
            )
          )}
          <div className="flex items-center justify-between border-t border-gray-warm pt-1.5 text-xs text-gray-mid">
            <span>Total backed</span>
            <span className="font-mono">{fmtUsd(summary.total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
