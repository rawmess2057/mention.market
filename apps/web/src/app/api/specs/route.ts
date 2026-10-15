import { NextResponse } from "next/server";
import path from "node:path";

import { getSpec, putSpec } from "@mention/resolver/store";

import { connection, PROGRAM_ID, resolutionSpecPda } from "@/lib/chain";
import { registerSpec, rpcCommitmentFetcher } from "@/lib/server/spec-registry";

export const runtime = "nodejs";

/**
 * Persistence for market resolution specs.
 *
 * The program commits only `specSha256` on-chain; the resolver needs the exact
 * spec *bytes* to build valid evidence. The create flow POSTs the spec here
 * right after the market is created. A spec is stored only if it hashes to
 * the market's on-chain commitment (see `lib/server/spec-registry.ts`), and the
 * store is insert-only. Storage is Postgres when `DATABASE_URL` is set (Vercel),
 * else the resolver's file store (local dev).
 */

// Without DATABASE_URL the store falls back to files: the route runs with
// cwd = the Next app root (apps/web), so point it at the resolver's data dir.
function ensureResolverDataDir(): void {
  process.env.RESOLVER_DATA_DIR ??= path.resolve(process.cwd(), "../resolver/data");
}

export async function POST(req: Request) {
  ensureResolverDataDir();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = await registerSpec(body, {
    fetchCommitment: rpcCommitmentFetcher(connection(), PROGRAM_ID, resolutionSpecPda),
    store: { putSpec },
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(req: Request) {
  ensureResolverDataDir();

  const marketAddress = new URL(req.url).searchParams.get("marketAddress");
  if (!marketAddress) {
    return NextResponse.json({ error: "marketAddress is required" }, { status: 400 });
  }

  try {
    const record = await getSpec(marketAddress);
    if (!record) return NextResponse.json({ ok: false }, { status: 404 });
    return NextResponse.json(record);
  } catch (err) {
    if (err instanceof TypeError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("spec store read failed", err);
    return NextResponse.json({ error: "spec storage is unavailable" }, { status: 500 });
  }
}
