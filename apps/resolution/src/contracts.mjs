import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";
export { canonicalJson };

const HEX_256 = /^[a-f0-9]{64}$/;
const SPEC_KEYS = [
  "schemaVersion",
  "marketAddress",
  "marketType",
  "outcomeOptions",
  "terms",
  "source",
  "window",
  "matching",
];
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

export function validateResolutionSpec(spec) {
  exactKeys(spec, SPEC_KEYS, "resolution spec");
  integer(spec.schemaVersion, "schemaVersion", 1, 1);
  text(spec.marketAddress, "marketAddress", 128);
  oneOf(spec.marketType, ["binary", "majority"], "marketType");

  if (!Array.isArray(spec.outcomeOptions) || spec.outcomeOptions.length < 2 || spec.outcomeOptions.length > 16) {
    throw new TypeError("outcomeOptions must contain 2 to 16 outcomes");
  }
  spec.outcomeOptions.forEach((outcome, index) => text(outcome, `outcomeOptions[${index}]`, 32));
  if (new Set(spec.outcomeOptions).size !== spec.outcomeOptions.length) {
    throw new TypeError("outcomeOptions must be unique");
  }
  if (spec.marketType === "binary" && !sameStrings(spec.outcomeOptions, ["yes", "no"])) {
    throw new TypeError('binary markets must use outcomeOptions ["yes", "no"]');
  }

  if (!Array.isArray(spec.terms) || spec.terms.length < 1 || spec.terms.length > 16) {
    throw new TypeError("terms must contain 1 to 16 phrase/outcome pairs");
  }
  const phrases = new Set();
  const termOutcomes = new Set();
  spec.terms.forEach((term, index) => {
    exactKeys(term, ["phrase", "outcome"], `terms[${index}]`);
    text(term.phrase, `terms[${index}].phrase`, 128);
    text(term.outcome, `terms[${index}].outcome`, 32);
    if (!spec.outcomeOptions.includes(term.outcome)) {
      throw new TypeError(`terms[${index}].outcome must be listed in outcomeOptions`);
    }
    if (spec.matching?.mode === "token" && /\s/u.test(term.phrase.trim())) {
      throw new TypeError(`terms[${index}].phrase must be one token in token mode`);
    }
    const normalizedPhrase = term.phrase.normalize("NFKC").trim().toLocaleLowerCase("und");
    if (phrases.has(normalizedPhrase)) throw new TypeError("term phrases must be unique");
    phrases.add(normalizedPhrase);
    termOutcomes.add(term.outcome);
  });
  if (spec.marketType === "binary" && (spec.terms.length !== 1 || spec.terms[0].outcome !== "yes")) {
    throw new TypeError("binary markets require exactly one YES trigger term");
  }
  if (spec.marketType === "majority" && spec.outcomeOptions.some((outcome) => !termOutcomes.has(outcome))) {
    throw new TypeError("majority markets require a phrase term for every outcome");
  }

  exactKeys(spec.source, ["provider", "sourceId", "url"], "source");
  text(spec.source.provider, "source.provider", 64);
  text(spec.source.sourceId, "source.sourceId", 256);
  absoluteUrl(spec.source.url, "source.url");

  exactKeys(spec.window, ["startsAtMs", "endsAtMs"], "window");
  integer(spec.window.startsAtMs, "window.startsAtMs", 0, Number.MAX_SAFE_INTEGER);
  integer(spec.window.endsAtMs, "window.endsAtMs", 1, Number.MAX_SAFE_INTEGER);
  if (spec.window.endsAtMs <= spec.window.startsAtMs) {
    throw new TypeError("window.endsAtMs must be after window.startsAtMs");
  }

  exactKeys(spec.matching, ["mode", "caseSensitive", "punctuationSensitive", "speaker"], "matching");
  oneOf(spec.matching.mode, ["exact_phrase", "token"], "matching.mode");
  boolean(spec.matching.caseSensitive, "matching.caseSensitive");
  boolean(spec.matching.punctuationSensitive, "matching.punctuationSensitive");
  if (spec.matching.speaker !== null) text(spec.matching.speaker, "matching.speaker", 128);

  return spec;
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

  if (spec !== undefined) {
    validateResolutionSpec(spec);
    if (manifest.marketAddress !== spec.marketAddress) throw new TypeError("manifest marketAddress does not match resolution spec");
    if (manifest.specSha256 !== hashResolutionSpec(spec)) throw new TypeError("manifest specSha256 does not match resolution spec");
    if (!spec.outcomeOptions.includes(manifest.outcome)) throw new TypeError("manifest outcome is not allowed by resolution spec");
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

export function evaluateTranscript(spec, segments, coverage) {
  validateResolutionSpec(spec);
  exactKeys(coverage, ["status", "coveredFromMs", "coveredThroughMs"], "coverage");
  oneOf(coverage.status, ["available", "partial", "unavailable"], "coverage.status");
  integer(coverage.coveredFromMs, "coverage.coveredFromMs", 0, Number.MAX_SAFE_INTEGER);
  integer(coverage.coveredThroughMs, "coverage.coveredThroughMs", 0, Number.MAX_SAFE_INTEGER);
  if (coverage.coveredThroughMs < coverage.coveredFromMs) {
    throw new TypeError("coverage.coveredThroughMs must be at or after coveredFromMs");
  }
  if (!Array.isArray(segments) || segments.length > 100_000) {
    throw new TypeError("segments must be an array with at most 100000 entries");
  }
  segments.forEach((segment, index) => {
    exactKeys(segment, ["startMs", "endMs", "speaker", "text"], `segments[${index}]`);
    integer(segment.startMs, `segments[${index}].startMs`, 0, Number.MAX_SAFE_INTEGER);
    integer(segment.endMs, `segments[${index}].endMs`, 1, Number.MAX_SAFE_INTEGER);
    if (segment.endMs <= segment.startMs) throw new TypeError(`segments[${index}].endMs must be after startMs`);
    text(segment.speaker, `segments[${index}].speaker`, 128);
    text(segment.text, `segments[${index}].text`, 4000);
  });

  if (coverage.status === "unavailable") return { status: "no_source", outcome: null, matches: [] };

  const normalizedSegments = segments
    .map((segment, index) => ({ ...segment, index }))
    .filter((segment) => segment.startMs >= spec.window.startsAtMs && segment.endMs <= spec.window.endsAtMs)
    .filter((segment) => spec.matching.speaker === null || segment.speaker === spec.matching.speaker)
    .map((segment) => ({ ...segment, tokens: tokenize(segment.text, spec.matching) }));
  const matches = [];
  for (const term of spec.terms) {
    const target = tokenize(term.phrase, spec.matching);
    for (const segment of normalizedSegments) {
      if (containsTokens(segment.tokens, target)) {
        matches.push({ outcome: term.outcome, excerptIndex: segment.index, startMs: segment.startMs });
      }
    }
  }
  matches.sort((left, right) => left.startMs - right.startMs || left.outcome.localeCompare(right.outcome));

  if (spec.marketType === "binary") {
    if (matches.length > 0) return { status: "candidate", outcome: "yes", matches };
    const complete = coverage.status === "available" &&
      coverage.coveredFromMs <= spec.window.startsAtMs &&
      coverage.coveredThroughMs >= spec.window.endsAtMs;
    return complete
      ? { status: "candidate", outcome: "no", matches }
      : { status: "needs_more_evidence", outcome: null, matches };
  }

  if (matches.length === 0) {
    const complete = coverage.status === "available" &&
      coverage.coveredFromMs <= spec.window.startsAtMs &&
      coverage.coveredThroughMs >= spec.window.endsAtMs;
    return complete
      ? { status: "no_match", outcome: null, matches }
      : { status: "needs_more_evidence", outcome: null, matches };
  }

  const first = matches[0];
  const tied = matches.filter((match) => match.startMs === first.startMs);
  const priorCoverageComplete = coverage.coveredFromMs <= spec.window.startsAtMs &&
    coverage.coveredThroughMs >= first.startMs;
  if (!priorCoverageComplete) return { status: "needs_more_evidence", outcome: null, matches };
  if (new Set(tied.map((match) => match.outcome)).size > 1) {
    return { status: "ambiguous", outcome: null, matches: tied };
  }
  return { status: "candidate", outcome: first.outcome, matches: tied };
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

function boolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
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

function tokenize(value, matching) {
  let normalized = value.normalize("NFKC");
  if (!matching.caseSensitive) normalized = normalized.toLocaleLowerCase("und");
  if (!matching.punctuationSensitive) normalized = normalized.replace(/[\p{P}\p{S}]+/gu, " ");
  return normalized.trim().split(/\s+/u).filter(Boolean);
}

function containsTokens(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
}