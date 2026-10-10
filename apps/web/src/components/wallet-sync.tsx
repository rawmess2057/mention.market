"use client";

import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSolBalance } from "@/hooks/useSolBalance";
import { useSim } from "@/lib/sim";

/**
 * Bridges the connected wallet into the per-wallet sim book:
 *  - connect/switch/disconnect -> sim.setWallet(...)
 *  - devnet SOL balance        -> sim.setBalance(...)
 * Renders nothing.
 */
export function WalletSync() {
  const { connected, publicKey } = useWallet();
  const { solBalance } = useSolBalance();
  const setWallet = useSim((s) => s.setWallet);
  const setBalance = useSim((s) => s.setBalance);

  useEffect(() => {
    setWallet(connected && publicKey ? publicKey.toBase58() : null);
  }, [connected, publicKey, setWallet]);

  useEffect(() => {
    if (!connected || !publicKey || solBalance === null) return;
    const wallet = publicKey.toBase58();
    const cur = useSim.getState().books[wallet]?.user;
    if (!cur || cur.balance !== solBalance) {
      setBalance(wallet, solBalance);
    }
  }, [connected, publicKey, solBalance, setBalance]);

  return null;
}
