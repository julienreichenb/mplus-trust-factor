# Utility baseline audit (Agent 06)

**Branch:** `agent/06-utility-baseline-audit`  
**Date:** 2026-07-30  
**Scope:** Audit + non-invasive diagnostics only. No public score formula changes. No mass live WCL calls.  
**Live validation:** Not performed (no user-approved fixture characters / credentials in this run). Commands for later execution are at the end.

## Verdict

Utility is weak/unavailable for many real characters primarily because:

1. **Shared Survival evidence often lacks Utility-only streams** (`HostileCasts`, `Interrupts`, `Dispels`, `DamageDone`) unless refresh ingested with `consumers: ["survival","utility"]` / `includeUtilityDatasets: true`.
2. **Publication eligibility conflates complete zero contribution with insufficient evidence** — a complete sample with `attributableEvents === 0` scores 50 with confidence ≤35, which fails v6 `minConfidence: 0.45`, so today’s gates reject what programme policy says should publish as neutral **without** fallback.
3. **Incomplete candidate rows currently fail the whole character** (`incompleteEvidenceCount > 0` → `INCOMPLETE_REQUIRED_DATASETS`) even when enough complete runs already exist.
4. **No explicit baseline-state machine or bounded fallback** exists yet — Agent 07 owns wiring.

Prototype classifiers live in  
`packages/providers/warcraftlogs/src/evidence/utility-baseline-diagnostics.ts`.

---

## Failure taxonomy

| Baseline state | Meaning | Fallback? | Typical root causes |
|----------------|---------|-----------|---------------------|
| `PUBLISHABLE` | Gates met + attributable positives observed | No | Dual-consumer shared evidence complete; enough runs/domains |
| `COMPLETE_ZERO_CONTRIBUTION` | Analyzable complete sample; zero attributable positives | **No** | Spec with no toolkit actions in window; truly unused utility; still score 50 |
| `INSUFFICIENT_EVIDENCE_RETRYABLE` | Too few complete/analyzed runs or coverage | **Yes** (≤4) | Missing Utility datasets; sparse matched reports; actor skips |
| `WCL_UNAVAILABLE` | Provider unavailable / private skipped | No | API down; private reports |
| `RATE_LIMITED` | Rate defer / rate-limited data state | No | `evaluateRateBudget` DEFER; GraphQL RATE_LIMITED |
| `BUDGET_EXHAUSTED` | Rate STOP | No | `WCL_RATE_STOP_PERCENT` |
| `NO_PUBLIC_LOGS` | No public WCL discovery | No | Empty rankings/reports |
| `IDENTITY_OR_MATCH_FAILURE` | Character↔report/actor match failed | No | Name/realm/region mismatch; missing `playerActorId` |

### Evidence-absence causes (per run / sample)

| Cause | Code signal |
|-------|-------------|
| No public report | `wclDataState=NO_PUBLIC_LOGS`, discovery empty |
| Report matching failed | `wclReportMatched=false`, selection reject |
| Actor resolution failed | `actor_attribution_failed`, `missing_player_actor` |
| Event pagination/truncation | `dataset.truncated=true` |
| Wrong event types | Friendlies Casts without HostileCasts filter; historical hostility bugs |
| Unsupported spell catalog | toolkit empty / unsupported class-spec notes |
| Truly zero observed contribution | Complete datasets + `attributableEvents=0` |
| Rate/budget stop | `rateBudgetAction` DEFER/STOP |
| Cache incompatibility | revision mismatch, analysisVersion ≠ `wcl-run-evidence-v1` |
| Survival-only bundle | Missing Utility-only keys while Survival keys present |

---

## Answers to mission questions

### How many selected runs have reusable WCL detailed evidence?

**Code contract (not live counted here):** baseline targets **one canonical best run per active dungeon ≤8**. Reuse is durable via `buildSharedEvidenceCompatibilityKey` + `RunAnalysis` / `external_payloads`. A second compatible refresh should show `providerCalls=0` when datasets persist.

**Live:** run the offline fixture commands below against persisted probe artifacts; do not call WCL at scale.

### Which required Utility event streams are missing?

Utility consumers (`UTILITY_EVIDENCE_CONSUMERS`):

`masterData`, `Casts`, `HostileCasts`, `Interrupts`, `Deaths`, `Buffs`, `Debuffs`, `Dispels`, `DamageDone`, `CombatantInfo`

**Utility-only vs Survival** (cannot be supplied by Survival-only ingest):

- `HostileCasts`
- `Interrupts`
- `Dispels`
- `DamageDone`

Overlap already on Survival path: `masterData`, `Casts`, `Deaths`, `Buffs`, `Debuffs`, `CombatantInfo`.

### Can Survival evidence bundles satisfy Utility without additional calls?

| Ingest mode | Satisfies Utility? |
|-------------|--------------------|
| `consumers: ["survival"]` only | **No** — missing Utility-only streams |
| `consumers: ["survival","utility"]` / `includeUtilityDatasets: true` and complete | **Yes** — zero extra WCL on reuse |
| Survival cache hit + incomplete Utility datasets | **Gap-fill fetch** of Utility-only keys (refresh already attempts this when `utilityEvidencePresentInBundle` is false) |

### For failures, how many extra runs would make Utility publishable?

Heuristic in `classifyUtilityBaselineState` → `estimatedExtraRunsToPublishable`:

`min(4, max(runsShort, coverageShort, dungeonGap, 1))` when state is `INSUFFICIENT_EVIDENCE_RETRYABLE`; otherwise `null`.

v6 gates: `minAnalyzedRuns=3`, `minEvidenceCoverage=0.5`, `minConfidence=0.45`, `minObservedDomains=2`.

### Call / event-page cost distribution

See `UTILITY_BASELINE_REQUEST_COST_TABLE` in code (exported). Summary:

| Operation | Conservative cost |
|-----------|-------------------|
| Event page | **1 point/page** estimate when unmeasured |
| Cold dual-consumer run | ≈10–40+ pages/requests (fight-dependent; HostileCasts dominates) |
| Compatible second refresh | **0** detailed provider calls |
| Utility gap-fill after Survival-only | pages for HostileCasts+Interrupts+Dispels+DamageDone only |
| Fallback extra run (uncached) | ≈ same as cold dual-consumer; stop early when publishable |

Runtime must prefer measured `rateLimitData` delta / `costUnits`; never coerce unknown → 0.

### Which fallback selection yields best evidence per WCL request?

`selectUtilityFallbackRuns` policy:

1. Trigger **only** if baseline state is `INSUFFICIENT_EVIDENCE_RETRYABLE`.
2. Prefer **missing / underrepresented** active dungeons.
3. Prefer **predicted complete persisted** Utility evidence (0 calls).
4. Prefer lower predicted provider calls, then higher score, then more recent.
5. **Pass 1:** one extra per dungeon; **Pass 2:** second from same dungeon only after.
6. Cap **4**; stop as soon as publication criteria would be met (Agent 07 must evaluate after each ingest).

---

## Baseline publication criteria

Publish Utility (`utility.observed_contribution`) when baseline state is:

### `PUBLISHABLE`

- `shadowStatus === SHADOW_SCORED`
- `analyzedRunCount ≥ minAnalyzedRuns` (3)
- `compatibleEvidenceCount / candidateRunCount ≥ minEvidenceCoverage` (0.5)
- `confidence01 ≥ minConfidence` (0.45) **or** product accepts observed-domain confidence path
- `observedDomainCount ≥ minObservedDomains` (2)
- `attributableEvents > 0`
- No hard WCL failure state

### `COMPLETE_ZERO_CONTRIBUTION`

- Analyzable complete sample meeting run/coverage floors
- `attributableEvents === 0`
- Emit **neutral 50** with **low confidence** (config caps ≤35 today)
- **Do not** fallback
- **Do not** treat as `INSUFFICIENT_EVIDENCE_RETRYABLE`

> **Gap for Agent 07:** current `evaluateUtilityPublicationEligibility` rejects zero-contribution via `INSUFFICIENT_CONFIDENCE` / `INSUFFICIENT_OBSERVED_DOMAINS`. Wire `classifyUtilityBaselineState` **before** or **into** eligibility so complete-zero publishes.

### Not publishable (no fabricated score)

All other baseline states → Utility unavailable / last-known-good policy unchanged; ranking eligibility may be false under v6.

---

## Machine-readable diagnostic schema (proposal)

```json
{
  "schemaVersion": "1.0.0",
  "analysisVersion": "utility-baseline-diagnostics-v1",
  "state": "INSUFFICIENT_EVIDENCE_RETRYABLE",
  "fallbackAllowed": true,
  "publishable": false,
  "completeZeroContribution": false,
  "evidenceCoverage": 0.25,
  "confidence01": 0.4,
  "analyzedRunCount": 1,
  "compatibleEvidenceCount": 1,
  "candidateRunCount": 8,
  "observedDomainCount": 1,
  "attributableEvents": 2,
  "absenceCauses": ["incomplete_utility_datasets", "survival_only_bundle"],
  "missingUtilityOnlyDatasets": ["HostileCasts", "Interrupts"],
  "survivalBundleCanSatisfyUtility": false,
  "estimatedExtraRunsToPublishable": 2,
  "reasons": ["insufficient_analyzed_runs"],
  "gates": {
    "minAnalyzedRuns": 3,
    "minConfidence": 0.45,
    "minEvidenceCoverage": 0.5,
    "minObservedDomains": 2
  },
  "runs": [
    {
      "reportCode": "ABC",
      "fightId": 7,
      "dungeonSlug": "ara-kara",
      "evidenceComplete": false,
      "missingDatasets": ["HostileCasts"],
      "truncatedDatasets": [],
      "providerCalls": 0,
      "pages": 0,
      "pointsConsumed": null,
      "costSource": "unknown",
      "absenceCauses": ["survival_only_bundle"]
    }
  ],
  "fallback": {
    "triggered": false,
    "selected": [],
    "maxExtraRuns": 4
  }
}
```

Persist under RunAnalysis summary (admin diagnostics) alongside existing `utility-observed-shadow-v1`.

---

## Fallback selection algorithm (for Agent 07)

```
if baseline.state != INSUFFICIENT_EVIDENCE_RETRYABLE: stop
if rateBudget in {DEFER, STOP} or NO_PUBLIC_LOGS: stop (map to RATE_LIMITED / BUDGET_EXHAUSTED / NO_PUBLIC_LOGS)
candidates = public, not in baseline, in active dungeon pool
sort by: missingDungeon > underrepresented > predictedCompleteCache > lowPredictedCalls > score > recent
pass1: pick ≤1 per dungeon until cap or publishable
after each ingest: re-classify; stop if PUBLISHABLE or COMPLETE_ZERO_CONTRIBUTION
pass2: allow 2nd from same dungeon only if still retryable
hard cap: 4 extra runs
never mutate Performance canonical selection
ledger: pages, calls, pointsConsumed, selectionReasons
```

**Cap validation recommendation:** start at **max 4**; measure distribution of `extraRunsNeeded` on a stratified panel; if P90 ≤2, keep 4 as ceiling; if many hit 4 still ineligible, investigate match/dataset gaps before raising cap.

---

## Agent 07 exact implementation file plan

| File | Change |
|------|--------|
| `packages/providers/warcraftlogs/src/evidence/utility-baseline-diagnostics.ts` | **Already added (06)** — consume; do not fork taxonomy |
| `packages/providers/warcraftlogs/src/probe/utility-publication-eligibility.ts` | Integrate baseline state: complete-zero eligible; do not reject solely on confidence≤35 when attributableEvents=0 and coverage floors met; stop failing closed on `incompleteEvidenceCount>0` when enough **complete** runs exist |
| `apps/worker/src/orchestration/utility-shadow-refresh.ts` | Emit baseline diagnostic into shadow summary |
| `apps/worker/src/orchestration/utility-publication-refresh.ts` | Publish on `PUBLISHABLE` **or** `COMPLETE_ZERO_CONTRIBUTION` |
| `apps/worker/src/orchestration/refresh-pipeline.ts` | After baseline Utility shadow: if `fallbackAllowed`, call selection + bounded `ingestSharedEvidenceBundle` (dual consumers); re-score; cost ledger; **do not** change Performance run selection |
| `apps/worker/src/orchestration/utility-fallback-refresh.ts` | **New** — orchestrate select → ingest → reclassify loop |
| `packages/providers/warcraftlogs/src/evidence/utility-from-shared-evidence.ts` | Optional: expose per-run absence causes via `diagnoseUtilityBaselineRun` |
| Tests listed in Agent 07 prompt | Add fixtures below |

**Do not touch:** `processors.ts` / queue topology (Agent 09); score weights/thresholds; opportunity research publication.

---

## Regression fixture recommendations

| Fixture | Assert |
|---------|--------|
| Dual-consumer complete ×3–8 runs with interrupts | `PUBLISHABLE`, fallback not triggered, 0 extra WCL |
| Dual-consumer complete ×≥3, empty events | `COMPLETE_ZERO_CONTRIBUTION`, score 50, no fallback |
| Survival-only bundles ×8 | missing Utility-only; retryable or gap-fill then reclassify |
| 1 complete + 7 incomplete | eligibility uses complete count; do not hard-fail on incomplete siblings |
| Retryable + 5 public alternates | selects ≤4, missing dungeons first, stops when publishable |
| `rateBudgetAction=STOP` | `BUDGET_EXHAUSTED`, no loop |
| `NO_PUBLIC_LOGS` | no fallback |
| Actor missing on all | `IDENTITY_OR_MATCH_FAILURE` |
| Second refresh same revision | `providerCalls=0` |
| Truncated HostileCasts | cause `event_pagination_truncation`; may still score with lowered confidence |

Reuse builders from `utility-from-shared-evidence.test.ts` / `utility-baseline-diagnostics.test.ts`.

---

## Live validation commands (not executed)

```powershell
# From repo root, with WCL creds only if explicitly approved:
pnpm --filter @mplus/provider-warcraftlogs test -- utility-baseline-diagnostics
pnpm --filter @mplus/provider-warcraftlogs exec vitest run src/evidence/utility-from-shared-evidence.test.ts

# Offline shared-evidence load against existing probe artifacts (no new WCL if cached):
# pnpm wcl:shared-evidence:load -- --help

# Bounded single-character refresh (admin force) — record every call; stop before warning thresholds.
# Do not run without an approved fixture character list.
```

---

## Code authority notes

- Docs claiming Survival shared evidence alone is enough for Utility are **wrong** unless Utility-only datasets were co-fetched.
- `UTILITY_EVENT_TYPES` in probe types omits `HostileCasts` as a named UtilityEventDataType but shared evidence stores HostileCasts separately and merges into raw casts for opportunity extraction — Agent 07 must keep HostileCasts in completeness checks (`utilityEvidencePresentInBundle`).
