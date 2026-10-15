// Resolution worker entry point (Railway / Fly.io / local).
//
//   DATABASE_URL         Neon Postgres (specs + resolution queue)
//   SOLANA_RPC_URL       devnet RPC (a dedicated one: the public endpoint rate-limits)
//   RESOLVER_KEYPAIR     resolver secret key as a JSON byte array (hosted secret), or
//   RESOLVER_KEYPAIR_PATH  a keypair file (local)
//   DEEPGRAM_API_KEY     batch transcription
//   POLL_MS              pass interval (default 20000)
//   ONCE=1               run a single pass and exit

import { getDb, migrate } from "@mention/db";
import { DeepgramBatchAdapter } from "@mention/resolver/adapters/deepgram";
import { createResolutionQueue } from "@mention/resolver/queue";
import { createSpecStore } from "@mention/resolver/store";

import { createChain, loadResolverKeypair } from "./chain.mjs";
import { createWorker } from "./worker.mjs";

const POLL_MS = Number(process.env.POLL_MS || 20_000);
const ts = () => new Date().toISOString();
const log = (msg) => console.log(`${ts()} ${msg}`);

const db = getDb();
if (!db) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
await migrate(db);

const keypair = loadResolverKeypair();
const chain = createChain({
  rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  keypair,
});
const config = await chain.config();
if (config.resolver !== chain.resolver) {
  console.error(`resolver mismatch: config.resolver=${config.resolver}, this key=${chain.resolver}`);
  process.exit(1);
}

const deepgram = new DeepgramBatchAdapter();
const worker = createWorker({
  chain,
  transcriber: { transcribe: (url) => deepgram.transcribeUrlRaw(url) },
  queue: createResolutionQueue({ db }),
  specs: createSpecStore({ db }),
  log,
});

log(`worker: resolver=${chain.resolver} balance=${(await chain.balanceLamports()) / 1e9} SOL poll=${POLL_MS}ms`);

let stopping = false;
let wake = () => {};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log(`${signal}: finishing the current pass, then exiting`);
    stopping = true;
    wake();
  });
}

// Sequential, never overlapping passes: a slow RPC pass can't double-submit.
do {
  try {
    await worker.tick();
  } catch (err) {
    log(`pass failed: ${err?.message ?? err}`);
  }
  if (process.env.ONCE === "1") break;
  if (stopping) break;
  await new Promise((r) => {
    const timer = setTimeout(r, POLL_MS);
    wake = () => {
      clearTimeout(timer);
      r();
    };
  });
} while (!stopping);

// Open RPC websockets (transaction confirmations) would keep the process alive.
process.exit(0);
