# Acceptance matrix — Wave 2 integration

| Criterion | Status | Notes |
|-----------|--------|-------|
| Root lint | pass | |
| Root typecheck | pass | |
| Root unit tests | pass | incl. worker combat/boost/factory tests |
| Contract tests | pass | |
| Data-quality tests | pass | |
| Security tests | pass | |
| Failure-injection tests | pass | |
| DB integration tests | pass | requires Postgres :5433 |
| Refresh pipeline integration | pass | requires Postgres :5433 |
| Build | pass | |
| OpenAPI generate | pass | |
| Addon fixture export CLI | pass | `pnpm addon:export` |
| WCL in worker DAG | pass | fixture provider |
| Raider.IO in worker DAG | pass | fixture provider + boost facts |
| Provenance persistence | pass | ExternalRequest rows |
| Addon DB export job | pass | `runGenerateAddonExport` |
| Live provider smoke | skipped | credentials not required |
| Commercial launch | **blocked** | Raider.IO + legal review |
