import { VOID_OUTCOME } from "@mention/resolution/contracts";

/**
 * The resolution queue (`resolutions` table, `packages/db/migrations/002`).
 *
 * The worker moves rows through transcription and on-chain submission; the
 * operator (ops page / CLI) approves outcomes. Every write is a guarded
 * transition — `UPDATE … WHERE state = ANY(<allowed>)` — so a worker pass and
 * an operator click can never clobber each other: the loser gets `null`.
 *
 * Invariant: a row reaches `approved` only through {@link approve}, which
 * requires a reviewer and a rationale. The worker proposes nothing else.
 */

export const STATES = Object.freeze([
  "pending",
  "candidate",
  "needs_review",
  "failed",
  "approved",
  "proposed",
  "finalized",
]);

/** States an operator can decide from. */
export const REVIEWABLE = Object.freeze(["candidate", "needs_review", "failed"]);

const JSON_COLUMNS = new Set(["transcript", "candidate", "evidence", "tx_sigs"]);
const NUMBER_COLUMNS = new Set([
  "market_id",
  "round",
  "audio_started_at",
  "transcribed_at",
  "approved_at",
  "attempts",
  "next_attempt_at",
  "created_at",
  "updated_at",
]);
const WRITABLE = new Set([
  "state",
  "round",
  "audio_started_at",
  "transcript",
  "transcribed_at",
  "candidate",
  "status_reason",
  "approved_outcome",
  "reviewer",
  "rationale",
  "approved_at",
  "evidence",
  "tx_sigs",
  "attempts",
  "next_attempt_at",
  "last_error",
]);

/** Columns cleared whenever a row goes back for a new decision. */
const DECISION_RESET = {
  approved_outcome: null,
  reviewer: null,
  rationale: null,
  approved_at: null,
  evidence: null,
};

const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function fromRow(row) {
  if (!row) return null;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    // Neon returns BIGINT as a string, PGlite as a number/bigint.
    out[camel(key)] = NUMBER_COLUMNS.has(key) && value !== null ? Number(value) : value;
  }
  return out;
}

export class QueueError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "QueueError";
    this.code = code;
  }
}

/**
 * @param {{ db: { query(text: string, params?: unknown[]): Promise<object[]> }, now?: () => number }} deps
 */
export function createResolutionQueue({ db, now = Date.now }) {
  if (!db) throw new TypeError("the resolution queue needs a database (DATABASE_URL)");

  /**
   * Guarded transition: apply `fields` only if the row is in one of `from`.
   * @returns {Promise<object|null>} the updated row, or null if the guard failed.
   */
  async function transition(marketAddress, from, fields) {
    const sets = [];
    const params = [marketAddress, [...from]];
    for (const [key, value] of Object.entries(fields)) {
      const column = snake(key);
      if (!WRITABLE.has(column)) throw new TypeError(`column ${column} is not writable`);
      params.push(JSON_COLUMNS.has(column) && value !== null ? JSON.stringify(value) : value);
      sets.push(`${column} = $${params.length}${JSON_COLUMNS.has(column) ? "::jsonb" : ""}`);
    }
    params.push(now());
    sets.push(`updated_at = $${params.length}`);
    const rows = await db.query(
      `UPDATE resolutions SET ${sets.join(", ")}
       WHERE market_address = $1 AND state = ANY($2::text[])
       RETURNING *`,
      params
    );
    return fromRow(rows[0]);
  }

  async function get(marketAddress) {
    return fromRow((await db.query("SELECT * FROM resolutions WHERE market_address = $1", [marketAddress]))[0]);
  }

  return {
    transition,
    get,

    /** Rows (newest first), optionally filtered by state. Transcripts are omitted unless asked for. */
    async list({ states = STATES, withTranscript = false } = {}) {
      const columns = withTranscript ? "*" : "market_address, market_id, state, round, audio_started_at, transcribed_at, candidate, status_reason, approved_outcome, reviewer, rationale, approved_at, evidence, tx_sigs, attempts, next_attempt_at, last_error, created_at, updated_at";
      const rows = await db.query(
        `SELECT ${columns} FROM resolutions WHERE state = ANY($1::text[]) ORDER BY updated_at DESC`,
        [[...states]]
      );
      return rows.map(fromRow);
    },

    /** Rows in `state` whose retry backoff has elapsed. */
    async due(state) {
      const rows = await db.query(
        "SELECT * FROM resolutions WHERE state = $1 AND next_attempt_at <= $2 ORDER BY next_attempt_at, market_id",
        [state, now()]
      );
      return rows.map(fromRow);
    },

    /** Start resolving a market (idempotent: an existing row is returned untouched). */
    async enqueue({ marketAddress, marketId, audioStartedAt = null, state = "pending", statusReason = null }) {
      const t = now();
      await db.query(
        `INSERT INTO resolutions (market_address, market_id, state, audio_started_at, status_reason, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (market_address) DO NOTHING`,
        [marketAddress, marketId, state, audioStartedAt, statusReason, t]
      );
      return get(marketAddress);
    },

    /**
     * Operator decision. From `candidate` with no `outcome`, approves the
     * evaluator's outcome; otherwise `outcome` (any spec option, or "void") is
     * a forced ruling backed by manual evidence.
     *
     * @param {string} marketAddress
     * @param {{ reviewer: string, rationale: string, outcome?: string, spec: object }} decision
     */
    async approve(marketAddress, { reviewer, rationale, outcome, spec }) {
      if (typeof reviewer !== "string" || reviewer.trim().length === 0) {
        throw new QueueError("a reviewer is required", "INVALID");
      }
      // Bounded: the rationale rides in the evidence, which must fit one transaction (~800 bytes).
      if (typeof rationale !== "string" || rationale.trim().length < 8 || rationale.trim().length > 120) {
        throw new QueueError("a rationale of 8–120 characters is required", "INVALID");
      }
      const row = await get(marketAddress);
      if (!row) throw new QueueError("market is not in the resolution queue", "NOT_FOUND");
      if (!REVIEWABLE.includes(row.state)) {
        throw new QueueError(`market is ${row.state}; only ${REVIEWABLE.join("/")} can be approved`, "CONFLICT");
      }
      const chosen = outcome ?? (row.state === "candidate" ? row.candidate?.outcome : null);
      if (!chosen) throw new QueueError("an outcome is required: the evaluator did not pick one", "INVALID");
      if (chosen !== VOID_OUTCOME && !spec?.outcomeOptions?.includes(chosen)) {
        throw new QueueError(`outcome "${chosen}" is not allowed by the market's spec`, "INVALID");
      }
      const updated = await transition(marketAddress, [row.state], {
        state: "approved",
        statusReason: null,
        approvedOutcome: chosen,
        reviewer: reviewer.trim(),
        rationale: rationale.trim(),
        approvedAt: now(),
        evidence: null,
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
      });
      if (!updated) throw new QueueError("the market changed state; reload and try again", "CONFLICT");
      return updated;
    },

    /** Re-transcribe (optionally with a corrected recording start time). */
    async retry(marketAddress, { audioStartedAt } = {}) {
      if (audioStartedAt !== undefined && (!Number.isSafeInteger(audioStartedAt) || audioStartedAt < 0)) {
        throw new QueueError("audioStartedAt must be epoch milliseconds", "INVALID");
      }
      const updated = await transition(marketAddress, REVIEWABLE, {
        state: "pending",
        ...(audioStartedAt !== undefined ? { audioStartedAt } : {}),
        ...camelKeys(DECISION_RESET),
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
      });
      if (!updated) throw new QueueError("only candidate/needs_review/failed markets can be retried", "CONFLICT");
      return updated;
    },

    /** A challenge reopened the market: decide again (new round, fresh evidence). */
    async reopen(marketAddress, { state, statusReason }) {
      const row = await get(marketAddress);
      if (!row) return null;
      return transition(marketAddress, ["proposed", "approved"], {
        state,
        statusReason,
        round: row.round + 1,
        ...camelKeys(DECISION_RESET),
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
      });
    },
  };
}

function camelKeys(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [camel(k), v]));
}
