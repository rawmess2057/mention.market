// Creates a fresh, tradable binary market on devnet and trades it, so the web
// UI (and the chain price-history reconstruction) has a real on-chain market
// with buy/sell history to display. Leaves the market OPEN (end ~6h out).

import { createHash } from "node:crypto";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  bn,
  programFor,
  ensureResolverKeypair,
  marketPda,
  vaultPda,
  positionPda,
  CONFIG_PDA,
  sharesForCost,
  lmsrSellValue,
  enumKey,
  budget,
  connection,
} from "./lib.mjs";
import { canonicalJson } from "../../resolution/src/canonical-json.mjs";

const resolver = ensureResolverKeypair();
const program = programFor(resolver);
const conn = connection();

export function resolutionSpecPda(market) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("resolution-spec"), market.toBuffer()],
    program.programId
  )[0];
}

const c = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const sha256Bytes = (b) => c(createHash("sha256").update(b).digest("hex"));

async function findFreeId(start = 7100) {
  for (let id = start; id < start + 100; id++) {
    const exists = await program.account.market.fetch(marketPda(id)).catch(() => null);
    if (!exists) return id;
  }
  throw new Error("no free id");
}

const id = await findFreeId();
const market = marketPda(id);
const specPda = resolutionSpecPda(market);
const title = `Traded fixture ${id}`;
const nowSec = Math.floor(Date.now() / 1000);
const endTimeSec = nowSec + 6 * 3600;
const bUi = 0.2;

const resolutionSpec = {
  schemaVersion: 1,
  marketAddress: market.toBase58(),
  marketType: "binary",
  outcomeOptions: ["yes", "no"],
  terms: [{ phrase: title, outcome: "yes" }],
  source: { provider: "operator-upload", sourceId: "trade-fixture", url: "https://dev.example/fixture" },
  window: { startsAtMs: nowSec * 1000, endsAtMs: endTimeSec * 1000 },
  matching: { mode: "exact_phrase", caseSensitive: false, punctuationSensitive: false, speaker: null },
};
const specHash = sha256Bytes(new TextEncoder().encode(canonicalJson(resolutionSpec)));

console.log(`resolver=${resolver.publicKey.toBase58()} balance=${((await conn.getBalance(resolver.publicKey)) / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
console.log(`creating market ${id} (${market.toBase58()}), b=${bUi} SOL, ends ${new Date(endTimeSec * 1000).toISOString()}`);

const cfg = await program.account.config.fetch(CONFIG_PDA);

await program.methods
  .createMarket(
    bn(id),
    title,
    "phase1-trade-fixture",
    { streams: {} },
    { binary: {} },
    bn(Math.round(bUi * LAMPORTS_PER_SOL)),
    [],
    bn(endTimeSec),
    100,
    Array.from(specHash)
  )
  .accounts({
    creator: resolver.publicKey,
    config: CONFIG_PDA,
    market,
    vault: vaultPda(market),
    resolutionSpec: specPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const trades = [
  { side: 0, cost: 40_000_000 },
  { side: 1, cost: 25_000_000 },
  { side: 0, cost: 15_000_000 },
];

for (const t of trades) {
  const m = await program.account.market.fetch(market);
  const shares = Math.floor(
    sharesForCost(
      Number(m.yesShares),
      Number(m.noShares),
      Number(m.b),
      t.side,
      t.cost
    )
  );
  const minShares = Math.floor(shares * 0.98);
  const sig = await program.methods
    .buyBinary(t.side, bn(t.cost), bn(minShares))
    .accounts({
      trader: resolver.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      position: positionPda(market, resolver.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .preInstructions(budget(1_400_000))
    .rpc();
  console.log(`  buy ${t.side === 0 ? "YES" : "NO"} ${t.cost / LAMPORTS_PER_SOL} SOL -> ${shares} shares: ${sig}`);
}

// Partially sell the YES position so the series shows a down-leg too.
{
  const m = await program.account.market.fetch(market);
  const pos = await program.account.position.fetch(positionPda(market, resolver.publicKey));
  const held = Number(pos.yesShares);
  const sellShares = Math.floor(held / 2);
  if (sellShares > 0) {
    const proceeds = Math.floor(
      lmsrSellValue(Number(m.yesShares), Number(m.noShares), Number(m.b), 0, sellShares)
    );
    const sig = await program.methods
      .sellBinary(0, bn(sellShares), bn(Math.floor(proceeds * 0.98)))
      .accounts({
        trader: resolver.publicKey,
        config: CONFIG_PDA,
        market,
        vault: vaultPda(market),
        position: positionPda(market, resolver.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(budget(1_400_000))
      .rpc();
    console.log(`  sell ${sellShares} YES shares: ${sig}`);
  }
}

const final = await program.account.market.fetch(market);
console.log(
  `done: slug=c${id} status=${enumKey(final.status)} yes=${final.yesShares.toString()} no=${final.noShares.toString()} volume=${(Number(final.volume) / LAMPORTS_PER_SOL).toFixed(3)} SOL traders=${final.traders}`
);
console.log(`open the UI at /market/c${id}`);
console.log(`config feeBps=${cfg.feeBps} paused=${cfg.paused}`);
