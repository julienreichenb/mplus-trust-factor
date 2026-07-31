# Score model lifecycle

## Source of truth

- **Database** `ScoreModel` rows (versioned, immutable once activated for a given version lineage).
- Drafts may be edited and validated in admin UI.
- Activation is transactional, audited, and performed from the admin website (or seed for empty DBs).
- A partial unique index enforces **one ACTIVE row per model key**.

## Environment variables

| Variable | Role |
|----------|------|
| `ACTIVE_SCORE_MODEL_KEY` | Empty-DB / seed bootstrap default key only (default `default`) |
| `ACTIVE_SCORE_MODEL_VERSION` | Empty-DB / seed bootstrap default version only (default **6**) |

**Normal model activation is not an env-var change.** Runtime code resolves the active model from the database (`getActiveModel()`). Env values are fallbacks only when the catalog is empty (e.g. `/meta` before seed).

CD (`deploy.sh`) runs seed **only when the ScoreModel catalog is empty**. It must never treat editing `ACTIVE_SCORE_MODEL_*` on the VPS as activation.

## Empty-database bootstrap

1. Migrate (`pnpm db:migrate` / deploy migrate).
2. If `ScoreModel` count is 0, run seed (`pnpm db:seed` / CD seed gate).
3. Seed upserts `default` v1–v6 and leaves **v6 ACTIVE**.
4. After seed, admin activation and runtime scoring use the DB ACTIVE row only.

Bootstrap is idempotent: re-running seed on a non-empty catalog does not flip activation via env.

## Activation behaviour

1. Admin confirms activation of a **validated DRAFT** (UI confirmation + `confirm: true`).
2. Server refuses non-DRAFT and invalid config.
3. Transaction: archive previous ACTIVE for the same key → set draft ACTIVE (`activatedAt`).
4. Optimistic concurrency: optional `expectedPreviousActiveId` aborts with `409 ACTIVE_MODEL_CONFLICT` on mismatch.
5. Audit: `admin.score_models.activate`.
6. Enqueue progressive **`RECALCULATE_ONLY`** for all persisted characters (`logicalKey = model-activate:<id>`).
7. If enqueue fails after commit: activation remains; audit `FAILURE` on enqueue; admin retries via Bulk processing.
8. No provider calls during the activation request itself.
9. Published snapshots stay visible until recalculated replacements publish.

## Admin backtest

`POST /api/v1/admin/score-models/:id/backtest` exports a real persisted cohort (public CHARACTER snapshots + observations when available) into a `CalibrationInputBundleV1`, then runs the Agent 10 harness (`persisted-snapshot-only` or `active-versus-draft`). Never activates models and never calls providers.

## Bulk modes (programme)

- `FULL_REFRESH` — providers + score
- `RECALCULATE_ONLY` — reuse persisted compatible evidence

See programme decisions embedded in [`.cursor-orchestration/2026-07-stabilization/`](../../.cursor-orchestration/2026-07-stabilization/) prompts for selection (`minMythicPlusScore`) and orchestrator requirements.
