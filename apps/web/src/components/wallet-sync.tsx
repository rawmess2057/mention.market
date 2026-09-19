"use client";

import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useDevnetUsdc } from "@/hooks/useDevnetUsdc";
import { useSim } from "@/lib/sim";

/**
 * Bridges the connected wallet into the per-wallet sim book:
 *  - connect/switch/disconnect  -> sim.setWallet(...)
 *  - devnet USDC (or SOL fallback) -> sim.setBalance(...)
 * Renders nothing.
 */
export function WalletSync() {
  const { connected, publicKey } = useWallet();
  const { usdcBalance, solBalance } = useDevnetUsdc();
  const setWallet = useSim((s) => s.setWallet);
  const setBalance = useSim((s) => s.setBalance);

  useEffect(() => {
    setWallet(connected && publicKey ? publicKey.toBase58() : null);
  }, [connected, publicKey, setWallet]);

  useEffect(() => {
    if (!connected || !publicKey) return;
    const usdcOk = usdcBalance !== null && usdcBalance > 0;
    const solOk = usdcBalance !== null && usdcBalance <= 0 && solBalance !== null;
    if (!usdcOk && !solOk) return; // balance pin still resolving (or connection failed)
    const kind: "usdc" | "sol" = usdcOk ? "usdc" : "sol";
    const amount = kind === "usdc" ? (usdcBalance ?? 0) : (solBalance ?? 0);
    const wallet = publicKey.toBase58();
    const cur = useSim.getState().books[wallet]?.user;
    if (!cur || cur.balance !== amount || cur.balanceKind !== kind) {
      setBalance(wallet, amount, kind);
    }
  }, [connected, publicKey, usdcBalance, solBalance, setBalance]);

  return null;
}