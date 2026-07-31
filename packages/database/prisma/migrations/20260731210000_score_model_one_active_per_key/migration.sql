-- Enforce one ACTIVE score model per key (Agent 08 lifecycle invariant).
-- Application activation still archives siblings in the same transaction;
-- this index makes concurrent activations fail cleanly instead of leaving two ACTIVE rows.

CREATE UNIQUE INDEX IF NOT EXISTS score_models_one_active_per_key
ON "score_models" (key)
WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS score_models_status_idx
ON "score_models" (status);
