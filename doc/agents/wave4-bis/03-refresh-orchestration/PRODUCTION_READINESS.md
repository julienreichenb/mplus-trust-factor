# Agent 39 corrective — production readiness

## Remaining root causes fixed

1. **Shared evidence unwired** — live Survival still called `analyzeSurvivalCanonicalRun` / `fetchSurvivalCanonicalDatasets` (duplicate detailed event path).
2. **Profile views missing** — `RECENTLY_VIEWED` had no write path; bots could spam rows.
3. **Cost ledger empty** — planner used only conservative baselines.
4. **Shared fetch not Survival-parity** — missing `includeResources`, player `sourceId`, and Survival page caps.

## Live pipeline call graph (after)

```
runRefreshPipeline
├── Blizzard / Raider.IO / WCL discovery (unchanged)
├── getReportFightDetails → combat facts (selection meta)
├── Survival (per selected run)
│   ├── reuse Survival RunAnalysis if compatible → 0 WCL
│   └── else analyzeSurvivalViaSharedEvidence
│       ├── createDurableSharedEvidenceStore (wcl-run-evidence-v1)
│       ├── ingestSharedEvidenceBundle(consumers=[survival, utility])
│       │   ├── loadDataset(compatibilityKey) → reuse ⇒ wclRequests=0
│       │   └── else fetchSharedEventDataset (+resources, Survival pagination)
│       └── buildSurvivalAnalysisFromSharedEvidence → buildCanonicalSurvivalAnalysis
│           (no second fetchSurvivalCanonicalDatasets)
├── recordRefreshCostEntries (durable ledger)
└── attemptPublication (published score preserved on defer/fail)
```

Second compatible refresh: shared dataset keys hit persisted `RunAnalysis` → **zero detailed WCL event calls**.

## Safety gates (unchanged)

- `REFRESH_SCHEDULER_ENABLED=false`
- `REFRESH_DRY_RUN_ONLY=true`
- No recurring cron

## Dry-run capacity (unit-validated)

Tier A/B/C dry-runs + low-quota deferral covered in `refresh-production-readiness.test.ts`.
Use measured warm-refresh average when ledger `n >= 5`; otherwise conservative ~35 pts/character.
