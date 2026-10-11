import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson } from "../src/canonical-json.mjs";
import { hashResolutionSpec, validateResolutionSpec } from "../src/contracts.mjs";
import { buildResolutionSpec, DEFAULT_PROVIDER } from "../src/spec-builder.mjs";

const marketAddress = "11111111111111111111111111111111";
const window = { startsAtMs: 1000, endsAtMs: 2000 };

test("builds a binary spec in the committed wire format", () => {
  const spec = buildResolutionSpec({
    marketAddress,
    marketType: "binary",
    binaryPhrase: "AI",
    sourceUrl: "https://example.com/live",
    window,
  });
  assert.equal(spec.source.provider, DEFAULT_PROVIDER);
  assert.equal(spec.source.sourceId, "https://example.com/live");
  assert.deepEqual(spec.outcomeOptions, ["yes", "no"]);
  assert.deepEqual(spec.terms, [{ phrase: "AI", outcome: "yes" }]);
  assert.equal(
    canonicalJson(spec),
    '{"marketAddress":"11111111111111111111111111111111","marketType":"binary","matching":{"caseSensitive":false,"mode":"exact_phrase","punctuationSensitive":false,"speaker":null},"outcomeOptions":["yes","no"],"schemaVersion":1,"source":{"provider":"operator-upload","sourceId":"https://example.com/live","url":"https://example.com/live"},"terms":[{"outcome":"yes","phrase":"AI"}],"window":{"endsAtMs":2000,"startsAtMs":1000}}',
  );
  assert.equal(hashResolutionSpec(spec), "d6a260decb01730f27126155d255c98daa13a0d26c7d3739ef0911e3df198a6d");
});

test("builds a majority spec with one term per board phrase", () => {
  const spec = buildResolutionSpec({
    marketAddress,
    marketType: "majority",
    words: ["data center", "AI demand", "supply"],
    sourceUrl: "https://example.com/feed",
    window,
  });
  assert.deepEqual(spec.outcomeOptions, ["data center", "AI demand", "supply"]);
  assert.deepEqual(spec.terms, [
    { phrase: "data center", outcome: "data center" },
    { phrase: "AI demand", outcome: "AI demand" },
    { phrase: "supply", outcome: "supply" },
  ]);
  assert.equal(hashResolutionSpec(spec), "869c6280cf2a7c1adfd4929c4e85909a9f515a78774e0664667e1bf0a03b569b");
});

test("result is a valid schema-v1 spec (validation on by default)", () => {
  const spec = buildResolutionSpec({
    marketAddress,
    marketType: "binary",
    binaryPhrase: "AI",
    sourceUrl: "https://example.com/live",
    window,
  });
  assert.doesNotThrow(() => validateResolutionSpec(spec));
});

test("rejects an invalid build when validate is on", () => {
  assert.throws(
    () =>
      buildResolutionSpec({
        marketAddress,
        marketType: "binary",
        binaryPhrase: "",
        sourceUrl: "https://example.com/live",
        window,
      }),
    /phrase/,
  );
});

test("rejects a non-http source url", () => {
  assert.throws(
    () =>
      buildResolutionSpec({
        marketAddress,
        marketType: "binary",
        binaryPhrase: "AI",
        sourceUrl: "ftp://example.com/live",
        window,
      }),
    /HTTP or HTTPS/,
  );
});

test("allows skipping validation for intermediate construction", () => {
  assert.doesNotThrow(() =>
    buildResolutionSpec({
      marketAddress,
      marketType: "binary",
      binaryPhrase: "",
      sourceUrl: "https://example.com/live",
      window,
      validate: false,
    }),
  );
});
