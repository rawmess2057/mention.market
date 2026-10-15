import type { Market } from "./types";

/**
 * The words a market listens for: a word race's options, or the quoted phrase
 * in a binary market's question (`Will X say "<phrase>"?`).
 */
export function watchWordsFor(m: Pick<Market, "type" | "title" | "words">): string[] {
  if (m.type === "majority") return (m.words ?? []).map((w) => w.word);
  const quoted = m.title.match(/["“”']([^"“”']+)["“”']/);
  return quoted ? [quoted[1].trim()] : [];
}
