# Ability catalog — product model

The ability catalog runtime authority is **one ACTIVE immutable release** plus **per-job frozen pins**.

## Runtime behavior

1. Admin maintains catalog via `/admin/ability-catalog` (refresh → review → validate/replay → activate).
2. **Every new analysis** resolves the current `ACTIVE` `AbilityCatalogRelease` at enqueue and freezes a `RELEASE` execution pin on the job.
3. Workers consume the job pin only — they never look up ACTIVE or re-resolve catalog semantics.
4. **Activation** affects future jobs immediately — no `ABILITY_CATALOG_RUNTIME_MODE`, no restart.

## Fail closed

If no valid ACTIVE release exists, enqueue **refuses** with `ABILITY_CATALOG_RELEASE_NOT_FOUND`.

There is **no** runtime fallback to `RETAIL_ABILITY_CATALOG` / STATIC pins for normal analyses.

The static TypeScript catalog remains for Bootstrap Release 0 compilation, parity tests, and compiler fixtures only.

## Admin workflow states

Derived from persisted batch/release/replay data:

| State | Meaning |
|-------|---------|
| `IDLE` | No recent refresh activity |
| `REFRESHING` | Refresh in progress |
| `REVIEW_REQUIRED` | Actionable review items pending; ACTIVE unchanged |
| `READY_TO_ACTIVATE` | Validated candidate with replay PASS |
| `ACTIVE` | ACTIVE release serving new analyses |
| `FAILED` | No ACTIVE release or refresh failed |

## API

- `GET /api/v1/admin/ability-catalog/workflow` — control-center status
- `POST /api/v1/admin/ability-catalog/refresh` — SimC + Blizzard extract, diff, review import (requires a usable SimC binary via `ABILITY_CATALOG_SIMC_BIN` or bundled `/usr/local/bin/simc`, plus Blizzard credentials; revision/version/build/LIVE come from binary interrogation)

See also: [`catalog-release-design.md`](./catalog-release-design.md), [`packages/abilities/src/refresh/OPERATOR.md`](../../packages/abilities/src/refresh/OPERATOR.md).
