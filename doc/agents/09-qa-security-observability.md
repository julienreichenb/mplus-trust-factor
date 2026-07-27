# Agent
- ID: 09
- Scope: QA, security, data quality, observability
- Branch/worktree: agent/qa (current branch)
- Date: 2026-07-27
- Commit(s): see git log

# Summary
Implemented cross-cutting quality controls without rewriting feature code: `@mplus/test-utils` package with fixture loaders, provider boundary Zod schemas, data-quality invariant validators, failure-injection helpers, and OpenAPI contract utilities. Expanded versioned synthetic fixtures under `tools/fixtures/`. Extended `@mplus/observability` with Prometheus-compatible metrics registry, WCL budget snapshot helper, and security utilities (constant-time compare, HTML escape, provider host allowlist). Added `GET /metrics` to the API. Created contract, data-quality, security, and failure-injection test suites. Added autocannon load script. Documented testing strategy, fixtures, data quality, load tests, observability, threat model, privacy/retention, and red-flag language policy.

# Plan reference
[doc/plans/09-qa-security-observability.md](../plans/09-qa-security-observability.md)

# Files owned/changed
- `packages/test-utils/**` (new)
- `packages/observability/src/{metrics,security}.ts`, tests
- `tools/fixtures/**` (manifest, versioned provider fixtures, expert cohort)
- `tools/scripts/load-test.mjs`
- `tests/contract/**`, `tests/data-quality/**`, `tests/security/**`, `tests/failure-injection/**`
- `apps/api/src/app.ts` (`/metrics`, request metrics hook)
- `apps/api/src/openapi-generate.ts` (dev defaults for generation)
- `apps/api/openapi.json` (generated snapshot)
- `packages/domain/src/domain.test.ts`
- `packages/scoring/src/scoring.invariants.test.ts`
- `apps/worker/src/dedupe.test.ts`
- `doc/testing/**`, `doc/security/**`
- Root: `package.json`, `vitest.config.ts`, `pnpm-lock.yaml`

# Public contracts
- No changes to `@mplus/contracts` types.
- New internal package: `@mplus/test-utils` (test/validation helpers only).
- New API route: `GET /metrics` (Prometheus text).
- OpenAPI snapshot includes `/metrics`.

# Acceptance results
- `pnpm install` — ok
- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — 56 passed, 3 todo (Agent 4 scoring)
- `pnpm test:contract` — pass
- `pnpm test:data-quality` — pass
- `pnpm test:security` — pass
- `pnpm test:failure` — pass
- `pnpm test:integration` — 3 passed (Postgres on 5433)
- `pnpm build` — pass
- `pnpm openapi:generate` — writes `apps/api/openapi.json`
- `pnpm test:load` — pass (0 errors; p99 within targets on local API)

# External API observations
- No live provider calls; all tests use `PROVIDER_MODE=fixture`.
- Provider fixture shapes are synthetic placeholders for Agents 1–3 to extend.

# Security and privacy
- Pino redaction paths verified; `redactSecretsInObject` helper added.
- SSRF prevention via `isAllowedProviderHost` allowlist.
- Constant-time admin key comparison helper for Agent 5 integration.
- Threat model documents cost amplification and red-flag defamation risks.
- Privacy/retention defaults documented (`RAW_ARTIFACT_RETENTION_DAYS=30`).

# Known limitations
- E2E Playwright flows deferred to Agent 10.
- Load test uses autocannon p99 as latency proxy (no native p95).
- Provider fixtures are minimal synthetic shapes until integration agents expand them.
- Worker/API do not yet call data-quality validators at persistence boundaries (Agent 5/10).
- Dependency/container scanning coordinated with Agent 8 (no `.github` in this branch).

# Contract change requests
None.

# Follow-up work
- Agent 5: wire `recordProviderRequest`, queue metrics, admin constant-time auth.
- Agents 1–3: extend fixtures + Zod schemas when live shapes verified.
- Agent 7: addon export load test at 100k synthetic characters.
- Agent 8: CI jobs for `test:contract`, optional `test:load`, security scans.
- Agent 10: E2E fixture flow, persistence-time invariant checks.

# Rollback
- Revert Agent 9 commit(s).
- Remove `GET /metrics` hook if observability causes issues.
- Tests and docs are additive; no migration changes.
