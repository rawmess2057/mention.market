"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  chainBackWord,
  chainBuyBinary,
  chainChallenge,
  chainClaim,
  chainCreateMarket,
  chainSellBinary,
  isChainId,
  type ChainCreateParams,
  type ChainTradeResult,
} from "@/lib/chain";
import { lmsrSharesForCost, lmsrSellValue, useSim } from "@/lib/sim";
import type { Market } from "@/lib/types";

/**
 * Chain-aware trade helpers. For chain (`c…`) markets these send real
 * devnet SOL transactions through the connected wallet and refresh the
 * wallet's SOL balance in the sim book; for simulated markets they return
 * null so callers fall back to the existing USDC demo-vault flow.
 */
export function useChain() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const setBalance = useSim((s) => s.setBalance);

  const refreshBalance = useCallback(
    async (wallet: string, result: ChainTradeResult) => {
      setBalance(wallet, result.solBalance, "sol");
    },
    [setBalance]
  );

  const buy = useCallback(
    async (
      market: Market,
      side: "yes" | "no",
      amountUi: number
    ): Promise<string | null> => {
      if (!connected || !publicKey || !sendTransaction || !isChainId(market.id)) return null;
      const num = Number(market.id.slice(1));
      const signer = { publicKey, sendTransaction };
      const result = await chainBuyBinary(signer, num, side, amountUi);
      await refreshBalance(publicKey.toBase58(), result);
      return result.sig;
    },
    [connected, publicKey, sendTransaction, refreshBalance]
  );

  const sell = useCallback(
    async (market: Market, side: "yes" | "no", sharesUi: number): Promise<string | null> => {
      if (!connected || !publicKey || !sendTransaction || !isChainId(market.id)) return null;
      const num = Number(market.id.slice(1));
      const signer = { publicKey, sendTransaction };
      const result = await chainSellBinary(signer, num, side, sharesUi);
      await refreshBalance(publicKey.toBase58(), result);
      return result.sig;
    },
    [connected, publicKey, sendTransaction, refreshBalance]
  );

  const back = useCallback(
    async (market: Market, word: string, amountUi: number): Promise<string | null> => {
      if (!connected || !publicKey || !sendTransaction || !isChainId(market.id)) return null;
      const num = Number(market.id.slice(1));
      const signer = { publicKey, sendTransaction };
      const result = await chainBackWord(signer, num, word, amountUi);
      await refreshBalance(publicKey.toBase58(), result);
      return result.sig;
    },
    [connected, publicKey, sendTransaction, refreshBalance]
  );

  const claim = useCallback(
    async (marketId: string): Promise<string | null> => {
      if (!connected || !publicKey || !sendTransaction || !isChainId(marketId)) return null;
      const num = Number(marketId.slice(1));
      const signer = { publicKey, sendTransaction };
      const result = await chainClaim(signer, num);
      await refreshBalance(publicKey.toBase58(), result);
      return result.sig;
    },
    [connected, publicKey, sendTransaction, refreshBalance]
  );

  const challenge = useCallback(
    async (marketId: string): Promise<string | null> => {
      if (!connected || !publicKey || !sendTransaction || !isChainId(marketId)) return null;
      const num = Number(marketId.slice(1));
      const signer = { publicKey, sendTransaction };
      const result = await chainChallenge(signer, num);
      await refreshBalance(publicKey.toBase58(), result);
      return result.sig;
    },
    [connected, publicKey, sendTransaction, refreshBalance]
  );

  const create = useCallback(
    async (params: ChainCreateParams): Promise<number | null> => {
      if (!connected || !publicKey || !sendTransaction) return null;
      const signer = { publicKey, sendTransaction };
      const result = await chainCreateMarket(signer, params);
      await refreshBalance(publicKey.toBase58(), result);
      return result.id;
    },
    [connected, publicKey, sendTransaction, refreshBalance]
  );

  return { connected, buy, sell, back, claim, challenge, create };
}

/** Estimate helpers for chain markets using the current store view. */
export function chainExpectedShares(market: Market, side: "yes" | "no", costUi: number): number {
  return lmsrSharesForCost(market, side, costUi);
}

export function chainExpectedProceeds(market: Market, side: "yes" | "no", sharesUi: number): number {
  return lmsrSellValue(market, side, sharesUi);
}