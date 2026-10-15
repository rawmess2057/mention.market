"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  fetchChainMarketsAll,
  fetchChainPosition,
  fetchChainSeries,
  isStaleChainMarket,
} from "@/lib/chain";
import { lmsrProbYes } from "@/lib/lmsr";
import { useStore } from "@/lib/store";
import type { PricePoint } from "@/lib/history";
import type { Market, NotificationItem } from "@/lib/types";
import { isVoided } from "@/lib/settle";

const POLL_MS = 30_000;
const JITTER_MS = 5_000;
/** Max gap between live samples on a flat market before we stamp a heartbeat. */
const LIVE_MAX_GAP_MS = 5 * 60_000;

/** Live probability the chart plots: YES prob (binary) or leader share (race). */
function marketPrice(m: Market): number | null {
  if (m.type === "binary") {
    const p = lmsrProbYes(m.yesShares, m.noShares, m.b);
    return Number.isFinite(p) ? p : null;
  }
  const words = m.words ?? [];
  const pot = words.reduce((s, w) => s + w.pool, 0);
  if (pot <= 0) return null;
  return Math.max(...words.map((w) => w.pool)) / pot;
}

/** Live share per option for a word-race market, or null when nothing is pooled. */
function marketWordShares(m: Market): Record<string, number> | null {
  const words = m.words ?? [];
  const pot = words.reduce((s, w) => s + w.pool, 0);
  if (pot <= 0) return null;
  const out: Record<string, number> = {};
  for (const w of words) out[w.word] = w.pool / pot;
  return out;
}

/**
 * Polls every on-chain market (single GPA, so reseeded batches need no id
 * registry changes) and reconciles the sim store against it — latest state in,
 * closed accounts out — hiding stale markets from the "live" bay. Also mirrors
 * the connected wallet's on-chain positions, appends a live price point per
 * poll, and backfills the real price history (reconstructed from the market's
 * trades) once per market. Renders nothing.
 */
export function ChainSync() {
  const { connected, publicKey } = useWallet();
  const started = useRef(false);
  // marketId -> volume at the last full history backfill (re-fetch on a trade).
  const backfilled = useRef<Map<string, number>>(new Map());
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let alive = true;
    let inspecting = false;

    const backfill = async (marketId: string, volume: number) => {
      if (inFlight.current.has(marketId)) return;
      inFlight.current.add(marketId);
      try {
        const { leader, words } = await fetchChainSeries(Number(marketId.slice(1)));
        if (!alive) return;
        useStore.getState().ingestChainHistory(marketId, leader);
        if (Object.keys(words).length > 0) {
          useStore.getState().ingestWordHistory(marketId, words);
        }
        // Mark even on empty so a history-less market isn't refetched forever.
        backfilled.current.set(marketId, volume);
      } catch {
        // best-effort: leave unmarked so it retries next poll
      } finally {
        inFlight.current.delete(marketId);
      }
    };

    const ingest = async () => {
      if (inspecting) return; // a slow devnet cycle must never stack on the next tick
      inspecting = true;
      try {
        const prev = useStore.getState().markets;
        const allMarkets = await fetchChainMarketsAll();
        if (!alive) return;
        // The GPA is the source of truth for what exists on-chain, so reconcile
        // the store against it: a chain market whose accounts were closed (see
        // `scripts/cleanup.mjs`) drops out instead of lingering on the home page
        // forever. Everything fetched stays in the store — even the stale
        // markets the lists below hide — so detail/claim views still resolve.
        useStore.getState().syncChainMarkets(allMarkets);
        const markets = allMarkets.filter((m) => !isStaleChainMarket(m));
        // Status transitions since the last poll, for markets the wallet holds.
        const moved = (to: Market["status"]) =>
          markets.filter((m) => prev[m.id] && prev[m.id].status !== to && m.status === to);
        const locked = moved("locked");
        const proposed = moved("resolving");
        const fresh = moved("resolved");

        // Live price imprint: append a point only when the price moved or the
        // last sample has gone stale. A flat on-chain market (the LMSR price is
        // constant between trades) would otherwise add a point every 30s and,
        // once past the merge cap, evict the sparse reconstructed trade history.
        const now = Date.now();
        const {
          history: histByMarket,
          wordHistory: wordHistByMarket,
          ingestChainHistory,
          ingestWordHistory,
        } = useStore.getState();
        for (const m of markets) {
          const v = marketPrice(m);
          if (v === null) continue;
          const hist = histByMarket[m.id] ?? [];
          const last = hist[hist.length - 1];
          const moved = !last || Math.abs(last.v - v) > 1e-6;
          const stale = !last || now - last.t > LIVE_MAX_GAP_MS;
          if (moved || stale) ingestChainHistory(m.id, [{ t: now, v }]);
        }

        // Same live imprint, per option, for word-race markets so every line
        // gets a current point (not just the leader).
        for (const m of markets) {
          if (m.type !== "majority") continue;
          const shares = marketWordShares(m);
          if (!shares) continue;
          const wh = wordHistByMarket[m.id] ?? {};
          const appends: Record<string, PricePoint[]> = {};
          for (const [word, v] of Object.entries(shares)) {
            const pts = wh[word] ?? [];
            const last = pts[pts.length - 1];
            const moved = !last || Math.abs(last.v - v) > 1e-6;
            const stale = !last || now - last.t > LIVE_MAX_GAP_MS;
            if (moved || stale) appends[word] = [{ t: now, v }];
          }
          if (Object.keys(appends).length > 0) ingestWordHistory(m.id, appends);
        }

        // Reconstructed history: fetch once per market, refresh when a trade
        // lands (volume changed). Runs for the home cards and detail page alike.
        for (const m of markets) {
          if (backfilled.current.get(m.id) !== m.volume) {
            void backfill(m.id, m.volume);
          }
        }

        if (connected && publicKey) {
          const positions = (
            await Promise.all(
              markets.map((m) => fetchChainPosition(Number(m.slug.slice(1)), publicKey))
            )
          ).filter((p): p is NonNullable<typeof p> => !!p);
          if (!alive) return;
          useStore.getState().ingestChainPositions(positions);
          const held = new Set(positions.map((p) => p.marketId));
          const notify = (m: Market, kind: NotificationItem["kind"], text: string) => {
            if (!held.has(m.id)) return;
            useStore.getState().pushNotification({ kind, marketId: m.id, marketSlug: m.slug, marketTitle: m.title, text });
          };
          for (const m of locked) notify(m, "locked", `“${m.title}” closed for trading — awaiting the transcript`);
          for (const m of proposed) {
            notify(
              m,
              "challenge",
              `“${m.title}”: ${(m.winningOutcome ?? "—").toUpperCase()} proposed — the challenge window is open`
            );
          }
          for (const m of fresh) {
            notify(
              m,
              "chain-resolved",
              isVoided(m)
                ? `“${m.title}” was voided — claim your refund`
                : `“${m.title}” resolved ${(m.winningOutcome ?? "—").toUpperCase()} — claim if you won`
            );
          }
        }
      } catch (err) {
        // Surfaced in the home page empty state: "checking devnet" must not be
        // indistinguishable from "we never reached it".
        useStore.getState().setChainSyncError(true);
        console.warn("chain sync failed:", err);
      } finally {
        inspecting = false;
      }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      await ingest();
      if (!alive) return;
      timer = setTimeout(run, POLL_MS + Math.random() * JITTER_MS);
    };
    run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      started.current = false;
    };
  }, [connected, publicKey]);

  return null;
}