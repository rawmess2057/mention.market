"use client";

import { useMemo, useState } from "react";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, fmtErr, fmtSol, shortAddr } from "@/lib/format";
import { lmsrPositionValue } from "@/lib/lmsr";
import { useStore } from "@/lib/store";
import { useChain } from "@/hooks/useChain";
import { isChainId } from "@/lib/chain";
import type { Market } from "@/lib/types";

export function PositionCard({ market }: { market: Market }) {
  const m = useStore((s) => s.markets[market.id]) ?? market;
  const pos = useStore((s) => s.positions[m.id]);
  const sellBinary = useStore((s) => s.sellBinary);
  const showToast = useStore((s) => s.showToast);
  const chain = useChain();
  const chainMarket = isChainId(m.id);
  const [selling, setSelling] = useState<string | null>(null);

  const onSell = async (side: "yes" | "no", shares: number) => {
    if (selling) return;
    setSelling(side);
    try {
      const sig = chainMarket ? await chain.sell(m, side, shares) : null;
      sellBinary(m.id, side, shares);
      if (sig) showToast(`Sold ${side.toUpperCase()} · tx ${shortAddr(sig)}`);
    } catch (err) {
      showToast(`Sell failed: ${fmtErr(err)}`);
    } finally {
      setSelling(null);
    }
  };

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
      const cost = (pos.avgYesPrice ?? 0) * yes + (pos.avgNoPrice ?? 0) * no;
      return { kind: "binary", yes, no, value, cost, pnl: value - cost };
    }
    const entries = Object.entries(pos.wordBacks ?? {}).filter(([, v]) => v > 0);
    if (entries.length === 0) return null;
    return {
      kind: "majority",
      backs: entries,
      total: entries.reduce((s, [, v]) => s + v, 0),
    };
  }, [pos, m]);

  if (!summary) return null;

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Briefcase className="h-3.5 w-3.5 text-accent" aria-hidden />
        <span className="label-caps text-fg">Your position</span>
      </div>

      <div className="space-y-2.5 p-4">
        {summary.kind === "binary" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              {summary.yes > 0 && (
                <Holding side="yes" shares={summary.yes} avg={pos?.avgYesPrice} />
              )}
              {summary.no > 0 && (
                <Holding side="no" shares={summary.no} avg={pos?.avgNoPrice} />
              )}
            </div>
            <Row label="Cost → value" value={`${fmtSol(summary.cost)} → ${fmtSol(summary.value)}`} />
            <Row
              label="Unrealized P&L"
              value={`${summary.pnl >= 0 ? "+" : ""}${fmtSol(summary.pnl)}`}
              tone={summary.pnl >= 0 ? "yes" : "no"}
            />
            {m.status === "open" && (
              <div className="flex gap-2 pt-1">
                {summary.yes > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={!!selling}
                    onClick={() => onSell("yes", summary.yes)}
                  >
                    {selling === "yes" ? "Selling…" : "Sell YES"}
                  </Button>
                )}
                {summary.no > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={!!selling}
                    onClick={() => onSell("no", summary.no)}
                  >
                    {selling === "no" ? "Selling…" : "Sell NO"}
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {summary.backs.map(([word, amt]) => (
              <Row key={word} label={word} value={fmtSol(amt)} />
            ))}
            <Row
              label="Total backed"
              value={fmtSol(summary.total)}
              className="border-t border-line pt-2"
            />
          </>
        )}
      </div>
    </section>
  );
}

function Holding({
  side,
  shares,
  avg,
}: {
  side: "yes" | "no";
  shares: number;
  avg?: number;
}) {
  return (
    <div
      className={cn(
        "rounded-tile border px-3 py-2",
        side === "yes" ? "border-yes-line bg-yes-soft" : "border-no-line bg-no-soft"
      )}
    >
      <div className={cn("label-caps", side === "yes" ? "text-yes" : "text-no")}>{side}</div>
      <div className="tnum mt-0.5 font-mono text-sm font-bold text-fg">
        {shares.toFixed(1)} sh
      </div>
      {avg !== undefined && (
        <div className="tnum text-micro text-fg-muted">avg {Math.round(avg * 100)}¢</div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string;
  tone?: "yes" | "no";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 text-label", className)}>
      <span className="min-w-0 truncate text-fg-muted">{label}</span>
      <span
        className={cn(
          "tnum shrink-0 font-mono font-semibold",
          tone === "yes" ? "text-yes" : tone === "no" ? "text-no" : "text-fg"
        )}
      >
        {value}
      </span>
    </div>
  );
}
