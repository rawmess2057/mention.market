import { cn } from "@/lib/format";
import { splitQuote } from "@/lib/watch-words";

/**
 * A market title in the display serif, with the quoted phrase (the thing the
 * market listens for) set in italic on a highlighter stroke. One component so
 * the card, the market page and the portfolio all read the same way.
 */
export function QuoteTitle({
  title,
  as: Tag = "h3",
  className,
}: {
  title: string;
  as?: "h1" | "h2" | "h3" | "span";
  className?: string;
}) {
  const { before, phrase, after } = splitQuote(title);
  return (
    <Tag className={cn("font-display tracking-[-0.01em] text-fg", className)}>
      {before}
      {phrase !== null && <span className="quote-hit">“{phrase}”</span>}
      {after}
    </Tag>
  );
}
