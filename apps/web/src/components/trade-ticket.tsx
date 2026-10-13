"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Info, Wallet } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn, fmtErr, fmtSol, shortAddr } from "@/lib/format";
import { lmsrBuyQuote, lmsrProbYes } from "@/lib/lmsr";
import { quoteBack } from "@/lib/parimutuel";
import { useSim } from "@/lib/sim";
import { useChain } from "@/hooks/useChain";
import { isChainId } from "@/lib/chain";
import { DURATION, EASE } from "@/lib/motion";
import type { Market } from "@/lib/types";

/** Percentage-of-balance sizing, the pattern traders expect from an exchange. */
const SIZE_PRESETS = [0.25, 0.5, 0.75] as const;

export interface TradeTicketProps {
  market: Market;
  /** Controlled side (binary markets); omit to let the ticket own it. */
  side?: "yes" | "no";
  onSideChange?: (side: "yes" | "no") => void;
  /** Controlled word (word-race markets). */
  word?: string | null;
  onWordChange?: (word: string) => void;
  className?: string;
  /** Called after a successful fill — the hosting sheet uses it to close. */
  onFilled?: () => void;
  /**
   * Word-race markets only: hide the inline word picker when something else
   * (the board) already owns that choice.
   */
  showWordPicker?: boolean;
}

/**
 * The one trade surface.
 *
 * Replaces the old pair of competing widgets (`trade-panel` and the
 * mislabelled "OrderBook" quick-bet card) with a single ticket that:
 *   - states the price twice — implied % and the ¢ contract price;
 *   - shows the full cost of the trade *before* the button (avg fill, price
 *     impact, payout, fee), because hidden slippage is the #1 trust killer;
 *   - keeps the on-chain signature as an explicit confirm step, while demo
 *     fills execute immediately (no fake ceremony around play money).
 */
export function TradeTicket({
  market,
  side: sideProp,
  onSideChange,
  word: wordProp,
  onWordChange,
  className,
  onFilled,
  showWordPicker = true,
}: TradeTicketProps) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const balance = useSim((s) => s.user.balance);
  const buyBinary = useSim((s) => s.buyBinary);
  const backWord = useSim((s) => s.backWord);
  const showToast = useSim((s) => s.showToast);
  const chain = useChain();
  const chainMarket = isChainId(m.id);

  const [internalSide, setInternalSide] = useState<"yes" | "no">("yes");
  const [internalWord, setInternalWord] = useState<string | null>(null);
  const side = sideProp ?? internalSide;
  const setSide = (next: "yes" | "no") => {
    if (sideProp === undefined) setInternalSide(next);
    onSideChange?.(next);
  };

  const words = useMemo(
    () => [...(m.words ?? [])].sort((a, b) => b.pool - a.pool),
    [m.words]
  );
  const selectedWord = wordProp !== undefined ? wordProp : internalWord;
  const setSelectedWord = (next: string) => {
    if (wordProp === undefined) setInternalWord(next);
    onWordChange?.(next);
  };
  const isWordRace = m.type !== "binary";

  const [amount, setAmount] = useState("0.05");
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const amt = Math.max(0, parseFloat(amount) || 0);
  const price = lmsrProbYes(m.yesShares, m.noShares, m.b);
  const sidePrice = side === "yes" ? price : 1 - price;
  const pot = words.reduce((s, w) => s + w.pool, 0);
  const wordEntry = words.find((w) => w.word === selectedWord) ?? null;
  const multiplier = wordEntry && wordEntry.pool > 0 ? (pot * 0.99) / wordEntry.pool : 0;

  const binaryQuote = useMemo(
    () => (!isWordRace && amt > 0 ? lmsrBuyQuote(m.yesShares, m.noShares, m.b, side, amt) : null),
    [isWordRace, m, side, amt]
  );
  const wordQuote = useMemo(
    () => (isWordRace && selectedWord && amt > 0 ? quoteBack(words, selectedWord, amt) : null),
    [isWordRace, words, selectedWord, amt]
  );

  const feeBps = m.creatorFeeBps || 100;
  const overBalance = amt > balance;
  const closed = m.status !== "open";
  const ready = !closed && amt > 0 && !overBalance && (!isWordRace || !!selectedWord);

  const cta = !connected
    ? "Connect wallet to trade"
    : closed
      ? "Market closed"
      : isWordRace && !selectedWord
        ? "Pick a word to back"
        : amt <= 0
          ? "Enter an amount"
          : overBalance
            ? "Amount exceeds balance"
            : isWordRace
              ? `Back “${selectedWord}” · ${fmtSol(amt)}`
              : `Buy ${side.toUpperCase()} · ${fmtSol(amt)}`;

  const fill = async () => {
    if (submitting) return;
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!ready) return;
    setSubmitting(true);
    try {
      if (isWordRace) {
        const word = selectedWord!;
        const sig = chainMarket ? await chain.back(m, word, amt) : null;
        backWord(m.id, word, amt, sig ?? undefined);
        showToast(
          sig
            ? `Backed “${word}” · ${fmtSol(amt)} · tx ${shortAddr(sig)}`
            : `Backed “${word}” · ${fmtSol(amt)}`
        );
      } else {
        const sig = chainMarket ? await chain.buy(m, side, amt) : null;
        buyBinary(m.id, side, amt, sig ?? undefined);
        showToast(
          sig
            ? `Bought ${side.toUpperCase()} · ${fmtSol(amt)} · tx ${shortAddr(sig)}`
            : `Bought ${side.toUpperCase()} · ${fmtSol(amt)}`
        );
      }
      onFilled?.();
    } catch (err) {
      showToast(`Trade failed: ${fmtErr(err)}`);
    } finally {
      setSubmitting(false);
      setConfirm(false);
    }
  };

  const onPrimary = () => {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!ready) return;
    // Real money gets a signature step; simulated fills do not.
    if (chainMarket) setConfirm(true);
    else void fill();
  };

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Side / word choice — the actual decision, made first and biggest. */}
      {isWordRace && !showWordPicker ? (
        wordEntry ? (
          <div className="flex items-center gap-2 rounded-tile border border-blue bg-blue-light px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-body font-semibold text-blue">
              {wordEntry.word.trim()}
            </span>
            <span className="tnum font-mono text-label font-semibold text-blue">
              {multiplier.toFixed(2)}×
            </span>
          </div>
        ) : (
          <p className="rounded-tile border border-dashed border-ink-200 px-3 py-2.5 text-center text-label text-gray-mid">
            Pick a word from the board to see the odds.
          </p>
        )
      ) : isWordRace ? (
        <div className="space-y-1">
          <div className="label-caps">Back a word</div>
          <div className="space-y-1">
            {words.slice(0, 5).map((w) => {
              const active = w.word === selectedWord;
              const share = pot > 0 ? w.pool / pot : 0;
              return (
                <button
                  key={w.word}
                  type="button"
                  onClick={() => setSelectedWord(w.word)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-tile border px-3 py-2 text-left transition-colors",
                    active
                      ? "border-blue bg-blue-light"
                      : "border-ink-200 hover:border-blue/40 hover:bg-ink-50"
                  )}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13px] font-semibold",
                      active ? "text-blue" : "text-navy"
                    )}
                  >
                    {w.word}
                  </span>
                  <span className="tnum shrink-0 font-mono text-[11px] text-ink-500">
                    {(((pot * 0.99) / Math.max(w.pool, 1e-9)) || 0).toFixed(2)}×
                  </span>
                  <span className="tnum w-9 shrink-0 text-right font-mono text-[12px] font-semibold text-navy">
                    {Math.round(share * 100)}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(["yes", "no"] as const).map((s) => {
            const p = s === "yes" ? price : 1 - price;
            const active = side === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                aria-pressed={active}
                className={cn(
                  "rounded-tile border px-3 py-2.5 text-left transition-all",
                  active
                    ? s === "yes"
                      ? "border-yes bg-yes text-white shadow-[0_4px_14px_-6px_rgba(43,117,80,0.6)]"
                      : "border-no bg-no text-white shadow-[0_4px_14px_-6px_rgba(199,91,58,0.6)]"
                    : "border-ink-200 bg-white hover:border-ink-300"
                )}
              >
                <span
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-[0.08em]",
                    active ? "text-white/80" : "text-gray-mid"
                  )}
                >
                  Buy {s}
                </span>
                <span
                  className={cn(
                    "tnum mt-0.5 block font-mono text-lg font-bold leading-none",
                    active ? "text-white" : "text-navy"
                  )}
                >
                  {Math.round(p * 100)}¢
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Size */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="label-caps">Amount (SOL)</span>
          <span className="tnum flex items-center gap-1 text-micro text-gray-mid">
            <Wallet className="h-3 w-3" aria-hidden />
            {fmtSol(balance)}
          </span>
        </div>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount in SOL"
          className="h-12 text-lg font-semibold"
        />
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {SIZE_PRESETS.map((p) => (
            <Button
              key={p}
              variant="secondary"
              size="sm"
              className="rounded-field"
              onClick={() => setAmount((Math.max(0, balance) * p).toFixed(3).replace(/0+$/, "").replace(/\.$/, ""))}
            >
              {p * 100}%
            </Button>
          ))}
          <Button
            variant="secondary"
            size="sm"
            className="rounded-field"
            onClick={() => setAmount(String(Math.max(0, Math.floor(balance * 1000) / 1000)))}
          >
            Max
          </Button>
        </div>
      </div>

      {/* What you are actually buying */}
      <div className="mt-4 rounded-tile bg-ink-50 p-3 text-label">
        {isWordRace ? (
          wordQuote && wordEntry ? (
            <div className="space-y-1.5">
              <QuoteRow label="Payout per 1 SOL" value={`${multiplier.toFixed(2)}×`} />
              <QuoteRow label="Pot after your back" value={fmtSol(wordQuote.poolAfter)} />
              <QuoteRow
                label="Share of the winning pool"
                value={`${(wordQuote.potShare * 100).toFixed(2)}%`}
              />
              <QuoteRow
                label="If this word wins"
                value={fmtSol(wordQuote.payoutIfWin)}
                tone="yes"
              />
              <QuoteRow
                label="Floor if the pot triples"
                value={fmtSol(wordQuote.minPayoutIfTripled)}
              />
              <p className="border-t border-ink-200 pt-1.5 text-micro leading-relaxed text-gray-mid">
                Pari-mutuel: your payout shrinks if more money lands on this word, so this is a
                floor, not a promise. Rake {feeBps / 100}% at settlement.
              </p>
            </div>
          ) : (
            <p className="py-1 text-center text-gray-mid">
              Pick a word above to see the odds.
            </p>
          )
        ) : binaryQuote ? (
          <div className="space-y-1.5">
            <QuoteRow label="You receive" value={`${binaryQuote.shares.toFixed(1)} shares`} />
            <QuoteRow
              label="Avg price / share"
              value={`${Math.round(binaryQuote.avgPrice * 100)}¢`}
            />
            <QuoteRow
              label="Price impact"
              value={`${binaryQuote.impactPct >= 0 ? "+" : ""}${binaryQuote.impactPct.toFixed(1)}%`}
              tone={binaryQuote.impactPct > 2 ? "warn" : undefined}
            />
            <QuoteRow
              label="Chance moves"
              value={`${Math.round(binaryQuote.before * 100)}% → ${Math.round(binaryQuote.after * 100)}%`}
            />
            <QuoteRow
              label={`Payout if ${side.toUpperCase()} resolves`}
              value={fmtSol(binaryQuote.shares)}
              tone="yes"
            />
            <p className="border-t border-ink-200 pt-1.5 text-micro leading-relaxed text-gray-mid">
              Each share pays 1 SOL if {side.toUpperCase()} wins. Fee {feeBps / 100}% at
              settlement{chainMarket ? "; on-chain fills allow ±2% slippage" : ""}.
            </p>
          </div>
        ) : (
          <p className="py-1 text-center text-gray-mid">Enter an amount to see your fill.</p>
        )}
      </div>

      <motion.div
        whileTap={ready ? { scale: 0.985 } : undefined}
        transition={{ duration: DURATION.press, ease: EASE }}
        className="mt-4"
      >
        <Button
          variant={isWordRace ? "default" : side === "yes" ? "yes" : "no"}
          size="xl"
          className="w-full"
          disabled={connected && !ready}
          onClick={onPrimary}
          aria-disabled={!ready && connected}
        >
          {submitting ? "Confirming…" : cta}
        </Button>
      </motion.div>

      <div className="mt-3 flex items-start gap-1.5 text-micro leading-relaxed text-gray-mid">
        <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        {connected ? (
          <span>
            {isWordRace
              ? "Winners split the pot pro-rata once the transcript is checked."
              : chainMarket
                ? "Real devnet trade — SOL is escrowed by the program until resolution."
                : "Demo market: fills run against a simulated LMSR book."}
          </span>
        ) : (
          <span>Connect a wallet to see your own book, balance and P&amp;L.</span>
        )}
      </div>

      {/* On-chain confirmation — the signature is the trust moment, keep it explicit. */}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign this trade</DialogTitle>
            <DialogDescription>
              {isWordRace
                ? `Back “${selectedWord}” · ${m.title}`
                : `${side.toUpperCase()} · ${m.title}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 rounded-tile bg-ink-50 p-3 text-label">
            <QuoteRow label="Cost" value={fmtSol(amt)} />
            {isWordRace ? (
              <QuoteRow
                label="If this word wins"
                value={fmtSol(wordQuote?.payoutIfWin ?? 0)}
                tone="yes"
              />
            ) : (
              <>
                <QuoteRow
                  label="Shares"
                  value={(binaryQuote?.shares ?? 0).toFixed(1)}
                />
                <QuoteRow
                  label="Potential payout"
                  value={fmtSol(binaryQuote?.shares ?? 0)}
                  tone="yes"
                />
              </>
            )}
            <QuoteRow label="Network" value="Solana devnet" />
          </div>
          <Button
            variant={isWordRace ? "default" : side === "yes" ? "yes" : "no"}
            size="lg"
            className="w-full"
            disabled={submitting}
            onClick={() => void fill()}
          >
            {submitting ? "Confirming…" : "Confirm & sign"}
          </Button>
          <p className="text-center text-micro text-gray-mid">
            One devnet transaction escrows your SOL in the market vault.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QuoteRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "yes" | "warn";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-mid">{label}</span>
      <span
        className={cn(
          "tnum font-mono font-semibold",
          tone === "yes" ? "text-yes" : tone === "warn" ? "text-warn" : "text-navy"
        )}
      >
        {value}
      </span>
    </div>
  );
}
