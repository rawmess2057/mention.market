"use client";

import { useState } from "react";
import { PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confetti } from "@/components/viz/confetti";
import { cn, fmtUsd } from "@/lib/format";
import { settleMajority } from "@/lib/parimutuel";
import { useSim } from "@/lib/sim";
import { useChain } from "@/hooks/useChain";
import { isChainId } from "@/lib/chain";
import type { Market, Position } from "@/lib/types";

export function ClaimCard({ market }: { market: Market }) {
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const pos = useSim((s) => s.positions[m.id]);
  const claim = useSim((s) => s.claim);
  const chain = useChain();
  const chainMarket = isChainId(m.id);
  const [flash, setFlash] = useState(false);
  const [confetti, setConfetti] = useState(0);

  if (!pos || m.status !== "resolved" || !m.winningOutcome) return null;

  let payout = 0;
  let cost = 0;
  if (m.type === "binary") {
    const yes = pos.yesShares ?? 0;
    const no = pos.noShares ?? 0;
    payout = m.winningOutcome === "yes" ? yes : no;
    cost = (pos.avgYesPrice ?? 0) * yes + (pos.avgNoPrice ?? 0) * no;
  } else if (pos.wordBacks) {
    const settled = settleMajority(m.words ?? [], m.winningOutcome);
    const backed = pos.wordBacks[m.winningOutcome] ?? 0;
    payout = settled.yourShare(backed);
    cost = Object.values(pos.wordBacks).reduce((s, v) => s + v, 0);
  }

  const profit = payout - cost;

  return (
    <div
      className={cn(
        "rounded-xl border border-green/20 bg-green-light/50 p-4",
        flash && "win-flash"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-green">
          <PartyPopper className="h-3.5 w-3.5" />
          Market resolved
        </div>
        <span className="text-xs text-gray-mid">
          Winner: <span className="font-bold text-green">{m.winningOutcome.toUpperCase()}</span>
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-gray-mid">Your payout</span>
        <span className="font-mono text-lg font-bold text-navy">{fmtUsd(payout)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-gray-mid">P&L</span>
        <span className={cn("font-mono font-bold", profit >= 0 ? "text-green" : "text-red-brand")}>
          {profit >= 0 ? "+" : ""}
          {fmtUsd(profit)}
        </span>
      </div>

      <Button
        variant="yes"
        size="lg"
        className="mt-3 w-full"
        disabled={pos.claimed || payout <= 0}
        onClick={async () => {
          if (chainMarket) await chain.claim(m.id);
          claim(m.id);
          setFlash(true);
          setConfetti((c) => c + 1);
          setTimeout(() => setFlash(false), 1000);
        }}
      >
        {pos.claimed ? "Claimed ✓" : `Claim ${fmtUsd(payout)}`}
      </Button>
      <Confetti fire={confetti} />
    </div>
  );
}
