import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { buildResolutionSpec } from "@mention/resolution/spec-builder";
import { hashResolutionSpec } from "@mention/resolution/contracts";

import mentionIdl from "../idl/mention.json";
import { PROGRAM_ID, registerMarketSpec } from "../chain";
import { decodeCommitment, registerSpec, type RegisterDeps } from "../server/spec-registry";

const market = Keypair.generate().publicKey;
const spec = buildResolutionSpec({
  marketAddress: market.toBase58(),
  marketType: "binary",
  binaryPhrase: "AI",
  sourceUrl: "https://example.com/live",
  window: { startsAtMs: 1000, endsAtMs: 2000 },
});
const specSha256 = hashResolutionSpec(spec);

function deps(committed: string | null, putSpec?: RegisterDeps["store"]["putSpec"]): RegisterDeps {
  return {
    fetchCommitment: async () => committed,
    store: { putSpec: putSpec ?? (async () => ({ specSha256 })) },
  };
}

describe("registerSpec", () => {
  it("stores a spec that matches the on-chain commitment", async () => {
    const putSpec = vi.fn(async () => ({ specSha256 }));
    const res = await registerSpec({ marketAddress: market.toBase58(), spec }, deps(specSha256, putSpec));
    expect(res.status).toBe(200);
    expect(putSpec).toHaveBeenCalledOnce();
  });

  it("refuses a spec that doesn't match, without touching the store", async () => {
    const putSpec = vi.fn();
    const res = await registerSpec({ marketAddress: market.toBase58(), spec }, deps("ab".repeat(32), putSpec));
    expect(res.status).toBe(422);
    expect(putSpec).not.toHaveBeenCalled();
  });

  it("reports a missing commitment as retryable", async () => {
    const res = await registerSpec({ marketAddress: market.toBase58(), spec }, deps(null));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ retryable: true });
  });

  it("refuses markets that committed a zero hash", async () => {
    const res = await registerSpec({ marketAddress: market.toBase58(), spec }, deps("0".repeat(64)));
    expect(res.status).toBe(422);
  });

  it("rejects malformed bodies and specs", async () => {
    expect((await registerSpec({ spec }, deps(specSha256))).status).toBe(400);
    expect((await registerSpec({ marketAddress: "nope", spec }, deps(specSha256))).status).toBe(400);
    expect((await registerSpec({ marketAddress: market.toBase58(), spec: { bogus: 1 } }, deps(specSha256))).status).toBe(400);
  });

  it("maps a store conflict to 409", async () => {
    const conflict = Object.assign(new Error("a different spec is already stored"), { code: "SPEC_CONFLICT" });
    const res = await registerSpec(
      { marketAddress: market.toBase58(), spec },
      deps(specSha256, async () => {
        throw conflict;
      })
    );
    expect(res.status).toBe(409);
  });
});

describe("decodeCommitment", () => {
  const discriminator = (mentionIdl as { accounts: Array<{ name: string; discriminator: number[] }> }).accounts.find(
    (a) => a.name === "ResolutionSpecCommitment"
  )!.discriminator;
  const data = Buffer.concat([Buffer.from(discriminator), market.toBuffer(), Buffer.from(specSha256, "hex"), Buffer.from([254])]);

  it("reads market and hash from a program-owned commitment", () => {
    expect(decodeCommitment(data, PROGRAM_ID, PROGRAM_ID)).toEqual({ market: market.toBase58(), specSha256 });
  });

  it("rejects foreign owners and other account types", () => {
    expect(decodeCommitment(data, new PublicKey("11111111111111111111111111111111"), PROGRAM_ID)).toBeNull();
    const wrongType = Buffer.from(data);
    wrongType[0] ^= 0xff;
    expect(decodeCommitment(wrongType, PROGRAM_ID, PROGRAM_ID)).toBeNull();
  });
});

describe("registerMarketSpec (client)", () => {
  const response = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response;

  it("retries while the commitment isn't visible, then succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(200));
    expect(await registerMarketSpec("m", spec, { baseMs: 0, fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up immediately on a real rejection", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(422));
    expect(await registerMarketSpec("m", spec, { baseMs: 0, fetchImpl })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reports failure after exhausting retries", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await registerMarketSpec("m", spec, { attempts: 3, baseMs: 0, fetchImpl })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
