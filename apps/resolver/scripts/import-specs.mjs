// One-off: copy every file-backed spec (apps/resolver/data/specs, or
// RESOLVER_DATA_DIR) into Postgres. Idempotent — the store is insert-only, so
// re-running skips specs already imported; a *different* spec already stored
// for a market is reported, never overwritten.
//
//   DATABASE_URL=postgres://… node apps/resolver/scripts/import-specs.mjs

import { createDb } from "@mention/db";

import { createSpecStore } from "../src/store/spec-store.mjs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const files = createSpecStore();
const pg = createSpecStore({ db: createDb(process.env.DATABASE_URL) });

let imported = 0;
let conflicts = 0;
for (const record of await files.listSpecs()) {
  try {
    const before = await pg.hasSpec(record.marketAddress);
    await pg.putSpec(record);
    if (!before) imported += 1;
  } catch (err) {
    conflicts += 1;
    console.error(`  ${record.marketAddress}: ${err.message}`);
  }
}
console.log(`imported ${imported}, already present ${(await files.listSpecs()).length - imported - conflicts}, conflicts ${conflicts}`);
