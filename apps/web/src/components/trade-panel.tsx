"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Info } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn, fmtErr, shortAddr } from "@/lib/format";
import { lmsrBuyQuote, lmsrProbYes } from "@/lib/lmsr";
import { useSim } from "@/lib/sim";
import { useChain } from "@/hooks/useChain";
import { isChainId } from "@/lib/chain";
import type { Market } from "@/lib/types";

const QUICK_SOL = [0.01, 0.025, 0.05, 0.1];

function fmtAsset(amount: number) {
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`;
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
  const chain = useChain();
  const chainMarket = isChainId(m.id);
  const quickAmounts = QUICK_SOL;

  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("0.05");
  const [submitting, setSubmitting] = useState(false);

  const amt = Math.max(0, parseFloat(amount) || 0);
  const balance = user.balance;

  const quote = useMemo(() => {
    if (amt <= 0) return null;
    return lmsrBuyQuote(m.yesShares, m.noShares, m.b, side, amt);
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
        : `Buy ${side.toUpperCase()} · ${fmtAsset(amt)}`;

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
            <span className="text-gray-mid">Amount (SOL)</span>
            <span className="text-gray-mid">
              Balance: <span className="font-mono text-green">{fmtAsset(balance)}</span>
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
            {quickAmounts.map((q) => (
              <Button key={q} variant="secondary" size="sm" onClick={() => setAmount(String(q))}>
                {fmtAsset(q)}
              </Button>
            ))}
          </div>
        </div>

        {quote && (
          <div className="mt-4 space-y-1 rounded-lg bg-cream-dark p-3 text-xs">
            <Row label="You receive" value={`${quote.shares.toFixed(1)} shares`} />
            <Row label="Avg price / share" value={`~${fmtAsset(quote.avgPrice)}`} />
            <Row
              label="Price impact"
              value={`${quote.impactPct >= 0 ? "+" : ""}${quote.impactPct.toFixed(1)}%`}
              className={quote.impactPct > 2 ? "text-orange-600" : ""}
            />
            <Row
              label="Implied prob. shift"
              value={`${Math.round(quote.before * 100)}% → ${Math.round(quote.after * 100)}%`}
            />
            <Row
              label="Payout if you win"
              value={fmtAsset(quote.shares)}
              className="text-green"
            />
            {chainMarket && (
              <div className="border-t border-gray-warm pt-1 text-[10px] text-gray-mid">
                On-chain execution applies a ±2% slippage tolerance (min proceeds = 98% of this quote).
              </div>
            )}
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
              {chainMarket
                ? `Real devnet trade; this market is denominated in SOL.`
                : `Demo mode: trades execute against a simulated LMSR using your devnet SOL balance.`}
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
              <Row label="Cost" value={fmtAsset(pendingTrade.amount)} />
              <Row label="Shares" value={quote.shares.toFixed(1)} />
              <Row label="Avg price / share" value={`~${fmtAsset(quote.avgPrice)}`} />
              <Row
                label="Potential payout"
                value={fmtAsset(quote.shares)}
                className="text-green"
              />
            </div>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={submitting}
            onClick={async () => {
              if (!pendingTrade) return;
              setSubmitting(true);
              try {
                const sig = chainMarket
                  ? await chain.buy(m, pendingTrade.side as "yes" | "no", pendingTrade.amount)
                  : null;
                buyBinary(m.id, pendingTrade.side as "yes" | "no", pendingTrade.amount, sig ?? undefined);
                setPendingTrade(null);
                if (sig) {
                  showToast(
                    `Bought ${pendingTrade.side.toUpperCase()} · ${fmtAsset(pendingTrade.amount)} · tx ${shortAddr(sig)}`
                  );
                }
              } catch (err) {
                showToast(`Trade failed: ${fmtErr(err)}`);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting
              ? "Confirming…"
              : chainMarket
                ? "Confirm & sign on-chain"
                : "Confirm · buy (demo)"}
          </Button>
          <p className="text-center text-[10px] text-gray-mid">
            {chainMarket
              ? `Confirming sends one real devnet SOL buy to the program (vault escrow) and your position is mirrored on-chain.`
              : "Confirming executes the simulated fill against your book."}
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
