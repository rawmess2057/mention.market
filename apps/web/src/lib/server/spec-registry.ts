import { PublicKey, type Connection } from "@solana/web3.js";
import { hashResolutionSpec } from "@mention/resolution/contracts";

import mentionIdl from "@/lib/idl/mention.json";

/**
 * Server-side registration of a market's resolution spec.
 *
 * The program commits only the spec's sha256 (in the market's
 * `ResolutionSpecCommitment` PDA). A spec is accepted only if it hashes to
 * that on-chain commitment, so no auth is needed: the one spec that can ever
 * be stored for a market is the one its creator committed to. Mirrors the
 * check in `apps/program/scripts/oracle.mjs::evidenceFor`.
 */

const ZERO_HASH = "0".repeat(64);
const COMMITMENT_DISCRIMINATOR = Buffer.from(
  (mentionIdl as { accounts: Array<{ name: string; discriminator: number[] }> }).accounts.find(
    (a) => a.name === "ResolutionSpecCommitment"
  )!.discriminator
);

export interface SpecStoreLike {
  putSpec(input: { marketAddress: string; spec: unknown }): Promise<{ specSha256: string }>;
}

export interface RegisterDeps {
  /** The committed spec hash (hex) for `market`, or null if the account isn't visible yet. */
  fetchCommitment(market: PublicKey): Promise<string | null>;
  store: SpecStoreLike;
}

export type RegisterResult =
  | { status: 200; body: { ok: true; marketAddress: string; specSha256: string } }
  | { status: 400 | 404 | 409 | 422 | 500; body: { error: string; retryable?: boolean } };

/** Decode `ResolutionSpecCommitment` (8-byte discriminator, market, sha256, bump). */
export function decodeCommitment(
  data: Uint8Array,
  owner: PublicKey,
  programId: PublicKey
): { market: string; specSha256: string } | null {
  if (!owner.equals(programId) || data.length < 8 + 32 + 32) return null;
  if (!Buffer.from(data.subarray(0, 8)).equals(COMMITMENT_DISCRIMINATOR)) return null;
  return {
    market: new PublicKey(data.subarray(8, 40)).toBase58(),
    specSha256: Buffer.from(data.subarray(40, 72)).toString("hex"),
  };
}

/** Production `fetchCommitment`: read and decode the commitment PDA over RPC. */
export function rpcCommitmentFetcher(
  conn: Connection,
  programId: PublicKey,
  commitmentPda: (market: PublicKey) => PublicKey
): RegisterDeps["fetchCommitment"] {
  return async (market) => {
    const info = await conn.getAccountInfo(commitmentPda(market), "confirmed");
    if (!info) return null;
    const decoded = decodeCommitment(info.data, info.owner, programId);
    if (!decoded || decoded.market !== market.toBase58()) return null;
    return decoded.specSha256;
  };
}

export async function registerSpec(body: unknown, deps: RegisterDeps): Promise<RegisterResult> {
  const { marketAddress, spec } = (body ?? {}) as { marketAddress?: unknown; spec?: unknown };
  if (typeof marketAddress !== "string" || !spec || typeof spec !== "object") {
    return { status: 400, body: { error: "marketAddress (string) and spec (object) are required" } };
  }
  let market: PublicKey;
  try {
    market = new PublicKey(marketAddress);
  } catch {
    return { status: 400, body: { error: "marketAddress is not a valid public key" } };
  }

  let specSha256: string;
  try {
    specSha256 = hashResolutionSpec(spec);
  } catch (err) {
    return { status: 400, body: { error: `invalid resolution spec: ${(err as Error).message}` } };
  }

  const committed = await deps.fetchCommitment(market);
  if (committed === null) {
    // Usually the create tx hasn't reached `confirmed` on this RPC yet.
    return { status: 404, body: { error: "no resolution-spec commitment for this market yet", retryable: true } };
  }
  if (committed === ZERO_HASH) {
    return { status: 422, body: { error: "market committed a zero spec hash; it is not resolvable" } };
  }
  if (committed !== specSha256) {
    return {
      status: 422,
      body: { error: `spec hash ${specSha256.slice(0, 12)}… does not match the on-chain commitment ${committed.slice(0, 12)}…` },
    };
  }

  try {
    const record = await deps.store.putSpec({ marketAddress, spec });
    return { status: 200, body: { ok: true, marketAddress, specSha256: record.specSha256 } };
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === "SPEC_CONFLICT") return { status: 409, body: { error: e.message } };
    // Validation errors are the caller's; anything else is storage trouble,
    // whose details (hosts, credentials) must not reach the client.
    if (e instanceof TypeError) return { status: 400, body: { error: e.message } };
    console.error("spec store write failed", e);
    return { status: 500, body: { error: "spec storage is unavailable", retryable: true } };
  }
}
