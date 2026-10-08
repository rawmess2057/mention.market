"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { fetchChainMarketsAll, fetchChainPosition, isStaleChainMarket, scaleForMarket } from "@/lib/chain";
import { useSim } from "@/lib/sim";

const POLL_MS = 15_000;

/**
 * Polls every on-chain market (single GPA, so reseeded batches need no id
 * registry changes) and merges the latest state into the sim store, hidden
 * from the "live" bay once they go stale. Also mirrors the connected wallet's
 * on-chain positions. Renders nothing.
 */
export function ChainSync() {
  const { connected, publicKey } = useWallet();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let alive = true;
    let inspecting = false;
    const ingest = async () => {
      if (inspecting) return; // a slow devnet cycle must never stack on the next tick
      inspecting = true;
      try {
        const markets = (await fetchChainMarketsAll()).filter((m) => !isStaleChainMarket(m));
        if (!alive) return;
        useSim.getState().ingestChainMarkets(markets);

        if (connected && publicKey) {
          // Reuse the scale already read above rather than re-fetching each
          // market just to learn its asset.
          const scaleById = new Map(markets.map((m) => [m.id, scaleForMarket(m)]));
          const positions = (
            await Promise.all(
              markets.map((m) => fetchChainPosition(Number(m.slug.slice(1)), publicKey, scaleById.get(m.id)))
            )
          ).filter((p): p is NonNullable<typeof p> => !!p);
          if (!alive) return;
          useSim.getState().ingestChainPositions(positions);
        }
      } catch (err) {
        console.warn("chain sync failed:", err);
      } finally {
        inspecting = false;
      }
    };

    ingest();
    const id = setInterval(ingest, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
      started.current = false;
    };
  }, [connected, publicKey]);

  return null;
}