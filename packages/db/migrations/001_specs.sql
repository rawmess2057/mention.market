-- Canonical resolution specs: the off-chain half of each market's on-chain
-- `ResolutionSpecCommitment`. Insert-only — a spec must never change once its
-- hash is committed (enforced by the store; see apps/resolver spec-store).
CREATE TABLE IF NOT EXISTS specs (
  market_address TEXT PRIMARY KEY,
  spec JSONB NOT NULL,
  spec_sha256 TEXT NOT NULL CHECK (spec_sha256 ~ '^[a-f0-9]{64}$'),
  ingest JSONB NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS specs_created_at ON specs (created_at);
