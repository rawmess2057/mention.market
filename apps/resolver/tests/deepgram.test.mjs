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
    assert.equal(out.coverage.status, "partial"); // 0 to ~3800ms, duration 4500ms but from>0? from 0, through 3800, duration*0.99=4455 -> through<duration -> partial
    assert.deepEqual(out.segments, [
      { startMs: 0, endMs: 2500, speaker: "host", text: "agents are coming" },
      { startMs: 3000, endMs: 3800, speaker: "guest", text: "open source" },
    ]);
  });

  it("falls back to paragraphs when words missing", () => {
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
    // paragraphs may return "0" as string; also accept empty
    assert.ok(out.segments[0].speaker === "0" || out.segments[0].speaker === "");
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
    assert.equal(calls[0].url, "https://api.deepgram.com/v1/listen?model=nova-3&language=en");
  });

  it("requires apiKey", () => {
    assert.throws(() => new DeepgramBatchAdapter(), /DEEPGRAM_API_KEY/);
  });
});
