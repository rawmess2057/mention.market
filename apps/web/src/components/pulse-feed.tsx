"use client";

import { AudioLines, FileCheck2, Radio } from "lucide-react";

import { cn } from "@/lib/format";
import type { Market } from "@/lib/types";

/**
 * The transcript panel. Markets resolve from a recording transcribed after the
 * event (recordings first; live capture comes later), so before resolution
 * this says what is being listened for, and after a proposal it shows the
 * quote the decision rests on — the evidence committed on-chain.
 */
export function PulseFeed({
  market: m,
  watchWords,
  className,
}: {
  market: Market;
  watchWords: string[];
  className?: string;
}) {
  const snippets = m.evidence?.snippets ?? [];
  const decided = m.status === "resolving" || m.status === "resolved";

  return (
    <section className={cn("panel flex flex-col overflow-hidden", className)}>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        {decided ? (
          <FileCheck2 className="h-3.5 w-3.5 text-yes" aria-hidden />
        ) : (
          <Radio className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
        )}
        <span className="label-caps text-fg">Transcript</span>
        <span className="ml-auto text-micro text-fg-subtle">
          {decided ? "evidence on-chain" : m.status === "locked" ? "transcribing" : "after the event"}
        </span>
      </header>

      <div className="flex-1 space-y-4 p-4">
        {watchWords.length > 0 && (
          <div>
            <div className="text-xs text-fg-subtle">Listening for</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {watchWords.map((w) => (
                <span key={w} className="rounded-md border border-accent/25 bg-accent-soft px-2 py-1 text-xs font-medium text-fg">
                  “{w}”
                </span>
              ))}
            </div>
          </div>
        )}

        {snippets.length > 0 ? (
          <ul className="space-y-3">
            {snippets.map((s, i) => (
              <li key={i} className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2 text-micro text-fg-subtle">
                  <span className="tnum font-mono">{new Date(s.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                  <span>·</span>
                  <span>Speaker {s.speaker}</span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-fg">
                  <Highlight text={s.text} watch={watchWords} />
                </p>
              </li>
            ))}
          </ul>
        ) : decided ? (
          <p className="text-sm leading-relaxed text-fg-muted">
            Resolved by operator review, without a transcript quote (for example a voided market or a source that
            couldn&apos;t be transcribed).
          </p>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-dashed border-line p-4">
            <AudioLines className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
            <p className="text-sm leading-relaxed text-fg-muted">
              {m.status === "locked"
                ? "The event has ended. The recording is being transcribed; the quote that decides this market will appear here."
                : "When the event ends, the recording is transcribed and checked for these words. The deciding quote appears here and is committed on-chain."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Highlight({ text, watch }: { text: string; watch: string[] }) {
  const needles = watch.filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (needles.length === 0) return <>{text}</>;
  const parts = text.split(new RegExp(`(${needles.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="word-hit">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
