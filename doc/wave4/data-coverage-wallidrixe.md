# Wallidrixe data coverage — Scoring v3 foundation

Character: `EU/archimonde/Wallidrixe`  
Catalogs: `ability-catalog-v1-seed`, `scoring-mechanic-catalog-v1-seed`  
Formula envelope: `scoring-v3-raw-facts-v1`  
Score model: **unchanged** (`default@2` remains active)

This document records whether each required Wave 4 metric can be collected from public providers + versioned catalogs. Status values:

- **AVAILABLE** — collected today with confidence suitable for dimension agents
- **PARTIAL** — collectable with gaps (catalog coverage, fight tying, or missing snapshot fields)
- **BLOCKED** — cannot collect reliably yet without new provider fields / product decisions

## Season / run selection

| Metric | Status | Notes |
|---|---|---|
| Active season resolution | PARTIAL | Blizzard current season works; Scoring v3 refuses `placeholder-current`. Smoke defaults to configured Midnight S1 dungeon set via `SCORING_SEASON_SLUG` / `season-midnight-s1`. |
| Expected eight-dungeon set | AVAILABLE | Canonical slugs in `@mplus/mechanics` `MIDNIGHT_S1_SEASON`. |
| One canonical run per dungeon | AVAILABLE | `selectScoringRuns`: highest key → score → timed → latest. |
| Keep unlogged highest run | AVAILABLE | Never demotes to a lower logged run; marks `detailAvailable=false`. |
| Out-of-season exclusion | AVAILABLE | Season-slug filter on selection input. |

## Performance inputs

| Metric | Status | Notes |
|---|---|---|
| Selected-run parse percentile | PARTIAL | Zone rankings percentiles exist; tying a percentile to the **selected fight** is still best-effort (`reportCode`+`fightId` match). Aggregate rankings may lack fight IDs. |
| Bracket-aware parse | PARTIAL | Bracket field present when rankings expose it; not yet required for selection. |
| Key difficulty percentile | BLOCKED | Key level + timed inputs AVAILABLE; season-cutoff interpolation / regional distribution not wired (Agent 22). |
| Spec / role | PARTIAL | CombatantInfo / profile identity available; not persisted on every selected run yet. |

## Survival

| Metric | Status | Notes |
|---|---|---|
| Death count | AVAILABLE | WCL Deaths filtered to target actor. Scored by Survival v3 soft curve (cap 5). |
| Damage taken | AVAILABLE | WCL DamageTaken totals for target. |
| Avoidable damage | PARTIAL | Versioned scoring-mechanic catalog (`scoring-mechanic-catalog-v1-survival-agent23`). Unknown abilities never avoidable. Recycled dungeons expanded; Midnight-original dungeons still placeholder IDs. |
| Personal defensives | AVAILABLE | Catalog-driven (`personal_defensive`) for Warlock seed; available uses = Σ floor(duration/CD), spam capped. |
| Self-heal effective / overheal | PARTIAL | Requires Healing events. Effective heal credited; overheal exposed in explanation only. |
| Healing potion casts | PARTIAL | Catalog includes Healthstone + Algari + seasonal seed ID — verify live Midnight potion IDs. |
| Max health | PARTIAL | Extracted from CombatantInfo `maxHitPoints` when present; otherwise BLOCKED and avoidable contributor renormalizes. |

## Utility

| Metric | Status | Notes |
|---|---|---|
| Kick casts | AVAILABLE | Catalog interrupt spell IDs; pet casts attributed via `petOwner`. |
| Successful interrupts | AVAILABLE | WCL Interrupts with player+pet attribution. |
| Effective kick cooldown | PARTIAL | Base CD from catalog; talent modifiers supported in schema but loadout talents not fully resolved in smoke. |
| Distinct CC targets | AVAILABLE | Unique hostile targets from catalogued CC casts/auras. |
| Group-support casts | AVAILABLE | Demonic Gateway seeded for Warlock. |
| Defensive dispels | AVAILABLE | Singe Magic / Command Demon seeded. |
| Offensive dispels / purges | PARTIAL / BLOCKED | No Warlock offensive-dispel seed; classification falls back heuristically — Agent 24 must decide capability matrix. |

## Experience (feasibility only)

| Metric | Status | Notes |
|---|---|---|
| Same-character rename/transfer | AVAILABLE | WCL `canonicalId` (Agent 25). |
| Public account-wide alts | BLOCKED | Not publicly enumerable via WCL; needs consent / verified linkage. |

## Provider cost & pagination

| Control | Status | Notes |
|---|---|---|
| Event pagination bounds | AVAILABLE | `MAX_EVENT_PAGES=10`, `MAX_EVENTS_PER_CATEGORY=2000`; smoke emits truncated categories. |
| Eight-run analysis budget | AVAILABLE | Worker analyzes all `ScoringRunSelection` entries up to `WCL_MAX_ANALYSIS_FIGHTS` (default 8, hard cap 16). Bound is selected canonical runs, not first-N reports. |
| API point cost | PARTIAL | Smoke prints `providerPointCost` + `wclApiCallCount` (deduped report/fight fetches). |

## Sanitization

Deep smoke emits report **fingerprints / masked codes only**, never raw report codes or unrelated roster dumps. Secret env values are not printed.

## Contract freeze recommendation (Agents 22–26)

Freeze now:

1. `ScoringRunSelection` + `ScoringSelectedRun` in `@mplus/contracts`
2. `SurvivalRawFacts` / `UtilityRawFacts` / `PerformanceRawInputs` + `RawFactProvenance`
3. `AbilityRule` + `ScoringMechanicRule` catalog schemas/versions
4. Selection invariants (no demotion for missing WCL; missing ≠ zero)

Defer until dimension agents:

- Score model `default@3` weights (Agent 27)
- Full mechanic/ability catalog expansion
- Max-health source + key-difficulty interpolation
