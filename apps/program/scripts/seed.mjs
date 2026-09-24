import { bn, budget, enumKey, programFor, deployKeypair, marketPda, vaultPda, CONFIG_PDA, SYSTEM_PROGRAM } from "./lib.mjs";
import { SEEDS } from "./seed-config.mjs";

const V = { streams: "Streams", sports: "Sports", earnings: "Earnings", politics: "Politics", podcasts: "Podcasts" };

const kp = deployKeypair();
const program = programFor(kp);
const now = Math.floor(Date.now() / 1000);

for (const s of SEEDS) {
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
for (const s of SEEDS) {
  const m = await program.account.market.fetch(marketPda(s.id)).catch(() => null);
  if (!m) continue;
  console.log(
    `  m${s.id} ${enumKey(m.status)} ${enumKey(m.asset)} ${enumKey(m.marketType)} volume=${m.volume} words=${m.words.length}`
  );
}