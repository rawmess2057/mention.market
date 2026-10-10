"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  fetchChainMarketsAll,
  fetchChainPosition,
  fetchChainPriceSeries,
  isStaleChainMarket,
} from "@/lib/chain";
import { lmsrProbYes } from "@/lib/lmsr";
import { useSim } from "@/lib/sim";
import type { Market } from "@/lib/types";

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

/**
 * Polls every on-chain market (single GPA, so reseeded batches need no id
 * registry changes) and merges the latest state into the sim store, hidden
 * from the "live" bay once they go stale. Also mirrors the connected wallet's
 * on-chain positions, appends a live price point per poll, and backfills the
 * real price history (reconstructed from the market's trades) once per market.
 * Renders nothing.
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
        const points = await fetchChainPriceSeries(Number(marketId.slice(1)));
        if (!alive) return;
        useSim.getState().ingestChainHistory(marketId, points);
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
        const markets = (await fetchChainMarketsAll()).filter((m) => !isStaleChainMarket(m));
        if (!alive) return;
        // Newly-resolved on-chain markets the wallet holds a stake in → notify.
        const prev = useSim.getState().markets;
        const fresh = markets.filter(
          (m) => prev[m.id] && prev[m.id].status !== "resolved" && m.status === "resolved"
        );
        useSim.getState().ingestChainMarkets(markets);

        // Live price imprint: append a point only when the price moved or the
        // last sample has gone stale. A flat on-chain market (the LMSR price is
        // constant between trades) would otherwise add a point every 30s and,
        // once past the merge cap, evict the sparse reconstructed trade history.
        const now = Date.now();
        const { history: histByMarket, ingestChainHistory } = useSim.getState();
        for (const m of markets) {
          const v = marketPrice(m);
          if (v === null) continue;
          const hist = histByMarket[m.id] ?? [];
          const last = hist[hist.length - 1];
          const moved = !last || Math.abs(last.v - v) > 1e-6;
          const stale = !last || now - last.t > LIVE_MAX_GAP_MS;
          if (moved || stale) ingestChainHistory(m.id, [{ t: now, v }]);
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
          useSim.getState().ingestChainPositions(positions);
          const held = new Set(positions.map((p) => p.marketId));
          for (const m of fresh) {
            if (!held.has(m.id)) continue;
            useSim.getState().pushNotification({
              kind: "chain-resolved",
              marketId: m.id,
              marketSlug: m.slug,
              marketTitle: m.title,
              text: `\u201c${m.title}\u201d resolved on-chain ${(m.winningOutcome ?? "—").toUpperCase()} — collect or challenge`,
            });
          }
        }
      } catch (err) {
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