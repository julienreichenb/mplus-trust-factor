# Agent 9 — QA, Security, Data Quality, and Observability

## Scope

Cross-cutting quality controls around the integrated foundation without rewriting feature implementations owned by Agents 1–8.

## Test pyramid

| Layer | Focus | Location | CI |
|-------|-------|----------|-----|
| Unit | Domain normalization, scoring invariants, dedupe keys, log redaction, security helpers | `packages/**`, `apps/**/src/*.test.ts` | Always |
| Contract | Provider fixture schemas, OpenAPI response shapes, job payload Zod schemas | `tests/contract/**`, `packages/contracts` | Always — drift fails CI |
| Data quality | Executable invariant checks on snapshots, models, runs, addon export | `tests/data-quality/**`, `packages/test-utils` | Always |
| Integration | Postgres seed/health, API inject, optional Redis | `*.integration.test.ts` | When infra available |
| Failure injection | Provider 429/timeout, WCL budget, Redis loss, duplicate job | `tests/failure-injection/**` | Always (fixture mocks) |
| Load | Cached health/meta endpoints via autocannon | `tools/scripts/load-test.mjs` | Local / optional CI job |
| E2E | Deferred to Agent 10 after full route wiring | Playwright placeholder note only | Not in Agent 9 |

## Fixture governance

- All fixtures under `tools/fixtures/` are synthetic or sanitized public examples.
- Versioned by provider: `tools/fixtures/providers/<provider>/v1/`.
- Manifest: `tools/fixtures/manifest.json` records origin, capture date, schema version.
- CI validates fixtures against Zod boundary schemas in `@mplus/test-utils`.
- Expert scoring cohort: `tools/fixtures/scoring/expert-cohort-v1.json` for golden tests.
- No tokens, cookies, IPs, emails, private report codes, or unrelated player data.

## Contract tests

1. **Provider fixtures** — Zod schemas mirror provider boundary DTOs; fixture files must parse.
2. **OpenAPI** — Generated `apps/api/openapi.json` compared to live `/health/*` and `/api/v1/meta` responses.
3. **Job payloads** — Existing Zod schemas in `@mplus/contracts` (extended coverage).
4. **Drift detection** — Contract test suite fails CI when fixtures or OpenAPI snapshot diverge.

## Data-quality invariants

Executable checks in `@mplus/test-utils/data-quality`:

- Region present on character/run identity.
- Scores in 0–100; confidence in 0–1.
- Grade matches active thresholds.
- Dimension weights sum to 1 for active model config.
- Score snapshot references model key + version.
- Source provenance on external metrics.
- No duplicate canonical run fingerprint in a batch.
- Same report revision not analyzed twice for same analysis version.
- Missing metrics not stored as fake zero.
- Payload hashes stable (deterministic fingerprint helpers).
- Addon export excludes premium/admin/raw fields.
- Only eligible characters in addon dataset.

## Threat model (summary)

Documented in `doc/security/threat-model.md`. Key risks:

- Provider secret leakage → Pino redaction + tests.
- SSRF via user URLs → allowlisted provider hosts only.
- SQL/GraphQL injection → parameterized queries, static GraphQL documents.
- Admin brute force → constant-time key comparison, rate limiting (documented).
- Refresh abuse / API-cost amplification → cooldowns, WCL budget soft stops.
- Queue poisoning / oversized payloads → Zod job schemas, size limits (documented).
- Decompression bomb / artifact path traversal → retention + path validation helpers.
- XSS via player names → HTML escaping helper + tests.
- Unicode confusables → NFKC normalization (domain package).
- Entitlement bypass → server-side checks (documented for Agent 5).
- Addon dataset tampering → checksum-ready export metadata.
- Red-flag defamation → probabilistic language policy in `red-flag-language.md`.

## Privacy and retention

- Public game data handled with minimal retention for raw payloads.
- `RAW_ARTIFACT_RETENTION_DAYS` default 30; derived scores kept longer.
- No unnecessary Battle.net account data; no private logs in MVP.
- Documented in `doc/security/privacy-retention.md`.

## Observability signals

Lightweight additions in `@mplus/observability`:

- `MetricsRegistry` — counters/histograms, Prometheus text at `/metrics`.
- Provider request count/latency/status/cache-hit labels.
- WCL points spent/remaining snapshot helper.
- Queue depth/failure counters (hook points for worker).
- Structured logs with request/job/correlation IDs (existing Pino setup).
- Documented log queries in `doc/testing/observability.md`.

## Performance / load targets (MVP provisional)

| Target | Threshold |
|--------|-----------|
| Cached profile API p95 | < 300 ms |
| Compare 10 cached profiles p95 | < 750 ms |
| Search non-blocking | No sync external analysis |
| Addon lookup | O(1) hash map |
| Exporter 100k synthetic chars | Documented memory budget |

Load script hits `/health/live` and `/api/v1/meta` against local API with fixture mode.

## Failure injection

Fixture-based tests simulate:

- Blizzard 429, provider timeout, invalid pagination.
- WCL rate budget at 90%.
- Raider.IO disabled.
- Redis connection failure (mock).
- DB unique conflict on duplicate dedupe key.
- Stale score still served.
- Raw artifact write failure.

## Shared-file coordination

- **No contract changes** — all validation uses existing `@mplus/contracts` types.
- **Minimal API addition** — `GET /metrics` route only (observability).
- **New package** — `@mplus/test-utils` (Agent 9 ownership per wave plan).
- **Root package.json** — add `test:contract`, `test:load`, `openapi:generate` in CI path.

## Self-review (pre-implementation)

- Plan avoids rewriting provider/scoring/API feature code.
- Fixture mode only; no live credentials in CI.
- Contract drift is CI-gated.
- Invariants are executable, not documentation-only.
- Threat model covers cost amplification and red-flag language risks.
- Load and failure tests use local/synthetic data.
- Observability is lightweight (Pino + optional Prometheus text).

**Approved to proceed with implementation.**
