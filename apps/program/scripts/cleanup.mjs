// Devnet cleanup: reap every market on the program and reclaim its escrow.
//
// Requires a program build that includes `close_market` (see
// programs/mention/src/instructions/close_market.rs). For each Market it closes
// the market + vault + resolution-spec accounts and sweeps the market's
// Position / EvidenceManifest accounts, refunding every lamport (trader escrow,
// reserve ante, creator rent) to CLOSE_RECIPIENT.
//
// Authority-only: must run as `config.authority` (the deploy keypair by
// default). This force-closes even resolved markets, so any unclaimed winnings
// are swept to the recipient too — intended for clearing devnet before a demo.
//
//   node scripts/cleanup.mjs                        # every market
//   CLOSE_IDS=1,7000 node scripts/cleanup.mjs       # only these market ids
//   CLOSE_RECIPIENT=<pubkey> node scripts/cleanup.mjs
//   CLOSE_KEYPAIR_PATH=.../some.json node scripts/cleanup.mjs
//
// Closing a market with very many positions/evidence accounts may exceed the
// 1232-byte transaction limit (roughly ~24 remaining accounts per close); such
// a market is reported and skipped rather than half-closed.

import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  budget,
  deployKeypair,
  loadKeypair,
  marketPda,
  vaultPda,
  resolutionSpecPda,
  programFor,
  CONFIG_PDA,
  enumKey,
} from "./lib.mjs";

/** Rough cap on extra account metas that fit one close transaction. */
const MAX_REMAINING = 24;

const keypair = process.env.CLOSE_KEYPAIR_PATH
  ? loadKeypair(process.env.CLOSE_KEYPAIR_PATH)
  : deployKeypair();
const program = programFor(keypair);
const recipient = process.env.CLOSE_RECIPIENT
  ? new PublicKey(process.env.CLOSE_RECIPIENT)
  : keypair.publicKey;
const onlyIds = process.env.CLOSE_IDS
  ? process.env.CLOSE_IDS.split(",").map((s) => Number(s.trim())).filter(Number.isFinite)
  : null;

const config = await program.account.config.fetch(CONFIG_PDA);
if (!config.authority.equals(keypair.publicKey)) {
  console.error(
    `Signer ${keypair.publicKey.toBase58()} is not config.authority ` +
      `(${config.authority.toBase58()}). Set CLOSE_KEYPAIR_PATH to the authority key.`
  );
  process.exit(1);
}

console.log(`authority = ${keypair.publicKey.toBase58()}`);
console.log(`recipient = ${recipient.toBase58()}`);

const [allMarkets, allPositions, allEvidence] = await Promise.all([
  program.account.market.all(),
  program.account.position.all().catch(() => []),
  program.account.evidenceManifest.all().catch(() => []),
]);

// Group the rent-bearing child accounts by the market they belong to.
const childrenByMarket = new Map();
const pushChild = (marketKey, pubkey) => {
  const key = marketKey.toBase58();
  const list = childrenByMarket.get(key) ?? [];
  list.push(pubkey);
  childrenByMarket.set(key, list);
};
for (const { account, publicKey } of allPositions) pushChild(account.market, publicKey);
for (const { account, publicKey } of allEvidence) pushChild(account.market, publicKey);

const targets = allMarkets
  .filter(({ account }) => !onlyIds || onlyIds.includes(account.id.toNumber()))
  .sort((a, b) => a.account.id.toNumber() - b.account.id.toNumber());

if (targets.length === 0) {
  console.log("No markets to close.");
  process.exit(0);
}

console.log(`closing ${targets.length} market(s)…\n`);

let closed = 0;
let reclaimed = 0;
let skipped = 0;

for (const { account, publicKey: market } of targets) {
  const id = account.id.toNumber();
  const children = childrenByMarket.get(market.toBase58()) ?? [];
  if (children.length > MAX_REMAINING) {
    console.warn(
      `  m${id} skipped: ${children.length} child accounts exceed the ${MAX_REMAINING} ` +
        `that fit one close transaction`
    );
    skipped += 1;
    continue;
  }

  const vault = vaultPda(market);
  const vaultLamports = (await program.provider.connection.getBalance(vault).catch(() => 0)) || 0;

  try {
    const sig = await program.methods
      .closeMarket()
      .accounts({
        authority: keypair.publicKey,
        config: CONFIG_PDA,
        market,
        vault,
        resolutionSpec: resolutionSpecPda(market),
        recipient,
      })
      .remainingAccounts(
        children.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }))
      )
      .preInstructions(budget())
      .rpc();

    reclaimed += vaultLamports;
    closed += 1;
    console.log(
      `  m${id} ${JSON.stringify(account.title)} [${enumKey(account.status)}] ` +
        `closed (${(vaultLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL escrow + rent): ${sig}`
    );
  } catch (err) {
    console.error(`  m${id} FAILED: ${err?.message ?? err}`);
    skipped += 1;
  }
}

const remaining = await program.account.market.all();
const remainingPositions = await program.account.position.all().catch(() => []);
const remainingEvidence = await program.account.evidenceManifest.all().catch(() => []);

const balance = await program.provider.connection.getBalance(recipient);
console.log(
  `\ndone: ${closed} closed, ${skipped} skipped; ` +
    `~${(reclaimed / LAMPORTS_PER_SOL).toFixed(4)} SOL escrow reclaimed`
);
console.log(`recipient balance = ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
console.log(
  `remaining on-chain: ${remaining.length} market(s), ${remainingPositions.length} position(s), ` +
    `${remainingEvidence.length} evidence manifest(s)`
);
