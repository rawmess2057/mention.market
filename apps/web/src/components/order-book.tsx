"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, Clock, Zap, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, fmtUsd, shortAddr } from "@/lib/format";
import { useSim } from "@/lib/sim";
import { lmsrProbYes, lmsrBuyCost } from "@/lib/lmsr";
import { useDevnetUsdc } from "@/hooks/useDevnetUsdc";
import type { Market } from "@/lib/types";

const QUICK = [10, 25, 50, 100];

export function OrderBook({ market }: { market: Market }) {
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const pos = useSim((s) => s.positions[m.id]);
  const balance = useSim((s) => s.user.balance);
  const buyBinary = useSim((s) => s.buyBinary);
  const activity = useSim((s) => s.activity);
  const showToast = useSim((s) => s.showToast);
  const { walletBuy, busy: usdcBusy } = useDevnetUsdc();

  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("10");
  const [submitting, setSubmitting] = useState(false);

  const amt = Math.max(0, parseFloat(amount) || 0);
  const price = lmsrProbYes(m.yesShares, m.noShares, m.b);
  const disabled = m.status !== "open" || amt <= 0 || amt > balance;

  const recentTrades = useMemo(
    () => activity.filter((a) => a.marketId === m.id).slice(0, 5),
    [activity, m.id]
  );

  const positionSummary = useMemo(() => {
    if (!pos) return null;
    const yes = pos.yesShares ?? 0;
    const no = pos.noShares ?? 0;
    if (yes === 0 && no === 0) return null;
    const value = yes * price + no * (1 - price);
    const cost = (pos.avgYesPrice ?? 0) * yes + (pos.avgNoPrice ?? 0) * no;
    return { yes, no, value, cost, pnl: value - cost };
  }, [pos, price]);

  return (
    <div className="space-y-3">
      {/* Wallet Balance */}
      <div className="rounded-2xl border border-gray-warm bg-white p-4 shadow-card">
        <div className="flex items-center gap-2 text-xs text-gray-mid">
          <Wallet className="h-3.5 w-3.5" />
          <span className="font-medium">Balance</span>
        </div>
        <div className="mt-1 font-mono text-xl font-bold text-navy">{fmtUsd(balance)}</div>
      </div>

      {/* Open Position */}
      {m.type !== "binary" ? (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-700">
          Word-race market — trade by backing a word on the board.
        </div>
      ) : (
        <>
      {positionSummary && (
        <div className="rounded-2xl border border-blue/15 bg-blue-light/30 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue">
            <TrendingUp className="h-3.5 w-3.5" />
            Open Position
          </div>
          <div className="mt-2 space-y-1">
            {positionSummary.yes > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-mid">YES shares</span>
                <span className="font-mono font-semibold text-green">{positionSummary.yes.toFixed(1)}</span>
              </div>
            )}
            {positionSummary.no > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-mid">NO shares</span>
                <span className="font-mono font-semibold text-red-brand">{positionSummary.no.toFixed(1)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-blue/10 pt-1 text-xs">
              <span className="text-gray-mid">P&L</span>
              <span className={cn("font-mono font-bold", positionSummary.pnl >= 0 ? "text-green" : "text-red-brand")}>
                {positionSummary.pnl >= 0 ? "+" : ""}{fmtUsd(positionSummary.pnl)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Quick Bet */}
      <div className="rounded-2xl border border-gray-warm bg-white p-4 shadow-card">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy">
          Quick Bet
        </div>

        {/* Side toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-cream-dark p-1">
          <button
            onClick={() => setSide("yes")}
            className={cn(
              "rounded-md py-2 text-xs font-bold transition-all",
              side === "yes"
                ? "bg-green text-white shadow-sm"
                : "text-gray-mid hover:text-navy"
            )}
          >
            YES {(price * 100).toFixed(0)}¢
          </button>
          <button
            onClick={() => setSide("no")}
            className={cn(
              "rounded-md py-2 text-xs font-bold transition-all",
              side === "no"
                ? "bg-red-brand text-white shadow-sm"
                : "text-gray-mid hover:text-navy"
            )}
          >
            NO {((1 - price) * 100).toFixed(0)}¢
          </button>
        </div>

        {/* Amount */}
        <div className="mt-3">
          <div className="mb-1 text-[11px] text-gray-mid">Amount (USDC)</div>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-10 text-sm font-semibold"
          />
          <div className="mt-2 grid grid-cols-4 gap-1">
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => setAmount(String(q))}
                className="rounded-md bg-cream-dark py-1 text-[11px] font-medium text-navy transition-colors hover:bg-gray-warm"
              >
                ${q}
              </button>
            ))}
          </div>
        </div>

        <motion.div whileTap={disabled || submitting ? undefined : { scale: 0.98 }} className="mt-3">
          <Button
            variant={side === "yes" ? "yes" : "no"}
            size="default"
            className="w-full"
            disabled={disabled || submitting || usdcBusy}
            onClick={async () => {
              setSubmitting(true);
              const sig = await walletBuy(amt);
              buyBinary(m.id, side, amt, sig ?? undefined);
              setSubmitting(false);
              if (sig) showToast(`Bought ${side.toUpperCase()} · ${fmtUsd(amt)} · tx ${shortAddr(sig)}`);
            }}
          >
            <Zap className="h-3.5 w-3.5" />
            {submitting || usdcBusy
              ? "Confirming…"
              : disabled
                ? "Enter amount"
                : `Buy ${side.toUpperCase()} · ${fmtUsd(amt)}`}
          </Button>
        </motion.div>
      </div>

      {/* Recent Trades */}
      <div className="rounded-2xl border border-gray-warm bg-white p-4 shadow-card">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy">
          Recent Trades
        </div>
        {recentTrades.length === 0 ? (
          <div className="py-3 text-center text-[11px] text-gray-mid">No trades yet</div>
        ) : (
          <div className="space-y-1.5">
            {recentTrades.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded px-1 py-0.5 font-bold",
                      t.side === "yes" ? "bg-green-light text-green" : "bg-red-light text-red-brand"
                    )}
                  >
                    {t.side?.toUpperCase()}
                  </span>
                  <span className="text-navy">{t.user}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-navy">{fmtUsd(t.amount)}</span>
                  <Clock className="h-2.5 w-2.5 text-gray-mid" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
