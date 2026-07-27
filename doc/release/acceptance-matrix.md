# Acceptance matrix — Wave 3 integration

| Criterion | Status | Notes |
|-----------|--------|-------|
| Lint | pass | |
| Typecheck | pass | |
| Clean `pnpm build` (after dist wipe) | pass | `clean:dist` clears stale `.tsbuildinfo` |
| Contract tests | pass | 10 |
| Security tests | pass | 13 |
| Data-quality tests | pass | 9 |
| Failure-injection tests | pass | 10 |
| Scoring + provider unit tests | pass | 167 |
| Worker + API tests | pass | 89 |
| Web unit tests | pass | 63 |
| Integration (DB + fixture pipeline) | pass | 4; Postgres :5433 |
| Playwright mock E2E | pass | 5 |
| Playwright fixture E2E | pass | 1 |
| Live Wallidrixe double refresh | pass | operator local secrets; not committed |
| Model default v2 seed | pass | v1 ARCHIVED |
| Secret scan (tracked tree) | pass | no BLOCKER |
| Commercial launch | **follow-up** | Raider.IO legal review |
