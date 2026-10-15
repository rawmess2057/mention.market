import { describe, it, mock } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DeepgramBatchAdapter, normalizeDeepgramResponse } from "../src/adapters/deepgram.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_WAV = path.join(__dirname, "fixtures", "tiny.wav");

describe("normalizeDeepgramResponse", () => {
  it("collapses word-level segments with speaker diarization", () => {
    const json = {
      duration: 4.5,
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: "agents are coming",
                words: [
                  { word: "agents", start: 0, end: 1.5, speaker: "host" },
                  { word: "are", start: 1.5, end: 2.0, speaker: "host" },
                  { word: "coming", start: 2.0, end: 2.5, speaker: "host" },
                  { word: "open", start: 3.0, end: 3.2, speaker: "guest" },
                  { word: "source", start: 3.2, end: 3.8, speaker: "guest" },
                ],
              },
            ],
          },
        ],
      },
    };

    const out = normalizeDeepgramResponse(json);
    // The whole file was transcribed: trailing silence is still covered.
    assert.deepEqual(out.coverage, { status: "available", coveredFromMs: 0, coveredThroughMs: 4500 });
    assert.deepEqual(out.segments, [
      { startMs: 0, endMs: 2500, speaker: "host", text: "agents are coming" },
      { startMs: 3000, endMs: 3800, speaker: "guest", text: "open source" },
    ]);
  });

  it("falls back to one segment when word timings are missing", () => {
    const json = {
      duration: 2.0,
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: "hello world",
                paragraphs: {
                  paragraphs: [
                    { start: 0, end: 2.0, speaker: "0", transcript: "hello world" },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
    const out = normalizeDeepgramResponse(json);
    assert.equal(out.segments[0].text, "hello world");
    assert.deepEqual(out.segments, [{ startMs: 0, endMs: 2000, speaker: "unknown", text: "hello world" }]);
  });

  it("marks coverage available if spans most of audio", () => {
    const json = {
      duration: 10.0,
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: "x",
                words: [
                  { word: "x", start: 0, end: 10.0, speaker: "host" },
                ],
              },
            ],
          },
        ],
      },
    };
    const out = normalizeDeepgramResponse(json);
    assert.equal(out.coverage.status, "available");
    assert.equal(out.coverage.coveredFromMs, 0);
    assert.equal(out.coverage.coveredThroughMs, 10000);
  });
});

describe("normalizeDeepgramResponse (real-shaped)", () => {
  const word = (w, start, end, speaker = 0) => ({
    word: w.toLowerCase().replace(/[^a-z0-9']/g, ""),
    punctuated_word: w,
    start,
    end,
    confidence: 0.99,
    speaker,
    speaker_confidence: 0.9,
  });

  it("reads metadata.duration, keeps punctuation, labels speakers", () => {
    const json = {
      metadata: { request_id: "req-1", duration: 12.5, channels: 1 },
      results: { channels: [{ alternatives: [{ transcript: "Hello there. Hi.", words: [
        word("Hello", 0.5, 0.9),
        word("there.", 0.9, 1.3),
        word("Hi.", 1.6, 1.9, 1),
      ] }] }] },
    };
    const out = normalizeDeepgramResponse(json);
    assert.deepEqual(out.coverage, { status: "available", coveredFromMs: 0, coveredThroughMs: 12500 });
    assert.deepEqual(out.segments, [
      { startMs: 500, endMs: 1300, speaker: "0", text: "Hello there." },
      { startMs: 1600, endMs: 1900, speaker: "1", text: "Hi." },
    ]);
    assert.match(out.artifactSha256, /^[a-f0-9]{64}$/);
  });

  it("splits long monologues at sentence ends and long pauses", () => {
    const words = [];
    let t = 0;
    for (let i = 0; i < 100; i += 1) {
      words.push(word(i % 10 === 9 ? `w${i}.` : `w${i}`, t, t + 0.2));
      t += 0.25;
    }
    words.push(word("after", t + 3, t + 3.2)); // 3s pause
    const out = normalizeDeepgramResponse({
      metadata: { duration: t + 4 },
      results: { channels: [{ alternatives: [{ transcript: "", words }] }] },
    });
    assert.ok(out.segments.length >= 3);
    for (const s of out.segments) {
      assert.ok(s.text.split(" ").length <= 120);
      assert.equal(s.speaker, "0");
    }
    assert.equal(out.segments.at(-1).text, "after");
  });

  it("splits at window edges, isolating a word that crosses one", () => {
    const json = {
      metadata: { duration: 10 },
      results: { channels: [{ alternatives: [{ transcript: "", words: [
        word("before", 1.0, 1.4),
        word("crossing", 1.8, 2.3), // crosses the 2.0s edge
        word("inside", 2.4, 2.8),
        word("phrase", 2.8, 3.2),
      ] }] }] },
    };
    const out = normalizeDeepgramResponse(json, { startedAtMs: 1_000_000, splitAtMs: [1_002_000] });
    assert.deepEqual(
      out.segments.map((s) => [s.startMs, s.endMs, s.text]),
      [
        [1_001_000, 1_001_400, "before"],
        [1_001_800, 1_002_300, "crossing"],
        [1_002_400, 1_003_200, "inside phrase"],
      ]
    );
    assert.deepEqual(out.coverage, { status: "available", coveredFromMs: 1_000_000, coveredThroughMs: 1_010_000 });
  });

  it("is unavailable without a duration", () => {
    const out = normalizeDeepgramResponse({ results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] } });
    assert.equal(out.coverage.status, "unavailable");
  });
});

describe("DeepgramBatchAdapter", () => {
  it("transcribes a file via postBinary with inferred content-type", async () => {
    const calls = [];
    const http = {
      async postBinary(url, bytes, contentType, headers) {
        calls.push({ url, bytesLen: bytes.length, contentType, headers });
        return {
          duration: 0.01,
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: "tiny",
                    words: [{ word: "tiny", start: 0, end: 0.01, speaker: "A" }],
                  },
                ],
              },
            ],
          },
        };
      },
      async postJson() {
        throw new Error("not used");
      },
      async get() {
        throw new Error("not used");
      },
    };

    const adapter = new DeepgramBatchAdapter({ apiKey: "k", http });
    const res = await adapter.transcribeFile(FIXTURE_WAV);
    assert.equal(res.segments[0].text, "tiny");
    assert.equal(res.segments[0].speaker, "A");
    assert.equal(calls[0].contentType, "audio/wav");
    assert.ok(calls[0].url.includes("model=nova-3"));
    assert.ok(calls[0].url.includes("language=en"));
    assert.ok(calls[0].headers.authorization.startsWith("Token"));
  });

  it("transcribes a URL via postJson", async () => {
    const calls = [];
    const http = {
      async postJson(url, body, headers) {
        calls.push({ url, body, headers });
        return {
          duration: 1.0,
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: "hi",
                    words: [{ word: "hi", start: 0, end: 1.0, speaker: "" }],
                  },
                ],
              },
            ],
          },
        };
      },
      async postBinary() {
        throw new Error("not used");
      },
      async get() {
        throw new Error("not used");
      },
    };
    const adapter = new DeepgramBatchAdapter({ apiKey: "k", http });
    const res = await adapter.transcribeUrl("https://example.com/a.mp3");
    assert.equal(res.segments[0].text, "hi");
    assert.equal(calls[0].body.url, "https://example.com/a.mp3");
    assert.equal(res.segments[0].speaker, "unknown");
    assert.equal(
      calls[0].url,
      "https://api.deepgram.com/v1/listen?model=nova-3&language=en&diarize=true&smart_format=true"
    );
  });

  it("requires apiKey", () => {
    assert.throws(() => new DeepgramBatchAdapter(), /DEEPGRAM_API_KEY/);
  });
});
