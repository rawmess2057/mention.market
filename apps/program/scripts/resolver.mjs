// Trusted resolver CLI: lock → post_evidence → propose → finalize.
//
// Runs under `node` (apps/program is outside the pnpm workspace, so it imports
// the pipeline from apps/resolver with relative paths). The resolver key is
// `scripts/keys/resolver.json` — it must equal `config.resolver` on-chain and
// hold enough SOL for tx fees plus the 1 SOL propose bond.
//
//   node resolver.mjs status   <market>
//   node resolver.mjs lock     <market>
//
// `<market>` is a market id (`12` or `c12`) or a base58 market address.

import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";

import {
  budget,
  CONFIG_PDA,
  enumKey,
  ensureResolverKeypair,
  evidencePda,
  hexToBytes,
  marketPda,
  programFor,
  resolutionSpecPda,
  sha256BytesHex,
  SYSTEM_PROGRAM,
  vaultPda,
} from "./lib.mjs";
import { candidatesDir, getSpec, listSpecs } from "../../resolver/src/store/spec-store.mjs";
import {
  buildCandidate,
  buildOverrideCandidate,
  decodeCandidate,
  encodeCandidate,
} from "../../resolver/src/pipeline.mjs";
import { evaluateTranscript } from "../../resolution/src/contracts.mjs";
import { DeepgramBatchAdapter } from "../../resolver/src/adapters/deepgram.mjs";
import { transcriptsDir } from "../../resolver/src/store/spec-store.mjs";

const MAX_EVIDENCE_LEN = 4096;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const resolver = ensureResolverKeypair();
  const program = programFor(resolver);

  switch (command) {
    case "status":
      return status(program, requireArg(positional[0], "market"));
    case "lock":
      return lock(program, resolver, requireArg(positional[0], "market"));
    case "resolve":
      return resolve(program, resolver, requireArg(positional[0], "market"), flags);
    case "post":
      return post(program, resolver, requireArg(positional[0], "candidate file"), flags);
    case "finalize":
      return finalize(program, resolver, requireArg(positional[0], "market"));
    case "watch":
      return watch(program, resolver, flags);
    default:
      printUsage();
      process.exitCode = command ? 1 : 0;
  }
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

async function status(program, marketArg) {
  const address = marketAddress(marketArg);
  const market = await fetchMarket(program, address);
  const spec = await fetchSpec(program, address);
  const record = getSpec(address.toBase58());
  const specHex = Buffer.from(spec.specSha256).toString("hex");

  console.log(`market      ${address.toBase58()}`);
  console.log(`title       "${market.title}" (${market.event})`);
  console.log(`status      ${enumKey(market.status)}  type=${enumKey(market.marketType)}`);
  console.log(`end_time    ${new Date(market.endTime.toNumber() * 1000).toISOString()}`);
  if (enumKey(market.marketType) === "majority") {
    console.log(`board       ${market.words.map((w) => w.word).join(", ")}`);
  }
  console.log(`spec hash   ${specHex}${specHex === "0".repeat(64) ? "  (zero — unresolvable)" : ""}`);
  console.log(`spec stored ${record ? "yes" : "no"}`);
  if (enumKey(market.status) !== "open") {
    console.log(`outcome     ${market.winningOutcome || "—"} (conf ${market.confidence})`);
    console.log(`deadline    ${new Date(market.challengeDeadline.toNumber() * 1000).toISOString()}`);
  }
}

async function lock(program, resolver, marketArg) {
  const address = marketAddress(marketArg);
  const market = await fetchMarket(program, address);
  const statusKey = enumKey(market.status);
  if (statusKey !== "open") {
    console.log(`already ${statusKey}, nothing to lock`);
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  if (now < market.endTime.toNumber()) {
    throw new Error(`market has not ended (ends ${new Date(market.endTime.toNumber() * 1000).toISOString()})`);
  }
  const sig = await program.methods
    .lockMarket()
    .accounts({ signer: resolver.publicKey, market: address })
    .preInstructions(budget())
    .rpc();
  console.log(`m${market.id} locked: ${sig}`);
}

async function resolve(program, resolver, marketArg, flags) {
  const address = marketAddress(marketArg);
  const market = await fetchMarket(program, address);
  const record = getSpec(address.toBase58());
  if (!record) {
    throw new Error(`no stored resolution spec for ${address.toBase58()} — run the seed script or create the market from the UI`);
  }
  const spec = record.spec;

  const force = flags.force;
  const reviewer = flags.reviewer;
  const rationale = flags.rationale;
  const approve = Boolean(flags.approve);

  if (approve && (typeof reviewer !== "string" || typeof rationale !== "string")) {
    throw new Error("--approve requires --reviewer <name> and --rationale <text>");
  }

  let summary;
  let candidate = null;
  if (force) {
    summary = { status: "override", outcome: force, matches: [], confidence: 100, warnings: ["operator override"] };
  } else {
    let transcript;
    if (flags.audio) {
      const adapter = new DeepgramBatchAdapter({});
      const res = await adapter.transcribeFile(flags.audio);
      transcript = { segments: res.segments, coverage: res.coverage };
      const out = path.join(transcriptsDir(), `${address.toBase58()}.${Date.now()}.json`);
      fs.mkdirSync(transcriptsDir(), { recursive: true });
      fs.writeFileSync(out, `${JSON.stringify(transcript, null, 2)}\n`);
      console.log(`transcribed  ${out} (${transcript.segments.length} segments)`);
    } else if (flags.audioUrl || flags["audio-url"]) {
      const adapter = new DeepgramBatchAdapter({});
      const res = await adapter.transcribeUrl(flags.audioUrl || flags["audio-url"]);
      transcript = { segments: res.segments, coverage: res.coverage };
      const out = path.join(transcriptsDir(), `${address.toBase58()}.${Date.now()}.json`);
      fs.mkdirSync(transcriptsDir(), { recursive: true });
      fs.writeFileSync(out, `${JSON.stringify(transcript, null, 2)}\n`);
      console.log(`transcribed  ${out} (${transcript.segments.length} segments)`);
    } else {
      const transcriptFile = requireArg(flags.transcript, "--transcript <file>");
      transcript = JSON.parse(fs.readFileSync(transcriptFile, "utf8"));
    }
    const result = evaluateTranscript(spec, transcript.segments, transcript.coverage);
    summary = {
      status: result.status,
      outcome: result.outcome,
      matches: result.matches,
      confidence: result.status === "candidate" ? 100 : 0,
      warnings: result.status === "candidate" ? [] : [result.status],
    };
    if (approve) {
      candidate = buildCandidate({ spec, transcript, review: { reviewer, approvedAt: Date.now(), rationale } });
    }
  }

  console.log(`market     m${market.id} ${address.toBase58()}`);
  console.log(`evaluator  ${summary.status} → outcome=${summary.outcome ?? "—"} (${summary.matches.length} matches)`);
  for (const warning of summary.warnings) console.log(`  ! ${warning}`);

  if (force && approve) {
    candidate = buildOverrideCandidate({ spec, outcome: force, review: { reviewer, approvedAt: Date.now(), rationale } });
  }

  const stagePath = path.join(candidatesDir(), `${address.toBase58()}.stage.json`);
  fs.mkdirSync(candidatesDir(), { recursive: true });
  fs.writeFileSync(stagePath, `${JSON.stringify({ marketAddress: address.toBase58(), ...summary }, null, 2)}\n`);
  console.log(`staged     ${stagePath}`);

  if (!approve) {
    console.log("not approved — re-run with --approve --reviewer <name> --rationale <text> to post");
    return;
  }
  if (!candidate?.evidence) {
    throw new Error(`cannot approve: evaluator status is "${summary.status}" (use --force <outcome> to override)`);
  }

  const encoded = encodeCandidate({ spec, candidate });
  const candidatePath = path.join(candidatesDir(), `${address.toBase58()}.json`);
  fs.writeFileSync(candidatePath, `${JSON.stringify(encoded, null, 2)}\n`);
  console.log(`candidate  ${candidatePath}`);

  if (flags.dry) {
    console.log("dry run — candidate written, nothing submitted");
    return;
  }
  await submit(program, resolver, market, encoded, flags);
}

async function post(program, resolver, candidateFile, flags) {
  const encoded = JSON.parse(fs.readFileSync(candidateFile, "utf8"));
  const address = new PublicKey(encoded.marketAddress);
  const market = await fetchMarket(program, address);
  if (flags.dry) {
    const decoded = decodeCandidate(encoded);
    console.log(`dry run — ${decoded.evidence.length} bytes, sha256=${decoded.evidence.sha256}`);
    return;
  }
  await submit(program, resolver, market, encoded, flags);
}

async function submit(program, resolver, market, encoded, flags = {}) {
  const decoded = decodeCandidate(encoded);
  const markets = market.address;
  const bytes = decoded.evidence.bytes;

  if (bytes.length === 0) throw new Error("evidence is empty");
  if (bytes.length > MAX_EVIDENCE_LEN) throw new Error(`evidence is ${bytes.length} bytes (max ${MAX_EVIDENCE_LEN})`);
  const recomputed = sha256BytesHex(bytes);
  if (recomputed !== decoded.evidence.sha256) {
    throw new Error(`candidate evidence hash mismatch (file ${decoded.evidence.sha256}, bytes ${recomputed})`);
  }

  const spec = await fetchSpec(program, markets);
  const specHex = Buffer.from(spec.specSha256).toString("hex");
  if (specHex !== decoded.specSha256) {
    throw new Error(`spec hash mismatch: on-chain ${specHex}, candidate ${decoded.specSha256}`);
  }
  if (specHex === "0".repeat(64)) throw new Error("market has a zero resolution spec and cannot be resolved");

  // Lock first if the market is still open (requires end_time passed).
  if (enumKey(market.status) === "open") {
    await lock(program, resolver, markets.toBase58());
    market = await fetchMarket(program, markets);
  }
  if (enumKey(market.status) !== "locked") {
    throw new Error(`market must be Locked to post evidence (status ${enumKey(market.status)})`);
  }

  const sha256 = new Uint8Array(Buffer.from(decoded.evidence.sha256, "hex"));
  const specSha256 = hexToBytes(decoded.specSha256);
  const evidence = evidencePda(markets, sha256);

  console.log(`posting evidence  ${bytes.length} bytes sha256=${decoded.evidence.sha256}`);
  const postSig = await program.methods
    .postEvidence(Buffer.from(bytes), Array.from(sha256), Array.from(specSha256))
    .accounts({
      resolver: resolver.publicKey,
      config: CONFIG_PDA,
      market: markets,
      evidence,
      systemProgram: SYSTEM_PROGRAM,
    })
    .preInstructions(budget())
    .rpc();
  console.log(`  post_evidence: ${postSig}`);

  console.log(`proposing outcome "${decoded.outcome}" confidence ${decoded.confidence}`);
  const proposeSig = await program.methods
    .proposeResolution(decoded.outcome, decoded.confidence, Array.from(sha256))
    .accounts({
      resolver: resolver.publicKey,
      config: CONFIG_PDA,
      market: markets,
      vault: vaultPda(markets),
      resolutionSpec: resolutionSpecPda(markets),
      evidence,
      systemProgram: SYSTEM_PROGRAM,
    })
    .preInstructions(budget())
    .rpc();
  console.log(`  propose_resolution: ${proposeSig}`);
  console.log("proposal open — finalize after the 120s challenge window (or after a challenge + re-propose)");
}

async function finalize(program, resolver, marketArg) {
  const address = marketAddress(marketArg);
  const market = await fetchMarket(program, address);
  const sig = await program.methods
    .finalizeResolution()
    .accounts({
      finalizer: resolver.publicKey,
      config: CONFIG_PDA,
      market: address,
      vault: vaultPda(address),
      proposerAccount: market.proposer,
      systemProgram: SYSTEM_PROGRAM,
    })
    .preInstructions(budget())
    .rpc();
  console.log(`m${market.id} finalized: ${sig}`);
}

async function watch(program, resolver, flags) {
  const interval = Number(flags.interval || 20) * 1000;
  console.log(`watching ${listSpecs().length} stored markets (every ${interval / 1000}s); locks ended markets`);
  for (;;) {
    for (const record of listSpecs()) {
      try {
        const address = new PublicKey(record.marketAddress);
        const market = await fetchMarket(program, address).catch(() => null);
        if (!market) continue;
        const now = Math.floor(Date.now() / 1000);
        if (enumKey(market.status) === "open" && now >= market.endTime.toNumber()) {
          await lock(program, resolver, record.marketAddress);
        }
      } catch (err) {
        console.error(`  ${record.marketAddress}: ${err.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function marketAddress(arg) {
  const value = String(arg);
  if (/^c?\d+$/.test(value)) {
    return marketPda(Number(value.replace(/^c/, "")));
  }
  return new PublicKey(value);
}

async function fetchMarket(program, address) {
  const market = await program.account.market.fetch(address).catch(() => null);
  if (!market) throw new Error(`market ${address.toBase58()} not found`);
  return Object.assign(market, { address });
}

async function fetchSpec(program, address) {
  const spec = await program.account.resolutionSpecCommitment.fetch(resolutionSpecPda(address)).catch(() => null);
  if (!spec) throw new Error(`resolution spec commitment missing for ${address.toBase58()}`);
  return spec;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function requireArg(value, label) {
  if (value === undefined || value === true) throw new Error(`missing ${label}`);
  return value;
}

function printUsage() {
  console.log(
    [
      "usage:",
      "  node resolver.mjs status   <market>",
      "  node resolver.mjs lock     <market>",
      "  node resolver.mjs resolve  <market> --transcript <file> [--approve --reviewer R --rationale T] [--dry]",
      "  node resolver.mjs resolve  <market> --audio <file> [--approve --reviewer R --rationale T] [--dry]",
      "  node resolver.mjs resolve  <market> --audio-url <url> [--approve --reviewer R --rationale T] [--dry]",
      "  node resolver.mjs resolve  <market> --force <outcome> [--approve --reviewer R --rationale T] [--dry]",
      "  node resolver.mjs post     <candidate.json> [--dry]",
      "  node resolver.mjs finalize <market>",
      "  node resolver.mjs watch    [--interval <sec>]",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(`resolver: ${err.message}`);
  process.exitCode = 1;
});
