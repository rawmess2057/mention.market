import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest doesn't read tsconfig's `paths`, so the `@/` alias Next.js uses has
 * to be repeated here. Without it, any test that touches a module importing
 * `@/lib/...` (e.g. `chain.ts`) fails to resolve.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
