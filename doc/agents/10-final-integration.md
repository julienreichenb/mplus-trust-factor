# Agent
- ID: 10
- Scope: Wave 2 final integration
- Branch/worktree: integration/wave2
- Date: 2026-07-27

# Summary
Integrated Agents 0–9 on `integration/wave2`: restored wave1 worker/API/scoring orchestration, wired `@mplus/provider-warcraftlogs` and `@mplus/provider-raiderio` into the refresh DAG, consumed `RunCombatFacts` for metric extraction and `RaiderIoBoostSupportFacts` for authenticity scoring, persisted provider provenance via `ExternalRequest`/`ExternalPayload`, integrated QA `validateScoreSnapshot` at score persistence, connected the addon export worker job to persisted `ScoreSnapshot` rows via `runExport()`, and preserved the standalone fixture exporter CLI.

# Plan reference
[doc/plans/10-wave2-integration.md](../plans/10-wave2-integration.md)

# Files owned/changed
- `apps/worker/**` — provider factory, refresh pipeline, combat metrics, boost authenticity, addon export job
- `apps/api/**` — restored from wave1 (character/search/compare/admin routes)
- `packages/scoring/**`, `packages/mechanics/**`, `packages/providers/blizzard/**` — restored from wave1
- `tools/addon-exporter/src/index.ts`, `from-snapshots.ts`
- `doc/plans/10-wave2-integration.md`, `doc/release/*`
- `vitest.config.ts`, root `package.json` (`addon:*` scripts from prior fix)

# Public contracts
- No breaking changes to `@mplus/contracts`.
- WCL extended DTOs remain in `@mplus/provider-warcraftlogs` per CR-02 deferral.
- Raider.IO types reconciled per CR-03 (already merged).

# Acceptance results
See `doc/release/acceptance-matrix.md`. Fixture-mode checks pass when Postgres is available on port 5433.

# External API observations
- No bulk live calls performed.
- Fixture mode used for Blizzard, WCL, and Raider.IO in CI/tests.
- Live smoke remains optional and bounded.

# Security and privacy
- Provider payloads persisted without secrets; observability redaction paths unchanged.
- `/metrics` endpoint from Agent 09 remains active.

# Known limitations
See `doc/release/known-limitations.md`.

# Contract change requests
- CR-02: deferred — worker imports provider types directly.
- CR-03: reconciled.

# Follow-up work
- Wire live WCL actor resolution to refresh job identity (not default env character).
- Connect Vue live client to restored API routes (Agent 6 follow-up).
- E2E Playwright cohort scenario.
- Raider.IO commercial/legal review before public launch.

# Rollback
Revert Agent 10 commit; set `PROVIDER_MODE=fixture` and `RAIDERIO_ENABLED=false`.
