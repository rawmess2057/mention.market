import assert from "node:assert/strict";
import test from "node:test";

import { buildResolutionSpec } from "@mention/resolution/spec-builder";

import {
  buildCandidate,
  buildOverrideCandidate,
  decodeCandidate,
  encodeCandidate,
} from "../src/pipeline.mjs";

const MARKET = "11111111111111111111111111111111";
const review = { reviewer: "ops", approvedAt: 1600, rationale: "reviewed transcript" };
const sourceUrl = "https://example.com/live";
const window = { startsAtMs: 1000, endsAtMs: 2000 };

function binary() {
  return buildResolutionSpec({ marketAddress: MARKET, marketType: "binary", binaryPhrase: "AI", sourceUrl, window });
}

function majority() {
  return buildResolutionSpec({
    marketAddress: MARKET,
    marketType: "majority",
    words: ["agents", "Grok"],
    sourceUrl,
    window,
  });
}

function coverage(status = "available", from = 1000, through = 2000) {
  return { status, coveredFromMs: from, coveredThroughMs: through };
}

test("builds a candidate when a binary trigger is spoken", () => {
  const spec = binary();
  const candidate = buildCandidate({
    spec,
    transcript: {
      segments: [
        { startMs: 1000, endMs: 1400, speaker: "host", text: "welcome to the show" },
        { startMs: 1400, endMs: 1600, speaker: "host", text: "today we say AI a lot" },
      ],
      coverage: coverage(),
    },
    review,
  });

  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.outcome, "yes");
  assert.ok(candidate.evidence);
  assert.equal(candidate.evidence.manifest.outcome, "yes");
  assert.ok(candidate.evidence.length <= 4096);
  assert.ok(candidate.evidence.manifest.excerpts.length >= 1);
});

test("does not infer NO from incomplete coverage", () => {
  const spec = binary();
  const candidate = buildCandidate({
    spec,
    transcript: {
      segments: [{ startMs: 1000, endMs: 1400, speaker: "host", text: "welcome" }],
      coverage: coverage("partial", 1000, 1500),
    },
    review,
  });

  assert.equal(candidate.status, "needs_more_evidence");
  assert.equal(candidate.evidence, null);
  assert.match(candidate.warnings[0], /coverage is incomplete/);
});

test("a complete transcript with no trigger resolves NO", () => {
  const spec = binary();
  const candidate = buildCandidate({
    spec,
    transcript: {
      segments: [{ startMs: 1000, endMs: 1900, speaker: "host", text: "nothing relevant said" }],
      coverage: coverage(),
    },
    review,
  });
  assert.equal(candidate.outcome, "no");
});

test("majority picks the first phrase spoken", () => {
  const spec = majority();
  const candidate = buildCandidate({
    spec,
    transcript: {
      segments: [
        { startMs: 1000, endMs: 1200, speaker: "host", text: "let us discuss agents today" },
        { startMs: 1300, endMs: 1500, speaker: "host", text: "Grok is next" },
      ],
      coverage: coverage(),
    },
    review,
  });
  assert.equal(candidate.outcome, "agents");
});

test("override candidate uses no excerpts and a manual evaluator", () => {
  const spec = binary();
  const candidate = buildOverrideCandidate({ spec, outcome: "no", review });
  assert.equal(candidate.status, "override");
  assert.equal(candidate.evidence.manifest.evaluator.method, "manual");
  assert.equal(candidate.evidence.manifest.excerpts.length, 0);
});

test("override rejects an outcome the spec does not allow", () => {
  assert.throws(
    () => buildOverrideCandidate({ spec: majority(), outcome: "nope", review }),
    /not allowed by the spec/,
  );
});

test("override can void any market, producing valid manual evidence", () => {
  for (const spec of [binary(), majority()]) {
    const candidate = buildOverrideCandidate({ spec, outcome: "void", review });
    assert.equal(candidate.outcome, "void");
    assert.equal(candidate.evidence.manifest.outcome, "void");
    assert.equal(candidate.evidence.manifest.evaluator.method, "manual");
  }
});

test("encode/decode round-trips the evidence bytes", () => {
  const spec = binary();
  const candidate = buildCandidate({
    spec,
    transcript: {
      segments: [{ startMs: 1000, endMs: 1400, speaker: "host", text: "we say AI" }],
      coverage: coverage(),
    },
    review,
  });
  const file = encodeCandidate({ spec, candidate });
  const decoded = decodeCandidate(file);

  assert.equal(decoded.marketAddress, MARKET);
  assert.equal(decoded.outcome, "yes");
  assert.deepEqual(Buffer.from(decoded.evidence.bytes), Buffer.from(candidate.evidence.bytes));
  assert.equal(decoded.evidence.sha256, candidate.evidence.sha256);
  assert.deepEqual(decoded.spec, spec);
});
