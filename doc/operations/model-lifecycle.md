# Score model lifecycle

## Source of truth

- **Database** `ScoreModel` rows (versioned, immutable once activated for a given version lineage).
- Drafts may be edited and validated in admin UI.
- Activation is transactional, audited, and performed from the admin website (or seed for empty DBs).

## Environment variables

| Variable | Role |
|----------|------|
| `ACTIVE_SCORE_MODEL_KEY` | Lookup key for the ACTIVE DB row (default `default`) — **not** “flip to activate a new formula” |
| `ACTIVE_SCORE_MODEL_VERSION` | Default/fallback when seeding or when DB model is missing (default **6**) |

**Normal model activation is not an env-var change.** Env may initialize an empty database only. Residual KEY lookup dependence is technical debt for Agent 08, not the product activation UX.

## Activation behaviour (target)

1. Admin activates a validated draft.
2. Other ACTIVE models for the same key are archived.
3. Activation queues a progressive **`RECALCULATE_ONLY`** cohort job — not a provider-heavy refresh storm.
4. Incompatible evidence may require explicit fuller refresh paths later.

## Bulk modes (programme)

- `FULL_REFRESH` — providers + score
- `RECALCULATE_ONLY` — reuse persisted compatible evidence

See programme decisions embedded in [`.cursor-orchestration/2026-07-stabilization/`](../../.cursor-orchestration/2026-07-stabilization/) prompts for selection (`minMythicPlusScore`) and orchestrator requirements.
