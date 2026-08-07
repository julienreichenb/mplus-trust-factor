# Scoring V2 Shadow Canary — archived development record

**Status:** archived. Current operator surface: [`25_OPERATOR_SURFACE_AND_PIPELINE.md`](25_OPERATOR_SURFACE_AND_PIPELINE.md).

The notes below are historical incident records from the transitional multi-command
recovery workflow. Do not treat listed step commands as the current operator path.

---

# Scoring V2 Shadow Canary — status

Operational status for the live Shadow Canary on `feat/scoring-v2-live-canary`.
Git history is the archive.

## Defective baseline (not acceptance)

Official admin/API/BullMQ path for EU / archimonde / Wallidrixe
(warlock / demonology / DPS / catalog `12.0.0/midnight-season-1`).

| Run | ID | Outcome |
|-----|-----|---------|
| Baseline 1 | `49e8378d-4dc0-4cef-8fc7-0a21824b777d` | COMPLETED but defective |
| Baseline 2 | `78df04ce-1440-4cce-af73-2d563549d753` | COMPLETED but defective |

Observed defects (both):

- `EvidenceDatasetPage` count **0** — digests without durable raw pages
- Roster stub only (`target` / `unknown` / UNRESOLVED)
- `fact_set_hash_mismatch` → all four dimensions SHADOW / score null / UNAVAILABLE
- Shared-evidence cache hit without pages; fight-details still fetched **13** times on run 2
- Silent `ranking_parse_absent`; Survival/Utility datasets not reaching extractors
- `providerAccounting` absent (added later in `8e55666`)

Candidate matrix (stable across baseline and corrected runs):
38 discovered → 35 planned; untimed **1**; timed-unknown **20**; **13** PARTIAL / **3** UNAVAILABLE
(`algethar-academy:0/1`, `skyreach:1` → `MISSING_NO_CANDIDATE`).

## Remediation (local commits)

| Commit | Fix |
|--------|-----|
| `8e55666` | Persist/expose aggregated `providerAccounting` |
| `93d9227` | Null hollow `factSetHash`; require durable pages; fail closed if WRITTEN facts lack manifest slot |
| `93a090a` | Fight-details page persist/reuse; CombatantInfo roster enrichment; conclusive RANKING_PARSE blocker |
| `87ea1e2` | Upgrade stub digests; sanitize empty realms |
| `37617d0` | Roster CombatantInfo test expectations |
| `55a6828` | Do not collapse roster when CombatantInfo is target-scoped; upgrade thin digests |

### Root cause — `fact_set_hash_mismatch`

Hollow ACQUIRED slots stamped placeholder `factSetHash` (`scoring-v2-acquisition` / `2.0.0`) when **zero** WRITTEN typed facts existed. Manifest SELECTED those hashes; deferred RunFactSet persist wrote nothing → finalizer expected hash, **actual=missing**.

Fix: leave `factSetHash` null until a typed fact is WRITTEN; bind by immutable report/fight/revision + frozen slot semantics; do not weaken integrity checks. Regression: fact-binding durable evidence tests.

### Raw pages

Wire persistence at the live GraphQL page-fetch boundary through `@mplus/artifact-store` + `EvidenceDatasetPage`. Page-less legacy cache is not durable reuse — first corrected run refetches once; later runs reconstruct from pages.

### Roster

Build from masterData Player actors + CombatantInfo enrichment. Target-scoped CombatantInfo must not filter the party to one row. Wallidrixe maps to internal Character; other players may stay UNRESOLVED.

## Corrected validation run A — durable fetch

| Field | Value |
|-------|--------|
| ID | `26a9dbd0-9994-4961-8c31-6bd7a567e5ce` |
| Terminal | **COMPLETED** (~2 min) — **no** `fact_set_hash_mismatch` |
| Slot matrix | **PARTIAL 13** / **UNAVAILABLE 3** (same missing reasons) |
| `EvidenceDatasetPage` | **212** rows (~26.7 MB uncompressed) |
| Digests | **13** |
| Retention | RawArtifact `retentionUntil` ≈ **30 days** from persist |
| providerAccounting | discovery **14**; acquisition **225**; providerCalls **239**; pages **199**; points **186**; cacheHits **0**; avoidedRequests **0** |
| Dimensions | Survival **88.5715** / 0.1774; Utility **58.56** / 0.45; Experience **18** / 0.4107; Performance **null** (`ranking_parse_row_absent`) |
| `CharacterPublishedScore` | **not mutated** |

Note: A still had some thin digests (target-scoped CombatantInfo). Fixed in `55a6828` and confirmed below.

## Corrected validation run B — persistent reuse

| Field | Value |
|-------|--------|
| ID | `edc38030-b8ee-4e02-9709-96f2044e8e48` |
| Terminal | **COMPLETED** (~20s) |
| Slot matrix | **PARTIAL 13** / **UNAVAILABLE 3** |
| Pages / digests | still **212** / **13** — **no** duplicate page or digest rows |
| providerAccounting | discovery **14**; acquisition **13**; providerCalls **27**; pages **186**; points **0**; cacheHits **195**; avoidedRequests **195**; singleflightReuse **13** |
| Dimensions | identical SHADOW scores to A (deterministic) |
| `CharacterPublishedScore` | **not mutated** |

Reuse is durable (DB pages + digests), not process-local L1 alone: pages unchanged across process lifetime, pointsConsumed **0**, avoidedRequests populated.

## Roster confirmation after thin-roster fix

| Field | Value |
|-------|--------|
| ID | `5c212571-5821-48ab-b133-63ee821c188c` |
| Roster size | **5 players on all 13 digests** |
| Wallidrixe | **RESOLVED** → Character `3691e49d-4b34-4723-a694-15a46d98d37a` |
| Other players | UNRESOLVED (no internal Character rows) |
| providerAccounting | providerCalls **27**; avoidedRequests **182**; points **0**; pages stable **212** |

## Cross-character reuse

**Blocked by unresolved identities only.** Party members such as Coomerhabile/silvermoon, Keatyny/silvermoon, Warcrimesuwu/stormscale, Ethernalmonk/outland, Noodelzz/tarrenmill, Haÿze/hyjal have **no** matching `Character` rows in this DB. Narrow second-character lookup was **not** fabricated; no broad 16-slot second canary launched.

## RANKING_PARSE

Live path executed; public client API does not return a usable per-fight ranking row for selected slots. Persisted conclusive blocker: **`ranking_parse_row_absent` / `RANKING_PARSE_PUBLIC_API_UNAVAILABLE`**. Performance remains SHADOW / score null. Other dimensions compute.

## Cooldown usage (examples)

From WRITTEN Survival/Utility fact sets on corrected runs:

- Survival defensives: spell **104773** (DEFENSIVE_MAJOR, castCount **1**), **108416** (DEFENSIVE_MINOR)
- Utility: support abilityGameId **132411** (REACTIVE_SUPPORT); strategic CC abilityGameIds including **1714**, **1271802**
- Interrupts: toolkit `hasInterrupt=true` with **0** credited attempts (true zero observation, not missing evidence)
- Aggregate Utility: strategicCc rawActions **19**; support REACTIVE_SUPPORT credit **15**

## Flags / publication

All `SCORING_V2_*` and `CALIBRATION_V2_*` flags remain default-off.
`adminShadowCanary` bypass is scoped to this admin operation only.
`CharacterPublishedScore` unchanged across baseline and corrected runs.
No push / deploy from this worktree.

## Remaining blockers

1. **Performance** stays UNAVAILABLE until a non-public WCL surface or alternate evidence exists for per-run RANKING_PARSE (conclusive blocker recorded).
2. **Cross-character reuse** waits on safely resolved non-Wallidrixe Character rows (realm/name present on digests; DB identity missing).
3. Season pool gaps remain product-data: `algethar-academy` / `skyreach` missing candidates (not a transport defect).

## Validation

Focused regression coverage for fact binding, durable pages, roster, fight-details reuse, ranking absent reason.
Full suite (lint / typecheck / test / integration / contract / build / english / abilities / diff-check) re-run after remediation — see final agent report.
Not pushed.
