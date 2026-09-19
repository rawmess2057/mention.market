/**
 * Devnet USDC plumbing for the demo.
 *
 * When a wallet is connected, trade actions first move real devnet USDC from
 * the user's wallet into a shared demo vault. There is no on-chain program yet
 * — this mirrors the future Anchor vault CPI, so the transfer is a genuine
 * signed transaction while the simulated store still owns pricing/positions.
 * If the wallet is absent or underfunded, the UI falls back to free-play.
 *
 * Token-account creation is batched INTO the same wallet-signed transaction
 * (we never pass a pubkey where a fee-payer keypair would be needed), so a
 * first-time donor signs a single "create ATA + transfer" tx.
 */

import { Connection, PublicKey, Transaction, TransactionInstruction, clusterApiUrl } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

/** Circle-issued devnet USDC — claim from https://faucet.circle.com/ */
export const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

/** Deterministic demo vault address — not a real key, receives demo USDC. */
const VAULT_SEED = new Uint8Array(32).map((_, i) => (i * 7 + 3) % 256);
export const DEMO_VAULT = new PublicKey(VAULT_SEED);

export const USDC_DECIMALS = 6;

export function devnetConnection(): Connection {
  return new Connection(clusterApiUrl("devnet"), "confirmed");
}

/** Real devnet USDC balance of `owner` (0 when the ATA doesn't exist yet). */
export async function getUsdcBalance(connection: Connection, owner: PublicKey): Promise<number> {
  try {
    const ata = await getAssociatedTokenAddress(DEVNET_USDC_MINT, owner);
    const account = await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID);
    return Number(account.amount) / 10 ** USDC_DECIMALS;
  } catch {
    return 0;
  }
}

/**
 * Returns the owner's USDC ATA plus the instruction to create it if missing.
 * Creation instructions get appended to the trade tx; the wallet signs them.
 */
async function usdcAta(
  connection: Connection,
  owner: PublicKey,
  payer: PublicKey
): Promise<{ address: PublicKey; create: TransactionInstruction[] }> {
  const ata = await getAssociatedTokenAddress(DEVNET_USDC_MINT, owner);
  try {
    await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID);
    return { address: ata, create: [] };
  } catch {
    return {
      address: ata,
      create: [
        createAssociatedTokenAccountInstruction(
          payer,
          ata,
          owner,
          DEVNET_USDC_MINT,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
      ],
    };
  }
}

export interface DemoSigner {
  publicKey: PublicKey;
  sendTransaction: (transaction: Transaction, connection: Connection) => Promise<string>;
}

/**
 * Transfer `amountUi` devnet USDC from the connected wallet into the demo vault.
 * ATA creation (rent paid by the donor) is part of the same transaction.
 * Returns the transaction signature, or throws — callers catch and fall back.
 */
export async function sendDemoUsdcTrade(
  signer: DemoSigner,
  amountUi: number
): Promise<string> {
  if (!(Number.isFinite(amountUi) && amountUi > 0)) {
    throw new Error("amount must be positive");
  }
  const connection = devnetConnection();
  const owner = signer.publicKey;

  const source = await usdcAta(connection, owner, owner);
  const vault = await usdcAta(connection, DEMO_VAULT, owner);

  const amount = BigInt(Math.round(amountUi * 10 ** USDC_DECIMALS));
  const transaction = new Transaction();
  transaction.add(...source.create, ...vault.create);
  transaction.add(
    createTransferInstruction(source.address, vault.address, owner, amount, [], TOKEN_PROGRAM_ID)
  );

  const signature = await signer.sendTransaction(transaction, connection);
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}