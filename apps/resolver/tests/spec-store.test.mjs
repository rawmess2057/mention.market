import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildResolutionSpec } from "@mention/resolution/spec-builder";
import { hashResolutionSpec } from "@mention/resolution/contracts";

import {
  candidatesDir,
  deleteSpec,
  getSpec,
  hasSpec,
  listSpecs,
  putSpec,
  specFilePath,
  specsDir,
} from "../src/store/spec-store.mjs";

const MARKET = "11111111111111111111111111111111";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "resolver-store-"));
}

function binarySpec(url = "https://example.com/live") {
  return buildResolutionSpec({
    marketAddress: MARKET,
    marketType: "binary",
    binaryPhrase: "AI",
    sourceUrl: url,
    window: { startsAtMs: 1000, endsAtMs: 2000 },
  });
}

test("putSpec stores the record and computes the spec hash", () => {
  process.env.RESOLVER_DATA_DIR = tmpDir();
  const spec = binarySpec();
  const record = putSpec({ marketAddress: MARKET, spec, ingest: { keywords: ["AI"] } });

  assert.equal(record.specSha256, hashResolutionSpec(spec));
  assert.equal(record.ingest.adapter, "operator-upload");
  assert.equal(record.ingest.mode, "manual");
  assert.deepEqual(record.ingest.keywords, ["AI"]);
  assert.equal(record.ingest.speaker, null);

  assert.equal(hasSpec(MARKET), true);
  assert.equal(fs.existsSync(specFilePath(MARKET)), true);

  const loaded = getSpec(MARKET);
  assert.deepEqual(loaded.spec, spec);
  assert.equal(loaded.specSha256, record.specSha256);
});

test("getSpec returns null for an unknown market", () => {
  process.env.RESOLVER_DATA_DIR = tmpDir();
  assert.equal(getSpec(MARKET), null);
});

test("listSpecs returns every stored record ordered by createdAt", () => {
  process.env.RESOLVER_DATA_DIR = tmpDir();
  const second = "11111111111111111111111111111112";
  putSpec({ marketAddress: MARKET, spec: binarySpec(), createdAt: 2 });
  putSpec({ marketAddress: second, spec: binarySpec("https://example.com/two"), createdAt: 1 });

  const all = listSpecs();
  assert.equal(all.length, 2);
  assert.equal(all[0].createdAt, 1);
  assert.equal(all[1].createdAt, 2);
});

test("deleteSpec removes a stored spec", () => {
  process.env.RESOLVER_DATA_DIR = tmpDir();
  putSpec({ marketAddress: MARKET, spec: binarySpec() });
  assert.equal(deleteSpec(MARKET), true);
  assert.equal(hasSpec(MARKET), false);
  assert.equal(deleteSpec(MARKET), false);
});

test("rejects a market address that could escape the specs directory", () => {
  process.env.RESOLVER_DATA_DIR = tmpDir();
  assert.throws(() => putSpec({ marketAddress: "../evil", spec: binarySpec() }), /invalid market address/);
});

test("specsDir and candidatesDir live under the configured data dir", () => {
  const dir = tmpDir();
  process.env.RESOLVER_DATA_DIR = dir;
  assert.equal(specsDir(), path.join(dir, "specs"));
  assert.equal(candidatesDir(), path.join(dir, "candidates"));
});
