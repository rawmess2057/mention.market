import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { Connection, PublicKey, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import anchorPkg from "@coral-xyz/anchor";

const { AnchorProvider, Program, Wallet, BN } = anchorPkg;

const require = createRequire(import.meta.url);

export const PROGRAM_ID = new PublicKey(
  "E6CW51RhjVAiMKJMjzfUNWDDyetqninZzRSLa4nRdZDV"
);
export const USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
export const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
export const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ATA_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export const RESOLVER_KEY_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "keys",
  "resolver.json"
);

export const CONFIG_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from("config")],
  PROGRAM_ID
)[0];

export function marketPda(id) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(id));
  return PublicKey.findProgramAddressSync([Buffer.from("market"), b], PROGRAM_ID)[0];
}

export function vaultPda(market) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function positionPda(market, owner) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function connection() {
  return new Connection("https://api.devnet.solana.com", "confirmed");
}

/** Pre-instruction to raise the per-tx compute budget above the 200k default. */
export function budget(units = 1_000_000) {
  return [ComputeBudgetProgram.setComputeUnitLimit({ units })];
}

export function loadKeypair(p) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

export function deployKeypair() {
  return loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
}

export function ensureResolverKeypair() {
  if (!fs.existsSync(RESOLVER_KEY_PATH)) {
    const kp = Keypair.generate();
    fs.mkdirSync(path.dirname(RESOLVER_KEY_PATH), { recursive: true });
    fs.writeFileSync(RESOLVER_KEY_PATH, JSON.stringify([...kp.secretKey]));
  }
  return loadKeypair(RESOLVER_KEY_PATH);
}

export function programFor(kp) {
  const provider = new AnchorProvider(connection(), new Wallet(kp), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(require("../target/idl/mention.json"), provider);
}

export const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
export const hexToBytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));

/** u64/i64 arg wrapping — the client's borsh coder requires BN instances. */
export const bn = (x) => new BN(String(x));

/** Decoded anchor enums come back as { variantKey: {} }; return the key. */
export const enumKey = (o) => (o && typeof o === "object" ? Object.keys(o)[0] : String(o));

export async function fetchOrNull(promise) {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function lmsrCost(qYes, qNo, b) {
  const m = Math.max(qYes, qNo);
  return b * (Math.log(Math.exp((qYes - m) / b) + Math.exp((qNo - m) / b)) + m / b);
}

export function lmsrProbYes(qYes, qNo, b) {
  if (!Number.isFinite(b) || b <= 0) return 0.5;
  const m = Math.max(qYes, qNo);
  const eY = Math.exp((qYes - m) / b);
  const eN = Math.exp((qNo - m) / b);
  return eY / (eY + eN);
}

export function lmsrBuyCost(qYes, qNo, b, side, shares) {
  const before = lmsrCost(qYes, qNo, b);
  const after = side === 0 ? lmsrCost(qYes + shares, qNo, b) : lmsrCost(qYes, qNo + shares, b);
  return after - before;
}

export function lmsrSellValue(qYes, qNo, b, side, shares) {
  const before = lmsrCost(qYes, qNo, b);
  const after = side === 0 ? lmsrCost(qYes - shares, qNo, b) : lmsrCost(qYes, qNo - shares, b);
  return before - after;
}

export function sharesForCost(qYes, qNo, b, side, cost) {
  if (cost <= 0) return 0;
  let lo = 0;
  let hi = 1;
  while (lmsrBuyCost(qYes, qNo, b, side, hi) < cost) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (lmsrBuyCost(qYes, qNo, b, side, mid) < cost) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}