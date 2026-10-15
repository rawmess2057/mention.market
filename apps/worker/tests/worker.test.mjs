import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createTestDb } from "@mention/db/testing";
import { hashResolutionSpec } from "@mention/resolution/contracts";
import { buildResolutionSpec } from "@mention/resolution/spec-builder";
import { createResolutionQueue } from "@mention/resolver/queue";
import { createSpecStore } from "@mention/resolver/store";

import { createWorker, MAX_TRANSCRIBE_ATTEMPTS } from "../src/worker.mjs";

const FIXTURE = JSON.parse(
  await readFile(new URL("../../resolver/tests/fixtures/deepgram-spacewalk.json", import.meta.url), "utf8")
);
const MARKET = "AWGWEBJWW5wGCgyz9poMYEAjJNRKmv9FK3nCN15g9dfv";
const RESOLVER = "8egVYdYA11111111111111111111111111111111111";
const START = 1_790_000_000_000;
const END = START + 25_000; // the 26s recording, window ending mid-sentence

/** A minimal in-memory program: enough state machine for the worker. */
function fakeChain({ specSha256, now }) {
  const market = {
    address: MARKET,
    id: 42,
    status: "open",
    endTimeMs: END,
    challengeDeadlineMs: 0,
    proposer: "11111111111111111111111111111111",
    winningOutcome: "",
    specSha256,
  };
  const chain = {
    market,
    evidence: new Map(),
    submits: [],
    challenge: null,
    balance: 5_000_000_000,
    resolver: RESOLVER,
    listMarkets: async () => [{ ...market }],
    balanceLamports: async () => chain.balance,
    async lock() {
      assert.equal(market.status, "open");
      market.status = "locked";
      return "sig-lock";
    },
    async submit(address, ev) {
      assert.equal(market.status, "locked");
      assert.equal(createHash("sha256").update(ev.bytes).digest("hex"), ev.sha256, "evidence bytes hash");
      assert.ok(ev.bytes.length <= 813, `post_evidence tx would exceed 1232 bytes (${ev.bytes.length} evidence bytes)`);
      chain.evidence.set(ev.sha256, ev);
      chain.submits.push(ev);
      market.status = "resolving";
      market.winningOutcome = ev.outcome;
      market.proposer = RESOLVER;
      market.challengeDeadlineMs = now() + 120_000;
      chain.challenge = null;
      return [`sig-evidence-${chain.submits.length}`, `sig-propose-${chain.submits.length}`];
    },
    async finalize() {
      assert.ok(now() > market.challengeDeadlineMs);
      market.status = "resolved";
      return "sig-finalize";
    },
    openChallenge: async () => chain.challenge,
    /** Test helper: a user disputes the proposal. */
    dispute(outcome) {
      market.status = "locked";
      chain.challenge = { challenger: "Chal1enger111111111111111111111111111111111", challengedOutcome: outcome, proposer: RESOLVER };
    },
  };
  return chain;
}

describe("resolution worker", () => {
  let db, clock, queue, chain, worker, transcribeCalls, transcribeImpl, logs;
  const now = () => clock;
  const spec = buildResolutionSpec({
    marketAddress: MARKET,
    marketType: "binary",
    binaryPhrase: "all female team",
    sourceUrl: "https://dpgr.am/spacewalk.wav",
    window: { startsAtMs: START, endsAtMs: END },
  });
  const approve = (extra = {}) =>
    queue.approve(MARKET, { reviewer: "ops-wallet-1", rationale: "phrase heard at 0:08 in the recording", spec, ...extra });

  beforeEach(async () => {
    db = await createTestDb();
    clock = START;
    queue = createResolutionQueue({ db, now });
    await createSpecStore({ db }).putSpec({ marketAddress: MARKET, spec });
    chain = fakeChain({ specSha256: hashResolutionSpec(spec), now });
    transcribeCalls = 0;
    transcribeImpl = async () => FIXTURE;
    logs = [];
    worker = createWorker({
      chain,
      transcriber: {
        transcribe: async (url) => {
          transcribeCalls += 1;
          assert.equal(url, spec.source.url);
          return transcribeImpl();
        },
      },
      queue,
      specs: createSpecStore({ db }),
      now,
      log: (m) => logs.push(m),
    });
  });
  afterEach(() => db.close());

  it("locks, transcribes, waits for approval, proposes, then finalizes", async () => {
    await worker.tick();
    assert.equal(chain.market.status, "open", "nothing happens before end_time");

    clock = END + 1;
    await worker.tick();
    assert.equal(chain.market.status, "locked");

    await worker.tick();
    let row = await queue.get(MARKET);
    assert.equal(row.state, "candidate");
    assert.equal(row.candidate.outcome, "yes");
    assert.ok(row.candidate.excerpts.length >= 1);
    assert.equal(transcribeCalls, 1);

    // No approval, no proposal — however many passes run.
    await worker.tick();
    await worker.tick();
    assert.equal(chain.submits.length, 0);

    await approve();
    await worker.tick();
    row = await queue.get(MARKET);
    assert.equal(row.state, "proposed");
    assert.equal(chain.submits.length, 1);
    const manifest = JSON.parse(Buffer.from(chain.submits[0].bytes).toString("utf8"));
    assert.equal(manifest.outcome, "yes");
    assert.equal(manifest.evaluator.method, "deterministic");
    assert.equal(manifest.review.reviewer, "ops-wallet-1");
    assert.deepEqual(row.txSigs, ["sig-evidence-1", "sig-propose-1"]);

    await worker.tick();
    assert.equal(chain.market.status, "resolving", "no finalize inside the challenge window");

    clock += 121_000;
    await worker.tick();
    assert.equal(chain.market.status, "resolved");
    assert.equal((await queue.get(MARKET)).state, "finalized");
    assert.equal(transcribeCalls, 1);
  });

  it("a challenge sends the market back for a new decision and fresh evidence", async () => {
    clock = END + 1;
    await worker.tick(); // lock
    await worker.tick(); // transcribe
    await approve();
    await worker.tick(); // propose
    const first = chain.submits[0].sha256;

    chain.dispute("yes");
    await worker.tick();
    let row = await queue.get(MARKET);
    assert.equal(row.state, "candidate");
    assert.equal(row.round, 1);
    assert.equal(row.reviewer, null);
    assert.equal(row.evidence, null);
    assert.match(row.statusReason, /challenged by .* disputing "yes"/);

    await worker.tick();
    assert.equal(chain.submits.length, 1, "no re-proposal without a new approval");

    clock += 5_000;
    await approve({ outcome: "no", rationale: "challenger is right: wrong recording" });
    await worker.tick();
    row = await queue.get(MARKET);
    assert.equal(row.state, "proposed");
    assert.equal(chain.submits.length, 2);
    assert.notEqual(chain.submits[1].sha256, first);
    const manifest = JSON.parse(Buffer.from(chain.submits[1].bytes).toString("utf8"));
    assert.equal(manifest.outcome, "no");
    assert.equal(manifest.evaluator.method, "manual", "an override of the evaluator is manual evidence");
  });

  it("gives up after repeated transcription failures; the operator can void", async () => {
    transcribeImpl = async () => {
      throw new Error("REMOTE_CONTENT_ERROR: could not fetch audio");
    };
    clock = END + 1;
    await worker.tick(); // lock
    for (let i = 0; i < MAX_TRANSCRIBE_ATTEMPTS; i += 1) {
      await worker.tick();
      clock += 10 * 60_000; // past the backoff
    }
    const row = await queue.get(MARKET);
    assert.equal(row.state, "failed");
    assert.equal(transcribeCalls, MAX_TRANSCRIBE_ATTEMPTS);
    assert.match(row.lastError, /REMOTE_CONTENT_ERROR/);

    await assert.rejects(approve(), /outcome is required/);
    await approve({ outcome: "void", rationale: "recording was never published" });
    await worker.tick();
    assert.equal(chain.market.winningOutcome, "void");
  });

  it("fails immediately when the source isn't audio (a permanent 4xx)", async () => {
    transcribeImpl = async () => {
      throw Object.assign(new Error("deepgram request failed (415): remote server failed to offer audio data"), { status: 415 });
    };
    clock = END + 1;
    await worker.tick();
    await worker.tick();
    const row = await queue.get(MARKET);
    assert.equal(row.state, "failed");
    assert.equal(transcribeCalls, 1);
    assert.match(row.statusReason, /isn't transcribable audio/);
  });

  it("retrying with a corrected start time re-evaluates without re-transcribing", async () => {
    clock = END + 1;
    await worker.tick();
    await worker.tick();
    assert.equal((await queue.get(MARKET)).candidate.outcome, "yes");

    // The recording actually started 20s before the window: the phrase (at ~8s) falls outside.
    await queue.retry(MARKET, { audioStartedAt: START - 20_000 });
    await worker.tick();
    const row = await queue.get(MARKET);
    assert.equal(transcribeCalls, 1);
    assert.equal(row.state, "needs_review", "a partial window can't prove NO");
  });

  it("parks markets whose spec isn't stored, without transcribing", async () => {
    chain.market.specSha256 = "ab".repeat(32);
    clock = END + 1;
    await worker.tick();
    await worker.tick();
    const row = await queue.get(MARKET);
    assert.equal(row.state, "failed");
    assert.match(row.statusReason, /does not match on-chain/);
    assert.equal(transcribeCalls, 0);
  });

  it("keeps an approval queued (with the error) while the resolver can't post the bond", async () => {
    clock = END + 1;
    await worker.tick();
    await worker.tick();
    await approve();
    chain.balance = 500_000_000;
    await worker.tick();
    let row = await queue.get(MARKET);
    assert.equal(row.state, "approved");
    assert.match(row.lastError, /needs ≥ 1.05 SOL/);
    const evidence = row.evidence;

    chain.balance = 5_000_000_000;
    clock = row.nextAttemptAt;
    await worker.tick();
    row = await queue.get(MARKET);
    assert.equal(row.state, "proposed");
    assert.equal(chain.submits[0].sha256, evidence.sha256, "the retry posts the same evidence");
  });

  it("hands back an approval whose evidence can't fit one transaction", async () => {
    clock = END + 1;
    await worker.tick();
    await worker.tick();
    // Within the queue's limits, but a long reviewer id leaves no room for the quote.
    await approve({ reviewer: "r".repeat(128), rationale: "x".repeat(120) });
    await worker.tick();
    const row = await queue.get(MARKET);
    assert.equal(row.state, "candidate");
    assert.equal(row.reviewer, null);
    assert.match(row.statusReason, /approve again with a shorter rationale/);
    assert.equal(chain.submits.length, 0);
  });

  it("every posted evidence fits one transaction", async () => {
    const { MAX_POSTABLE_EVIDENCE_LEN } = await import("@mention/resolver/evidence");
    clock = END + 1;
    await worker.tick();
    await worker.tick();
    await approve({ reviewer: "CD69UjQitwnnPwHkFSYNsL2Qh7PW3hdqBNU1cQSrXFj" });
    await worker.tick();
    assert.equal(chain.submits.length, 1);
    assert.ok(chain.submits[0].bytes.length <= MAX_POSTABLE_EVIDENCE_LEN);
    assert.match(JSON.parse(Buffer.from(chain.submits[0].bytes).toString()).excerpts[0].text, /all female team/);
  });

  it("refuses operator decisions outside reviewable states", async () => {
    clock = END + 1;
    await worker.tick();
    await worker.tick();
    await approve();
    await assert.rejects(approve(), /only candidate\/needs_review\/failed/);
    await assert.rejects(queue.retry(MARKET), /can be retried/);
    await assert.rejects(
      queue.approve(MARKET, { reviewer: "", rationale: "x".repeat(20), spec }),
      /reviewer is required/
    );
  });
});
