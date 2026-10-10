// Phase 1 evidence-flow E2E against devnet, using the trusted resolver wallet.
// Creates a fresh binary market with a real resolution spec, waits for its end,
// locks it, posts an evidence manifest, proposes (bound to spec + evidence),
// waits out the challenge window, and finalizes. Reads everything back on-chain.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  bn,
  programFor,
  ensureResolverKeypair,
  marketPda,
  vaultPda,
  CONFIG_PDA,
  enumKey,
  budget,
  connection,
} from "./lib.mjs";
import { canonicalJson } from "../../resolution/src/canonical-json.mjs";

const SLEEP_MS = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const sha256Bytes = (bytes) => c(createHash("sha256").update(bytes).digest("hex"));

export function resolutionSpecPda(market) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("resolution-spec"), market.toBuffer()],
    programFor(ensureResolverKeypair()).programId
  )[0];
}

export function evidencePda(market, sha256) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("evidence"), market.toBuffer(), Buffer.from(sha256)],
    programFor(ensureResolverKeypair()).programId
  )[0];
}

async function findFreeMarketId(program, start = 7000) {
  for (let id = start; id < start + 100; id++) {
    const exists = await program.account.market.fetch(marketPda(id)).catch(() => null);
    if (!exists) return id;
  }
  throw new Error("no free market id found");
}

async function airdropIfLow(kp, minLamports) {
  const conn = connection();
  const bal = await conn.getBalance(kp.publicKey);
  console.log(`resolver balance: ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  if (bal < minLamports) {
    try {
      const sig = await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
      console.log(`airdrop: ${sig}`);
      await sleep(8_000);
    } catch (e) {
      console.log(`airdrop failed (continuing): ${e.message}`);
    }
  }
  return conn.getBalance(kp.publicKey);
}

const resolver = ensureResolverKeypair();
const program = programFor(resolver);
const programId = program.programId;
console.log(`program=${programId.toBase58()} resolver=${resolver.publicKey.toBase58()}`);
console.log(`config=${CONFIG_PDA.toBase58()}`);

const configCheck = await program.account.config.fetch(CONFIG_PDA).catch((e) => {
  console.error("config fetch failed:", e);
  process.exit(1);
});
console.log(
  `config: resolver=${configCheck.resolver.toBase58()} feeBps=${configCheck.feeBps / 100} paused=${configCheck.paused}`
);

if (!configCheck.resolver.equals(resolver.publicKey)) {
  console.error("resolver mismatch");
  process.exit(1);
}

await airdropIfLow(resolver, 1.5 * LAMPORTS_PER_SOL);

const id = await findFreeMarketId(program);
const market = marketPda(id);
const title = `Evidence-E2E ${id}`;
const nowSec = Math.floor(Date.now() / 1000);
const endTimeSec = nowSec + 45;
const bUi = 0.1;
const outcomes = ["yes", "no"];
const resolutionSpec = {
  schemaVersion: 1,
  marketAddress: market.toBase58(),
  marketType: "binary",
  outcomeOptions: outcomes,
  terms: [{ phrase: title, outcome: "yes" }],
  source: { provider: "operator-upload", sourceId: "evidence-e2e", url: "https://dev.example/e2e" },
  window: { startsAtMs: nowSec * 1000, endsAtMs: endTimeSec * 1000 },
  matching: {
    mode: "exact_phrase",
    caseSensitive: false,
    punctuationSensitive: false,
    speaker: null,
  },
};
const specBytes = new TextEncoder().encode(canonicalJson(resolutionSpec));
const specHash = sha256Bytes(specBytes);
console.log(`spec hash: ${Buffer.from(specHash).toString("hex").slice(0, 16)}…`);

const resolutionSpecPk = resolutionSpecPda(market);
console.log(`creating market ${id}: ${market.toBase58()}`);

const createTx = await program.methods
  .createMarket(
    bn(id),
    title,
    "phase1-hardening-e2e",
    { streams: {} },
    { binary: {} },
    bn(bUi * LAMPORTS_PER_SOL),
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
    resolutionSpec: resolutionSpecPk,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
console.log(`created: ${createTx}`);

const created = await program.account.market.fetch(market);
const specCommit = await program.account.resolutionSpecCommitment.fetch(resolutionSpecPk);
console.log(
  `market: id=${created.id} status=${enumKey(created.status)} specStored=${Buffer.from(specCommit.specSha256).toString("hex").slice(0, 16)}…`
);
if (!Buffer.from(specCommit.specSha256).equals(Buffer.from(specHash))) {
  console.error("resolution spec hash mismatch after create");
  process.exit(1);
}

while (Math.floor(Date.now() / 1000) < Number(created.endTime)) {
  console.log(`waiting for end time (${new Date(Number(created.endTime) * 1000).toISOString()})…`);
  await sleep(SLEEP_MS);
}

const lockTx = await program.methods
  .lockMarket()
  .accounts({ signer: resolver.publicKey, market })
  .rpc();
console.log(`locked: ${lockTx}`);

const evidenceBytes = Buffer.from(
  canonicalJson({
    marketId: market.toBase58(),
    marketTitle: title,
    outcome: "yes",
    confidence: 100,
    source: "evidence-e2e/1",
    specSha256: Buffer.from(specHash).toString("hex"),
    note: "On-chain Phase 1 evidence-binding E2E.",
    proposedAt: Math.floor(Date.now() / 1000),
  })
);
const evidenceSha = sha256Bytes(evidenceBytes);
console.log(`evidence: ${evidenceBytes.length} bytes, sha ${Buffer.from(evidenceSha).toString("hex").slice(0, 16)}…`);

const evidencePk = evidencePda(market, evidenceSha);
const postTx = await program.methods
  .postEvidence(evidenceBytes, Array.from(evidenceSha), Array.from(specHash))
  .accounts({
    resolver: resolver.publicKey,
    config: CONFIG_PDA,
    market,
    evidence: evidencePk,
    systemProgram: SystemProgram.programId,
  })
  .preInstructions(budget())
  .rpc();
console.log(`evidence posted: ${postTx}`);

const manifest = await program.account.evidenceManifest.fetch(evidencePk);
console.log(
  `manifest: market=${manifest.market.toBase58()} specMatch=${Buffer.from(manifest.specSha256).equals(Buffer.from(specHash))} shaStored=${Buffer.from(manifest.sha256).toString("hex").slice(0, 16)}… bytes=${manifest.bytes.length}`
);
if (!manifest.market.equals(market) || !Buffer.from(manifest.specSha256).equals(Buffer.from(specHash))) {
  console.error("evidence manifest mismatch");
  process.exit(1);
}
if (!Buffer.from(manifest.sha256).equals(Buffer.from(evidenceSha))) {
  console.error("evidence manifest sha mismatch");
  process.exit(1);
}

const proposeTx = await program.methods
  .proposeResolution("yes", 100, Array.from(evidenceSha))
  .accounts({
    resolver: resolver.publicKey,
    config: CONFIG_PDA,
    market,
    vault: vaultPda(market),
    resolutionSpec: resolutionSpecPk,
    evidence: evidencePk,
    systemProgram: SystemProgram.programId,
  })
  .preInstructions(budget())
  .rpc();
console.log(`proposed: ${proposeTx}`);

const pending = await program.account.market.fetch(market);
console.log(
  `pending: status=${enumKey(pending.status)} outcome=${pending.winningOutcome} bond=${pending.bond} deadline=${new Date(Number(pending.challengeDeadline) * 1000).toISOString()} evidenceHash=${Buffer.from(pending.evidenceHash).toString("hex").slice(0, 16)}…`
);
if (enumKey(pending.status) !== "resolving" || pending.winningOutcome !== "yes") {
  console.error("propose did not leave market resolving with outcome yes");
  process.exit(1);
}
if (!Buffer.from(pending.evidenceHash).equals(Buffer.from(evidenceSha))) {
  console.error("market evidence_hash mismatch");
  process.exit(1);
}

while (Math.floor(Date.now() / 1000) <= Number(pending.challengeDeadline)) {
  console.log("waiting out challenge window…");
  await sleep(10_000);
}

const finalizeTx = await program.methods
  .finalizeResolution()
  .accounts({
    finalizer: resolver.publicKey,
    config: CONFIG_PDA,
    market,
    vault: vaultPda(market),
    proposerAccount: resolver.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
console.log(`finalized: ${finalizeTx}`);

const done = await program.account.market.fetch(market);
console.log(
  `resolved: status=${enumKey(done.status)} outcome=${done.winningOutcome} resolvedAt=${done.resolvedAt} bond=${done.bond}`
);
if (enumKey(done.status) !== "resolved" || done.bond > 0) {
  console.error("market did not resolve cleanly");
  process.exit(1);
}

const finalBal = await connection().getBalance(resolver.publicKey);
console.log(`resolver final balance: ${(finalBal / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
console.log("E2E PASSED");
fs.writeFileSync(new URL("../target/evidence-e2e.marker", import.meta.url), JSON.stringify({ id, market: market.toBase58(), ts: Date.now() }));