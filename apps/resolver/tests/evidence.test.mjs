import assert from "node:assert/strict";
import test from "node:test";

import { buildResolutionSpec } from "@mention/resolution/spec-builder";
import { hashResolutionSpec, validateEvidenceManifest } from "@mention/resolution/contracts";

import {
  buildEvidence,
  EVALUATOR_VERSION,
  hashArtifact,
  MAX_EVIDENCE_LEN,
} from "../src/evidence/manifest.mjs";

const MARKET = "11111111111111111111111111111111";

function spec() {
  return buildResolutionSpec({
    marketAddress: MARKET,
    marketType: "binary",
    binaryPhrase: "AI",
    sourceUrl: "https://example.com/live",
    window: { startsAtMs: 1000, endsAtMs: 2000 },
  });
}

function excerpt(text = "they said AI", startMs = 1100, endMs = 1200) {
  return { startMs, endMs, speaker: "host", text };
}

function evidenceInput(s) {
  return {
    spec: s,
    outcome: "yes",
    confidence: 92,
    source: {
      provider: s.source.provider,
      sourceId: s.source.sourceId,
      url: s.source.url,
      capturedAt: 1500,
      artifactSha256: hashArtifact("raw-transcript"),
    },
    excerpts: [excerpt()],
    evaluator: { method: "deterministic", version: EVALUATOR_VERSION, matchedExcerptIndexes: [0] },
    review: { reviewer: "ops", approvedAt: 1600, rationale: "matched AI at 1.1s" },
    createdAt: 1700,
  };
}

test("builds a valid, hashable evidence bundle under the byte cap", () => {
  const s = spec();
  const result = buildEvidence(evidenceInput(s));

  assert.equal(result.length, result.bytes.length);
  assert.ok(result.length <= MAX_EVIDENCE_LEN);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.sha256, hashArtifact(result.bytes));
  assert.equal(result.manifest.specSha256, hashResolutionSpec(s));
  assert.equal(result.manifest.outcome, "yes");
  assert.doesNotThrow(() => validateEvidenceManifest(result.manifest, s));
});

test("review is mandatory — the schema blocks unreviewed evidence", () => {
  const s = spec();
  const input = evidenceInput(s);
  delete input.review;
  assert.throws(() => buildEvidence(input), /review is required/);
});

test("outcome not allowed by the spec is rejected", () => {
  const s = spec();
  const input = evidenceInput(s);
  input.outcome = "maybe";
  assert.throws(() => buildEvidence(input), /not allowed by resolution spec/);
});

test("an excerpt outside the window is rejected", () => {
  const s = spec();
  const input = evidenceInput(s);
  input.excerpts = [excerpt("late", 1500, 2500)];
  assert.throws(() => buildEvidence(input), /outside the resolution window/);
});

test("trims a large manifest to fit while keeping the matched excerpt", () => {
  const s = spec();
  const input = evidenceInput(s);
  input.excerpts = Array.from({ length: 64 }, (_, i) =>
    excerpt("word ".repeat(800), 1001 + i, 1002 + i),
  );
  input.evaluator.matchedExcerptIndexes = [0];

  const result = buildEvidence(input);
  assert.ok(result.length <= MAX_EVIDENCE_LEN, `expected <= ${MAX_EVIDENCE_LEN}, got ${result.length}`);
  assert.ok(result.manifest.excerpts.length >= 1);
  assert.deepEqual(result.manifest.evaluator.matchedExcerptIndexes, [0]);
  assert.ok(result.manifest.excerpts[0].text.length > 0);
  assert.doesNotThrow(() => validateEvidenceManifest(result.manifest, s));
});
