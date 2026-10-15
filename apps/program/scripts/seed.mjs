import {
  bn,
  budget,
  enumKey,
  programFor,
  deployKeypair,
  loadKeypair,
  marketPda,
  vaultPda,
  resolutionSpecPda,
  hexToBytes,
  CONFIG_PDA,
  SYSTEM_PROGRAM,
} from "./lib.mjs";
import {
  SEEDS,
  demoBatch,
  binaryPhrase,
  seedKeywords,
  seedProvider,
  seedSourceUrl,
} from "./seed-config.mjs";
import { buildResolutionSpec } from "../../resolution/src/spec-builder.mjs";
import { hashResolutionSpec } from "../../resolution/src/contracts.mjs";
import { putSpec } from "../../resolver/src/store/spec-store.mjs";

const V = { streams: "Streams", sports: "Sports", earnings: "Earnings", politics: "Politics", podcasts: "Podcasts" };

// The seeding wallet pays each market's reserve ante + rent out of its own
// balance, so `SEED_KEYPAIR_PATH` lets you fund fresh markets from whichever
// devnet wallet actually holds SOL (defaults to the CLI deploy keypair).
const kp = process.env.SEED_KEYPAIR_PATH ? loadKeypair(process.env.SEED_KEYPAIR_PATH) : deployKeypair();
const program = programFor(kp);
const now = Math.floor(Date.now() / 1000);

// Block 0 = canonical ids 1–8 (evergreen) + demo 9–16. Re-seeding later (say
// after the first batch expired) is `SEED_BLOCK=1` → demo at 25–32, and the
// app picks the new batch up automatically via on-chain discovery.
//
// `SEED_ONLY=2` seeds just those ids; `SEED_END_SECONDS=5` overrides the end
// offset (useful for a fast end-to-end resolution demo).
const block = Number(process.env.SEED_BLOCK || 0);
const only = process.env.SEED_ONLY
  ? process.env.SEED_ONLY.split(",").map((id) => Number(id.trim())).filter(Number.isFinite)
  : null;
const endOverrideSec = process.env.SEED_END_SECONDS ? Number(process.env.SEED_END_SECONDS) : null;
let targets = [...SEEDS.filter((s) => s.id <= 8), ...demoBatch(block)];
if (only) targets = targets.filter((s) => only.includes(s.id));
if (targets.length === 0) {
  console.error(`SEED_ONLY=${process.env.SEED_ONLY} matched no seeds`);
  process.exit(1);
}

for (const s of targets) {
  const market = marketPda(s.id);
  const exists = await program.account.market.fetch(market).catch(() => null);
  if (exists) {
    console.log(`m${s.id} already exists: "${exists.title}" (idempotent, skipping)`);
    continue;
  }
  const endTime = now + (endOverrideSec ?? s.endMin * 60);
  const spec = buildResolutionSpec({
    marketAddress: market.toBase58(),
    marketType: s.type,
    words: s.words,
    binaryPhrase: binaryPhrase(s),
    sourceUrl: seedSourceUrl(s),
    provider: seedProvider(s),
    window: { startsAtMs: now * 1000, endsAtMs: endTime * 1000 },
  });
  const specHex = hashResolutionSpec(spec);
  const tx = await program.methods
    .createMarket(
      bn(s.id),
      s.title,
      s.event,
      { [((V[s.vertical] ?? "Streams").toLowerCase())]: {} },
      { [s.type === "majority" ? "majority" : "binary"]: {} },
      bn(s.b),
      s.words,
      bn(endTime),
      100,
      Array.from(hexToBytes(specHex))
    )
    .accounts({
      creator: kp.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      resolutionSpec: resolutionSpecPda(market),
      systemProgram: SYSTEM_PROGRAM,
    })
    .preInstructions(budget())
    .rpc();
  await putSpec({
    marketAddress: market.toBase58(),
    spec,
    ingest: { adapter: "operator-upload", mode: "manual", keywords: seedKeywords(s), speaker: null },
  });
  console.log(`m${s.id} "${s.title}" created (ends in ${s.endMin}m, spec ${specHex.slice(0, 12)}…): ${tx}`);
}

console.log("\nDone. Full market list:");
for (const s of targets) {
  const m = await program.account.market.fetch(marketPda(s.id)).catch(() => null);
  if (!m) continue;
  console.log(
    `  m${s.id} ${enumKey(m.status)} ${enumKey(m.marketType)} volume=${m.volume} words=${m.words.length}`
  );
}
