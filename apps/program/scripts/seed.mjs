import { bn, budget, enumKey, programFor, deployKeypair, loadKeypair, marketPda, vaultPda, CONFIG_PDA, SYSTEM_PROGRAM } from "./lib.mjs";
import { SEEDS, demoBatch } from "./seed-config.mjs";

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
const block = Number(process.env.SEED_BLOCK || 0);
const targets = [...SEEDS.filter((s) => s.id <= 8), ...demoBatch(block)];

for (const s of targets) {
  const market = marketPda(s.id);
  const exists = await program.account.market.fetch(market).catch(() => null);
  if (exists) {
    console.log(`m${s.id} already exists: "${exists.title}" (idempotent, skipping)`);
    continue;
  }
  const endTime = now + s.endMin * 60;
  const tx = await program.methods
    .createMarket(
      bn(s.id),
      s.title,
      s.event,
      { [((V[s.vertical] ?? "Streams").toLowerCase())]: {} },
      { [s.type === "majority" ? "majority" : "binary"]: {} },
      { sol: {} },
      bn(s.b),
      s.words,
      bn(endTime),
      100
    )
    .accounts({
      creator: kp.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      systemProgram: SYSTEM_PROGRAM,
    })
    .preInstructions(budget())
    .rpc();
  console.log(`m${s.id} "${s.title}" created (ends in ${s.endMin}m): ${tx}`);
}

console.log("\nDone. Full market list:");
for (const s of targets) {
  const m = await program.account.market.fetch(marketPda(s.id)).catch(() => null);
  if (!m) continue;
  console.log(
    `  m${s.id} ${enumKey(m.status)} ${enumKey(m.asset)} ${enumKey(m.marketType)} volume=${m.volume} words=${m.words.length}`
  );
}