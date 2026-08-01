---
status: accepted-for-planning
normative: true
last_reviewed: 2026-08-01
checkpoint_commit: 87ccefc329e64f6cc2b7d00c9d4f6b0c5e263188
code_baseline: bfc2c2dfc18416549b185f594de82cf965c92041
---

# Scoring V2 â€” Implementation dependency graph

Companion to [`IMPLEMENTATION_BASELINE.md`](./IMPLEMENTATION_BASELINE.md). Defines workstream order, file ownership conflicts, branch names, and live-probe gates. No runtime changes in this checkpoint.

Prompt numbers refer to `.cursor-orchestration/mplus-scoring-v2-agent-kit/prompts/`.

---

## 1. Dependency DAG

```mermaid
flowchart TD
  P01[01 Architecture audit and ADRs]
  P02[02 Evidence Contract V2 and selector]
  P03[03 WCL discovery query planner probes]
  P04[04 Artifact storage and persistence]
  P05[05 Async pipeline and parallelism]
  P06[06 Performance V2 Phase 1]
  P07[07 Survival V2 Phase 1]
  P08[08 Utility V2 Phase 1]
  P09[09 Experience V3 Phase 1]
  P10[10 Calibration V2 adapter]
  P11[11 Admin and public explainability]
  P12[12 Observability cost hardening]
  P13[13 Phase 2 contextual]
  P14[14 Phase 3 reference cohorts]
  P15[15 Cutover cleanup]

  P01 --> P02
  P01 --> P03
  P02 --> P04
  P03 --> P04
  P04 --> P05
  P05 --> P06
  P05 --> P07
  P05 --> P08
  P05 --> P09
  P06 --> P10
  P07 --> P10
  P08 --> P10
  P09 --> P10
  P04 --> P10
  P10 --> P11
  P05 --> P12
  P10 --> P12
  P11 --> P13
  P12 --> P13
  P13 --> P14
  P14 --> P15
```

**Invariant:** no dimension formula work (06â€“09) before Evidence Contract (02) and persistence for manifests/facts (04). Calibration V2 (10) consumes frozen V2 evidence â€” it does not invent a second selection path.

---

## 2. Calibration â†’ Scoring V2 adaptation edges

```mermaid
flowchart LR
  subgraph preserve [Preserve platform]
    C1[Cohorts and revisions]
    C2[calibration-run queue]
    C3[Immutable reports]
    C4[DRAFT-only model create]
    C5[No provider coupling]
  end

  subgraph replace [Version or replace]
    B1[CalibrationInputBundleV1 snapshot embed]
    B2[Live ScoreSnapshot select at enqueue]
    B3[4 MiB embedded JSON only]
  end

  subgraph v2 [Scoring V2 freeze graph]
    M[Evidence Manifest V2 16 slots]
    F[Normalized fact sets plus hashes]
    P[Policies catalogs scorer versions]
    R[Active and draft replay]
    G[Coverage completeness in reports]
  end

  C1 --> R
  C2 --> R
  C3 --> G
  C4 --> R
  C5 --> R
  B1 -.->|schema dispatch V1 retain / V2 add| M
  B2 -.->|replace attach path| F
  B3 -.->|root manifest plus artifacts| F
  M --> R
  F --> R
  P --> R
  R --> G
```

Population-based recommendations: **no edge into digests** until Prompt 14 critical-mass gates pass.

---

## 3. File conflict matrix

Two prompts **must not** edit the same hot file concurrently. Cells: `serial` = serialize; `coord` = parallel only with agreed interface owner; `ok` = safe parallel; `â€”` = N/A.

### 3.1 Hot ownership zones

| Zone | Primary paths | Owner prompt(s) |
|------|---------------|-----------------|
| Evidence contracts / selector | `packages/scoring/src/selection/*`, new evidence-manifest modules, `packages/contracts` evidence types | **02** |
| WCL provider / planner | `packages/providers/warcraftlogs/**`, probe scripts | **03** |
| Prisma / migrations | `packages/database/prisma/**` | **04**, then **10** |
| Raw artifacts / recording | `provider-recording.ts`, `RawArtifact` usage, new artifact backend | **04** |
| Queues / processors | `packages/contracts/src/jobs.ts`, `apps/worker/src/queues.ts`, `processors.ts`, `refresh-pipeline.ts` | **05** (then **10** only for calibration wiring touch) |
| Performance | `packages/scoring/src/performance/**`, refresh Performance glue | **06** |
| Survival | `packages/scoring/src/survival/**`, WCL survival analysis consumers | **07** |
| Utility | utility scoring + `UTILITY_PUBLICATION_MODE` consumers | **08** |
| Experience | `packages/scoring/src/experience/**`, Blizzard history | **09** |
| Calibration platform | `packages/scoring/src/calibration/**`, `packages/contracts/src/calibration.ts`, `admin-calibration*`, `calibration-run.ts`, calibration Prisma models | **10** |
| Admin/public explain | admin/web score explain routes | **11** |
| Observability | metrics/logging/cost dashboards | **12** |
| Feature flags config | `packages/config/src/index.ts` | **coord**: 04/05/10/14 add flags with merge discipline |

### 3.2 Concurrent prompt pairs

| | 02 | 03 | 04 | 05 | 06â€“09 | 10 | 11 |
|--|----|----|----|----|-------|----|----|
| **02** | â€” | coord (candidate types) | serial on contracts if shared | ok after 02 merge | serial (consume selector) | ok after facts | ok |
| **03** | coord | â€” | serial on provider payload shapes | ok after planner API freeze | ok | ok | ok |
| **04** | serial | serial | â€” | serial (schema before queues) | serial | serial (Prisma) | ok |
| **05** | ok | ok | serial | â€” | serial (pipeline before dims) | serial (`jobs.ts` / processors) | ok |
| **06â€“09** | â€” | â€” | â€” | â€” | **serial among themselves on model defaults**; Experience (**09**) may start earlier if no shared model file edits | serial on score-model contracts | coord UI |
| **10** | â€” | â€” | serial | serial | serial | â€” | serial admin nav/routes |
| **11** | â€” | â€” | ok | ok | coord | serial | â€” |

### 3.3 Explicit non-concurrency list

These prompt pairs **cannot run concurrently**:

1. **04 â†” 10** â€” Prisma schema / migrations
2. **05 â†” 10** â€” `jobs.ts`, `queues.ts`, `processors.ts`
3. **06 â†” 07 â†” 08 â†” 09** â€” when touching `createDefaultModelV6`, shared `calculate.ts`, or publication gates (coordinate or serialize)
4. **10 â†” 11** â€” admin calibration + explainability routes/nav
5. **02 â†” 04** â€” if both invent Evidence Manifest contract shapes (02 owns pure types/selector; 04 owns Prisma mapping after contract freeze)
6. Any prompt â†” formula/weight/threshold edits â€” **forbidden** without an explicit user prompt (see `AGENTS.md`)

Safe early parallel after this audit (**01** complete): **02** and **03** with a written interface note (candidate identity = `reportCode + fightId`, selector pure, provider returns candidates only).

---

## 4. Proposed branches / worktrees

| Workstream | Branch / worktree name |
|------------|------------------------|
| Docs/ADRs (this) | `agent/scoring-v2-architecture-audit` / `docs/scoring-v2-architecture` |
| Evidence contract | `feat/scoring-v2-evidence-contract` |
| WCL planner | `feat/scoring-v2-wcl-planner` |
| Persistence | `feat/scoring-v2-persistence` |
| Pipeline | `feat/scoring-v2-pipeline` |
| Performance | `feat/scoring-v2-performance` |
| Survival | `feat/scoring-v2-survival` |
| Utility | `feat/scoring-v2-utility` |
| Experience | `feat/scoring-v2-experience` |
| Calibration V2 | `feat/scoring-v2-calibration` |
| Explainability | `feat/scoring-v2-explainability` |
| Observability | `feat/scoring-v2-observability` |
| Phase 2 | `research/scoring-v2-phase2` |
| Phase 3 | `research/scoring-v2-reference-cohorts` |
| Cutover | `chore/scoring-v2-cutover` |

Use separate git worktrees per active parallel pair. Rebase onto the integration branch before each merge.

---

## 5. Merge order

```text
01 docs / ADRs                          â† current checkpoint
 â†’ 02 evidence contracts + pure selector
 â†’ 03 WCL planner / discovery bounds / probes   (may land before 02 if no contract collision; prefer after interface note)
 â†’ 04 persistence + artifact abstraction + migrations
 â†’ 05 pipeline slot fan-out / finalize
 â†’ 06 Performance Phase 1 (flagged off)
 â†’ 07 Survival Phase 1 (flagged off)
 â†’ 08 Utility Phase 1 (flagged off)
 â†’ 09 Experience Phase 1 (flagged off; may interleave if ownership clear)
 â†’ 10 Calibration V2 adapter (bundle V2, preflight, reports)
 â†’ 11 explainability
 â†’ 12 observability / cost hardening
 â†’ shadow validation + calibration replay on Agent 11 labels
 â†’ 13 Phase 2 contextual (research)
 â†’ 14 Phase 3 reference cohorts (gated)
 â†’ 15 cutover / V1 retirement
```

Default: **no push, merge, deploy, flag enable, live provider call, or model activation** without explicit user instruction.

---

## 6. Live-probe assumptions (gate list)

Probes are **manual and explicitly authorized**. Until green, treat corresponding designs as provisional.

| ID | Assumption | Blocks |
|----|------------|--------|
| LP-01 | Same-key parse / `key %` field is stable for DPS, tank, healer | Performance detailed blend; selector timer quality |
| LP-02 | 2Ã—8 selector achieves target coverage on complete / sparse / archived / tank / healer | Evidence Contract acceptance |
| LP-03 | Hydration bounds (raise from 25/5) are cost-acceptable at ~80 candidates | Discovery planner |
| LP-04 | Event-page vs table aggregates for DamageTaken / casts | Query planner dataset choice |
| LP-05 | Multi-fight batch point cost is predictable | Rate reservation |
| LP-06 | Report archive/access on target WCL plan matches eligibility gates | Manifest freeze fail-closed |
| LP-07 | `points_and_damage` partition binding is reliable | Performance profile stabilizer |
| LP-08 | Blizzard prior-season + achievements payloads exist for Experience V2 | Experience Phase 1 completeness |
| LP-09 | V2 calibration root manifest for ~40 members stays â‰¤4 MiB with hash refs | Bundle V2 storage shape |
| LP-10 | Account grouping quality sufficient for Phase 3 20-account gate | Prompt 14 only â€” not Phase 1 |

---

## 7. Coordination status stub

Maintain [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) after each workstream checkpoint (branch, SHA, blockers, schema touched).
