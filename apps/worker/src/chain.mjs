import fs from "node:fs";
import { createRequire } from "node:module";

import anchorPkg from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";

const { AnchorProvider, Program, Wallet } = anchorPkg;
const require = createRequire(import.meta.url);

/**
 * On-chain side of the worker: read markets, and send the resolver's
 * transactions (lock, post_evidence + propose, finalize).
 *
 * PDAs mirror `apps/program/scripts/lib.mjs` and `apps/web/src/lib/chain.ts`
 * (CLAUDE.md gotcha #2). The IDL is the web app's committed copy, so the worker
 * always speaks the same program interface the site does.
 */

const IDL = require("../../web/src/lib/idl/mention.json");
export const PROGRAM_ID = new PublicKey(IDL.address);
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
const ZERO_HASH = "0".repeat(64);

const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const CONFIG_PDA = pda(Buffer.from("config"));
const vaultPda = (market) => pda(Buffer.from("vault"), market.toBuffer());
const resolutionSpecPda = (market) => pda(Buffer.from("resolution-spec"), market.toBuffer());
const challengePda = (market) => pda(Buffer.from("challenge"), market.toBuffer());
const evidencePda = (market, sha256) => pda(Buffer.from("evidence"), market.toBuffer(), Buffer.from(sha256));

/** The program's LMSR/evidence paths need more than the 200k CU default. */
const budget = () => [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })];
const enumKey = (o) => (o && typeof o === "object" ? Object.keys(o)[0] : String(o));

/** `RESOLVER_KEYPAIR` (JSON byte array, for hosted secrets) or `RESOLVER_KEYPAIR_PATH` (a file). */
export function loadResolverKeypair(env = process.env) {
  const raw = env.RESOLVER_KEYPAIR ?? (env.RESOLVER_KEYPAIR_PATH ? fs.readFileSync(env.RESOLVER_KEYPAIR_PATH, "utf8") : null);
  if (!raw) throw new Error("set RESOLVER_KEYPAIR (JSON byte array) or RESOLVER_KEYPAIR_PATH");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

/**
 * @param {{ rpcUrl: string, keypair: Keypair }} opts
 */
export function createChain({ rpcUrl, keypair }) {
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keypair), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(IDL, provider);
  const resolver = keypair.publicKey;

  async function fetchOrNull(promise) {
    try {
      return await promise;
    } catch {
      return null;
    }
  }

  return {
    resolver: resolver.toBase58(),

    async config() {
      const config = await program.account.config.fetch(CONFIG_PDA);
      return { resolver: config.resolver.toBase58(), authority: config.authority.toBase58(), paused: config.paused };
    },

    balanceLamports: () => connection.getBalance(resolver),

    /** Every market, with its committed spec hash (null if none / all-zero). */
    async listMarkets() {
      const accounts = await program.account.market.all();
      const commitments = await program.account.resolutionSpecCommitment.fetchMultiple(
        accounts.map((a) => resolutionSpecPda(a.publicKey))
      );
      return accounts.map(({ publicKey, account: m }, i) => {
        const hex = commitments[i] ? Buffer.from(commitments[i].specSha256).toString("hex") : null;
        return {
          address: publicKey.toBase58(),
          id: Number(m.id),
          status: enumKey(m.status),
          endTimeMs: Number(m.endTime) * 1000,
          challengeDeadlineMs: Number(m.challengeDeadline) * 1000,
          proposer: m.proposer.toBase58(),
          winningOutcome: m.winningOutcome,
          specSha256: hex && hex !== ZERO_HASH ? hex : null,
        };
      });
    },

    async lock(address) {
      return program.methods
        .lockMarket()
        .accounts({ signer: resolver, market: new PublicKey(address) })
        .preInstructions(budget())
        .rpc();
    },

    /** The open dispute on a market, if any. */
    async openChallenge(address) {
      const open = await fetchOrNull(program.account.challenge.fetch(challengePda(new PublicKey(address))));
      return open
        ? { challenger: open.challenger.toBase58(), challengedOutcome: open.challengedOutcome, proposer: open.proposer.toBase58() }
        : null;
    },

    /**
     * Post the evidence (skipped if this exact evidence is already on-chain —
     * a retry after a failed propose) and propose its outcome, settling any
     * open challenge in the same instruction.
     *
     * @param {string} address
     * @param {{ bytes: Uint8Array, sha256: string, specSha256: string, outcome: string, confidence: number }} ev
     * @returns {Promise<string[]>} transaction signatures.
     */
    async submit(address, ev) {
      const market = new PublicKey(address);
      const sha256 = Buffer.from(ev.sha256, "hex");
      const evidence = evidencePda(market, sha256);
      const sigs = [];
      if (!(await connection.getAccountInfo(evidence))) {
        sigs.push(
          await program.methods
            .postEvidence(Buffer.from(ev.bytes), Array.from(sha256), Array.from(Buffer.from(ev.specSha256, "hex")))
            .accounts({ resolver, config: CONFIG_PDA, market, evidence, systemProgram: SYSTEM_PROGRAM })
            .preInstructions(budget())
            .rpc()
        );
      }

      const challenge = challengePda(market);
      const open = await fetchOrNull(program.account.challenge.fetch(challenge));
      const settle = open
        ? {
            challengerAccount: open.challenger,
            priorProposerAccount: open.proposer,
            treasury: (await program.account.config.fetch(CONFIG_PDA)).authority,
          }
        : { challengerAccount: null, priorProposerAccount: null, treasury: null };
      sigs.push(
        await program.methods
          .proposeResolution(ev.outcome, ev.confidence, Array.from(sha256))
          .accounts({
            resolver,
            config: CONFIG_PDA,
            market,
            vault: vaultPda(market),
            resolutionSpec: resolutionSpecPda(market),
            evidence,
            challenge,
            ...settle,
            systemProgram: SYSTEM_PROGRAM,
          })
          .preInstructions(budget())
          .rpc()
      );
      return sigs;
    },

    async finalize(address, proposer) {
      const market = new PublicKey(address);
      return program.methods
        .finalizeResolution()
        .accounts({
          finalizer: resolver,
          config: CONFIG_PDA,
          market,
          vault: vaultPda(market),
          proposerAccount: new PublicKey(proposer),
          systemProgram: SYSTEM_PROGRAM,
        })
        .preInstructions(budget())
        .rpc();
    },
  };
}
