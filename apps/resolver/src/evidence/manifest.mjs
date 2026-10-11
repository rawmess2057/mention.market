import { createHash } from "node:crypto";

import { canonicalJson } from "@mention/resolution/canonical-json";
import { hashResolutionSpec, validateEvidenceManifest } from "@mention/resolution/contracts";

/**
 * Build the schema-v1 evidence manifest that `post_evidence` commits on-chain.
 *
 * Two hard on-chain limits shape this module:
 *   - the program stores at most {@link MAX_EVIDENCE_LEN} raw bytes, and
 *   - the manifest must have *exactly* the v1 keys (`validateEvidenceManifest`
 *     rejects unknown/missing fields).
 *
 * So assembly validates the manifest against its spec, then shrinks the
 * excerpts (shortest possible matched context) until the canonical JSON fits.
 * A mandatory `review` block means evidence can never be posted unreviewed —
 * the stage-for-approval policy is enforced by the schema itself.
 */

/** `constants.rs` `MAX_EVIDENCE_LEN`. */
export const MAX_EVIDENCE_LEN = 4096;

/** Preferred per-excerpt text length before shrinking kicks in. */
export const DEFAULT_EXCERPT_TEXT_CAP = 480;

/** Minimum excerpt text length we will shrink to before failing. */
const MIN_EXCERPT_TEXT_CAP = 8;

export const EVALUATOR_VERSION = "resolver/0.1.0";

/** SHA-256 (hex) of raw bytes or a string — the evidence `artifactSha256`. */
export function hashArtifact(value) {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Assemble, validate, fit, and hash an evidence manifest.
 *
 * @param {object} input
 * @param {object} input.spec              The market's canonical resolution spec.
 * @param {string} input.outcome           Winning outcome (must be in the spec).
 * @param {number} input.confidence        0–100.
 * @param {object} input.source            `{provider, sourceId, url, capturedAt, artifactSha256}`.
 * @param {Array}  input.excerpts          `[{startMs, endMs, speaker, text}]`.
 * @param {object} [input.evaluator]       `{method, version, matchedExcerptIndexes}`.
 * @param {object} input.review            `{reviewer, approvedAt, rationale}` (required).
 * @param {number} [input.createdAt]
 * @param {number} [input.maxBytes]        Defaults to {@link MAX_EVIDENCE_LEN}.
 * @returns {{manifest:object, bytes:Uint8Array, sha256:string, length:number}}
 */
export function buildEvidence(input) {
  const {
    spec,
    outcome,
    confidence,
    source,
    excerpts,
    evaluator,
    review,
    createdAt = Date.now(),
    maxBytes = MAX_EVIDENCE_LEN,
  } = input;

  if (!spec) throw new TypeError("spec is required to build evidence");
  if (review === null || typeof review !== "object" || Array.isArray(review)) {
    throw new TypeError("review is required — evidence cannot be posted unreviewed");
  }

  const manifest = {
    schemaVersion: 1,
    marketAddress: spec.marketAddress,
    specSha256: hashResolutionSpec(spec),
    outcome,
    confidence,
    source,
    excerpts: excerpts.map((e) => ({ ...e })),
    evaluator: {
      method: evaluator?.method ?? "manual",
      version: evaluator?.version ?? EVALUATOR_VERSION,
      matchedExcerptIndexes: [...(evaluator?.matchedExcerptIndexes ?? [])],
    },
    review,
    createdAt,
  };

  const fitted = fitToBudget(manifest, spec, maxBytes);
  validateEvidenceManifest(fitted, spec);

  const bytes = new Uint8Array(Buffer.from(canonicalJson(fitted), "utf8"));
  if (bytes.length > maxBytes) {
    throw new Error(
      `evidence is ${bytes.length} bytes, over the ${maxBytes}-byte cap; shorten review.rationale or excerpts`,
    );
  }
  return { manifest: fitted, bytes, sha256: hashArtifact(bytes), length: bytes.length };
}

/**
 * Shrink excerpts until the canonical bytes fit the budget, keeping every
 * excerpt referenced by `evaluator.matchedExcerptIndexes`.
 */
function fitToBudget(manifest, spec, maxBytes) {
  const work = structuredClone(manifest);
  if (size(work) <= maxBytes) return work;

  let cap = DEFAULT_EXCERPT_TEXT_CAP;
  while (size(work) > maxBytes && cap >= MIN_EXCERPT_TEXT_CAP) {
    work.excerpts = work.excerpts.map((e) => ({ ...e, text: capText(e.text, cap) }));
    if (size(work) <= maxBytes) return work;
    cap = Math.floor(cap / 2);
  }

  // Drop unmatched trailing excerpts (remapping matched indexes) as a last
  // resort. Matched excerpts are never dropped; if those alone overflow, the
  // final byte check in `buildEvidence` fails with a clear message.
  const matched = new Set(work.evaluator.matchedExcerptIndexes);
  while (size(work) > maxBytes && work.excerpts.length > matched.size) {
    let drop = -1;
    for (let i = work.excerpts.length - 1; i >= 0; i -= 1) {
      if (!matched.has(i)) {
        drop = i;
        break;
      }
    }
    if (drop === -1) break;
    work.excerpts.splice(drop, 1);
    work.evaluator.matchedExcerptIndexes = work.evaluator.matchedExcerptIndexes
      .filter((i) => i !== drop)
      .map((i) => (i > drop ? i - 1 : i));
    matched.clear();
    for (const i of work.evaluator.matchedExcerptIndexes) matched.add(i);
  }

  return work;
}

function size(manifest) {
  return Buffer.byteLength(canonicalJson(manifest), "utf8");
}

function capText(text, max) {
  if (typeof text !== "string" || text.length <= max) return text;
  return text.slice(0, Math.max(1, max));
}
