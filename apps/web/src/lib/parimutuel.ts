/**
 * Pari-mutuel pool math for Majority ("race") markets.
 *
 * Everyone who backs a word puts USDC into that word's pool. When the event
 * ends, the winning word's backers split the entire pot (all pools minus fees)
 * pro-rata to their contribution.
 */

import type { WordPool } from "./types";

export interface BackQuote {
  /** Total pool after backing. */
  poolAfter: number;
  /** Your share of the winning pot, in USDC, if this word wins. */
  payoutIfWin: number;
  /** Total pot across all words after your backing. */
  potAfter: number;
  /** Fraction of the winning word's pool you own after backing. */
  potShare: number;
  /**
   * Worst-case payout if the pot triples before the event ends, assuming
   * (conservatively) every new USDC lands on your own word. Real payouts are
   * never lower than this unless the pool grows on other words.
   */
  minPayoutIfTripled: number;
}

/** Quote for backing `word` with `amount` USDC. */
export function quoteBack(
  words: WordPool[],
  word: string,
  amount: number,
  feeBps = 100 // 1% total rake on the pot at settlement
): BackQuote {
  const pot = words.reduce((s, w) => s + w.pool, 0) + amount;
  const poolAfter = (words.find((w) => w.word === word)?.pool ?? 0) + amount;
  const winningPoolAfter = poolAfter;
  const net = pot * (1 - feeBps / 10_000);
  const potShare = winningPoolAfter > 0 ? amount / winningPoolAfter : 0;

  const potTripled = pot * 3;
  const winTripled = poolAfter + (potTripled - pot); // all new money lands on your word
  const netTripled = potTripled * (1 - feeBps / 10_000);
  const minPayoutIfTripled = winTripled > 0 ? (amount / winTripled) * netTripled : 0;

  return {
    poolAfter,
    potAfter: pot,
    payoutIfWin: winningPoolAfter > 0 ? (amount / winningPoolAfter) * net : 0,
    potShare,
    minPayoutIfTripled,
  };
}

/**
 * Implied odds for a word: fraction of the total pot currently on it.
 * Returns a map word -> probability-ish share (sums to 1 across words with pool).
 */
export function impliedOdds(words: WordPool[]): Record<string, number> {
  const pot = words.reduce((s, w) => s + w.pool, 0);
  const out: Record<string, number> = {};
  for (const w of words) out[w.word] = pot > 0 ? w.pool / pot : 0;
  return out;
}

/** Settle a majority market: payouts per word, pro-rata. */
export function settleMajority(
  words: WordPool[],
  winningWord: string,
  feeBps = 100
): { totalPot: number; netPot: number; yourShare: (backed: number) => number } {
  const totalPot = words.reduce((s, w) => s + w.pool, 0);
  const netPot = totalPot * (1 - feeBps / 10_000);
  const winPool = words.find((w) => w.word === winningWord)?.pool ?? 0;
  return {
    totalPot,
    netPot,
    yourShare: (backed: number) =>
      winPool > 0 ? (backed / winPool) * netPot : 0,
  };
}
