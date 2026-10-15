import { NextResponse } from "next/server";

import { fetchChainMarketsAll } from "@/lib/chain";

export const runtime = "nodejs";

/**
 * Every on-chain market, as the app maps it. First paint for a new visitor:
 * one CDN-cached snapshot shared by everyone, instead of each browser running
 * its own whole-program scan. Live freshness comes from the client's
 * websocket subscription and poll right after.
 */
export async function GET() {
  try {
    const markets = await fetchChainMarketsAll();
    return NextResponse.json(
      { markets, at: Date.now() },
      { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=30" } }
    );
  } catch (err) {
    console.error("markets snapshot failed", err);
    return NextResponse.json({ error: "devnet unavailable" }, { status: 502 });
  }
}
