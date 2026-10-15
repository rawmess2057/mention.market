import { canonicalJson } from "@mention/resolution/canonical-json";
import { evaluateTranscript, hashResolutionSpec, VOID_OUTCOME } from "@mention/resolution/contracts";

import { buildEvidence, EVALUATOR_VERSION, hashArtifact } from "./evidence/manifest.mjs";

/**
 * Matched segments cited as evidence excerpts: the earliest, decisive one.
 * Evidence must fit one transaction (`MAX_POSTABLE_EVIDENCE_LEN`), and the
 * fixed manifest fields already take ~600 of its 800 bytes.
 */
export const MAX_EXCERPTS = 1;

/**
 * Shift an audio-relative transcript (times from 0, as Deepgram batch returns)
 * onto the epoch clock the spec's window uses. `audioStartedAtMs` is when the
 * recording began; for a recording of the event it defaults to the window
 * start (operator-overridable when the recording starts earlier or later).
 */
export function normalizeTranscriptTime(transcript, audioStartedAtMs) {
  if (!Number.isSafeInteger(audioStartedAtMs) || audioStartedAtMs < 0) {
    throw new TypeError("audioStartedAtMs must be a non-negative safe integer");
  }
  const { segments, coverage, artifactSha256 } = normalizeTranscript(transcript);
  const shift = (t) => t + audioStartedAtMs;
  return {
    segments: segments.map((s) => ({ ...s, startMs: shift(s.startMs), endMs: shift(s.endMs) })),
    coverage:
      coverage.status === "unavailable"
        ? { ...coverage }
        : { ...coverage, coveredFromMs: shift(coverage.coveredFromMs), coveredThroughMs: shift(coverage.coveredThroughMs) },
    ...(artifactSha256 ? { artifactSha256 } : {}),
  };
}

/**
 * Turn a resolution spec + a transcript into a reviewable candidate.
 *
 * This is the deterministic half of the pipeline: it runs the shared evaluator,
 * extracts the matched evidence excerpts, and assembles the on-chain evidence
 * manifest. It never approves anything — the mandatory `review` block is
 * supplied by the operator, so the returned candidate is *staged*, not final.
 *
 * @param {object} input
 * @param {object} input.spec          Canonical resolution spec.
 * @param {object} input.transcript    `{segments, coverage, artifactSha256?}`.
 * @param {object} [input.review]      `{reviewer, approvedAt, rationale}` (required to build evidence).
 * @param {number} [input.capturedAt]
 * @param {number} [input.createdAt]
 * @returns {object} candidate — `{status, outcome, matches, confidence, evidence, warnings}`.
 */
export function buildCandidate({ spec, transcript, review, capturedAt, createdAt }) {
  if (!spec) throw new TypeError("spec is required");
  const { segments, coverage, artifactSha256 } = normalizeTranscript(transcript);

  const result = evaluateTranscript(spec, segments, coverage);
  if (result.status !== "candidate") {
    return {
      status: result.status,
      outcome: null,
      matches: result.matches ?? [],
      confidence: 0,
      evidence: null,
      warnings: [explain(result.status)],
    };
  }

  // The earliest match decides the outcome; evidence must fit one transaction,
  // so cite only that (a binary YES may match hundreds of times).
  const excerptIndexes = [...new Set(result.matches.map((m) => m.excerptIndex))]
    .sort((a, b) => a - b)
    .slice(0, MAX_EXCERPTS);
  const excerpts = excerptIndexes.map((i) => {
    const segment = segments[i];
    return { startMs: segment.startMs, endMs: segment.endMs, speaker: segment.speaker, text: segment.text };
  });

  const now = Date.now();
  const evidence = buildEvidence({
    spec,
    outcome: result.outcome,
    confidence: confidenceFor(coverage, result.matches.length),
    source: {
      provider: spec.source.provider,
      sourceId: spec.source.sourceId,
      url: spec.source.url,
      capturedAt: capturedAt ?? now,
      artifactSha256: artifactSha256 ?? hashArtifact(canonicalJson(segments)),
    },
    excerpts,
    evaluator: {
      method: "deterministic",
      version: EVALUATOR_VERSION,
      matchedExcerptIndexes: excerpts.map((_, i) => i),
    },
    review,
    createdAt: createdAt ?? now,
  });

  return {
    status: "candidate",
    outcome: result.outcome,
    matches: result.matches,
    confidence: evidence.manifest.confidence,
    evidence,
    warnings: [],
  };
}

/**
 * Build a manual/override candidate: no excerpts, operator-declared outcome.
 * Used with `--force` when the transcript is incomplete but a human resolves
 * the market. The mandatory `review` block is still required.
 */
export function buildOverrideCandidate({ spec, outcome, review, capturedAt, createdAt }) {
  if (!spec) throw new TypeError("spec is required");
  // `VOID_OUTCOME` voids the market (every position refunded) under any spec.
  if (outcome !== VOID_OUTCOME && !spec.outcomeOptions.includes(outcome)) {
    throw new TypeError(`outcome "${outcome}" is not allowed by the spec`);
  }
  const now = Date.now();
  const evidence = buildEvidence({
    spec,
    outcome,
    confidence: 100,
    source: {
      provider: spec.source.provider,
      sourceId: spec.source.sourceId,
      url: spec.source.url,
      capturedAt: capturedAt ?? now,
      artifactSha256: hashArtifact(`override:${spec.marketAddress}:${outcome}`),
    },
    excerpts: [],
    evaluator: { method: "manual", version: EVALUATOR_VERSION, matchedExcerptIndexes: [] },
    review,
    createdAt: createdAt ?? now,
  });
  return { status: "override", outcome, matches: [], confidence: 100, evidence, warnings: ["operator override"] };
}

function normalizeTranscript(transcript) {
  if (!transcript || typeof transcript !== "object") throw new TypeError("transcript is required");
  const { segments, coverage, artifactSha256 } = transcript;
  if (!Array.isArray(segments)) throw new TypeError("transcript.segments must be an array");
  if (!coverage || typeof coverage !== "object") throw new TypeError("transcript.coverage is required");
  return { segments, coverage, artifactSha256 };
}

/**
 * Simple confidence policy: full coverage is certain, partial coverage is
 * discounted. The operator may still override during review.
 */
function confidenceFor(coverage, matchCount) {
  if (coverage.status === "available") return 100;
  if (coverage.status === "partial") return matchCount > 0 ? 85 : 60;
  return 50;
}

function explain(status) {
  switch (status) {
    case "needs_more_evidence":
      return "transcript coverage is incomplete — capture from the window start through the deciding phrase";
    case "ambiguous":
      return "two outcomes matched at the same timestamp — needs human arbitration";
    case "no_match":
      return "no board phrase was spoken within the window";
    case "no_source":
      return "transcript source is unavailable";
    default:
      return `unresolved status: ${status}`;
  }
}

/**
 * Serialize a staged candidate for the tx CLI. The spec travels with the
 * candidate so `post` can re-validate the evidence before submitting.
 */
export function encodeCandidate({ spec, candidate, createdAt = Date.now() }) {
  if (!candidate?.evidence) throw new TypeError("candidate has no evidence to post");
  return {
    marketAddress: spec.marketAddress,
    specSha256: hashResolutionSpec(spec),
    status: candidate.status,
    outcome: candidate.outcome,
    confidence: candidate.confidence,
    matches: candidate.matches,
    spec,
    evidence: {
      manifest: candidate.evidence.manifest,
      sha256: candidate.evidence.sha256,
      length: candidate.evidence.length,
      bytesBase64: Buffer.from(candidate.evidence.bytes).toString("base64"),
    },
    createdAt,
  };
}

/** Inverse of {@link encodeCandidate}: restore raw evidence bytes. */
export function decodeCandidate(file) {
  if (!file?.evidence?.bytesBase64) throw new TypeError("candidate file has no evidence bytes");
  return {
    marketAddress: file.marketAddress,
    specSha256: file.specSha256,
    status: file.status,
    outcome: file.outcome,
    confidence: file.confidence,
    matches: file.matches,
    spec: file.spec,
    evidence: {
      manifest: file.evidence.manifest,
      sha256: file.evidence.sha256,
      length: file.evidence.length,
      bytes: new Uint8Array(Buffer.from(file.evidence.bytesBase64, "base64")),
    },
    createdAt: file.createdAt,
  };
}
