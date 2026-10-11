import { NextResponse } from "next/server";
import path from "node:path";

import { getSpec, putSpec } from "@mention/resolver/store";

export const runtime = "nodejs";

/**
 * Local persistence for market resolution specs.
 *
 * The program commits only `specSha256` on-chain; the resolver needs the exact
 * spec *bytes* to build valid evidence. This route lets the web app (which
 * builds the spec when creating a market) save it into the resolver's file
 * store (`apps/resolver/data/specs/<marketAddress>.json`) so every UI-created
 * market stays resolvable.
 */

// The route runs with cwd = the Next app root (apps/web); resolve the resolver
// store relative to it. An explicit env override always wins.
function ensureResolverDataDir(): void {
  process.env.RESOLVER_DATA_DIR ??= path.resolve(process.cwd(), "../resolver/data");
}

export async function POST(req: Request) {
  ensureResolverDataDir();

  let body: { marketAddress?: unknown; spec?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { marketAddress, spec } = body ?? {};
  if (typeof marketAddress !== "string" || !spec || typeof spec !== "object") {
    return NextResponse.json(
      { error: "marketAddress (string) and spec (object) are required" },
      { status: 400 }
    );
  }

  try {
    const record = putSpec({ marketAddress, spec });
    return NextResponse.json({ ok: true, marketAddress, specSha256: record.specSha256 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function GET(req: Request) {
  ensureResolverDataDir();

  const marketAddress = new URL(req.url).searchParams.get("marketAddress");
  if (!marketAddress) {
    return NextResponse.json({ error: "marketAddress is required" }, { status: 400 });
  }

  const record = getSpec(marketAddress);
  if (!record) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json(record);
}
