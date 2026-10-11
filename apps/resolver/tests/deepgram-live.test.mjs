import { describe, it } from "node:test";
import assert from "node:assert";

import { DeepgramLiveTranscriber } from "../src/adapters/deepgram-live.mjs";

describe("DeepgramLiveTranscriber", () => {
  it("builds url with defaults", () => {
    const t = new DeepgramLiveTranscriber({ apiKey: "k" });
    const u = new URL(t.url());
    assert.equal(u.hostname, "api.deepgram.com");
    assert.equal(u.protocol, "wss:");
    assert.ok(u.pathname.endsWith("/v1/listen"));
    assert.equal(u.searchParams.get("model"), "nova-3");
    assert.equal(u.searchParams.get("language"), "en");
  });

  it("includes keyterm and keywords", () => {
    const t = new DeepgramLiveTranscriber({ apiKey: "k", keyterm: "apple", keywords: ["banana", "cherry"], diarize: true });
    const u = new URL(t.url());
    assert.equal(u.searchParams.get("keyterm"), "apple");
    assert.equal(u.searchParams.get("keywords"), "banana,cherry");
    assert.equal(u.searchParams.get("diarize"), "true");
  });

  it("requires apiKey", () => {
    assert.throws(() => new DeepgramLiveTranscriber(), /DEEPGRAM_API_KEY/);
  });
});
