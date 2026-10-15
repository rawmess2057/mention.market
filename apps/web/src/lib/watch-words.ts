import type { Market } from "./types";

/**
 * The words a market listens for: a word race's options, or the quoted phrase
 * in a binary market's question (`Will X say "<phrase>"?`).
 */
export function watchWordsFor(m: Pick<Market, "type" | "title" | "words">): string[] {
  if (m.type === "majority") return (m.words ?? []).map((w) => w.word);
  const quoted = m.title.match(QUOTE);
  return quoted ? [quoted[1].trim()] : [];
}

const QUOTE = /["“”']([^"“”']+)["“”']/;

/**
 * A title split around its quoted phrase, so the UI can set the phrase apart:
 * `Will he say "W in the chat"?` → before `Will he say `, phrase `W in the
 * chat`, after `?`. No quote: the whole title is `before`.
 */
export function splitQuote(title: string): { before: string; phrase: string | null; after: string } {
  const m = title.match(QUOTE);
  if (!m || m.index === undefined) return { before: title, phrase: null, after: "" };
  return {
    before: title.slice(0, m.index),
    phrase: m[1].trim(),
    after: title.slice(m.index + m[0].length),
  };
}
