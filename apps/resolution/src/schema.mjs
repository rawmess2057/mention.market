/**
 * Pure resolution schema + evaluator — no Node built-ins.
 *
 * Kept separate from `contracts.mjs` so browser code (the web create flow's
 * shared spec builder) can validate without pulling `node:crypto` into the
 * client bundle. Hashing lives in `contracts.mjs`.
 */

/**
 * Reserved outcome for a voided market (every position refunded). It is valid
 * evidence for any spec without being listed in `outcomeOptions`, so existing
 * specs — and their on-chain hashes — are unchanged; no spec may list it.
 */
export const VOID_OUTCOME = "void";

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
  if (spec.outcomeOptions.some((outcome) => outcome.toLowerCase() === VOID_OUTCOME)) {
    throw new TypeError(`"${VOID_OUTCOME}" is reserved and cannot be an outcome option`);
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

/* -------------------------------- helpers -------------------------------- */

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
