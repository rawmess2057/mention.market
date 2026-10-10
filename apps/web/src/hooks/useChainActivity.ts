"use client";

import { useEffect } from "react";
import { fetchChainActivity, isChainId, SOL_DECIMALS } from "@/lib/chain";
import { useSim } from "@/lib/sim";
import type { Market } from "@/lib/types";

const POLL_MS = 15_000;

/**
 * Backfill real on-chain trade history for a chain market into
 * `chainActivity`. Refetches when the market's `volume` changes (a trade
 * landed, surfaced by chain-sync) or its nonce is bumped (the viewer just
 * sent a trade), and polls slowly as a catch-all. No-op for sim markets,
 * whose activity is generated locally.
 */
export function useChainActivity(market: Market | undefined): void {
  const ingest = useSim((s) => s.ingestChainActivity);
  const marketId = market?.id;
  const volume = useSim((s) => (marketId ? (s.markets[marketId]?.volume ?? 0) : 0));
  const nonce = useSim((s) =>
    marketId ? (s.chainActivityNonce[marketId] ?? 0) : 0
  );

  useEffect(() => {
    if (!marketId || !isChainId(marketId)) return;
    const numericId = Number(marketId.slice(1));
    if (!Number.isFinite(numericId)) return;

    let cancelled = false;
    const load = async () => {
      const items = await fetchChainActivity(numericId, SOL_DECIMALS);
      if (!cancelled) ingest(marketId, items);
    };

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [marketId, volume, nonce, ingest]);
}