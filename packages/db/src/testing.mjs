import { migrate } from "./index.mjs";

/**
 * A fresh, migrated, in-memory Postgres (PGlite) behind the same `Db`
 * interface as production. Each call is an isolated database.
 */
export async function createTestDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  const db = {
    query: async (text, params = []) => (await pg.query(text, params)).rows,
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}
