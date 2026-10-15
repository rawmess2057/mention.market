// Apply pending migrations to the database at DATABASE_URL.
//
//   DATABASE_URL=postgres://… pnpm --filter @mention/db migrate

import { createDb, migrate } from "./index.mjs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const applied = await migrate(createDb(process.env.DATABASE_URL));
console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
