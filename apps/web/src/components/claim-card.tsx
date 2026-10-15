"use client";

import { useState } from "react";
import { PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confetti } from "@/components/viz/confetti";
import { cn, fmtErr, fmtSol } from "@/lib/format";
import { claimPayout, isVoided, positionCost } from "@/lib/settle";
import { useStore } from "@/lib/store";
import { useChain } from "@/hooks/useChain";
import { isChainId } from "@/lib/chain";
import type { Market } from "@/lib/types";

/**
 * Resolution outcome + claim, in one card.
 *
 * Tone follows the research: winning should feel earned but not casino-loud,
 * and a losing position should be told plainly rather than hidden.
 */
export function ClaimCard({ market }: { market: Market }) {
  const m = useStore((s) => s.markets[market.id]) ?? market;
  const pos = useStore((s) => s.positions[m.id]);
  const claim = useStore((s) => s.claim);
  const showToast = useStore((s) => s.showToast);
  const chain = useChain();
  const chainMarket = isChainId(m.id);
  const [flash, setFlash] = useState(false);
  const [confetti, setConfetti] = useState(0);
  const [claiming, setClaiming] = useState(false);

  if (!pos || m.status !== "resolved" || !m.winningOutcome) return null;

  const voided = isVoided(m);
  const payout = claimPayout(m, pos)?.payout ?? 0;
  const cost = positionCost(pos);
  const profit = payout - cost;
  const won = payout > 0;

  return (
    <section
      className={cn(
        "panel overflow-hidden",
        won && "border-yes-line",
        flash && "win-flash"
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <PartyPopper className={cn("h-3.5 w-3.5", won ? "text-yes" : "text-fg-muted")} aria-hidden />
        <span className="label-caps text-fg">
          {voided ? "Market voided" : won ? "You called it" : "Resolved"}
        </span>
        <span className="tnum ml-auto text-micro text-fg-muted">
          {voided ? "ruling" : "winner"}{" "}
          <span className={cn("font-mono font-bold", voided ? "text-fg" : "text-yes")}>
            {m.winningOutcome.toUpperCase()}
          </span>
        </span>
      </div>

      <div className="space-y-2.5 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-label text-fg-muted">{voided ? "Your refund" : "Your payout"}</span>
          <span className="tnum font-mono text-2xl font-bold text-fg">{fmtSol(payout)}</span>
        </div>
        <div className="flex items-center justify-between text-label">
          <span className="text-fg-muted">P&amp;L</span>
          <span
            className={cn(
              "tnum font-mono font-bold",
              profit >= 0 ? "text-yes" : "text-no"
            )}
          >
            {profit >= 0 ? "+" : ""}
            {fmtSol(profit)}
          </span>
        </div>

        {won ? (
          <Button
            variant="yes"
            size="lg"
            className="w-full"
            disabled={claiming || pos.claimed || payout <= 0}
            onClick={async () => {
              if (claiming) return;
              setClaiming(true);
              try {
                if (chainMarket) await chain.claim(m.id);
                claim(m.id);
                setFlash(true);
                setConfetti((c) => c + 1);
                setTimeout(() => setFlash(false), 1000);
              } catch (err) {
                showToast(`Claim failed: ${fmtErr(err)}`);
              } finally {
                setClaiming(false);
              }
            }}
          >
            {pos.claimed
              ? "Claimed ✓"
              : claiming
                ? "Claiming…"
                : `Claim ${voided ? "refund " : ""}${fmtSol(payout)}`}
          </Button>
        ) : voided ? (
          <p className="rounded-tile bg-surface-2 px-3 py-2 text-micro leading-relaxed text-fg-muted">
            The market was voided, so every position is refunded. This one has nothing left to
            refund.
          </p>
        ) : (
          <p className="rounded-tile bg-surface-2 px-3 py-2 text-micro leading-relaxed text-fg-muted">
            The market resolved at {m.winningOutcome.toUpperCase()}
            {m.confidence !== undefined ? ` (${m.confidence}% confidence)` : ""}. The transcript
            excerpt behind it is in the resolution panel — worth a look before the next one.
          </p>
        )}
      </div>
      <Confetti fire={confetti} />
    </section>
  );
}
