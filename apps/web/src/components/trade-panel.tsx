"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Info } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn, fmtUsd, shortAddr } from "@/lib/format";
import { lmsrBuyCost, lmsrPriceAfterBuy, lmsrProbYes } from "@/lib/lmsr";
import { useSim } from "@/lib/sim";
import { useDevnetUsdc } from "@/hooks/useDevnetUsdc";
import type { Market } from "@/lib/types";

const QUICK = [10, 25, 50, 100];

function fmtBalance(amount: number, kind: "usdc" | "sol" | undefined) {
  return kind === "sol" ? `◎ ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : fmtUsd(amount);
}

export function TradePanel({ market }: { market: Market }) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const user = useSim((s) => s.user);
  const buyBinary = useSim((s) => s.buyBinary);
  const setPendingTrade = useSim((s) => s.setPendingTrade);
  const pendingTrade = useSim((s) => s.pendingTrade);
  const showToast = useSim((s) => s.showToast);
  const { walletBuy, busy: usdcBusy } = useDevnetUsdc();

  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("10");
  const [submitting, setSubmitting] = useState(false);

  const amt = Math.max(0, parseFloat(amount) || 0);
  const balance = user.balance;
  const balanceKind = user.balanceKind;

  const quote = useMemo(() => {
    if (amt <= 0) return null;
    let lo = 0;
    let hi = 1;
    const cost = (sh: number) =>
      lmsrBuyCost(m.yesShares, m.noShares, m.b, side, sh);
    while (cost(hi) < amt) hi *= 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (cost(mid) < amt) lo = mid;
      else hi = mid;
    }
    const shares = (lo + hi) / 2;
    const after = lmsrPriceAfterBuy(m.yesShares, m.noShares, m.b, side, shares);
    return { shares, after, probNow: lmsrProbYes(m.yesShares, m.noShares, m.b) };
  }, [m, side, amt]);

  const price = lmsrProbYes(m.yesShares, m.noShares, m.b);
  const myPrice = side === "yes" ? price : 1 - price;
  const disabled =
    !connected || m.status !== "open" || amt <= 0 || amt > balance;

  const cta = !connected
    ? "Connect wallet to trade"
    : m.status !== "open"
      ? "Market closed"
      : amt > balance
        ? "Insufficient balance"
        : `Buy ${side.toUpperCase()} · ${fmtUsd(amt)}`;

  return (
    <>
      <div className="rounded-2xl border border-gray-warm bg-white p-4 shadow-card">
        {/* Segmented side selector */}
        <div className="relative grid grid-cols-2 gap-1 rounded-xl bg-cream-dark p-1">
          {(["yes", "no"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={cn(
                "relative z-10 rounded-lg py-2.5 text-center transition-colors",
                side === s ? "text-white" : "text-gray-mid hover:text-navy"
              )}
            >
              {side === s && (
                <motion.span
                  layoutId="side-pill"
                  className={cn(
                    "absolute inset-0 -z-10 rounded-lg",
                    s === "yes"
                      ? "bg-gradient-to-r from-green to-green/80 shadow-[0_4px_16px_rgba(43,117,80,0.3)]"
                      : "bg-gradient-to-r from-red-brand to-red-brand/80 shadow-[0_4px_16px_rgba(199,91,58,0.3)]"
                  )}
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <span className="block text-[10px] font-bold uppercase tracking-wider opacity-80">
                {s}
              </span>
              <span className="font-mono text-xl font-extrabold">
                {s === "yes" ? (price * 100).toFixed(0) : ((1 - price) * 100).toFixed(0)}¢
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-gray-mid">Amount ({balanceKind === "sol" ? "SOL" : "USDC"})</span>
            <span className="text-gray-mid">
              Balance: <span className="font-mono text-green">{fmtBalance(balance, balanceKind)}</span>
            </span>
          </div>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-12 text-lg font-semibold"
          />
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {QUICK.map((q) => (
              <Button key={q} variant="secondary" size="sm" onClick={() => setAmount(String(q))}>
                ${q}
              </Button>
            ))}
          </div>
        </div>

        {quote && (
          <div className="mt-4 space-y-1 rounded-lg bg-cream-dark p-3 text-xs">
            <Row label="You receive" value={`${quote.shares.toFixed(1)} shares`} />
            <Row
              label="Implied prob. shift"
              value={`${Math.round(quote.probNow * 100)}% → ${Math.round(
                (side === "yes" ? quote.after.yes : quote.after.no) * 100
              )}%`}
            />
            <Row
              label="Payout if you win"
              value={fmtUsd(quote.shares)}
              className="text-green"
            />
          </div>
        )}

        <motion.div whileTap={disabled ? undefined : { scale: 0.98 }} className="mt-4">
          <Button
            variant={side === "yes" ? "yes" : "no"}
            size="xl"
            className="w-full"
            disabled={disabled}
            onClick={() =>
              !connected
                ? setVisible(true)
                : setPendingTrade({ marketId: m.id, side, amount: amt, shares: quote?.shares })
            }
          >
            {cta}
          </Button>
        </motion.div>

        <div className="mt-3 flex items-start gap-1.5 text-[10px] text-gray-mid">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {connected ? (
            <span>
              Demo mode: trades execute instantly against a simulated LMSR using your {balanceKind === "sol" ? "devnet SOL balance" : "devnet USDC balance"}.
            </span>
          ) : (
            <span>
              Connect a wallet to trade — your book, balance, and P&L live on your own account.
            </span>
          )}
        </div>
      </div>

      {/* Confirm sheet */}
      <Dialog open={!!pendingTrade} onOpenChange={(o) => !o && setPendingTrade(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm trade</DialogTitle>
            <DialogDescription>
              {side.toUpperCase()} · {m.title}
            </DialogDescription>
          </DialogHeader>
          {pendingTrade && quote && (
            <div className="space-y-2 rounded-lg bg-cream-dark p-3 text-sm">
              <Row label="Side" value={side.toUpperCase()} />
              <Row label="Cost" value={fmtUsd(pendingTrade.amount)} />
              <Row label="Shares" value={quote.shares.toFixed(1)} />
              <Row
                label="Potential payout"
                value={fmtUsd(quote.shares)}
                className="text-green"
              />
            </div>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={submitting || usdcBusy}
            onClick={async () => {
              if (!pendingTrade) return;
              setSubmitting(true);
              const sig = await walletBuy(pendingTrade.amount);
              buyBinary(m.id, pendingTrade.side as "yes" | "no", pendingTrade.amount, sig ?? undefined);
              setPendingTrade(null);
              setSubmitting(false);
              if (sig) {
                showToast(
                  `Bought ${pendingTrade.side.toUpperCase()} · ${fmtUsd(pendingTrade.amount)} · tx ${shortAddr(sig)}`
                );
              }
            }}
          >
            {submitting || usdcBusy
              ? "Confirming…"
              : "Confirm · Sign & buy (demo)"}
          </Button>
          <p className="text-center text-[10px] text-gray-mid">
            Confirming signs a devnet USDC transfer to the demo vault, then the simulated fill
            executes against your book.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-mid">{label}</span>
      <span className={cn("font-mono font-semibold text-navy", className)}>{value}</span>
    </div>
  );
}
