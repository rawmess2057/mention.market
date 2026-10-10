"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { fetchChainMarketsAll, fetchChainPosition, isStaleChainMarket } from "@/lib/chain";
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
        // Newly-resolved on-chain markets the wallet holds a stake in → notify.
        const prev = useSim.getState().markets;
        const fresh = markets.filter(
          (m) => prev[m.id] && prev[m.id].status !== "resolved" && m.status === "resolved"
        );
        useSim.getState().ingestChainMarkets(markets);

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