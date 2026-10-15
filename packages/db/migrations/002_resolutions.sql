-- Resolution queue: one row per market the worker is resolving.
--
--   pending ──transcribe+evaluate──▶ candidate     (evaluator picked an outcome)
--                                  ▶ needs_review  (no outcome: coverage, ambiguity, no match)
--                                  ▶ failed        (no transcript / no spec; operator retries or forces)
--   candidate|needs_review|failed ──operator──▶ approved   (reviewer + rationale required)
--   approved ──post_evidence + propose──▶ proposed ──window──▶ finalized
--   proposed ──challenge on-chain──▶ candidate|needs_review (needs approval again)
--
-- The worker never proposes a row that isn't `approved`, and every state change
-- is a guarded UPDATE (`WHERE state = <expected>`), so the worker and the ops
-- page can't overwrite each other.
CREATE TABLE IF NOT EXISTS resolutions (
  market_address    TEXT PRIMARY KEY,
  market_id         BIGINT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN
                      ('pending', 'candidate', 'needs_review', 'failed', 'approved', 'proposed', 'finalized')),
  -- Bumped on every challenge; evidence from an earlier round is never reused.
  round             INTEGER NOT NULL DEFAULT 0,
  -- When the recording began (epoch ms). Defaults to the spec window start.
  audio_started_at  BIGINT,
  transcript        JSONB,
  transcribed_at    BIGINT,
  -- Evaluator output: { status, outcome, matches, confidence, warnings, excerpts }.
  candidate         JSONB,
  status_reason     TEXT,
  -- Operator decision.
  approved_outcome  TEXT,
  reviewer          TEXT,
  rationale         TEXT,
  approved_at       BIGINT,
  -- Exact evidence posted for this round: { bytesBase64, sha256, specSha256, outcome, confidence }.
  evidence          JSONB,
  tx_sigs           JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   BIGINT NOT NULL DEFAULT 0,
  last_error        TEXT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS resolutions_state_idx ON resolutions (state, next_attempt_at);
