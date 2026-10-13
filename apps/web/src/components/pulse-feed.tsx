"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Radio, Search } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn, fmtClock } from "@/lib/format";
import { useSim } from "@/lib/sim";
import { WaveformAvatar } from "@/components/waveform-avatar";

/**
 * The live transcript — this product's oracle, so it gets a first-class panel.
 *
 * Two behaviours worth calling out, both from the field research on live data:
 * the feed stops auto-scrolling the moment someone scrolls up (nothing is more
 * hostile than a feed that yanks itself away), and watched words carry a hit
 * scoreboard so the transcript reads as a scoreboard rather than a log.
 */
export function PulseFeed({
  slug,
  watchWords,
  className,
}: {
  slug: string;
  watchWords: string[];
  className?: string;
}) {
  const lines = useSim((s) => s.transcript[slug]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const [stick, setStick] = useState(true);

  const all = useMemo(() => lines ?? [], [lines]);

  const hits = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of watchWords) counts.set(w, 0);
    if (all.length === 0) return counts;
    const needles = [...counts.keys()].filter(Boolean).map((w) => w.toLowerCase());
    if (needles.length === 0) return counts;
    for (const line of all) {
      const text = line.text.toLowerCase();
      for (const w of counts.keys()) {
        if (w && text.includes(w.toLowerCase())) counts.set(w, (counts.get(w) ?? 0) + 1);
      }
    }
    return counts;
  }, [all, watchWords]);

  const filtered = useMemo(
    () =>
      filter
        ? all.filter(
            (l) =>
              l.text.toLowerCase().includes(filter.toLowerCase()) ||
              l.speaker.toLowerCase().includes(filter.toLowerCase())
          )
        : all,
    [all, filter]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [filtered, stick]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 64);
  };

  const jumpToLive = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStick(true);
  };

  return (
    <div className={cn("panel flex min-h-0 flex-col overflow-hidden", className)}>
      <div className="flex items-center gap-2 border-b border-ink-200 px-4 py-3">
        <Radio className="live-dot text-no" aria-hidden />
        <span className="label-caps text-navy">Live transcript</span>
        <span className="tnum ml-auto text-micro text-gray-mid">
          {all.length} lines
        </span>
      </div>

      {watchWords.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-ink-100 px-3 py-2">
          {watchWords.slice(0, 6).map((w) => {
            const n = hits.get(w) ?? 0;
            return (
              <span
                key={w}
                title={`“${w}” said ${n} ${n === 1 ? "time" : "times"}`}
                className={cn(
                  "tnum inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-micro font-semibold",
                  n > 0
                    ? "border-yes-line bg-yes-soft text-yes"
                    : "border-ink-200 bg-white text-ink-400"
                )}
              >
                {w}
                <span className="opacity-70">{n}×</span>
              </span>
            );
          })}
        </div>
      )}

      <div className="border-b border-ink-100 px-3 py-2">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-mid"
            aria-hidden
          />
          <Input
            placeholder="Find a moment…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter transcript"
            className="h-8 border-0 bg-ink-100 pl-8 text-label"
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="thin-scroll h-full min-h-0 space-y-0.5 overflow-y-auto p-2.5"
        >
          {filtered.slice(-40).map((l, i) => (
            <div
              key={`${l.t}-${i}`}
              className="animate-fade-in flex items-start gap-2 rounded-tile px-2 py-1.5 text-label leading-relaxed transition-colors hover:bg-ink-50"
            >
              <WaveformAvatar speaking={i >= filtered.length - 3} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-micro font-semibold text-blue">{l.speaker}</span>
                  <span className="tnum font-mono text-[10px] text-gray-mid">
                    {fmtClock(l.t)}
                  </span>
                </div>
                <p className="mt-0.5 text-navy">
                  <Highlight text={l.text} watch={watchWords} fresh={i >= filtered.length - 1} />
                </p>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <EmptyState
              className="rounded-none border-0"
              title={all.length === 0 ? "Waiting for audio…" : "No matching lines"}
              body={
                all.length === 0
                  ? "The transcript lands here the moment the stream is indexed."
                  : "Try a different word or speaker."
              }
            />
          )}
        </div>

        {!stick && (
          <button
            type="button"
            onClick={jumpToLive}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-pill border border-ink-200 bg-white px-3 py-1.5 text-micro font-semibold text-navy shadow-dropdown transition-colors hover:bg-ink-50"
          >
            <ArrowDown className="h-3 w-3" aria-hidden />
            Jump to live
          </button>
        )}
      </div>
    </div>
  );
}

function Highlight({ text, watch, fresh }: { text: string; watch: string[]; fresh: boolean }) {
  if (watch.length === 0) return <span>{text}</span>;

  const escaped = watch.map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);

  return (
    <span>
      {parts.map((part, i) =>
        re.test(part) && watch.some((w) => w.trim().toLowerCase() === part.toLowerCase()) ? (
          <span key={i} className={cn("word-hit", fresh && "word-hit-live")}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}
