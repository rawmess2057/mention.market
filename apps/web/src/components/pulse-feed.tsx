"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Radio } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, fmtClock } from "@/lib/format";
import { useSim, WATCH_WORDS } from "@/lib/sim";
import { WaveformAvatar } from "@/components/waveform-avatar";

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

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const filtered = filter
    ? (lines ?? []).filter(
        (l) =>
          l.text.toLowerCase().includes(filter.toLowerCase()) ||
          l.speaker.toLowerCase().includes(filter.toLowerCase())
      )
    : lines ?? [];

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-warm bg-white shadow-card",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-warm px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 animate-pulse-live text-red-brand" />
          <span className="text-xs font-semibold uppercase tracking-wider text-navy">
            Pulse
          </span>
        </div>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-mid">
          <span className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-green" />
          live
        </span>
      </div>

      {/* Search */}
      <div className="border-b border-gray-warm px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-mid" />
          <Input
            placeholder="Filter transcript..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 border-0 bg-cream-dark pl-8 text-xs"
          />
        </div>
      </div>

      {/* Feed */}
      <div ref={scrollRef} className="thin-scroll min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {filtered.slice(-30).map((l, i) => (
          <div
            key={`${l.t}-${i}`}
            className="animate-fade-in flex items-start gap-2 rounded-lg px-2 py-1.5 text-[12px] leading-relaxed transition-colors hover:bg-cream-dark/50"
          >
            <WaveformAvatar speaking={i >= filtered.length - 3} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-blue">{l.speaker}</span>
                <span className="font-mono text-[9px] text-gray-mid">{fmtClock(l.t)}</span>
              </div>
              <p className="mt-0.5 text-navy">
                <Highlight text={l.text} watch={watchWords} fresh={i >= filtered.length - 1} />
              </p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-xs text-gray-mid">
            Waiting for audio…
          </div>
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
