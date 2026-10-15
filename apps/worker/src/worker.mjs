import { hashResolutionSpec } from "@mention/resolution/contracts";
import {
  compactDeepgramResponse,
  expandDeepgramTranscript,
  normalizeDeepgramResponse,
} from "@mention/resolver/adapters/deepgram";
import { buildCandidate, buildOverrideCandidate } from "@mention/resolver/pipeline";

/**
 * The resolution worker: one sequential pass (`tick`) over every market.
 *
 *   open, ended            → lock
 *   locked, not queued     → enqueue (pending), or failed if its spec is missing
 *   pending                → transcribe the spec's source URL (Deepgram batch),
 *                            evaluate → candidate | needs_review | failed
 *   (operator approves)    → approved
 *   approved               → build evidence once, post it, propose → proposed
 *   proposed, but locked   → challenged: back for a new decision (new round)
 *   resolving, window over → finalize → finalized
 *
 * Dependencies are injected (`chain`, `transcriber`, `queue`, `specs`) so the
 * whole loop runs in tests against in-process Postgres and a fake chain.
 */

/** Propose bond (1 SOL, `constants.rs`) plus evidence rent and fees. */
export const MIN_PROPOSE_LAMPORTS = 1_050_000_000;
export const MAX_TRANSCRIBE_ATTEMPTS = 3;
const RETRY_BASE_MS = 60_000;
/** Placeholder review used only to preview a candidate; never posted. */
const PREVIEW_REVIEW = { reviewer: "preview", approvedAt: 0, rationale: "preview only" };

/**
 * @param {object} deps
 * @param {ReturnType<import("./chain.mjs").createChain>} deps.chain
 * @param {{ transcribe(url: string): Promise<object> }} deps.transcriber  Returns a raw Deepgram response.
 * @param {ReturnType<import("@mention/resolver/queue").createResolutionQueue>} deps.queue
 * @param {{ getSpec(address: string): Promise<{ spec: object, specSha256: string } | null> }} deps.specs
 * @param {() => number} [deps.now]
 * @param {(msg: string) => void} [deps.log]
 */
export function createWorker({ chain, transcriber, queue, specs, now = Date.now, log = console.log }) {
  /** Normalized, window-aligned transcript for a row (from its stored compact form). */
  function transcriptFor(row, spec) {
    return normalizeDeepgramResponse(expandDeepgramTranscript(row.transcript), {
      startedAtMs: row.audioStartedAt ?? spec.window.startsAtMs,
      splitAtMs: [spec.window.startsAtMs, spec.window.endsAtMs],
    });
  }

  async function loadSpec(market) {
    const record = await specs.getSpec(market.address);
    if (!record) return { error: "no stored resolution spec (register it via /api/specs)" };
    const hash = hashResolutionSpec(record.spec);
    if (hash !== market.specSha256) {
      return { error: `stored spec ${hash.slice(0, 12)}… does not match on-chain ${market.specSha256.slice(0, 12)}…` };
    }
    return { spec: record.spec, specSha256: hash };
  }

  async function transcribeAndEvaluate(market, row) {
    const { spec, error } = await loadSpec(market);
    if (error) {
      await queue.transition(market.address, ["pending"], { state: "failed", statusReason: error });
      return;
    }

    let current = row;
    if (!current.transcript) {
      try {
        const raw = await transcriber.transcribe(spec.source.url);
        current = await queue.transition(market.address, ["pending"], {
          transcript: compactDeepgramResponse(raw),
          transcribedAt: now(),
        });
        if (!current) return; // operator acted meanwhile
      } catch (err) {
        const attempts = row.attempts + 1;
        // 4xx (bad URL, not audio, unsupported media) won't fix itself; 429/5xx/network might.
        const permanent = err?.status >= 400 && err?.status < 500 && err?.status !== 429;
        const giveUp = permanent || attempts >= MAX_TRANSCRIBE_ATTEMPTS;
        await queue.transition(market.address, ["pending"], {
          state: giveUp ? "failed" : "pending",
          attempts,
          nextAttemptAt: now() + RETRY_BASE_MS * 2 ** attempts,
          lastError: String(err?.message ?? err).slice(0, 500),
          statusReason: giveUp
            ? permanent
              ? `the source isn't transcribable audio (${spec.source.url}); fix the source or void`
              : `transcription failed ${attempts}× for ${spec.source.url}`
            : null,
        });
        log(`  m${market.id}: transcription failed (${attempts}/${MAX_TRANSCRIBE_ATTEMPTS}): ${err?.message ?? err}`);
        return;
      }
    }

    const preview = buildCandidate({ spec, transcript: transcriptFor(current, spec), review: PREVIEW_REVIEW });
    const candidate = {
      status: preview.status,
      outcome: preview.outcome,
      matches: preview.matches,
      confidence: preview.confidence,
      warnings: preview.warnings,
      excerpts: preview.evidence?.manifest.excerpts ?? [],
    };
    const state = preview.status === "candidate" ? "candidate" : "needs_review";
    await queue.transition(market.address, ["pending"], {
      state,
      candidate,
      statusReason: state === "candidate" ? null : preview.warnings[0] ?? preview.status,
      lastError: null,
    });
    log(`  m${market.id}: ${state}${candidate.outcome ? ` "${candidate.outcome}"` : ""} — awaiting operator approval`);
  }

  /**
   * Evidence for the approved decision, built once per round and stored so
   * retries post identical bytes. Returns null (and hands the decision back
   * for review) when the decision can't become postable evidence.
   */
  async function evidenceFor(market, row, spec) {
    if (row.evidence) return row.evidence;
    const review = { reviewer: row.reviewer, approvedAt: row.approvedAt, rationale: row.rationale };
    const followsEvaluator =
      row.candidate?.status === "candidate" && row.candidate.outcome === row.approvedOutcome && row.transcript;
    let built;
    try {
      built = followsEvaluator
        ? buildCandidate({
            spec,
            transcript: transcriptFor(row, spec),
            review,
            capturedAt: row.transcribedAt,
            createdAt: row.approvedAt,
          })
        : buildOverrideCandidate({
            spec,
            outcome: row.approvedOutcome,
            review,
            capturedAt: row.approvedAt,
            createdAt: row.approvedAt,
          });
    } catch (err) {
      // Typically reviewer + rationale + quote overflow what one transaction
      // can carry. Retrying can't fix that: hand the decision back.
      await queue.transition(market.address, ["approved"], {
        state: row.candidate?.status === "candidate" ? "candidate" : "needs_review",
        statusReason: `approval couldn't be posted (${err.message}); approve again with a shorter rationale`,
        approvedOutcome: null,
        reviewer: null,
        rationale: null,
        approvedAt: null,
        evidence: null,
      });
      log(`  m${market.id}: approval returned for review: ${err.message}`);
      return null;
    }
    if (built.outcome !== row.approvedOutcome) {
      throw new Error(`evidence outcome ${built.outcome} differs from the approved ${row.approvedOutcome}`);
    }
    const evidence = {
      bytesBase64: Buffer.from(built.evidence.bytes).toString("base64"),
      sha256: built.evidence.sha256,
      specSha256: hashResolutionSpec(spec),
      outcome: built.outcome,
      confidence: built.confidence,
    };
    const saved = await queue.transition(market.address, ["approved"], { evidence });
    if (!saved) throw new Error("row left `approved` while building evidence");
    return evidence;
  }

  async function propose(market, row) {
    const { spec, error } = await loadSpec(market);
    if (error) throw new Error(error);
    const evidence = await evidenceFor(market, row, spec);
    if (!evidence) return;
    if (evidence.specSha256 !== market.specSha256) throw new Error("evidence is bound to a different spec");

    const balance = await chain.balanceLamports();
    if (balance < MIN_PROPOSE_LAMPORTS) {
      throw new Error(`resolver has ${balance / 1e9} SOL; needs ≥ ${MIN_PROPOSE_LAMPORTS / 1e9} SOL for the bond`);
    }
    const sigs = await chain.submit(market.address, {
      bytes: new Uint8Array(Buffer.from(evidence.bytesBase64, "base64")),
      sha256: evidence.sha256,
      specSha256: evidence.specSha256,
      outcome: evidence.outcome,
      confidence: evidence.confidence,
    });
    await queue.transition(market.address, ["approved"], {
      state: "proposed",
      txSigs: [...row.txSigs, ...sigs],
      lastError: null,
    });
    log(`  m${market.id}: proposed "${evidence.outcome}" (${sigs.at(-1)})`);
  }

  async function step(market) {
    const t = now();
    if (!market.specSha256) return; // legacy/demo market: not resolvable through evidence

    if (market.status === "open") {
      if (t >= market.endTimeMs) {
        const sig = await chain.lock(market.address);
        log(`  m${market.id}: locked (${sig})`);
      }
      return;
    }

    let row = await queue.get(market.address);

    if (market.status === "locked") {
      if (!row) {
        const { spec, error } = await loadSpec(market);
        row = await queue.enqueue({
          marketAddress: market.address,
          marketId: market.id,
          audioStartedAt: spec ? spec.window.startsAtMs : null,
          state: error ? "failed" : "pending",
          statusReason: error ?? null,
        });
        log(`  m${market.id}: queued (${row.state}${error ? `: ${error}` : ""})`);
      }
      if (row.state === "proposed") {
        // Our proposal was challenged: the market is back to Locked.
        const open = await chain.openChallenge(market.address);
        const reason = open
          ? `challenged by ${open.challenger} disputing "${open.challengedOutcome}"; review and approve again`
          : "proposal was reset on-chain; review and approve again";
        await queue.reopen(market.address, {
          state: row.candidate?.status === "candidate" ? "candidate" : "needs_review",
          statusReason: reason,
        });
        log(`  m${market.id}: ${reason}`);
        return;
      }
      if (row.state === "pending" && row.nextAttemptAt <= t) await transcribeAndEvaluate(market, row);
      else if (row.state === "approved" && row.nextAttemptAt <= t) {
        try {
          await propose(market, row);
        } catch (err) {
          await queue.transition(market.address, ["approved"], {
            attempts: row.attempts + 1,
            nextAttemptAt: t + RETRY_BASE_MS * Math.min(2 ** row.attempts, 16),
            lastError: String(err?.message ?? err).slice(0, 500),
          });
          throw err;
        }
      }
      return;
    }

    if (market.status === "resolving") {
      // A propose that landed before we recorded it (crash between the two).
      if (row?.state === "approved") await queue.transition(market.address, ["approved"], { state: "proposed" });
      if (row && t > market.challengeDeadlineMs) {
        const sig = await chain.finalize(market.address, market.proposer);
        await queue.transition(market.address, ["approved", "proposed"], {
          state: "finalized",
          txSigs: [...(row.txSigs ?? []), sig],
        });
        log(`  m${market.id}: finalized "${market.winningOutcome}" (${sig})`);
      }
      return;
    }

    if (market.status === "resolved" && row && row.state !== "finalized") {
      await queue.transition(market.address, [row.state], { state: "finalized" });
    }
  }

  return {
    step,
    /** One pass over every market. A failure on one market never stops the rest. */
    async tick() {
      const markets = await chain.listMarkets();
      for (const market of markets.sort((a, b) => a.id - b.id)) {
        try {
          await step(market);
        } catch (err) {
          log(`  m${market.id}: ${err?.message ?? err}`);
          if (err?.logs) log(`    ${err.logs.slice(-3).join("\n    ")}`);
        }
      }
    },
  };
}
