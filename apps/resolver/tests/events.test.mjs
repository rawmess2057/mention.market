import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyEvent,
  createEvent,
  EVENT_KINDS,
  recommendedAdapter,
} from "../src/events/model.mjs";

const canonicalSource = { provider: "rss", sourceId: "ep-1", url: "https://example.com/feed.xml" };

test("classifies events by provider first, then vertical", () => {
  assert.equal(classifyEvent({ provider: "rss", vertical: "streams" }), "podcast");
  assert.equal(classifyEvent({ provider: "twitch-live", vertical: "podcasts" }), "livestream");
  assert.equal(classifyEvent({ provider: "official-webcast", vertical: "streams" }), "fixed_time");
  assert.equal(classifyEvent({ vertical: "streams" }), "livestream");
  assert.equal(classifyEvent({ vertical: "podcasts" }), "podcast");
  assert.equal(classifyEvent({ vertical: "earnings" }), "fixed_time");
  assert.equal(classifyEvent({}), "fixed_time");
});

test("recommendedAdapter maps each kind to its target ingestion adapter", () => {
  for (const kind of EVENT_KINDS) {
    assert.equal(typeof recommendedAdapter(kind), "string");
  }
  assert.equal(recommendedAdapter("livestream"), "deepgram-live");
  assert.equal(recommendedAdapter("podcast"), "deepgram-batch");
  assert.equal(recommendedAdapter("fixed_time"), "deepgram-batch");
});

test("createEvent fills defaults and keeps the canonical source", () => {
  const event = createEvent({
    marketAddress: "11111111111111111111111111111111",
    vertical: "podcasts",
    window: { startsAtMs: 1000, endsAtMs: 2000 },
    canonicalSource,
  });

  assert.equal(event.kind, "podcast");
  assert.equal(event.ingest.adapter, "operator-upload");
  assert.equal(event.ingest.mode, "manual");
  assert.deepEqual(event.keywords, []);
  assert.equal(event.speaker, null);
  assert.equal(event.probe, null);
  assert.deepEqual(event.canonicalSource, canonicalSource);
});

test("createEvent carries explicit kind, probe, keywords and speaker", () => {
  const event = createEvent({
    marketAddress: "11111111111111111111111111111111",
    kind: "livestream",
    window: { startsAtMs: 1000, endsAtMs: 2000 },
    canonicalSource,
    probe: { provider: "twitch-live", sourceId: "chan", url: "https://twitch.tv/x" },
    speaker: "host",
    keywords: ["AI", "agents"],
    ingest: { adapter: "deepgram-live", mode: "live" },
  });

  assert.equal(event.kind, "livestream");
  assert.equal(event.speaker, "host");
  assert.deepEqual(event.keywords, ["AI", "agents"]);
  assert.deepEqual(event.ingest, { adapter: "deepgram-live", mode: "live" });
  assert.equal(event.probe.provider, "twitch-live");
});

test("createEvent rejects a window that does not advance", () => {
  assert.throws(
    () =>
      createEvent({
        marketAddress: "11111111111111111111111111111111",
        vertical: "streams",
        window: { startsAtMs: 2000, endsAtMs: 1000 },
        canonicalSource,
      }),
    /endsAtMs must be after/,
  );
});

test("createEvent rejects a non-http canonical source", () => {
  assert.throws(
    () =>
      createEvent({
        marketAddress: "11111111111111111111111111111111",
        vertical: "streams",
        window: { startsAtMs: 1000, endsAtMs: 2000 },
        canonicalSource: { provider: "rss", sourceId: "e", url: "ftp://example.com/x" },
      }),
    /HTTP or HTTPS/,
  );
});

test("createEvent rejects an unknown ingest mode", () => {
  assert.throws(
    () =>
      createEvent({
        marketAddress: "11111111111111111111111111111111",
        vertical: "streams",
        window: { startsAtMs: 1000, endsAtMs: 2000 },
        canonicalSource,
        ingest: { mode: "telepathy" },
      }),
    /ingest.mode must be one of/,
  );
});
