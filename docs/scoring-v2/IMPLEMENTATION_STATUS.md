---
status: checkpoint-complete
last_reviewed: 2026-08-01
checkpoint_commit: 87ccefc329e64f6cc2b7d00c9d4f6b0c5e263188
code_baseline: bfc2c2dfc18416549b185f594de82cf965c92041
---

# Scoring V2 — Implementation status

Coordination board for the Scoring V2 program. Update after each prompt checkpoint.

| Workstream | Branch / worktree | Owner | Dependencies | Commit | Tests | Blockers | Schema / contracts | Merge order | Status |
|------------|-------------------|-------|--------------|--------|-------|----------|--------------------|-------------|--------|
| 01 Architecture audit + ADRs | `agent/scoring-v2-architecture-audit` | architecture audit | — | `87ccefc329e64f6cc2b7d00c9d4f6b0c5e263188` | docs-only validation | ADR review pending (program accepted; formal ADR sign-off before migrations) | docs + ADRs only | 1 | **checkpoint complete** |
| 02 Evidence Contract V2 | `feat/scoring-v2-evidence-contract` | — | 01 | — | — | — | contracts/selector | 2 | pending |
| 03 WCL planner / probes | `feat/scoring-v2-wcl-planner` | — | 01; coord with 02 | — | — | live probes LP-01–07 | provider | 3 | pending |
| 04 Persistence / artifacts | `feat/scoring-v2-persistence` | — | 02, 03 | — | — | ADR-0001/0002 | Prisma | 4 | pending |
| 05 Pipeline | `feat/scoring-v2-pipeline` | — | 04 | — | — | ADR-0003 | jobs/queues | 5 | pending |
| 06–09 Dimensions Phase 1 | `feat/scoring-v2-{performance,survival,utility,experience}` | — | 05 | — | — | flags off | scoring | 6 | pending |
| 10 Calibration V2 | `feat/scoring-v2-calibration` | — | 04, 06–09 | — | — | ADR-0005 | calibration + Prisma | 7 | pending |
| 11 Explainability | `feat/scoring-v2-explainability` | — | 10 | — | — | — | admin/web | 8 | pending |
| 12 Observability | `feat/scoring-v2-observability` | — | 05, 10 | — | — | — | metrics | 9 | pending |
| 13 Phase 2 | `research/scoring-v2-phase2` | — | shadow gates | — | — | — | research | 10 | pending |
| 14 Phase 3 | `research/scoring-v2-reference-cohorts` | — | critical mass | — | — | LP-10 | research | 11 | pending |
| 15 Cutover | `chore/scoring-v2-cutover` | — | 14 + approval | — | — | ADR-0006 | cleanup | 12 | pending |

**Workstream 01 tip:** authoritative amended SHA is `git rev-parse HEAD` on `agent/scoring-v2-architecture-audit`. Embedded `checkpoint_commit` may lag by one metadata self-reference.

**Defaults:** no push, merge, deploy, flag enable, live provider call, or model activation without explicit user instruction.
