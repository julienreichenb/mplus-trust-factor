---
status: superseded
normative: false
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
superseded_by: IMPLEMENTATION_BASELINE.md
checkpoint_commit: 87ccefc329e64f6cc2b7d00c9d4f6b0c5e263188
code_baseline: bfc2c2dfc18416549b185f594de82cf965c92041
---


# Current repository audit and reuse map

> **Superseded** for planning by [`IMPLEMENTATION_BASELINE.md`](./IMPLEMENTATION_BASELINE.md) (code baseline `bfc2c2d`; checkpoint `87ccefc`; calibration platform merged). Kept as historical kit snapshot.

## 1. Baseline

This kit snapshot reflected main around `0b0d911f9c4f3ec771bd8f2390e972da01595f99` and a then-draft calibration branch. Calibration is now on main (`#48`). Use the implementation baseline for decisions.

## 2. WCL provider

### Reusable

| Path | Current capability | V2 treatment |
|---|---|---|
| `packages/providers/warcraftlogs/src/operations/queries.ts` | Character resolve, zone rankings, points_and_damage, recent reports, report metadata, events | extend; keep operation names versioned |
| `packages/providers/warcraftlogs/src/types.ts` | candidates, rankings, reports, actors, events, performance aggregates | adapt into V2 contracts; avoid parallel duplicate types |
| `packages/providers/warcraftlogs/src/live/live-provider.ts` | discovery, hydration, detailed report/fight, survival analysis | split retrieval from scoring and planner |
| `packages/providers/warcraftlogs/src/discovery/points-and-damage-performance.ts` | validates JSON shape, persists raw, adapts profile summary | retain and version; add partition/role diagnostics |
| `packages/providers/warcraftlogs/src/evidence/wcl-run-evidence-types.ts` | shared datasets, completeness, compatibility, accounting | evolve to artifact references and V2 dataset identity |
| `packages/providers/warcraftlogs/src/evidence/shared-run-selection.ts` | one shared run per dungeon | replace with Evidence Manifest V2 |
| `packages/providers/warcraftlogs/src/analysis/*` | event extraction and Survival facts | reuse extractors behind normalized fact sets |
| `packages/providers/warcraftlogs/src/rate/*` | point budget decisions | integrate with full-plan reservation |
| `tools/scripts/wcl-*-probe*` | extensive research tooling | consolidate into sanitized V2 probe suite |

### Incompatible or incomplete

- Existing shared selection stores one run per dungeon.
- Different dimensions can still use different selectors.
- Dataset bundles can embed full event arrays.
- Planner/admission does not yet guarantee complete 2Ã—dungeon execution before publication.
- Same-key parse semantics still require explicit live validation for all roles.

## 3. Selection and scoring

### Current Performance

- `packages/scoring/src/performance/aggregate.ts`
- equal-weight per-dungeon best and median profile aggregates;
- 65% peak / 35% consistency;
- historical WCL contribution;
- confidence includes profile displayed run volume and selected-run coverage;
- explanatory best/latest runs.

V2 action:

- preserve profile adapter and equal-dungeon concept;
- replace detailed selection with two manifest slots;
- use detailed/profile blend;
- remove profile run volume as proxy for detailed sample;
- retain historical behavior only after double-counting review.

### Current Survival

- `packages/providers/warcraftlogs/src/probe/survival-v1_1_1-*`
- `packages/scoring/src/survival/aggregate.ts`
- pressure clusters, health hardening, outcome/defensive/recovery;
- current selector can use up to three runs per dungeon and prefer lower WCL-logged runs.

V2 action:

- reuse pressure-cluster/fact logic;
- remove independent selector;
- consume two manifest slots;
- move raw events to artifacts;
- add relative damage shadow and Phase 2 availability.

### Current Utility

- `packages/providers/warcraftlogs/src/probe/utility-v3_2-*`
- observed-positive-contribution candidate;
- floor 50;
- cast stops/support/strategic CC;
- publication integration currently limited/research-oriented.

V2 action:

- retain safety semantics and domain weights as initial candidate;
- add explicit attempt classification;
- consume shared manifest;
- keep missed-opportunity penalties for Phase 2.

### Current Experience

- `packages/scoring/src/experience/v2/`
- dungeon breadth, key-band breadth, participation, history, recency;
- current Raider.IO field request already includes current/previous scores and ranks.

V2 action:

- preserve exposure core;
- add Blizzard prior-season strength and achievements;
- use Raider.IO only for missing historical rank/cutoff;
- add verified account-linked contribution later.

## 4. Refresh and queue orchestration

### Current

- `apps/worker/src/orchestration/refresh-pipeline.ts`
- `apps/worker/src/processors.ts`
- `apps/worker/src/queues.ts`
- `apps/worker/src/orchestration/analyze-run.ts`

The refresh pipeline currently performs a large synchronous DAG and may analyze runs inline. BullMQ already has refresh, analyze, recalculate, addon, discovery, and bulk workers.

### V2 action

- retain refresh-character as orchestrator;
- introduce versioned slot analysis fan-out;
- fan-in finalization;
- provider-free recalculation;
- keep current admission lifecycle;
- coordinate with pending BullMQ priority/concurrency work;
- do not place calibration on refresh IngestionJob lifecycle.

## 5. Persistence

### Current reusable models

- provider request/payload/artifact;
- canonical runs and source references;
- participants;
- run analyses;
- metrics;
- score models/snapshots/dimensions;
- analysis batches;
- public score pointer.

### Current problems

- event arrays in `RunAnalysis.summary`;
- no first-class immutable 2Ã—dungeon manifest/slots;
- no normalized dataset/fact-set records with artifact references;
- competing analysis versions may be difficult to query;
- current score snapshot does not explicitly model a V2 manifest relation.

### V2 action

A destructive test reset is acceptable. Prefer a coherent schema over compatibility layers that would remain permanently.

## 6. Provider recording

`apps/worker/src/orchestration/provider-recording.ts`, ExternalRequest, ExternalPayload, and RawArtifact should become the shared source of provider provenance. Do not create a second request ledger for V2.

Required improvements:

- artifact backend for large pages;
- exact dataset compatibility metadata;
- payload hash/reference on fact sets;
- retention dependency checks.

## 7. Shared evidence store

`apps/worker/src/orchestration/shared-evidence-store.ts` currently stores datasets and bundles through RunAnalysis.

Reuse:

- compatibility/reconstruction concepts;
- shared consumer union;
- persisted cache hits.

Replace:

- large event arrays in JSONB;
- one bundle summary as the primary long-term store;
- ambiguous reconstruction from string-key inspection.

## 8. Calibration draft

Current draft paths include:

- `packages/contracts/src/calibration.ts`
- `apps/api/src/services/admin-calibration-service.ts`
- `apps/worker/src/orchestration/calibration-run.ts`
- `packages/scoring/src/calibration/`
- admin pages/routes;
- calibration Prisma models/migration.

Reusable:

- feature flag and RBAC;
- cohort/member revisions;
- frozen bundle hash/size;
- dedicated queue;
- provider-free deterministic harness;
- immutable report/digest;
- DRAFT model safety.

Required V2 adaptation:

- bundle roots reference manifest/fact hashes;
- V2 preflight;
- active/draft exact-evidence proof;
- larger portable artifact export;
- V1/V2 schema dispatch;
- V2 coverage/cost diagnostics.

## 9. Existing scripts and CI

Root `package.json` already exposes:

- WCL performance/survival/utility probes;
- shared evidence loading;
- live smoke tests;
- ability validation/coverage;
- isolated unit/integration/contract/data-quality/security/failure suites;
- deploy validation and test promotion.

V2 should add scripts consistently rather than introduce ad hoc invocation.

## 10. Delete/replace candidates after cutover

Potential removals after shadow/cutover:

- V1 one-run shared selector;
- independent Survival selector;
- legacy inline WCL analysis path;
- obsolete WCL probe versions;
- RunAnalysis event-array storage;
- V1-only score metrics/model defaults;
- duplicate compatibility keys/types.

No removal occurs until old reports/snapshots remain readable or are intentionally reset in test.
