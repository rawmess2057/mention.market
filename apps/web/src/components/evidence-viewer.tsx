"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, FileAudio, Gavel, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn, fmtClock } from "@/lib/format";
import { useSim } from "@/lib/sim";
import type { Market } from "@/lib/types";

export function EvidenceSection({ market }: { market: Market }) {
  const m = useSim((s) => s.markets[market.id]) ?? market;
  const [open, setOpen] = useState(false);

  const show =
    m.status === "resolving" || m.status === "resolved" || m.evidence;

  if (!show) return null;

  const label =
    m.status === "resolving"
      ? "AI resolver is preparing evidence…"
      : m.winningOutcome
        ? `Winner: ${m.winningOutcome.toUpperCase()}`
        : "Evidence ready";

  return (
    <div className="rounded-xl border border-blue/15 bg-blue-light/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue">
          <Gavel className="h-3.5 w-3.5" />
          Resolution
        </div>
        {m.confidence !== undefined && (
          <span className="font-mono text-xs font-bold text-blue">
            {m.confidence}% confidence
          </span>
        )}
      </div>

      <div className="mt-2 text-sm font-semibold text-navy">{label}</div>

      {m.evidence && <ChallengeCountdown market={m} />}

      <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setOpen(true)}>
        View evidence package
      </Button>

      <EvidenceModal market={m} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function ChallengeCountdown({ market: m }: { market: Market }) {
  const ev = m.evidence!;
  const [remaining, setRemaining] = useState(ev.challengeDeadline - Date.now());

  useEffect(() => {
    const t = setInterval(() => setRemaining(ev.challengeDeadline - Date.now()), 1000);
    return () => clearInterval(t);
  }, [ev.challengeDeadline]);

  const ms = Math.max(0, remaining);
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);

  if (m.status === "resolved" && ms <= 0) {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-xs text-green">
        <BadgeCheck className="h-3.5 w-3.5" />
        Challenge window closed — finalized on-chain
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs text-amber-600">
      <ShieldAlert className="h-3.5 w-3.5" />
      Challenge window: {min}m {String(sec).padStart(2, "0")}s remaining
      {ev.challenged && <span className="font-bold">· CHALLENGED</span>}
    </div>
  );
}

function EvidenceModal({
  market: m,
  open,
  onOpenChange,
}: {
  market: Market;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const challenge = useSim((s) => s.challenge);
  const ev = m.evidence;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Resolution evidence</DialogTitle>
          <DialogDescription>{m.title}</DialogDescription>
        </DialogHeader>

        {!ev ? (
          <div className="py-8 text-center text-sm text-gray-mid">
            The AI resolver is still packaging evidence (transcript excerpts, timestamps, audio
            hashes). Check back shortly.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-gray-mid">AI confidence</span>
                  <span className="font-mono font-bold text-navy">{ev.confidence}%</span>
                </div>
                <Progress value={ev.confidence} indicatorClassName="bg-blue" />
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase text-gray-mid">Winner</div>
                <div className="font-mono text-sm font-bold text-green">
                  {ev.winningOutcome.toUpperCase()}
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-cream-dark p-3 text-xs text-gray-mid">
              Proposed by <span className="font-mono text-navy">{ev.proposedBy}</span> · bond{" "}
              <span className="font-mono text-navy">{fmtUsd2(ev.bondUsd)}</span> · hash{" "}
              <span className="font-mono text-navy">{ev.evidenceHash}</span>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-mid">
                Transcript snippets
              </div>
              <div className="space-y-2">
                {ev.snippets.map((s, i) => (
                  <div key={i} className="rounded-lg border border-gray-warm bg-white p-3 text-sm text-navy">
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-mid">
                      <span className="font-mono">{fmtClock(s.t)}</span>
                      <span className="font-medium text-blue">{s.speaker}</span>
                    </div>
                    {s.text}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-mid">
              <FileAudio className="h-3.5 w-3.5" />
              Audio clip hashes stored on-chain · Arweave archive pending
            </div>

            {!ev.challenged && m.status === "resolving" && (
              <Button
                variant="destructive"
                size="lg"
                className="w-full"
                onClick={() => {
                  challenge(m.id);
                  onOpenChange(false);
                }}
              >
                Challenge (bond 50 USDC)
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function fmtUsd2(n: number) {
  return `$${n.toLocaleString()}`;
}
