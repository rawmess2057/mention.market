"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { devnetConnection, getUsdcBalance, sendDemoUsdcTrade } from "@/lib/usdc";

export type BalanceKind = "usdc" | "sol";

/**
 * Connects the wallet to real devnet balances. Exposes `usdcBalance` (devnet
 * USDC) and `solBalance` (devnet SOL), plus `walletBuy`, which signs a devnet
 * USDC transfer into the demo vault before the simulated trade executes.
 *
 * The sim wallet book uses USDC when the wallet holds any (the vault settles in
 * USDC); otherwise it falls back to SOL so a fresh wallet still has funds.
 */
export function useDevnetUsdc() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    if (!connected || !publicKey) {
      setUsdcBalance(null);
      setSolBalance(null);
      return;
    }
    try {
      const conn = devnetConnection();
      const [usdc, sol] = await Promise.all([
        getUsdcBalance(conn, publicKey),
        conn.getBalance(publicKey),
      ]);
      setUsdcBalance(usdc);
      setSolBalance(sol / 1e9);
    } catch {
      setUsdcBalance(null);
      setSolBalance(null);
    }
  }, [connected, publicKey]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setUsdcBalance(null);
      setSolBalance(null);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const conn = devnetConnection();
        const [usdc, sol] = await Promise.all([
          getUsdcBalance(conn, publicKey),
          conn.getBalance(publicKey),
        ]);
        if (!alive) return;
        setUsdcBalance(usdc);
        setSolBalance(sol / 1e9);
      } catch {
        if (!alive) return;
        setUsdcBalance(null);
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
        read();
      }
    },
    [connected, publicKey, sendTransaction, usdcBalance, read]
  );

  return { usdcBalance, solBalance, busy, walletBuy, refresh: read };
}