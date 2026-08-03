# Scoring V2 Shadow Canary — status

Operational status for the live Shadow Canary on `feat/scoring-v2-live-canary`.
Git history is the archive.

## Implemented in this worktree

- Public/timed eligibility in `evidence-v2-selector` (private/hidden, `UNTIMED_RUN`, `TIMED_STATE_UNKNOWN`, fallback to next candidate).
- Acquisition post-hydration rejection reasons (`ACTOR_UNRESOLVED`, `REPORT_REVISION_UNRESOLVED`, `INCOMPLETE_FIGHT`, …).
- Canonical class/spec freeze for Shadow Canary via Character + `@mplus/abilities` (no probe majority-vote invent).
- Additive persistence: `WclRunSourceDigest`, `EvidenceDatasetPage`, `WclRunParticipant`, `ScoringV2ShadowCanary`.
- Redis WCL concurrency primitives (global HTTP ≤3, per-character runs ≤2, source singleflight, budget reserve).
- First-class `RANKING_PARSE` resolver (`resolveRankingParseFromZoneRankings` + live `getRankingParseForFight`).
- Admin Shadow Canary tab on `/admin/scoring-v2` + launch/list/get API.
- Simple Survival/Utility cooldown usage explainability DTOs (factual use counts only).

## Live-canary status

- Target: EU / archimonde / Wallidrixe.
- Lifecycle: **SHADOW** only.
- Launch path: Control Center → Shadow Canary → async job → production plan/slot/finalize path with publication blocked.
- Spec identity must come from persisted Character/`activeSpec` (fail-closed if incomplete).

## Source-retention policy

- Raw WCL pages: content-addressed `RawArtifact`, default **30-day** `retentionUntil`.
- Permanent neutral digest: `WclRunSourceDigest` keyed by `reportCode+fightId+reportRevision`.
- Digests must never store scores, grades, weights, penalties, or calculator outputs.

## Concurrency defaults

| Control | Default |
|--------|---------|
| Global WCL HTTP | 3 |
| Per-character active runs | 2 |
| WCL budget reserve | 20% |
| Runtime setting keys | `wcl_global_http_concurrency`, `wcl_per_character_run_concurrency`, `wcl_budget_reserve_ratio` |

## Explainability scope (current)

- Admin + public DTO path for per-run cooldown **use counts** only.
- No opportunity maxima, efficiency %, timing quality, or recommendations yet.
- Public projection strips report codes, party identities, timestamps, fingerprints.

## Immediate follow-ups

1. Test three canaries: DPS, tank, and healer.
2. Validate cross-character reuse on shared dungeon runs.
3. Run the Agent 11 cohort only after the canaries pass.
4. Activate user-facing V2 explainability only after publication approval.
5. Enrich cooldown explainability later with opportunity/timing semantics.
6. Implement private-report OAuth only as a separate future feature.
7. Review raw 30-day retention and object-storage migration before production scale.
8. Calibrate scoring formulas from frozen evidence.
9. Define publication/cutover criteria.

## Flags / publication

All `SCORING_V2_*` and `CALIBRATION_V2_*` flags remain default-off.
`CharacterPublishedScore` must not be mutated by the canary path.
V1 public score remains untouched.
