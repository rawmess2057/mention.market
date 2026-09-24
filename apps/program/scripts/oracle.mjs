import fs from "node:fs";
import { programFor, ensureResolverKeypair, marketPda, vaultPda, CONFIG_PDA, SYSTEM_PROGRAM, TOKEN_PROGRAM, ATA_PROGRAM, USDC_MINT, sha256Hex, hexToBytes, fetchOrNull , budget } from "./lib.mjs";
import { SEEDS } from "./seed-config.mjs";

const SCRIPTED_OUTCOMES = {};
for (const s of SEEDS) SCRIPTED_OUTCOMES[s.id] = s.outcome;

const MODE = process.argv.includes("--watch") || process.env.MODE === "watch" ? "watch" : "once";
const DRY = process.argv.includes("--dry") || process.env.DRY === "1";
const POLL_MS = Number(process.env.POLL_MS || 20_000);

const resolver = ensureResolverKeypair();
const program = programFor(resolver);

const status = await fetchOrNull(program.account.config.fetch(CONFIG_PDA));
if (!status) {
  console.error("Config not found on devnet — run scripts/bootstrap.mjs first.");
  process.exit(1);
}
if (!status.resolver.equals(resolver.publicKey)) {
  console.error(
    `Resolver mismatch: config.resolver=${status.resolver.toBase58()} but this key is ${resolver.publicKey.toBase58()}`
  );
  process.exit(1);
}

const ids = process.argv.includes("--all")
  ? SEEDS.map((s) => s.id)
  : (process.env.IDS || "").split(",").map((x) => Number(x.trim())).filter(Boolean);

const confidence = Number(process.env.CONFIDENCE || 100);

const enumVal = (o) => Object.keys(o)[0];

function outcomeFor(m) {
  if (SCRIPTED_OUTCOMES[m.id.toString()]) return SCRIPTED_OUTCOMES[m.id.toString()];
  if (enumVal(m.marketType) === "majority" && m.words.length) return m.words[0].word;
  return "yes";
}

async function lockMarket(market, pk) {
  const tx = await program.methods
    .lockMarket()
    .accounts({ signer: pk.publicKey, market })
    .preInstructions(budget())
    .rpc();
  console.log(`  ${new Date().toISOString()} locked ${pk.publicKey.toBase58()}: ${tx}`);
}

async function proposeResolution(market, pk, outcome) {
  const evidence = JSON.stringify({
    marketId: market.toBase58(),
    outcome,
    confidence,
    source: "mention-oracle/1",
    note: "Scripted demo outcome from seed configuration.",
    proposedAt: Math.floor(Date.now() / 1000),
  });
  const evidenceHash = hexToBytes(sha256Hex(evidence));
  const tx = await program.methods
    .proposeResolution(outcome, confidence, evidenceHash)
    .accounts({
      resolver: pk.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      resolverAta: null,
      vaultAta: null,
      mint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM,
      associatedTokenProgram: ATA_PROGRAM,
      systemProgram: SYSTEM_PROGRAM,
    })
    .preInstructions(budget())
    .rpc();
  console.log(`  ${new Date().toISOString()} proposed "${outcome}" (hs ${sha256Hex(evidence).slice(0, 12)}…): ${tx}`);
}

async function finalizeResolution(market, pk, proposer) {
  const tx = await program.methods
    .finalizeResolution()
    .accounts({
      finalizer: pk.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      proposerAccount: proposer,
      proposerAta: null,
      vaultAta: null,
      mint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM,
      associatedTokenProgram: ATA_PROGRAM,
      systemProgram: SYSTEM_PROGRAM,
    })
    .preInstructions(budget())
    .rpc();
  console.log(`  ${new Date().toISOString()} finalized: ${tx}`);
}

async function tick() {
  const now = Math.floor(Date.now() / 1000);
  for (const id of ids) {
    const pk = marketPda(id);
    const m = await program.account.market.fetch(pk).catch(() => null);
    if (!m) {
      console.log(`  m${id}: not found`);
      continue;
    }
    const st = enumVal(m.status);
    if (st === "open" && now >= Number(m.endTime)) {
      if (DRY) console.log(`  m${id} open+ended -> would lock`);
      else await lockMarket(pk, resolver);
    } else if (st === "locked") {
      const outcome = outcomeFor(m);
      if (DRY) console.log(`  m${id} locked -> would propose "${outcome}"`);
      else await proposeResolution(pk, resolver, outcome);
    } else if (st === "resolving" && now > Number(m.challengeDeadline)) {
      if (DRY) console.log(`  m${id} window elapsed -> would finalize`);
      else await finalizeResolution(pk, resolver, resolver.publicKey);
    } else {
      console.log(`  m${id}: ${st} (end ${Number(m.endTime)}, deadline ${Number(m.challengeDeadline)})`);
    }
  }
}

if (ids.length === 0) {
  console.error("No market ids. Pass --all or IDS=1,2,3");
  process.exit(1);
}

console.log(`oracle: mode=${MODE} dry=${DRY} ids=[${ids.join(", ")}] resolver=${resolver.publicKey.toBase58()}`);

if (MODE === "watch") {
  await tick();
  setInterval(tick, POLL_MS);
  console.log(`watching every ${POLL_MS}ms…`);
} else {
  await tick();
  fs.writeFileSync(new URL("../target/claimed-oracle-once.marker", import.meta.url), Date.now().toString());
  process.exit(0);
}