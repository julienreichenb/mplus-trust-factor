# Scoring V2 Shadow Canary — status

Operational status for the live Shadow Canary on `feat/scoring-v2-live-canary`.
Git history is the archive.

## Completed runtime wiring

- Production transport uses **persistent DB/CAS** (`EvidenceDatasetPage` + RawArtifact) before WCL; in-memory L1 is optional only.
- Redis **source singleflight** + global HTTP ≤3 + per-character ≤2 wired at the provider call boundary.
- Raw pages persist with **retentionUntil = fetchedAt + 30 days**.
- After shared evidence: permanent **WclRunSourceDigest** + five-player **WclRunParticipant** roster (UNRESOLVED mappings allowed).
- BullMQ worker `scoring-v2-shadow-canary`: discover → plan → slot fan-out → finalize.
- Admin launch enqueues a real job; finalize marks canary **COMPLETED** with bounded diagnostics.
- Admin Shadow Canary panel shows slot matrix, dimensions, progress, and diagnostic download.
- `adminShadowCanary` batch meta bypasses process-env SCORING_V2 gates while publication stays blocked.
- Relaunch after COMPLETED/FAILED creates a **new** canary row (source reuse via digest/pages).

## Validation (this pass)

- `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:contract`, `build`, `check:english`, `abilities:validate`, `git diff --check` — **pass**.
- Focused unit: persistent page load/save, 30-day retention, recursive forbidden score fields in digests.

## Live Wallidrixe proof

- Target: EU / archimonde / Wallidrixe.
- **Not executed in this pass** (API/worker live stack + WCL credentials not exercised end-to-end here).
- Immediate next step: launch twice from `/admin/scoring-v2` Shadow Canary tab and record matrices / WCL request counts / cache hits.

## RANKING_PARSE

- Live `getRankingParseForFight` implemented and transport-wired.
- Live public-report verification still pending the Wallidrixe canary run; Performance stays UNAVAILABLE when fight-bound parse evidence is absent.

## Concurrency defaults

| Control | Default |
|--------|---------|
| Global WCL HTTP | 3 |
| Per-character active runs | 2 |
| WCL budget reserve | 20% |

## Remaining blockers

1. Execute bounded live Wallidrixe first + second canary (reuse proof).
2. Cross-character digest reuse on one overlapping participant (narrow).
3. Record live RANKING_PARSE result or conclusive blocker.
4. Enrich admin diagnostics with provider call / points / raw-byte counters from persisted canary progress.

## Flags / publication

All `SCORING_V2_*` and `CALIBRATION_V2_*` flags remain default-off.
`CharacterPublishedScore` must not be mutated by the canary path.
V1 public score remains untouched.
