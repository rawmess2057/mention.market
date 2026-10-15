"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Wallet } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useChain } from "@/hooks/useChain";
import { chainErrorText } from "@/lib/chain";
import { cn, fmtSol } from "@/lib/format";
import { lmsrBuyQuote, lmsrProbYes } from "@/lib/lmsr";
import { DURATION, EASE } from "@/lib/motion";
import { quoteBack } from "@/lib/parimutuel";
import { lmsrSellValue, useStore } from "@/lib/store";
import { explorerTx, toast } from "@/lib/toast";
import type { Market } from "@/lib/types";

/** Percentage-of-balance (or of holdings, when selling) sizing presets. */
const SIZE_PRESETS = [0.25, 0.5, 0.75] as const;
/** Price impact above this is called out before the trade. */
const HIGH_IMPACT_PCT = 5;

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
  /** Word races: hide the inline word picker when the board owns that choice. */
  showWordPicker?: boolean;
}

const trimNum = (n: number, dp = 3) => n.toFixed(dp).replace(/0+$/, "").replace(/\.$/, "") || "0";

/**
 * The one trade surface. It states the full cost before the button (shares,
 * average fill, price impact, payout), and one click goes straight to the
 * wallet: the wallet's signature prompt is the confirmation, so there is no
 * second dialog. Progress is a single toast: signing → confirmed, with the
 * transaction link.
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
  const m = useStore((s) => s.markets[market.id]) ?? market;
  const balance = useStore((s) => s.user.balance);
  const position = useStore((s) => s.positions[market.id]);
  const recordBuy = useStore((s) => s.buyBinary);
  const recordSell = useStore((s) => s.sellBinary);
  const recordBack = useStore((s) => s.backWord);
  const chain = useChain();

  const [internalSide, setInternalSide] = useState<"yes" | "no">("yes");
  const [internalWord, setInternalWord] = useState<string | null>(null);
  const side = sideProp ?? internalSide;
  const setSide = (next: "yes" | "no") => {
    if (sideProp === undefined) setInternalSide(next);
    onSideChange?.(next);
  };
  const selectedWord = wordProp !== undefined ? wordProp : internalWord;
  const setSelectedWord = (next: string) => {
    if (wordProp === undefined) setInternalWord(next);
    onWordChange?.(next);
  };

  const isWordRace = m.type !== "binary";
  const held = side === "yes" ? (position?.yesShares ?? 0) : (position?.noShares ?? 0);
  const canSell = !isWordRace && ((position?.yesShares ?? 0) > 0 || (position?.noShares ?? 0) > 0);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const selling = mode === "sell" && canSell;

  const [amount, setAmount] = useState("0.05");
  const [submitting, setSubmitting] = useState(false);

  const words = useMemo(() => [...(m.words ?? [])].sort((a, b) => b.pool - a.pool), [m.words]);
  const amt = Math.max(0, parseFloat(amount) || 0);
  const price = lmsrProbYes(m.yesShares, m.noShares, m.b);
  const pot = words.reduce((s, w) => s + w.pool, 0);
  const wordEntry = words.find((w) => w.word === selectedWord) ?? null;
  const multiplier = wordEntry && wordEntry.pool > 0 ? (pot * 0.99) / wordEntry.pool : 0;

  const buyQuote = useMemo(
    () => (!isWordRace && !selling && amt > 0 ? lmsrBuyQuote(m.yesShares, m.noShares, m.b, side, amt) : null),
    [isWordRace, selling, m, side, amt]
  );
  const sellProceeds = selling && amt > 0 ? lmsrSellValue(m, side, Math.min(amt, held)) : 0;
  const wordQuote = useMemo(
    () => (isWordRace && selectedWord && amt > 0 ? quoteBack(words, selectedWord, amt) : null),
    [isWordRace, words, selectedWord, amt]
  );

  const feeBps = m.creatorFeeBps || 100;
  const closed = m.status !== "open" || Date.now() >= m.endTime;
  const over = selling ? amt > held + 1e-9 : amt > balance;
  const ready = !closed && amt > 0 && !over && (!isWordRace || !!selectedWord);
  const highImpact = (buyQuote?.impactPct ?? 0) > HIGH_IMPACT_PCT;

  const cta = !connected
    ? "Connect wallet to trade"
    : closed
      ? "Trading closed"
      : isWordRace && !selectedWord
        ? "Pick a word to back"
        : amt <= 0
          ? "Enter an amount"
          : over
            ? selling
              ? "More than you hold"
              : "Not enough SOL"
            : isWordRace
              ? `Back “${selectedWord}” · ${fmtSol(amt)}`
              : selling
                ? `Sell ${trimNum(amt, 2)} ${side.toUpperCase()}`
                : `Buy ${side.toUpperCase()} · ${fmtSol(amt)}`;

  const submit = async () => {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!ready || submitting) return;
    setSubmitting(true);
    const id = toast.pending("Confirm in your wallet…");
    try {
      if (isWordRace) {
        const word = selectedWord!;
        const sig = await chain.back(m, word, amt);
        if (!sig) throw new Error("The wallet isn't ready to sign.");
        recordBack(m.id, word, amt, sig);
        toast.success(`Backed “${word}” with ${fmtSol(amt)}`, { id, href: explorerTx(sig) });
      } else if (selling) {
        const shares = Math.min(amt, held);
        const sig = await chain.sell(m, side, shares);
        if (!sig) throw new Error("The wallet isn't ready to sign.");
        recordSell(m.id, side, shares);
        toast.success(`Sold ${trimNum(shares, 2)} ${side.toUpperCase()} for ${fmtSol(sellProceeds)}`, { id, href: explorerTx(sig) });
      } else {
        const sig = await chain.buy(m, side, amt);
        if (!sig) throw new Error("The wallet isn't ready to sign.");
        recordBuy(m.id, side, amt, sig);
        toast.success(`Bought ${trimNum(buyQuote?.shares ?? 0, 2)} ${side.toUpperCase()} for ${fmtSol(amt)}`, {
          id,
          href: explorerTx(sig),
        });
      }
      onFilled?.();
    } catch (err) {
      toast.error("Trade didn't go through", { id, description: chainErrorText(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const presetBase = selling ? held : balance;
  const setPreset = (fraction: number) => setAmount(trimNum(Math.max(0, presetBase) * fraction, selling ? 4 : 3));

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {canSell && (
        <Segmented
          aria-label="Buy or sell"
          value={mode}
          onChange={(v) => {
            setMode(v);
            setAmount(v === "sell" ? trimNum(held, 4) : "0.05");
          }}
          options={[
            { value: "buy", label: "Buy" },
            { value: "sell", label: "Sell" },
          ]}
        />
      )}

      {isWordRace ? (
        showWordPicker ? (
          <div className="space-y-1">
            {words.slice(0, 6).map((w) => {
              const active = w.word === selectedWord;
              const share = pot > 0 ? w.pool / pot : 0;
              return (
                <button
                  key={w.word}
                  type="button"
                  onClick={() => setSelectedWord(w.word)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                    active ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-surface-2"
                  )}
                >
                  <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", active ? "text-fg" : "text-fg")}>{w.word}</span>
                  <span className="tnum shrink-0 font-mono text-xs text-fg-muted">
                    {(((pot * 0.99) / Math.max(w.pool, 1e-9)) || 0).toFixed(2)}×
                  </span>
                  <span className="tnum w-10 shrink-0 text-right font-mono text-xs font-semibold text-fg">
                    {Math.round(share * 100)}%
                  </span>
                </button>
              );
            })}
          </div>
        ) : wordEntry ? (
          <div className="flex items-center gap-2 rounded-lg border border-accent bg-accent-soft px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{wordEntry.word.trim()}</span>
            <span className="tnum font-mono text-sm font-semibold text-accent">{multiplier.toFixed(2)}×</span>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-sm text-fg-muted">
            Pick a word from the board to see its odds.
          </p>
        )
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(["yes", "no"] as const).map((s) => {
            const p = s === "yes" ? price : 1 - price;
            const active = side === s;
            const heldHere = s === "yes" ? (position?.yesShares ?? 0) : (position?.noShares ?? 0);
            const disabled = selling && heldHere <= 0;
            return (
              <button
                key={s}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setSide(s);
                  if (selling) setAmount(trimNum(heldHere, 4));
                }}
                aria-pressed={active}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition-[background-color,border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-35",
                  active
                    ? s === "yes"
                      ? "border-yes bg-yes text-bg shadow-[0_8px_24px_-12px_rgb(var(--yes)/0.7)]"
                      : "border-no bg-no text-bg shadow-[0_8px_24px_-12px_rgb(var(--no)/0.7)]"
                    : "border-line bg-surface-2 hover:border-line-strong"
                )}
              >
                <span className={cn("text-[11px] font-semibold uppercase tracking-wider", active ? "text-bg/70" : "text-fg-muted")}>
                  {selling ? "Sell" : "Buy"} {s}
                </span>
                <span className={cn("tnum mt-0.5 block text-xl font-bold leading-none", active ? "text-bg" : "text-fg")}>
                  {Math.round(p * 100)}¢
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor={`amt-${m.id}`} className="text-xs font-medium text-fg-muted">
            {selling ? "Shares" : "Amount"}
          </label>
          <button
            type="button"
            onClick={() => setPreset(1)}
            className="tnum flex items-center gap-1 text-xs text-fg-subtle transition-colors hover:text-fg"
          >
            <Wallet className="h-3 w-3" aria-hidden />
            {selling ? `${trimNum(held, 4)} held` : fmtSol(balance)}
          </button>
        </div>
        <div className="relative">
          <Input
            id={`amt-${m.id}`}
            type="number"
            inputMode="decimal"
            min={0}
            step={selling ? 0.0001 : 0.01}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tnum h-12 bg-surface-2 pr-14 text-lg font-semibold"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">
            {selling ? side.toUpperCase() : "SOL"}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {SIZE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className="rounded-md border border-line py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
            >
              {p * 100}%
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreset(1)}
            className="rounded-md border border-line py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            Max
          </button>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-line bg-surface-2/60 p-3 text-sm">
        {isWordRace ? (
          wordQuote && wordEntry ? (
            <>
              <QuoteRow label="Payout per 1 SOL" value={`${multiplier.toFixed(2)}×`} />
              <QuoteRow label="If this word wins" value={fmtSol(wordQuote.payoutIfWin)} tone="yes" />
              <QuoteRow label="Your share of its pool" value={`${(wordQuote.potShare * 100).toFixed(1)}%`} />
              <Fine>Pari-mutuel: the payout shrinks if more SOL lands on this word. {feeBps / 100}% fee at settlement.</Fine>
            </>
          ) : (
            <p className="py-1 text-center text-fg-muted">Pick a word to see the payout.</p>
          )
        ) : selling ? (
          amt > 0 ? (
            <>
              <QuoteRow label="You receive" value={fmtSol(sellProceeds)} tone="yes" />
              <QuoteRow label="Avg price" value={`${Math.round((sellProceeds / Math.max(Math.min(amt, held), 1e-9)) * 100)}¢`} />
              <Fine>Sells back to the market maker at its current curve.</Fine>
            </>
          ) : (
            <p className="py-1 text-center text-fg-muted">Enter how many shares to sell.</p>
          )
        ) : buyQuote ? (
          <>
            <QuoteRow label="Shares" value={trimNum(buyQuote.shares, 3)} />
            <QuoteRow label="Avg price" value={`${Math.round(buyQuote.avgPrice * 100)}¢`} />
            <QuoteRow
              label="Price impact"
              value={`${buyQuote.impactPct >= 0 ? "+" : ""}${buyQuote.impactPct.toFixed(1)}%`}
              tone={highImpact ? "warn" : undefined}
            />
            <QuoteRow label={`Payout if ${side.toUpperCase()}`} value={fmtSol(buyQuote.shares)} tone="yes" />
            <Fine>
              Each share pays 1 SOL if {side.toUpperCase()} wins. {feeBps / 100}% fee at settlement; fills allow ±2%
              slippage.
            </Fine>
          </>
        ) : (
          <p className="py-1 text-center text-fg-muted">Enter an amount to see your fill.</p>
        )}
      </div>

      {highImpact && !selling && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          This trade moves the price {buyQuote!.impactPct.toFixed(1)}%. A smaller amount gets a better average price.
        </p>
      )}

      <motion.div whileTap={ready ? { scale: 0.985 } : undefined} transition={{ duration: DURATION.press, ease: EASE }}>
        <Button
          variant={isWordRace ? "default" : side === "yes" ? "yes" : "no"}
          size="xl"
          className="w-full"
          disabled={(connected && !ready) || submitting}
          onClick={() => void submit()}
        >
          {submitting ? "Confirm in wallet…" : cta}
        </Button>
      </motion.div>
    </div>
  );
}

function QuoteRow({ label, value, tone }: { label: string; value: string; tone?: "yes" | "warn" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className={cn("tnum font-semibold", tone === "yes" ? "text-yes" : tone === "warn" ? "text-warn" : "text-fg")}>
        {value}
      </span>
    </div>
  );
}

function Fine({ children }: { children: React.ReactNode }) {
  return <p className="border-t border-line pt-2 text-xs leading-relaxed text-fg-subtle">{children}</p>;
}
