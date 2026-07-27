# Agent
- ID: 04
- Scope: Versioned scoring, confidence, and boost-suspicion engine
- Branch/worktree: `agent/scoring`
- Date: 2026-07-27
- Commit(s): `2bac323` (implementation); handoff doc follow-ups on `agent/scoring`

# Summary
Replaced the neutral scoring placeholder with a pure deterministic Trust Factor engine (`@mplus/scoring`) and mechanic-catalog abstractions (`@mplus/mechanics`). Model v1 is fully data-driven (`ScoreModelConfigV1`), missing metrics shrink toward 50, authenticity emits probabilistic evidence/tags only, and a 10-profile synthetic golden cohort is covered by tests.

# Plan reference
[doc/plans/04-scoring.md](../plans/04-scoring.md)

# Files owned/changed
- `packages/scoring/**` — full engine API, defaults, validation, tests
- `packages/mechanics/**` — rule types, catalog validation, matcher, seed catalog, tests
- `tools/fixtures/scoring/**` — synthetic golden profiles
- `doc/scoring/**` — model, metrics, confidence, authenticity, roles, calibration, explainability
- `doc/plans/04-scoring.md`
- `doc/contracts/change-requests/04-score-model-config-v1.md`
- `vitest.config.ts` — alias for `@mplus/mechanics` (test harness)

# Public contracts
- New scoring-package types: `ScoreModelConfigV1`, authenticity/feature inputs, explanation DTO
- Public API: `calculateScore`, `calculateMetricScores`, `calculateDimensionScores`, `calculateAuthenticity`, `calculateFinalTrust`, `explainScore`, `gradeScore`, `validateScoreModelConfig`
- Mechanics: `MechanicRule`, `MechanicCatalog`, `matchMechanicRules`, `classifyDamageEvent`
- No new API routes, queues, env vars, or Prisma migrations
- Slim `@mplus/contracts.ScoreModelConfig` unchanged; rich config local (see CR)

# Acceptance results
Exact commands run and results:
- `pnpm install` — ok
- `pnpm db:generate` — ok (Prisma client for unrelated health test)
- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — 28 passed (15 scoring + 4 mechanics + foundation)
- `pnpm build` — pass

# External API observations
- None (no network in Agent 4 packages)

# Security and privacy
- Synthetic fixtures only; no real player payloads
- No secrets; pure computation
- Boost language remains probabilistic in public explanations

# Known limitations
- Metric extractors / observation production remain upstream (providers + Agent 5)
- Mechanic seed catalog is minimal/illustrative
- `ScoreModelConfigV1` not yet mirrored into shared contracts (CR filed)
- Weights/thresholds are v1 hypotheses pending expert calibration
- Historical decay helper exists; upstream must supply season-normalized inputs

# Contract change requests
- [doc/contracts/change-requests/04-score-model-config-v1.md](../contracts/change-requests/04-score-model-config-v1.md)

# Follow-up work
- Agent 5: wire `calculateScoreEngine` into recalculate-score worker with observation assembly
- Agent 10: promote rich model config into contracts if admin editors need it
- Run expert-labelled calibration before treating grades as product truth

# Rollback
- Revert this branch/commit; consumers fall back to previous placeholder `calculateScore` behavior
- No DB migration to roll back
