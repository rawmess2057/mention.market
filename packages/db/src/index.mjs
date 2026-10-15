import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

/**
 * Minimal Postgres access shared by the web app, the resolver store and the
 * worker.
 *
 * Everything talks to a `Db` — `{ query(text, params) → Promise<rows[]> }` —
 * so production uses Neon's serverless HTTP driver (one request per query,
 * nothing pooled: right for Vercel functions) and tests swap in an in-process
 * PGlite instance (`@mention/db/testing`) with real Postgres semantics.
 */

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

/** @returns {{ query(text: string, params?: unknown[]): Promise<object[]> }} */
export function createDb(url) {
  if (!url) throw new TypeError("a Postgres connection URL is required");
  const sql = neon(url);
  return { query: (text, params = []) => sql.query(text, params) };
}

let shared;

/** The process-wide `Db` from `DATABASE_URL`, or null when it isn't set. */
export function getDb() {
  if (shared === undefined) {
    shared = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null;
  }
  return shared;
}

/**
 * Split a migration file into statements. Migrations are plain DDL: one
 * statement per `;`-terminated line group, `--` comments allowed. (Neon's
 * HTTP driver runs a single statement per query.)
 */
export function splitStatements(sqlText) {
  return sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Apply every `migrations/*.sql` not yet recorded in `schema_migrations`, in
 * filename order. Statements are written idempotently (`IF NOT EXISTS`), so a
 * run interrupted between a statement and its bookkeeping row is safe to redo.
 *
 * @returns {Promise<string[]>} names of the migrations applied by this call.
 */
export async function migrate(db, { dir = MIGRATIONS_DIR } = {}) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)"
  );
  const done = new Set((await db.query("SELECT name FROM schema_migrations")).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = [];
  for (const name of files) {
    if (done.has(name)) continue;
    for (const statement of splitStatements(fs.readFileSync(path.join(dir, name), "utf8"))) {
      await db.query(statement);
    }
    await db.query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [name, Date.now()]);
    applied.push(name);
  }
  return applied;
}
