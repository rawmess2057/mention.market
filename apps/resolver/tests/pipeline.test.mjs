import assert from "node:assert/strict";
import test from "node:test";

import { buildResolutionSpec } from "@mention/resolution/spec-builder";

import {
  buildCandidate,
  buildOverrideCandidate,
  decodeCandidate,
  encodeCandidate,
  MAX_EXCERPTS,
  normalizeTranscriptTime,
} from "../src/pipeline.mjs";
import { normalizeDeepgramResponse } from "../src/adapters/deepgram.mjs";

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

/* ---- Deepgram batch → time base → candidate (end to end) ---- */

// A recording of an hour-long event: audio-relative seconds, as Deepgram returns.
const EVENT_START = 1_790_000_000_000;
const EVENT_END = EVENT_START + 3_600_000;
const eventWindow = { startsAtMs: EVENT_START, endsAtMs: EVENT_END };

function deepgramJson(lines, durationSec = 3600) {
  const words = [];
  for (const [startSec, speaker, sentence] of lines) {
    sentence.split(" ").forEach((w, i) => {
      words.push({
        word: w.toLowerCase().replace(/[^a-z0-9']/g, ""),
        punctuated_word: w,
        start: startSec + i * 0.3,
        end: startSec + i * 0.3 + 0.25,
        confidence: 0.98,
        speaker,
      });
    });
  }
  return {
    metadata: { request_id: "dg-req", duration: durationSec, channels: 1 },
    results: { channels: [{ alternatives: [{ transcript: lines.map((l) => l[2]).join(" "), words }] }] },
  };
}

function binaryAt(window) {
  return buildResolutionSpec({ marketAddress: MARKET, marketType: "binary", binaryPhrase: "artificial intelligence", sourceUrl, window });
}

test("normalizeTranscriptTime shifts segments and coverage onto the epoch clock", () => {
  const raw = normalizeDeepgramResponse(deepgramJson([[10, 0, "Hello world."]], 60));
  const t = normalizeTranscriptTime(raw, EVENT_START);
  assert.equal(t.segments[0].startMs, EVENT_START + 10_000);
  assert.deepEqual(t.coverage, { status: "available", coveredFromMs: EVENT_START, coveredThroughMs: EVENT_START + 60_000 });
  assert.equal(t.artifactSha256, raw.artifactSha256);
  assert.throws(() => normalizeTranscriptTime(raw, -1), /audioStartedAtMs/);
});

test("a real-shaped Deepgram recording resolves YES with a capped excerpt list", () => {
  const raw = normalizeDeepgramResponse(
    deepgramJson([
      [5, 0, "Welcome back to the show."],
      [600, 1, "Let us talk about artificial intelligence."],
      [1200, 0, "Artificial intelligence again."],
      [1800, 1, "More artificial intelligence."],
      [2400, 0, "Artificial intelligence, once more."],
    ])
  );
  const spec = binaryAt(eventWindow);
  // Without the time shift nothing falls inside the epoch window.
  assert.equal(buildCandidate({ spec, transcript: raw, review }).status, "needs_more_evidence");

  const candidate = buildCandidate({ spec, transcript: normalizeTranscriptTime(raw, EVENT_START), review });
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.outcome, "yes");
  assert.equal(candidate.matches.length, 4);
  assert.equal(candidate.evidence.manifest.excerpts.length, MAX_EXCERPTS);
  assert.equal(candidate.evidence.manifest.excerpts[0].startMs, EVENT_START + 600_000);
  assert.equal(candidate.evidence.manifest.excerpts[0].speaker, "1");
  assert.ok(candidate.evidence.length <= 4096);
});

test("a full recording with no trigger resolves NO; a short one needs review", () => {
  const lines = [[5, 0, "Nothing about that topic today."]];
  const full = normalizeTranscriptTime(normalizeDeepgramResponse(deepgramJson(lines, 3600)), EVENT_START);
  const no = buildCandidate({ spec: binaryAt(eventWindow), transcript: full, review });
  assert.equal(no.status, "candidate");
  assert.equal(no.outcome, "no");

  const short = normalizeTranscriptTime(normalizeDeepgramResponse(deepgramJson(lines, 1800)), EVENT_START);
  assert.equal(buildCandidate({ spec: binaryAt(eventWindow), transcript: short, review }).status, "needs_more_evidence");
});

test("a real Deepgram response (fixture) resolves through the whole pipeline", async () => {
  const { readFile } = await import("node:fs/promises");
  const json = JSON.parse(await readFile(new URL("./fixtures/deepgram-spacewalk.json", import.meta.url), "utf8"));
  const raw = normalizeDeepgramResponse(json);
  assert.deepEqual(raw.coverage, { status: "available", coveredFromMs: 0, coveredThroughMs: 25_933 });
  assert.ok(raw.segments.every((s) => s.speaker === "0" && s.text.length <= 4000));

  // The window ends mid-sentence (25.0s; the speech runs to 25.4s).
  const recordingWindow = { startsAtMs: EVENT_START, endsAtMs: EVENT_START + 25_000 };
  const unsplit = normalizeTranscriptTime(raw, EVENT_START);
  const transcript = normalizeDeepgramResponse(json, {
    startedAtMs: EVENT_START,
    splitAtMs: [recordingWindow.startsAtMs, recordingWindow.endsAtMs],
  });
  const spec = (phrase) =>
    buildResolutionSpec({ marketAddress: MARKET, marketType: "binary", binaryPhrase: phrase, sourceUrl, window: recordingWindow });

  // Unsplit, the one straddling segment falls outside the window: a false NO.
  assert.equal(buildCandidate({ spec: spec("all female team"), transcript: unsplit, review }).outcome, "no");

  const yes = buildCandidate({ spec: spec("all female team"), transcript, review });
  assert.equal(yes.status, "candidate");
  assert.equal(yes.outcome, "yes");
  assert.ok(yes.evidence.length <= 4096);

  const no = buildCandidate({ spec: spec("moon landing"), transcript, review });
  assert.equal(no.status, "candidate");
  assert.equal(no.outcome, "no");
});

test("real-transcript evidence fits one transaction and still quotes the phrase", async () => {
  const { readFile } = await import("node:fs/promises");
  const { MAX_POSTABLE_EVIDENCE_LEN } = await import("../src/evidence/manifest.mjs");
  const json = JSON.parse(await readFile(new URL("./fixtures/deepgram-spacewalk.json", import.meta.url), "utf8"));
  const window = { startsAtMs: EVENT_START, endsAtMs: EVENT_START + 300_000 };
  const spec = buildResolutionSpec({ marketAddress: MARKET, marketType: "binary", binaryPhrase: "all female team", sourceUrl: "https://dpgr.am/spacewalk.wav", window });
  const transcript = normalizeDeepgramResponse(json, { startedAtMs: EVENT_START, splitAtMs: [window.startsAtMs, window.endsAtMs] });
  // An /ops approval: a wallet as reviewer and a typical rationale.
  const longReview = { reviewer: "CD69UjQitwnnPwHkFSYNsL2Qh7PW3hdqBNU1cQSrXFj", approvedAt: EVENT_START, rationale: "Phrase heard ~7s in; matches the spec." };
  const candidate = buildCandidate({ spec, transcript, review: longReview });
  assert.equal(candidate.outcome, "yes");
  assert.ok(candidate.evidence.length <= MAX_POSTABLE_EVIDENCE_LEN, `${candidate.evidence.length} bytes`);
  const [excerpt] = candidate.evidence.manifest.excerpts;
  assert.match(excerpt.text, /all female team/);
  assert.ok(excerpt.text.startsWith("…"), "trimmed around the phrase, not from the start");
});
