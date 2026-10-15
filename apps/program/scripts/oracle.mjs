// Demo oracle: drives scripted markets through lock → post_evidence → propose
// → (120s challenge window) → finalize.
//
// Outcomes come from the seed config, but every proposal is bound to a real
// evidence manifest (an operator override built by the resolver pipeline)
// against the market's committed resolution spec — the program rejects
// proposals without one. Markets with no stored spec (or a zero spec hash)
// are skipped, not failed.
//
//   node scripts/oracle.mjs --watch --all     # SEED_BLOCK selects the demo batch
//   IDS=9,10 node scripts/oracle.mjs --dry
//   VOID_IDS=10 node scripts/oracle.mjs --watch --all   # void market 10 (refund everyone)

import fs from "node:fs";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  programFor,
  ensureResolverKeypair,
  marketPda,
  vaultPda,
  resolutionSpecPda,
  evidencePda,
  settlementAccounts,
  CONFIG_PDA,
  SYSTEM_PROGRAM,
  hexToBytes,
  fetchOrNull,
  budget,
  enumKey,
} from "./lib.mjs";
import { SEEDS, demoBatch } from "./seed-config.mjs";
import { getSpec } from "../../resolver/src/store/spec-store.mjs";
import { buildOverrideCandidate } from "../../resolver/src/pipeline.mjs";
import { hashResolutionSpec } from "../../resolution/src/contracts.mjs";

// Scripted outcomes cover the canonical batch and (if seeding re-ran with
// SEED_BLOCK) the active shifted demo batch, e.g. ids 25–32 for SEED_BLOCK=1.
const SEED_BLOCK = Number(process.env.SEED_BLOCK || 0);
const SCRIPTED_OUTCOMES = {};
for (const s of [...SEEDS, ...demoBatch(SEED_BLOCK)]) SCRIPTED_OUTCOMES[s.id] = s.outcome;

const MODE = process.argv.includes("--watch") || process.env.MODE === "watch" ? "watch" : "once";
const DRY = process.argv.includes("--dry") || process.env.DRY === "1";
const POLL_MS = Number(process.env.POLL_MS || 20_000);
const MAX_EVIDENCE_LEN = 4096;
/** Propose bond (1 SOL, `constants.rs`) plus headroom for evidence rent and fees. */
const MIN_PROPOSE_LAMPORTS = 1.05 * LAMPORTS_PER_SOL;
const ZERO_HASH = "0".repeat(64);
/** Markets to resolve as `void` instead of their scripted outcome. */
const VOID_IDS = new Set((process.env.VOID_IDS || "").split(",").map((x) => Number(x.trim())).filter(Boolean));

const resolver = ensureResolverKeypair();
const program = programFor(resolver);
const conn = program.provider.connection;

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
  ? [...SEEDS.filter((s) => s.id <= 8), ...demoBatch(SEED_BLOCK)].map((s) => s.id)
  : (process.env.IDS || "").split(",").map((x) => Number(x.trim())).filter(Boolean);

const ts = () => new Date().toISOString();

function outcomeFor(m) {
  if (VOID_IDS.has(m.id.toNumber())) return "void";
  if (SCRIPTED_OUTCOMES[m.id.toString()]) return SCRIPTED_OUTCOMES[m.id.toString()];
  if (enumKey(m.marketType) === "majority" && m.words.length) return m.words[0].word;
  return "yes";
}

/**
 * Build the evidence for a scripted outcome, or explain why the market can't
 * be resolved. Timestamps are pinned to the market's end time so a retry (a
 * failed propose, or a re-propose after a challenge) rebuilds identical bytes
 * and therefore reuses the same evidence PDA instead of colliding with it.
 */
async function evidenceFor(pk, m, outcome) {
  const commitment = await fetchOrNull(program.account.resolutionSpecCommitment.fetch(resolutionSpecPda(pk)));
  const onChainHex = commitment ? Buffer.from(commitment.specSha256).toString("hex") : ZERO_HASH;
  if (onChainHex === ZERO_HASH) return { skip: "zero resolution spec (legacy market, unresolvable)" };

  const record = getSpec(pk.toBase58());
  if (!record) return { skip: "no stored resolution spec in apps/resolver/data/specs" };
  const specHex = hashResolutionSpec(record.spec);
  if (specHex !== onChainHex) {
    return { skip: `stored spec ${specHex.slice(0, 12)}… does not match on-chain ${onChainHex.slice(0, 12)}…` };
  }

  const pinnedMs = Number(m.endTime) * 1000;
  const candidate = buildOverrideCandidate({
    spec: record.spec,
    outcome,
    review: {
      reviewer: "mention-oracle",
      approvedAt: pinnedMs,
      rationale:
        outcome === "void"
          ? "Operator voided the market (VOID_IDS): every position is refunded."
          : "Scripted demo outcome from seed configuration.",
    },
    capturedAt: pinnedMs,
    createdAt: pinnedMs,
  });
  const { bytes, sha256 } = candidate.evidence;
  if (bytes.length > MAX_EVIDENCE_LEN) return { skip: `evidence is ${bytes.length} bytes (max ${MAX_EVIDENCE_LEN})` };
  return { bytes, sha256: hexToBytes(sha256), sha256Hex: sha256, specSha256: hexToBytes(specHex) };
}

async function lockMarket(market) {
  const tx = await program.methods
    .lockMarket()
    .accounts({ signer: resolver.publicKey, market })
    .preInstructions(budget())
    .rpc();
  console.log(`  ${ts()} locked: ${tx}`);
}

async function proposeResolution(market, outcome, ev) {
  const balance = await conn.getBalance(resolver.publicKey);
  if (balance < MIN_PROPOSE_LAMPORTS) {
    throw new Error(
      `resolver ${resolver.publicKey.toBase58()} has ${balance / LAMPORTS_PER_SOL} SOL; needs ≥ ${MIN_PROPOSE_LAMPORTS / LAMPORTS_PER_SOL} SOL for the bond`
    );
  }

  const evidence = evidencePda(market, ev.sha256);
  if (await conn.getAccountInfo(evidence)) {
    console.log(`  ${ts()} evidence ${ev.sha256Hex.slice(0, 12)}… already posted, reusing`);
  } else {
    const tx = await program.methods
      .postEvidence(Buffer.from(ev.bytes), Array.from(ev.sha256), Array.from(ev.specSha256))
      .accounts({
        resolver: resolver.publicKey,
        config: CONFIG_PDA,
        market,
        evidence,
        systemProgram: SYSTEM_PROGRAM,
      })
      .preInstructions(budget())
      .rpc();
    console.log(`  ${ts()} posted evidence (${ev.bytes.length} bytes, ${ev.sha256Hex.slice(0, 12)}…): ${tx}`);
  }

  const { open, ...settle } = await settlementAccounts(program, market);
  if (open) {
    const verdict = open.challengedOutcome === outcome ? "rejected" : "upheld";
    console.log(`  ${ts()} settling challenge on "${open.challengedOutcome}" by ${open.challenger.toBase58()}: ${verdict}`);
  }
  const tx = await program.methods
    .proposeResolution(outcome, 100, Array.from(ev.sha256))
    .accounts({
      resolver: resolver.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      resolutionSpec: resolutionSpecPda(market),
      evidence,
      ...settle,
      systemProgram: SYSTEM_PROGRAM,
    })
    .preInstructions(budget())
    .rpc();
  console.log(`  ${ts()} proposed "${outcome}": ${tx}`);
}

async function finalizeResolution(market, proposer) {
  const tx = await program.methods
    .finalizeResolution()
    .accounts({
      finalizer: resolver.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      proposerAccount: proposer,
      systemProgram: SYSTEM_PROGRAM,
    })
    .preInstructions(budget())
    .rpc();
  console.log(`  ${ts()} finalized: ${tx}`);
}

async function step(id) {
  const now = Math.floor(Date.now() / 1000);
  const pk = marketPda(id);
  const m = await fetchOrNull(program.account.market.fetch(pk));
  if (!m) {
    console.log(`  m${id}: not found`);
    return;
  }
  const st = enumKey(m.status);
  if (st === "open" && now >= Number(m.endTime)) {
    if (DRY) console.log(`  m${id} open+ended -> would lock`);
    else await lockMarket(pk);
  } else if (st === "locked") {
    const outcome = outcomeFor(m);
    const ev = await evidenceFor(pk, m, outcome);
    if (ev.skip) console.log(`  m${id} locked, skipping: ${ev.skip}`);
    else if (DRY) console.log(`  m${id} locked -> would post evidence ${ev.sha256Hex.slice(0, 12)}… and propose "${outcome}"`);
    else await proposeResolution(pk, outcome, ev);
  } else if (st === "resolving" && now > Number(m.challengeDeadline)) {
    if (DRY) console.log(`  m${id} window elapsed -> would finalize`);
    else await finalizeResolution(pk, m.proposer);
  } else {
    console.log(`  m${id}: ${st} (end ${Number(m.endTime)}, deadline ${Number(m.challengeDeadline)})`);
  }
}

/** One pass over every market; a failure on one market never stops the rest. */
async function tick() {
  for (const id of ids) {
    try {
      await step(id);
    } catch (err) {
      console.error(`  m${id}: ${err?.message ?? err}`);
      if (err?.logs) console.error(`    ${err.logs.slice(-3).join("\n    ")}`);
    }
  }
}

if (ids.length === 0) {
  console.error("No market ids. Pass --all or IDS=1,2,3");
  process.exit(1);
}

console.log(`oracle: mode=${MODE} dry=${DRY} ids=[${ids.join(", ")}] resolver=${resolver.publicKey.toBase58()}`);

if (MODE === "watch") {
  console.log(`watching every ${POLL_MS}ms…`);
  // Sequential loop rather than setInterval: a slow RPC pass never overlaps the
  // next one (which could double-submit the same lock or proposal).
  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
} else {
  await tick();
  fs.writeFileSync(new URL("../target/claimed-oracle-once.marker", import.meta.url), Date.now().toString());
  process.exit(0);
}
