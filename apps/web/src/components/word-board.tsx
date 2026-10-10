"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LeaderBar } from "@/components/viz/leader-bar";
import { cn, fmtErr, shortAddr } from "@/lib/format";
import { quoteBack } from "@/lib/parimutuel";
import { useSim } from "@/lib/sim";
import { useNow } from "@/hooks/useNow";
import { useChain } from "@/hooks/useChain";
import { isChainId } from "@/lib/chain";
import type { Market } from "@/lib/types";

const QUICK_SOL = [0.01, 0.025, 0.05, 0.1];

function fmtAsset(amount: number, compact = false) {
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: compact ? 3 : 4 })} SOL`;
}

export function WordBoard({ market }: { market: Market }) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const backWord = useSim((s) => s.backWord);
  const showToast = useSim((s) => s.showToast);
  const balance = useSim((s) => s.user.balance);
  const chain = useChain();
  const chainMarket = isChainId(m.id);
  const quickAmounts = QUICK_SOL;
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState("0.05");
  const [submitting, setSubmitting] = useState(false);
  const now = useNow(5000);

  const words = useMemo(
    () => [...(m.words ?? [])].sort((a, b) => b.pool - a.pool),
    [m.words]
  );
  const pot = words.reduce((s, w) => s + w.pool, 0);
  const amt = Math.max(0, parseFloat(amount) || 0);
  const sel = words.find((w) => w.word === selected);
  const backQuote = useMemo(() => (selected ? quoteBack(words, selected, amt) : null), [words, selected, amt]);

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1 text-xs text-gray-mid">
          <span className="flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5 text-orange-500" />
            {words.length} words · {fmtAsset(pot)} total pot
          </span>
          <span>1% rake at settlement</span>
        </div>

        {words.map((w, i) => {
          const share = pot > 0 ? (w.pool / pot) * 100 : 0;
          const hot = w.lastBetAt > 0 && now - w.lastBetAt < 30_000;
          return (
            <motion.button
              key={w.word}
              onClick={() => setSelected(w.word)}
              whileTap={{ scale: 0.985 }}
              className={cn(
                "w-full rounded-2xl border p-3.5 text-left transition-colors",
                i === 0
                  ? "grad-border"
                  : "border-gray-warm bg-white hover:border-blue/40"
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-navy">
                  {i === 0 && <Flame className="h-3.5 w-3.5 shrink-0 text-orange-500" />}
                  {w.word.trim()}
                  {hot && (
                    <span className="rounded bg-orange-100 px-1 py-px text-[9px] font-bold uppercase text-orange-600">
                      hot
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs text-gray-mid">
                  {fmtAsset(w.pool, true)} · {Math.round(share)}%
                </span>
              </div>
              <LeaderBar
                value={share}
                barClassName={
                  i === 0
                    ? "bg-gradient-to-r from-blue to-blue-dark"
                    : "bg-blue/40"
                }
              />
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-mid">
                <span>{w.bettors} backers</span>
                {w.pool > 0 && (
                  <span className="font-mono text-green">
                    {((pot * 0.99) / w.pool).toFixed(2)} / 1 SOL if it wins
                  </span>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Back sheet */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Back &ldquo;{selected}&rdquo;</DialogTitle>
            <DialogDescription>
              If this word/phrase is spoken first, winners split the pot pro-rata.
            </DialogDescription>
          </DialogHeader>

          {sel && (
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-gray-mid">Amount (SOL)</span>
                  <span className="text-gray-mid">
                    Pool: <span className="font-mono text-navy">{fmtAsset(sel.pool)}</span>
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

              <div className="space-y-1 rounded-lg bg-cream-dark p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-mid">Pool after</span>
                  <span className="font-mono font-semibold text-navy">
                    {backQuote ? fmtAsset(backQuote.poolAfter) : fmtAsset(sel.pool + amt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-mid">Your pot share</span>
                  <span className="font-mono font-semibold text-navy">
                    {((backQuote?.potShare ?? 0) * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-mid">Your cut if it wins</span>
                  <span className="font-mono font-semibold text-green">
                    {fmtAsset(backQuote?.payoutIfWin ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-mid">Min payout if the pot triples</span>
                  <span className="font-mono font-semibold text-navy">
                    {fmtAsset(backQuote?.minPayoutIfTripled ?? 0)}
                  </span>
                </div>
                <p className="border-t border-gray-warm pt-1 text-[10px] text-gray-mid">
                  Worst case assumes every new drop lands on this word &mdash; you always get at least that &ldquo;min payout&rdquo; floor.
                </p>
              </div>

              <Button
                size="lg"
                className="w-full"
                disabled={!connected || amt <= 0 || amt > balance || submitting}
                onClick={async () => {
                  if (!connected) {
                    setVisible(true);
                    return;
                  }
                  if (!selected || amt <= 0) return;
                  const word = selected;
                  setSubmitting(true);
                  try {
                    const sig = chainMarket
                      ? await chain.back(m, word, amt)
                      : null;
                    backWord(m.id, word, amt, sig ?? undefined);
                    setSelected(null);
                    if (sig) showToast(`Backed \u201c${word}\u201d · ${fmtAsset(amt)} · tx ${shortAddr(sig)}`);
                  } catch (err) {
                    showToast(`Back failed: ${fmtErr(err)}`);
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                {submitting
                  ? "Confirming…"
                  : !connected
                    ? "Connect wallet to back"
                    : amt > balance
                      ? "Insufficient balance"
                      : `Back ${selected} · ${fmtAsset(amt)}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
