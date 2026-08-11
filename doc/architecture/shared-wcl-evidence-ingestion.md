# Shared WCL Evidence Ingestion — Audit & Call Graph

**Branch:** `agent/wave4.5-wcl-utility-probe`  
**Scope:** Survival + Utility share one canonical evidence bundle; Utility stays offline.

## 1. Production ingestion call graph (before)

```
refresh-pipeline
├── discoverCharacterRuns (encounterRankings)          [WCL]
├── getReportFightDetails / masterData                [WCL]  ← often per-dimension
├── combat-facts (event-fetcher)
│   └── ReportEvents × categories                     [WCL]
│       └── filters to player/pets → DROPS hostile NPC casts
├── Survival: analyzeSurvivalCanonicalRun
│   └── fetchSurvivalCanonicalDatasets                [WCL again]
│       └── Casts/Deaths/DamageTaken/Buffs/… (player-scoped)
└── Utility: NOT in production refresh

Utility probe (offline tooling)
├── run discovery / masterData                        [WCL]
└── fetchUtilityEventDataset (Casts sourceId=null)    [WCL]
    └── still friendly-only without filterExpression
```

### Duplicate logical fetches identified

| Dataset | Combat-facts | Survival canonical | Utility probe |
|---------|--------------|--------------------|---------------|
| masterData | yes | yes | yes |
| Casts (player) | yes (filtered) | yes | yes |
| Hostile NPC casts | **dropped** | **absent** | **absent** |
| Deaths | yes | yes | often absent |
| Buffs/Debuffs | yes | yes | yes |
| Interrupts | yes | no | yes |

### Persistence keys (reuse, do not parallelize)

| Layer | Key |
|-------|-----|
| `external_requests` / `external_payloads` | fingerprint + freshness (`wcl.combat_events`, `wcl.report_master`) |
| `RunAnalysis` | `(runId, characterId, analysisVersion)` |
| Report revision cache | in-process `ReportRevisionCache` |
| Shared evidence (new) | `wcl-run-evidence-v1` + compatibility key |
| Shared run selection | `wcl-shared-run-selection-v1` |

Compatibility key:

`wcl-evidence|{report}|r{revision}|f{fight}|a{actor}|{dataset}|t{start}-{end}|fe:{filter}|{contract}|{fingerprint}`

Durable page uniqueness (`EvidenceDatasetPage`) also includes `scopeFingerprint`, a
deterministic hash of request-shaping values (source actor, filterExpression,
hostilityType, includeResources, start/end, dataset key, provider contract).
Actor-scoped pages for two characters in the same fight must never collide or
reuse each other's cached event pages. Unscoped fight-wide datasets share
`scope:unscoped`.

## 2. Shared architecture (after)

```
SharedRunSelection (one per character/season/contract/model-scope)
        │
        ▼
ingestSharedEvidenceBundle(consumers=[survival, utility])
        │
        ├─ loadDataset(compatibilityKey) → RunAnalysis / file artifacts
        ├─ reuse ⇒ 0 WCL calls
        └─ missing ⇒ fetchSharedEventDataset (paginated, deduped)
                │
                ▼
        WclRunEvidenceBundle
                │
        ┌───────┴────────┐
        ▼                ▼
 Survival analyzer   Utility opportunity engine
 (no direct WCL)     (offline; no production publish)
```

Hostile casts use:

`hostilityType: Enemies` on ReportEvents (Casts defaults to Friendlies)

Optional `filterExpression` for cast subtypes (`begincast` / `cast` / `castfailed` / `interrupted`).

**Observability note:** WCL Casts payloads on the validation panel exposed **zero `interruptible` flags**. Confirmed misses remain gated until interruptibility is available via API fields or a verified mechanic catalog expectation.

## 3. Schema / durable storage

**No new Prisma tables.** Reuse:

- `run_analyses` with `analysisVersion = wcl-run-evidence-v1`
- `external_requests` / `external_payloads` for raw provider payloads (existing recording path)
- publication / observation coherence unchanged
- `WclBudgetManager` cost keys: `sharedEvidenceHostileCasts`, `sharedEvidenceDeaths`, `sharedEvidenceCasts`

Probe artifacts (append-only, do not overwrite 01–10 / 23–30):

| File | Content |
|------|---------|
| `00-shared-run-selection.json` | Canonical selection |
| `11-hostile-casts-raw.json` | Hostile NPC cast stream |
| `12-deaths-raw.json` | Deaths / player-state |
| `13-shared-evidence-accounting.json` | Per-run WCL usage |

## 4. Rules

- Persisted complete dataset + same revision ⇒ **0 WCL calls**
- Report revision change ⇒ invalidate that report/fight evidence only
- Scoring-model change ⇒ local recalculation only
- Catalog change ⇒ local analyzer rerun
- Force score recalculation ≠ provider refetch
- Concurrent refresh coalesce via in-flight map + job dedupe
- Insufficient quota ⇒ `DEFERRED_RATE_LIMIT`; published score preserved
- Partial Utility failure must not invalidate Survival datasets (and vice versa)
- Public profile GET remains zero external calls (read published snapshot only)

## 4.1 WCL cost accounting

Batch loads measure cost via `rateLimitData` **before** and **after**:

| `costSource` | Meaning |
|--------------|---------|
| `measured` | `pointsSpentAfter − pointsSpentBefore` (or all per-request `costUnits` present) |
| `estimated` | Conservative page/request estimate when measurement unavailable |
| `unknown` | No basis — **`pointsConsumed` is `null`, never `0`** |

Module: `packages/providers/warcraftlogs/src/evidence/wcl-batch-cost-accounting.ts`

## 5. Remaining observability limitations

- Range / LoS still **NOT_OBSERVABLE**
- Mechanic catalog for PRIORITY_INTERRUPT is prep/empty — uncovered spells stay severity-neutral
- Revive/res streams not fully modeled (death sticks until fight end in V3.2)
- Utility remains **offline** / not production-integrated
