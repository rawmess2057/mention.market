import assert from "node:assert/strict";
import test from "node:test";

import { migrate, splitStatements } from "../src/index.mjs";
import { createTestDb } from "../src/testing.mjs";

test("splitStatements drops comments and splits on terminating semicolons", () => {
  const sql = "-- header\nCREATE TABLE a (x INT);\n\n-- note\nCREATE INDEX b ON a (x);\n";
  assert.deepEqual(splitStatements(sql), ["CREATE TABLE a (x INT)", "CREATE INDEX b ON a (x)"]);
});

test("migrate creates the schema once and is a no-op afterwards", async () => {
  const db = await createTestDb();
  try {
    const tables = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1"
    );
    assert.deepEqual(tables.map((t) => t.table_name), ["schema_migrations", "specs"]);
    assert.deepEqual(await migrate(db), [], "second run applies nothing");
  } finally {
    await db.close();
  }
});

test("specs rejects a malformed hash at the database level", async () => {
  const db = await createTestDb();
  try {
    await assert.rejects(
      db.query(
        "INSERT INTO specs (market_address, spec, spec_sha256, ingest, created_at) VALUES ($1, $2, $3, $4, $5)",
        ["m", {}, "not-a-hash", {}, 1]
      ),
      /check constraint/i
    );
  } finally {
    await db.close();
  }
});
