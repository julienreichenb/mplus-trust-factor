# CI / CD

## CI (`.github/workflows/ci.yml`)

Triggers include `main`, `integration/**`, and `agent/**`.

Typical quality path: install → migrate → seed → lint / typecheck / test / build (exact steps in the workflow file).

Local Postgres uses host **5433**; GitHub Actions Postgres uses **5432** via `DATABASE_URL`. Vitest must respect an explicit `DATABASE_URL` (CI) instead of hard-forcing `:5433`.

## CD (`.github/workflows/cd.yml`) — current vs intent

| Topic | Current | Programme intent |
|-------|---------|------------------|
| Push deploy source | `integration/wave4.3` | `main` → test |
| Deploy env on push | Forced `test` | test |
| Production | `workflow_dispatch` | Reviewed `main` → prod later |
| Missing secrets | May skip without failing | Should fail closed (Agent 05) |
| Health probe | `/health/live` | Prefer readiness |

Do **not** treat environment-variable edits in CD as “model activation”. Score models activate via DB/admin (see [`model-lifecycle.md`](model-lifecycle.md)).

## Agent ownership

CD hardening is Agent 05 scope. Do not change CD triggers in docs-only PRs beyond documenting the gap.
