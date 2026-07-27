# Acceptance matrix — Agent 10

| Area | Criterion | Status | Evidence |
|------|-----------|--------|----------|
| Product | Search | Pass | API `GET /characters/search`, web HomePage |
| Product | Character profile | Pass | Enriched `CharacterProfileResponse` |
| Product | Score/grade/confidence | Pass | `@mplus/scoring` + persisted snapshots |
| Product | Dimensions/radar | Pass | Web CharacterPage + TrustRadarChart |
| Product | Red flags | Pass | Stored in snapshot explanation, mapped in API |
| Product | Last/highest run | Pass | Profile enrichment + `/runs` route |
| Product | Comparison | Pass | `POST /comparisons` |
| Product | Admin model config | Pass | validate/backtest/activate/clone/update |
| Product | Addon tooltip/data | Pass | Lua shard + `MPlusTrust.GetGrade` |
| Data | Blizzard identity/equipment | Pass | Provider factory + refresh DAG |
| Data | WCL public facts | Pass | Fixture mode inline analyze |
| Data | Raider.IO runs/cutoff | Pass | Fixture adapter |
| Data | Source provenance | Pass | `sources` on profile |
| Engineering | Strict typecheck | Pass | `pnpm typecheck` |
| Engineering | Lint | Pass | `pnpm lint` |
| Engineering | Unit/integration/e2e | Pass | `pnpm test`, `test:integration`, `test:e2e` (mock) |
| Engineering | OpenAPI | Pass | `pnpm openapi:generate` |
| Engineering | Migrations | Pass | `pnpm db:migrate` on empty DB |
| Engineering | Fixture mode default | Pass | `PROVIDER_MODE=fixture` |
| Engineering | Docker infra | Pass | `pnpm compose:up` |
| Engineering | CI | Pass | `.github/workflows/ci.yml` |
| Legal | Raider.IO review | **Blocked** | See `legal-and-provider-review.md` |
