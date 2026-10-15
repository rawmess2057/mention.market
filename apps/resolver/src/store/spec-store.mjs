import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "@mention/db";
import { hashResolutionSpec } from "@mention/resolution/contracts";

/**
 * Store for the canonical resolution spec of each market.
 *
 * The program commits only `specSha256` on-chain — the spec *bytes* live here.
 * Evidence must cite the exact spec the hash was taken from, so this store is
 * the off-chain half of the on-chain commitment and is **insert-only**: storing
 * the same spec again is a no-op, a different spec for a stored market throws
 * {@link SpecConflictError}.
 *
 * Backends: Postgres when `DATABASE_URL` is set (Vercel, the worker), else
 * files under `<data>/specs/<marketAddress>.json` (tests, offline scripts).
 * Records are `{ marketAddress, spec, specSha256, ingest, createdAt }`.
 */

/**
 * @typedef {object} SpecRecord
 * @property {string} marketAddress
 * @property {object} spec          Schema-v1 resolution spec.
 * @property {string} specSha256    Hex sha256 of the canonical spec (the on-chain commitment).
 * @property {object} ingest
 * @property {number} createdAt     Epoch ms.
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

/** A different spec is already stored for this market. */
export class SpecConflictError extends Error {
  constructor(marketAddress, storedSha256, attemptedSha256) {
    super(
      `a different spec is already stored for ${marketAddress} ` +
        `(stored ${storedSha256.slice(0, 12)}…, attempted ${attemptedSha256.slice(0, 12)}…)`
    );
    this.name = "SpecConflictError";
    this.code = "SPEC_CONFLICT";
  }
}

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

/** Validate and hash a spec into its stored record. */
function buildRecord({ marketAddress, spec, ingest, createdAt }) {
  assertMarketAddress(marketAddress);
  const specSha256 = hashResolutionSpec(spec);
  if (spec.marketAddress !== marketAddress) {
    throw new TypeError(`spec.marketAddress ${spec.marketAddress} does not match ${marketAddress}`);
  }
  return {
    marketAddress,
    spec,
    specSha256,
    ingest: { ...DEFAULT_INGEST, ...ingest },
    createdAt: createdAt ?? Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* Backends: { insert(record) → stored|null, get, list, remove }       */
/* `insert` returns null when the address already exists.              */
/* ------------------------------------------------------------------ */

const fileBackend = {
  async insert(record) {
    fs.mkdirSync(specsDir(), { recursive: true });
    const file = specFilePath(record.marketAddress);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
    try {
      // `link` fails if `file` exists: an atomic create-if-absent.
      fs.linkSync(tmp, file);
      return record;
    } catch (err) {
      if (err.code === "EEXIST") return null;
      throw err;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  },
  async get(marketAddress) {
    try {
      return JSON.parse(fs.readFileSync(specFilePath(marketAddress), "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  },
  async list() {
    let entries;
    try {
      entries = fs.readdirSync(specsDir());
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(fs.readFileSync(path.join(specsDir(), name), "utf8")));
  },
  async remove(marketAddress) {
    try {
      fs.rmSync(specFilePath(marketAddress));
      return true;
    } catch (err) {
      if (err.code === "ENOENT") return false;
      throw err;
    }
  },
};

const fromRow = (row) => ({
  marketAddress: row.market_address,
  spec: row.spec,
  specSha256: row.spec_sha256,
  ingest: row.ingest,
  createdAt: Number(row.created_at),
});

function postgresBackend(db) {
  return {
    async insert(record) {
      const rows = await db.query(
        `INSERT INTO specs (market_address, spec, spec_sha256, ingest, created_at)
         VALUES ($1, $2::jsonb, $3, $4::jsonb, $5)
         ON CONFLICT (market_address) DO NOTHING
         RETURNING *`,
        [
          record.marketAddress,
          JSON.stringify(record.spec),
          record.specSha256,
          JSON.stringify(record.ingest),
          record.createdAt,
        ]
      );
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async get(marketAddress) {
      const rows = await db.query("SELECT * FROM specs WHERE market_address = $1", [marketAddress]);
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async list() {
      return (await db.query("SELECT * FROM specs")).map(fromRow);
    },
    async remove(marketAddress) {
      const rows = await db.query("DELETE FROM specs WHERE market_address = $1 RETURNING market_address", [
        marketAddress,
      ]);
      return rows.length > 0;
    },
  };
}

/**
 * A spec store over `db` (Postgres), or over the data directory when `db` is
 * null. The module-level functions below use the process default.
 */
export function createSpecStore({ db = null } = {}) {
  const backend = db ? postgresBackend(db) : fileBackend;
  return {
    /**
     * Persist a market's canonical spec (insert-only). `specSha256` is
     * recomputed from the spec, and the spec validated, so the stored
     * commitment can never drift from the bytes.
     *
     * @param {object} input
     * @param {string} input.marketAddress
     * @param {object} input.spec           Schema-v1 resolution spec.
     * @param {object} [input.ingest]       Overrides for {@link DEFAULT_INGEST}.
     * @param {number} [input.createdAt]    Epoch ms (defaults to now).
     * @returns {Promise<SpecRecord>} the stored record (the existing one on a repeat).
     */
    async putSpec(input) {
      const record = buildRecord(input);
      const inserted = await backend.insert(record);
      if (inserted) return inserted;
      const existing = await backend.get(record.marketAddress);
      if (existing && existing.specSha256 === record.specSha256) return existing;
      throw new SpecConflictError(record.marketAddress, existing?.specSha256 ?? "", record.specSha256);
    },
    /** @type {(marketAddress: string) => Promise<SpecRecord | null>} */
    getSpec: (marketAddress) => backend.get(assertMarketAddress(marketAddress)),
    hasSpec: async (marketAddress) => (await backend.get(assertMarketAddress(marketAddress))) !== null,
    /** Every stored record, sorted by `createdAt`. @type {() => Promise<SpecRecord[]>} */
    listSpecs: async () => (await backend.list()).sort((a, b) => a.createdAt - b.createdAt),
    /** Operator cleanup only (e.g. after `close_market`); specs are otherwise immutable. */
    deleteSpec: (marketAddress) => backend.remove(assertMarketAddress(marketAddress)),
  };
}

// Resolved per call: `DATABASE_URL` / `RESOLVER_DATA_DIR` may be set after import.
const defaultStore = () => createSpecStore({ db: getDb() });

/** @param {{ marketAddress: string, spec: object, ingest?: object, createdAt?: number }} input */
export const putSpec = (input) => defaultStore().putSpec(input);
export const getSpec = (marketAddress) => defaultStore().getSpec(marketAddress);
export const hasSpec = (marketAddress) => defaultStore().hasSpec(marketAddress);
export const listSpecs = () => defaultStore().listSpecs();
export const deleteSpec = (marketAddress) => defaultStore().deleteSpec(marketAddress);
