"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { fetchChainMarkets, fetchChainPosition, knownChainIds } from "@/lib/chain";
import { useSim } from "@/lib/sim";

const POLL_MS = 15_000;

/**
 * Polls the known chain markets (curated seeds + session creations) and
 * merges the latest on-chain state into the sim store. Also mirrors the
 * connected wallet's on-chain positions. Renders nothing.
 */
export function ChainSync() {
  const { connected, publicKey } = useWallet();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let alive = true;
    const ingest = async () => {
      try {
        const markets = await fetchChainMarkets(knownChainIds());
        if (!alive) return;
        useSim.getState().ingestChainMarkets(markets);

        if (connected && publicKey) {
          const ids = knownChainIds();
          const positions = (
            await Promise.all(ids.map((id) => fetchChainPosition(id, publicKey)))
          ).filter((p): p is NonNullable<typeof p> => !!p);
          if (!alive) return;
          useSim.getState().ingestChainPositions(positions);
        }
      } catch (err) {
        console.warn("chain sync failed:", err);
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