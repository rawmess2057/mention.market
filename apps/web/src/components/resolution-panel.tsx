"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ExternalLink, Gavel, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useChain } from "@/hooks/useChain";
import { useNow } from "@/hooks/useNow";
import { chainErrorText } from "@/lib/chain";
import { cn, fmtTimeLeft } from "@/lib/format";
import { EASE } from "@/lib/motion";
import { isVoided } from "@/lib/settle";
import { useStore } from "@/lib/store";
import { explorerTx, toast } from "@/lib/toast";
import type { Market } from "@/lib/types";

type Step = 0 | 1 | 2 | 3;
const STEPS = ["Trading", "Closed", "Proposed", "Resolved"] as const;

/** Where a market is in its life, from the chain status and the clock. */
export function resolutionStep(m: Market, now: number): Step {
  if (m.status === "resolved") return 3;
  if (m.status === "resolving") return 2;
  if (m.status === "locked" || now >= m.endTime) return 1;
  return 0;
}

const outcomeLabel = (o: string) => (o === "void" ? "VOID" : o.toUpperCase());

/**
 * How this market resolves, live: a four-step timeline, the proposed or final
 * outcome with the transcript quote behind it, and the challenge window.
 */
export function ResolutionPanel({ market, className }: { market: Market; className?: string }) {
  const m = useStore((s) => s.markets[market.id]) ?? market;
  const now = useNow(1000);
  const step = resolutionStep(m, now);
  const ev = m.evidence;
  const outcome = m.winningOutcome ?? ev?.winningOutcome;
  const quote = ev?.snippets?.[0];

  return (
    <section className={cn("panel overflow-hidden", className)}>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Gavel className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
        <span className="label-caps text-fg">Resolution</span>
      </header>

      <div className="space-y-4 p-4">
        <Timeline step={step} />

        {step === 0 && (
          <p className="text-sm text-fg-muted">
            Trading closes in <span className="tnum font-medium text-fg">{fmtTimeLeft(m.endTime - now)}</span>. Then
            the recording is transcribed and an outcome is proposed.
          </p>
        )}

        {step === 1 && (
          <p className="text-sm text-fg-muted">
            Trading is closed. The recording is being transcribed; an outcome is proposed after an operator reviews
            it.
          </p>
        )}

        {step >= 2 && outcome && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className={cn(
              "rounded-xl border p-3.5",
              outcome === "yes" ? "border-yes/30 bg-yes-soft" : outcome === "no" ? "border-no/30 bg-no-soft" : "border-line bg-surface-2"
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-fg-muted">{step === 3 ? "Final outcome" : "Proposed outcome"}</span>
              <span
                className={cn(
                  "text-lg font-bold tracking-tight",
                  outcome === "yes" ? "text-yes" : outcome === "no" ? "text-no" : "text-fg"
                )}
              >
                {outcomeLabel(outcome)}
              </span>
            </div>
            {isVoided(m) && <p className="mt-1 text-sm text-fg-muted">Market voided: every position is refunded.</p>}
            {quote && (
              <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-sm leading-relaxed text-fg">
                “{quote.text}”
                <footer className="mt-1 text-micro text-fg-subtle">
                  Speaker {quote.speaker} · {new Date(quote.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                </footer>
              </blockquote>
            )}
          </motion.div>
        )}

        {step === 2 && ev && <ChallengeWindow market={m} now={now} />}

        {step === 3 && (
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Check className="h-3.5 w-3.5 text-yes" aria-hidden /> Final on-chain. Winning positions can be claimed.
          </p>
        )}
      </div>
    </section>
  );
}

function Timeline({ step }: { step: Step }) {
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Resolution progress">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={label} className="min-w-0" aria-current={active ? "step" : undefined}>
            <div className="h-1 overflow-hidden rounded-full bg-surface-3">
              <motion.div
                className={cn("h-full rounded-full", active && step < 3 ? "bg-accent" : "bg-yes")}
                initial={false}
                animate={{ width: done || active ? "100%" : "0%" }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            </div>
            <div className={cn("mt-1.5 truncate text-micro", active ? "font-semibold text-fg" : done ? "text-fg-muted" : "text-fg-subtle")}>
              {label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ChallengeWindow({ market: m, now }: { market: Market; now: number }) {
  const ev = m.evidence!;
  const chain = useChain();
  const markChallenged = useStore((s) => s.challenge);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const left = ev.challengeDeadline - now;

  if (ev.challenged) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
        <ShieldAlert className="h-4 w-4" aria-hidden /> Challenged. The resolver reviews it and proposes again.
      </p>
    );
  }
  if (left <= 0) {
    return <p className="text-sm text-fg-muted">Challenge window closed. Finalizing on-chain…</p>;
  }

  const send = async () => {
    setSending(true);
    const id = toast.pending("Confirm the challenge in your wallet…");
    try {
      const sig = await chain.challenge(m.id);
      markChallenged(m.id);
      toast.success(`Challenge submitted on “${m.title}”`, { id, href: sig ? explorerTx(sig) : undefined });
      setConfirming(false);
    } catch (err) {
      toast.error("Challenge failed", { id, description: chainErrorText(err) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-fg-muted">Challenge window</span>
        <span className="tnum font-mono font-semibold text-warn">{fmtTimeLeft(left)}</span>
      </div>
      <AnimatePresence initial={false} mode="wait">
        {confirming ? (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2 overflow-hidden"
          >
            <p className="text-xs leading-relaxed text-fg-muted">
              Posting a challenge locks a <span className="font-semibold text-fg">{ev.bondSol} SOL bond</span>. If the
              resolver then proposes a different outcome, you get your bond back plus theirs. If it proposes the same
              outcome again, your bond goes to the treasury.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => setConfirming(false)} disabled={sending}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" className="flex-1" onClick={() => void send()} disabled={sending}>
                {sending ? "Challenging…" : `Post ${ev.bondSol} SOL bond`}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="cta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button variant="outline" size="sm" className="w-full" onClick={() => setConfirming(true)}>
              Dispute this outcome
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      {m.sourceUrl && (
        <a
          href={m.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-micro text-fg-subtle hover:text-fg"
        >
          Verify on the explorer <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}
    </div>
  );
}
