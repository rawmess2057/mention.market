import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hashResolutionSpec } from "@mention/resolution/contracts";

/**
 * File-backed store for the canonical resolution spec of each market.
 *
 * The program commits only `specSha256` on-chain — the spec *bytes* live here.
 * Evidence must cite the exact spec the hash was taken from, so this store is
 * the off-chain half of the on-chain commitment and must never mutate a spec
 * after the market is created.
 *
 * Layout: `<data>/specs/<marketAddress>.json` →
 * `{ marketAddress, spec, specSha256, ingest, createdAt }`.
 */

// Resolve the package root from this module's own path. (Avoid `new URL(x,
// import.meta.url)`: bundlers like webpack statically rewrite that form into
// an asset import and choke on a bare directory.) Callers embedding the store
// (e.g. a Next route handler) should override via `RESOLVER_DATA_DIR`.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Default ingestion hints; the pipeline refines these per event kind. */
export const DEFAULT_INGEST = Object.freeze({
  adapter: "operator-upload",
  mode: "manual",
  keywords: [],
  speaker: null,
});

export function dataDir() {
  return process.env.RESOLVER_DATA_DIR || path.join(ROOT, "data");
}

export function specsDir() {
  return path.join(dataDir(), "specs");
}

export function candidatesDir() {
  return path.join(dataDir(), "candidates");
}

export function transcriptsDir() {
  return path.join(dataDir(), "transcripts");
}

export function audioDir() {
  return path.join(dataDir(), "audio");
}

function assertMarketAddress(marketAddress) {
  if (typeof marketAddress !== "string" || !BASE58.test(marketAddress)) {
    throw new TypeError(`invalid market address: ${JSON.stringify(marketAddress)}`);
  }
  return marketAddress;
}

export function specFilePath(marketAddress) {
  return path.join(specsDir(), `${assertMarketAddress(marketAddress)}.json`);
}

/**
 * Persist a market's canonical spec. `specSha256` is recomputed from the spec
 * (and the spec validated) so the stored commitment can never drift from the
 * bytes.
 *
 * @param {object} input
 * @param {string} input.marketAddress
 * @param {object} input.spec           Schema-v1 resolution spec.
 * @param {object} [input.ingest]       Overrides for {@link DEFAULT_INGEST}.
 * @param {number} [input.createdAt]    Epoch ms (defaults to now).
 */
export function putSpec(input) {
  const { marketAddress, spec, ingest, createdAt } = input;
  assertMarketAddress(marketAddress);
  const specSha256 = hashResolutionSpec(spec);
  const record = {
    marketAddress,
    spec,
    specSha256,
    ingest: { ...DEFAULT_INGEST, ...ingest },
    createdAt: createdAt ?? Date.now(),
  };
  const dir = specsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = specFilePath(marketAddress);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return record;
}

/** @returns {object|null} the stored record, or null when absent. */
export function getSpec(marketAddress) {
  const file = specFilePath(marketAddress);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw);
}

export function hasSpec(marketAddress) {
  return fs.existsSync(specFilePath(marketAddress));
}

/** @returns {object[]} every stored record, sorted by `createdAt`. */
export function listSpecs() {
  let entries;
  try {
    entries = fs.readdirSync(specsDir());
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(specsDir(), name), "utf8")))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function deleteSpec(marketAddress) {
  try {
    fs.rmSync(specFilePath(marketAddress));
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}
