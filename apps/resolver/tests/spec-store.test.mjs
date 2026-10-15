import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTestDb } from "@mention/db/testing";
import { buildResolutionSpec } from "@mention/resolution/spec-builder";
import { hashResolutionSpec } from "@mention/resolution/contracts";

import {
  candidatesDir,
  createSpecStore,
  SpecConflictError,
  specFilePath,
  specsDir,
} from "../src/store/spec-store.mjs";

const MARKET = "11111111111111111111111111111111";
const SECOND = "11111111111111111111111111111112";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "resolver-store-"));
}

function binarySpec(marketAddress = MARKET, url = "https://example.com/live") {
  return buildResolutionSpec({
    marketAddress,
    marketType: "binary",
    binaryPhrase: "AI",
    sourceUrl: url,
    window: { startsAtMs: 1000, endsAtMs: 2000 },
  });
}

/** Run the same behavioural suite against each backend. */
const BACKENDS = [
  {
    name: "file",
    async open() {
      process.env.RESOLVER_DATA_DIR = tmpDir();
      return { store: createSpecStore(), close: async () => {} };
    },
  },
  {
    name: "postgres",
    async open() {
      const db = await createTestDb();
      return { store: createSpecStore({ db }), close: () => db.close() };
    },
  },
];

for (const backend of BACKENDS) {
  const it = (name, fn) =>
    test(`[${backend.name}] ${name}`, async () => {
      const { store, close } = await backend.open();
      try {
        await fn(store);
      } finally {
        await close();
      }
    });

  it("putSpec stores the record and computes the spec hash", async (store) => {
    const spec = binarySpec();
    const record = await store.putSpec({ marketAddress: MARKET, spec, ingest: { keywords: ["AI"] } });

    assert.equal(record.specSha256, hashResolutionSpec(spec));
    assert.equal(record.ingest.adapter, "operator-upload");
    assert.equal(record.ingest.mode, "manual");
    assert.deepEqual(record.ingest.keywords, ["AI"]);
    assert.equal(record.ingest.speaker, null);
    assert.equal(await store.hasSpec(MARKET), true);

    const loaded = await store.getSpec(MARKET);
    assert.deepEqual(loaded.spec, spec);
    assert.equal(loaded.specSha256, record.specSha256);
    // The stored bytes still hash to the commitment (Postgres JSONB reorders keys).
    assert.equal(hashResolutionSpec(loaded.spec), record.specSha256);
    assert.equal(typeof loaded.createdAt, "number");
  });

  it("is insert-only: same spec is a no-op, a different spec conflicts", async (store) => {
    const first = await store.putSpec({ marketAddress: MARKET, spec: binarySpec(), createdAt: 5 });
    const again = await store.putSpec({ marketAddress: MARKET, spec: binarySpec(), createdAt: 9 });
    assert.equal(again.createdAt, 5, "a repeat returns the original record untouched");
    assert.equal(again.specSha256, first.specSha256);

    await assert.rejects(
      store.putSpec({ marketAddress: MARKET, spec: binarySpec(MARKET, "https://example.com/other") }),
      (err) => err instanceof SpecConflictError && err.code === "SPEC_CONFLICT"
    );
    assert.equal((await store.getSpec(MARKET)).specSha256, first.specSha256, "original kept");
  });

  it("rejects a spec whose own marketAddress differs from the key", async (store) => {
    await assert.rejects(store.putSpec({ marketAddress: SECOND, spec: binarySpec(MARKET) }), /does not match/);
  });

  it("getSpec returns null for an unknown market", async (store) => {
    assert.equal(await store.getSpec(MARKET), null);
  });

  it("listSpecs returns every stored record ordered by createdAt", async (store) => {
    await store.putSpec({ marketAddress: MARKET, spec: binarySpec(MARKET), createdAt: 2 });
    await store.putSpec({ marketAddress: SECOND, spec: binarySpec(SECOND), createdAt: 1 });
    const all = await store.listSpecs();
    assert.deepEqual(all.map((r) => r.createdAt), [1, 2]);
  });

  it("deleteSpec removes a stored spec", async (store) => {
    await store.putSpec({ marketAddress: MARKET, spec: binarySpec() });
    assert.equal(await store.deleteSpec(MARKET), true);
    assert.equal(await store.hasSpec(MARKET), false);
    assert.equal(await store.deleteSpec(MARKET), false);
  });

  it("rejects a market address that could escape the specs directory", async (store) => {
    await assert.rejects(store.putSpec({ marketAddress: "../evil", spec: binarySpec() }), /invalid market address/);
  });
}

test("[file] records live at <data>/specs/<market>.json", async () => {
  const dir = tmpDir();
  process.env.RESOLVER_DATA_DIR = dir;
  await createSpecStore().putSpec({ marketAddress: MARKET, spec: binarySpec() });
  assert.equal(fs.existsSync(specFilePath(MARKET)), true);
  assert.equal(specsDir(), path.join(dir, "specs"));
  assert.equal(candidatesDir(), path.join(dir, "candidates"));
});
