import { ExternalLink, ScrollText } from "lucide-react";
import { ResolutionGrammar } from "@/components/resolution-grammar";
import { EvidenceSection } from "@/components/evidence-viewer";
import { cn } from "@/lib/format";
import type { Market } from "@/lib/types";

/**
 * "How this resolves", promoted out of the Rules tab and onto the market page.
 *
 * Every source we studied converges here: the resolution criteria is the most
 * important content on a market page and the one thing users must trust before
 * money moves, so it belongs above the fold — not behind a tab, and not in a
 * footer.
 */
export function TrustPanel({ market, className }: { market: Market; className?: string }) {
  const m = market;
  return (
    <div className={cn("space-y-3", className)}>
      <div className="panel p-4">
        <div className="mb-2 flex items-center gap-2">
          <ScrollText className="h-3.5 w-3.5 text-blue" aria-hidden />
          <span className="label-caps text-navy">How this resolves</span>
          {m.sourceUrl && (
            <a
              href={m.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-0.5 text-micro font-medium text-blue hover:underline"
            >
              primary source <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
        <ResolutionGrammar market={m} />
      </div>
      <EvidenceSection market={m} />
    </div>
  );
}
