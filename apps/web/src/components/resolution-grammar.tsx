import { Globe, Scale, Camera, Percent } from "lucide-react";
import { isChainId } from "@/lib/chain";
import { cn } from "@/lib/format";
import type { Market } from "@/lib/types";

/**
 * Scannable "resolution grammar" — the verbatim rule plus the mechanical
 * chips (track, resolver, challenge window, fee) that govern payout.
 * Chain markets fall back to their prose `rules` for the grammar line.
 */
export function ResolutionGrammar({ market }: { market: Market }) {
  const m = market;
  const grammar = m.resolution ?? m.rules;
  const onChain = isChainId(m.id);

  const chips = [
    {
      icon: <Camera className="h-3.5 w-3.5" />,
      label: "Track",
      value: m.source,
    },
    {
      icon: <Scale className="h-3.5 w-3.5" />,
      label: "Resolver",
      value: onChain ? "Program + off-chain oracle, bond-backed" : "Resolver + challenge window",
    },
    {
      icon: <Globe className="h-3.5 w-3.5" />,
      label: "Challenge",
      value: onChain ? "2 minutes to dispute" : "2 minutes to dispute",
    },
    {
      icon: <Percent className="h-3.5 w-3.5" />,
      label: "Payout fee",
      value: `${m.creatorFeeBps / 100}%`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1.5">
        <span
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border font-mono text-[9px] font-bold",
            onChain ? "border-blue/30 bg-blue-light text-blue" : "border-gray-warm bg-cream-dark text-gray-mid"
          )}
          title="The exact condition that pays out"
        >
          i
        </span>
        <p className="text-[13px] leading-relaxed text-text-secondary">{grammar}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span
            key={c.label}
            title={`${c.label}: ${c.value}`}
            className="inline-flex items-center gap-1 rounded-md border border-gray-warm bg-cream/60 px-2 py-1 text-[11px] font-medium text-gray-mid"
          >
            {c.icon}
            <span className="font-semibold">{c.label}:</span> {c.value}
          </span>
        ))}
      </div>
    </div>
  );
}