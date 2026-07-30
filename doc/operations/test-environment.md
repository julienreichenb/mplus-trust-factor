# Test environment

## Current state

- The only automated CD push deploy path today targets the **test** environment.
- Push trigger branch in `.github/workflows/cd.yml` is currently `integration/wave4.3` (stale vs programme intent).
- Programme intent (Agent 05): **`main` automatically deploys test**. That is **not** yet current behaviour — document intent separately from runtime.

## Production

- Production remains out of scope until test is clean.
- No direct production deployment from feature branches.
- Future: reviewed merges to a `prod` policy from `main`.

## Health checks

CD currently verifies `/health/live` rather than full readiness. Prefer `/health/ready` for stronger gates when Agent 05 hardens CD.

## Local vs test

| Concern | Local | Test |
|---------|-------|------|
| Postgres host port | Compose **5433** | Environment-specific |
| Battle.net login | May be absent | Present for the project owner |
| Secrets | Root `.env` only | CD / host secrets — never commit |
