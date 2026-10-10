"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { connection, SOL_DECIMALS } from "@/lib/chain";

/**
 * Connects the wallet to its real devnet SOL balance. Polls every 10s so the
 * header/sim book stay fresh while a trade settles. Returns `null` while
 * disconnected or before the first successful read.
 */
export function useSolBalance() {
  const { connected, publicKey } = useWallet();
  const [solBalance, setSolBalance] = useState<number | null>(null);

  const read = useCallback(async () => {
    if (!connected || !publicKey) {
      setSolBalance(null);
      return;
    }
    try {
      setSolBalance((await connection().getBalance(publicKey)) / SOL_DECIMALS);
    } catch {
      setSolBalance(null);
    }
  }, [connected, publicKey]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setSolBalance(null);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const lamports = await connection().getBalance(publicKey);
        if (!alive) return;
        setSolBalance(lamports / SOL_DECIMALS);
      } catch {
        if (!alive) return;
        setSolBalance(null);
      }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [connected, publicKey]);

  return { solBalance, refresh: read };
}
