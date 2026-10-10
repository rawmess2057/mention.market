import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  evaluateTranscript,
  hashEvidenceManifest,
  hashResolutionSpec,
  validateEvidenceManifest,
  validateResolutionSpec,
} from "../src/contracts.mjs";

const spec = {
  schemaVersion: 1,
  marketAddress: "market-pda-1",
  marketType: "binary",
  outcomeOptions: ["yes", "no"],
  terms: [{ phrase: "AI", outcome: "yes" }],
  source: {
    provider: "demo-source",
    sourceId: "event-123",
    url: "https://example.com/event-123",
  },
  window: { startsAtMs: 1_800_000_000_000, endsAtMs: 1_800_003_600_000 },
  matching: {
    mode: "exact_phrase",
    caseSensitive: false,
    punctuationSensitive: false,
    speaker: null,
  },
};

const manifest = {
  schemaVersion: 1,
  marketAddress: "market-pda-1",
  specSha256: "a".repeat(64),
  outcome: "yes",
  confidence: 100,
  source: {
    provider: "demo-source",
    sourceId: "event-123",
    url: "https://example.com/event-123",
    capturedAt: 1_800_003_600_000,
    artifactSha256: "b".repeat(64),
  },
  excerpts: [
    { startMs: 1_800_000_012_000, endMs: 1_800_000_015_000, speaker: "host", text: "We are building with AI." },
  ],
  evaluator: { method: "deterministic", version: "exact-phrase/1", matchedExcerptIndexes: [0] },
  review: { reviewer: "operator@example.test", approvedAt: 1_800_004_000_000, rationale: "Phrase is present." },
  createdAt: 1_800_004_001_000,
};

test("canonical JSON sorts object keys recursively and preserves array order", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: true, b: null }, list: [2, 1] }), '{"a":{"b":null,"y":true},"list":[2,1],"z":1}');
});

test("resolution specs validate and hash independent of object key order", () => {
  assert.equal(validateResolutionSpec(spec), spec);
  const reordered = Object.fromEntries(Object.entries(spec).reverse());
  assert.equal(hashResolutionSpec(spec), hashResolutionSpec(reordered));
  assert.equal(hashResolutionSpec(spec), "e29785f0528070bab08616c2653d976e4cdf6232f4ca3479f856b5a78fa6cbe5");
});

test("resolution specs reject invalid windows and unsupported fields", () => {
  assert.throws(() => validateResolutionSpec({ ...spec, window: { startsAtMs: 10, endsAtMs: 10 } }), /endsAtMs/);
  assert.throws(() => validateResolutionSpec({ ...spec, resolverCanEdit: true }), /unknown fields/);
});

test("evidence manifests validate and produce stable SHA-256 hashes", () => {
  assert.equal(validateEvidenceManifest(manifest), manifest);
  const boundManifest = { ...manifest, specSha256: hashResolutionSpec(spec) };
  assert.equal(hashEvidenceManifest(boundManifest, spec), hashEvidenceManifest({
    ...boundManifest,
    source: { ...boundManifest.source },
  }, spec));
  assert.equal(hashEvidenceManifest(boundManifest, spec), "f26e879a7646a94be7536810b491c811549be09400474d37f7def7a327f7fdc3");
  assert.throws(() => hashEvidenceManifest(boundManifest), /spec is required/);
});

test("evidence manifests reject bad digests, outcomes metadata, and excerpt indexes", () => {
  assert.throws(() => validateEvidenceManifest({ ...manifest, specSha256: "bad" }), /SHA-256/);
  assert.throws(() => validateEvidenceManifest({
    ...manifest,
    evaluator: { ...manifest.evaluator, matchedExcerptIndexes: [1] },
  }), /between 0 and 0/);
  assert.throws(() => validateEvidenceManifest({ ...manifest, confidence: 101 }), /between 0 and 100/);
});

test("evidence manifest is bound to its market spec, source, and outcome", () => {
  const boundManifest = { ...manifest, specSha256: hashResolutionSpec(spec) };
  assert.equal(validateEvidenceManifest(boundManifest, spec), boundManifest);
  assert.throws(() => validateEvidenceManifest({ ...boundManifest, outcome: "maybe" }, spec), /not allowed/);
  assert.throws(() => validateEvidenceManifest({ ...boundManifest, marketAddress: "other-market" }, spec), /does not match/);
  assert.throws(() => validateEvidenceManifest({
    ...boundManifest,
    source: { ...boundManifest.source, sourceId: "other-event" },
  }, spec), /source does not match/);
});

test("canonical JSON rejects values that do not have portable JSON encodings", () => {
  assert.throws(() => canonicalJson({ value: undefined }), /undefined/);
  assert.throws(() => canonicalJson({ value: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalJson({ value: 1n }), /bigint/);
});

test("binary evaluator matches whole tokens and ignores case and punctuation by spec", () => {
  const result = evaluateTranscript(spec, [
    { startMs: 1_800_000_010_000, endMs: 1_800_000_011_000, speaker: "host", text: "The air is clear." },
    { startMs: 1_800_000_012_000, endMs: 1_800_000_013_000, speaker: "host", text: "AI! is useful." },
  ], { status: "partial", coveredFromMs: spec.window.startsAtMs, coveredThroughMs: 1_800_000_013_000 });
  assert.equal(result.status, "candidate");
  assert.equal(result.outcome, "yes");
  assert.equal(result.matches[0].excerptIndex, 1);
});

test("binary evaluator will not infer NO from incomplete transcript coverage", () => {
  const result = evaluateTranscript(spec, [], {
    status: "partial",
    coveredFromMs: spec.window.startsAtMs,
    coveredThroughMs: 1_800_000_100_000,
  });
  assert.equal(result.status, "needs_more_evidence");
  assert.equal(result.outcome, null);
});

test("binary evaluator returns NO only when full event coverage is available", () => {
  const result = evaluateTranscript(spec, [], {
    status: "available",
    coveredFromMs: spec.window.startsAtMs,
    coveredThroughMs: spec.window.endsAtMs,
  });
  assert.equal(result.status, "candidate");
  assert.equal(result.outcome, "no");
});

test("majority evaluator requires continuous coverage from event start through the earliest phrase", () => {
  const majority = {
    ...spec,
    marketType: "majority",
    outcomeOptions: ["AI", "agents"],
    terms: [{ phrase: "AI", outcome: "AI" }, { phrase: "agents", outcome: "agents" }],
  };
  const segments = [
    { startMs: 1_800_000_020_000, endMs: 1_800_000_021_000, speaker: "host", text: "agents" },
  ];
  const partial = evaluateTranscript(majority, segments, {
    status: "partial",
    coveredFromMs: majority.window.startsAtMs + 1_000,
    coveredThroughMs: 1_800_000_030_000,
  });
  assert.equal(partial.status, "needs_more_evidence");

  const complete = evaluateTranscript(majority, segments, {
    status: "available",
    coveredFromMs: majority.window.startsAtMs,
    coveredThroughMs: majority.window.endsAtMs,
  });
  assert.equal(complete.status, "candidate");
  assert.equal(complete.outcome, "agents");
});

test("majority evaluator marks simultaneous different winners ambiguous", () => {
  const majority = {
    ...spec,
    marketType: "majority",
    outcomeOptions: ["AI", "agents"],
    terms: [{ phrase: "AI", outcome: "AI" }, { phrase: "agents", outcome: "agents" }],
  };
  const result = evaluateTranscript(majority, [
    { startMs: 1_800_000_020_000, endMs: 1_800_000_021_000, speaker: "host", text: "AI and agents" },
  ], {
    status: "available",
    coveredFromMs: majority.window.startsAtMs,
    coveredThroughMs: majority.window.endsAtMs,
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.outcome, null);
});

test("unavailable source is never converted into a negative outcome", () => {
  const result = evaluateTranscript(spec, [], {
    status: "unavailable",
    coveredFromMs: spec.window.startsAtMs,
    coveredThroughMs: spec.window.startsAtMs,
  });
  assert.equal(result.status, "no_source");
  assert.equal(result.outcome, null);
});