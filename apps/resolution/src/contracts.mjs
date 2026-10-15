import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";
import { evaluateTranscript, validateResolutionSpec, VOID_OUTCOME } from "./schema.mjs";

export { canonicalJson, evaluateTranscript, validateResolutionSpec, VOID_OUTCOME };

const HEX_256 = /^[a-f0-9]{64}$/;
const EVIDENCE_KEYS = [
  "schemaVersion",
  "marketAddress",
  "specSha256",
  "outcome",
  "confidence",
  "source",
  "excerpts",
  "evaluator",
  "review",
  "createdAt",
];

export function sha256Hex(value) {
  const bytes = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

export function validateEvidenceManifest(manifest, spec) {
  exactKeys(manifest, EVIDENCE_KEYS, "evidence manifest");
  integer(manifest.schemaVersion, "schemaVersion", 1, 1);
  text(manifest.marketAddress, "marketAddress", 128);
  hash(manifest.specSha256, "specSha256");
  text(manifest.outcome, "outcome", 32);
  integer(manifest.confidence, "confidence", 0, 100);

  exactKeys(manifest.source, ["provider", "sourceId", "url", "capturedAt", "artifactSha256"], "source");
  text(manifest.source.provider, "source.provider", 64);
  text(manifest.source.sourceId, "source.sourceId", 256);
  absoluteUrl(manifest.source.url, "source.url");
  integer(manifest.source.capturedAt, "source.capturedAt", 0, Number.MAX_SAFE_INTEGER);
  hash(manifest.source.artifactSha256, "source.artifactSha256");

  if (!Array.isArray(manifest.excerpts) || manifest.excerpts.length > 64) {
    throw new TypeError("excerpts must be an array with at most 64 entries");
  }
  manifest.excerpts.forEach((excerpt, index) => {
    exactKeys(excerpt, ["startMs", "endMs", "speaker", "text"], `excerpts[${index}]`);
    integer(excerpt.startMs, `excerpts[${index}].startMs`, 0, Number.MAX_SAFE_INTEGER);
    integer(excerpt.endMs, `excerpts[${index}].endMs`, 1, Number.MAX_SAFE_INTEGER);
    if (excerpt.endMs <= excerpt.startMs) throw new TypeError(`excerpts[${index}].endMs must be after startMs`);
    text(excerpt.speaker, `excerpts[${index}].speaker`, 128);
    text(excerpt.text, `excerpts[${index}].text`, 4000);
  });

  exactKeys(manifest.evaluator, ["method", "version", "matchedExcerptIndexes"], "evaluator");
  oneOf(manifest.evaluator.method, ["deterministic", "manual"], "evaluator.method");
  text(manifest.evaluator.version, "evaluator.version", 64);
  if (!Array.isArray(manifest.evaluator.matchedExcerptIndexes)) {
    throw new TypeError("evaluator.matchedExcerptIndexes must be an array");
  }
  manifest.evaluator.matchedExcerptIndexes.forEach((index, i) => {
    integer(index, `evaluator.matchedExcerptIndexes[${i}]`, 0, manifest.excerpts.length - 1);
  });

  exactKeys(manifest.review, ["reviewer", "approvedAt", "rationale"], "review");
  text(manifest.review.reviewer, "review.reviewer", 128);
  integer(manifest.review.approvedAt, "review.approvedAt", 0, Number.MAX_SAFE_INTEGER);
  text(manifest.review.rationale, "review.rationale", 2000);
  integer(manifest.createdAt, "createdAt", 0, Number.MAX_SAFE_INTEGER);
  // The evaluator never rules "void"; it is always an operator's call.
  if (manifest.outcome === VOID_OUTCOME && manifest.evaluator.method !== "manual") {
    throw new TypeError(`a "${VOID_OUTCOME}" ruling requires evaluator.method "manual"`);
  }

  if (spec !== undefined) {
    validateResolutionSpec(spec);
    if (manifest.marketAddress !== spec.marketAddress) throw new TypeError("manifest marketAddress does not match resolution spec");
    if (manifest.specSha256 !== hashResolutionSpec(spec)) throw new TypeError("manifest specSha256 does not match resolution spec");
    if (manifest.outcome !== VOID_OUTCOME && !spec.outcomeOptions.includes(manifest.outcome)) throw new TypeError("manifest outcome is not allowed by resolution spec");
    if (
      manifest.source.provider !== spec.source.provider ||
      manifest.source.sourceId !== spec.source.sourceId ||
      manifest.source.url !== spec.source.url
    ) {
      throw new TypeError("manifest source does not match resolution spec");
    }
    for (const [index, excerpt] of manifest.excerpts.entries()) {
      if (excerpt.startMs < spec.window.startsAtMs || excerpt.endMs > spec.window.endsAtMs) {
        throw new TypeError(`excerpts[${index}] is outside the resolution window`);
      }
    }
  }
  return manifest;
}

export function hashResolutionSpec(spec) {
  validateResolutionSpec(spec);
  return sha256Hex(spec);
}

export function hashEvidenceManifest(manifest, spec) {
  if (spec === undefined) throw new TypeError("resolution spec is required to hash an evidence manifest");
  validateEvidenceManifest(manifest, spec);
  return sha256Hex(manifest);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!sameStrings(actual, expected)) throw new TypeError(`${label} has missing or unknown fields`);
}

function text(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new TypeError(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
}

function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be a safe integer between ${min} and ${max}`);
  }
}

function oneOf(value, choices, label) {
  if (!choices.includes(value)) throw new TypeError(`${label} must be one of: ${choices.join(", ")}`);
}

function absoluteUrl(value, label) {
  text(value, label, 2048);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${label} must use HTTP or HTTPS`);
  }
}

function hash(value, label) {
  if (typeof value !== "string" || !HEX_256.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
