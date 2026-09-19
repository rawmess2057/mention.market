"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { devnetConnection, getUsdcBalance, sendDemoUsdcTrade } from "@/lib/usdc";

/**
 * Connects the wallet to a real devnet USDC balance and exposes `walletBuy`,
 * which signs a devnet USDC transfer into the demo vault before the simulated
 * trade executes. Returns null when the wallet is absent or underfunded — the
 * caller then stays in free-play mode.
 */
export function useDevnetUsdc() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!connected || !publicKey) {
      setUsdcBalance(null);
      return;
    }
    try {
      const balance = await getUsdcBalance(devnetConnection(), publicKey);
      setUsdcBalance(balance);
    } catch {
      setUsdcBalance(null);
    }
  }, [connected, publicKey]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setUsdcBalance(null);
      return;
    }
    let alive = true;
    const read = async () => {
      const balance = await getUsdcBalance(devnetConnection(), publicKey);
      if (alive) setUsdcBalance(balance);
    };
    read();
    const id = setInterval(read, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [connected, publicKey]);

  const walletBuy = useCallback(
    async (amountUi: number): Promise<string | null> => {
      if (!connected || !publicKey || !sendTransaction) return null;
      if (usdcBalance === null || usdcBalance < amountUi) return null;
      setBusy(true);
      try {
        return await sendDemoUsdcTrade(
          {
            publicKey,
            sendTransaction: (tx, conn) => sendTransaction(tx, conn),
          },
          amountUi
        );
      } catch (err) {
        console.warn("devnet USDC transfer skipped — falling back to free-play:", err);
        return null;
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [connected, publicKey, sendTransaction, usdcBalance, refresh]
  );

  return { usdcBalance, busy, walletBuy, refresh };
}