# Audit Baseline

## Validated scoring baseline from previous chantier

Wallidrixe-Archimonde EU, 16 selected timed public WCL runs:

- Performance ~= 94.960, confidence 1.0
- Survival ~= 72.933, confidence 1.0
- Utility = 62.3, confidence 1.0
- Experience = unavailable / `PREVIOUS_EVIDENCE_UNAVAILABLE`
- Composite ~= 78.545, confidence ~= 0.9
- Tier B

Regression invariants already validated:
- 16/16 timed public run selection;
- encounterRankings discovery;
- character-scoped ranking evidence;
- capability package/digest warm reuse;
- max HP / HostileCasts / CombatantInfo loadout conservation;
- offensive active-combat clock separated from Survival pressure clock;
- conditional cooldowns skip unresolved availability;
- P/S/U independent per-dimension confidence;
- replay has zero WCL provider calls;
- API matches persisted CharacterScore;
- E=0 available semantics have tests.

Do not disturb this baseline.

## Existing dynamic season foundation

The repository already has a canonical season authority based on Blizzard's authoritative `current_season` resolution.

Relevant code:
- `apps/worker/src/orchestration/season-authority.ts`
- active M+ season authority / SeasonDungeon orchestration
- `ensureBlizzardCurrentSeason(...)`

The Experience chantier should consolidate around that authority, not create a parallel current-season system.

## Existing Experience code

Important files include:
- `apps/worker/src/orchestration/scoring/experience-phase1.ts`
- `apps/worker/src/orchestration/scoring/experience-previous-season-evidence.ts`
- `apps/worker/src/orchestration/scoring/experience-season-bootstrap.ts`
- `apps/worker/src/orchestration/scoring/experience-season-population-policy-sync.ts`
- `apps/worker/src/orchestration/scoring/experience-season-population-policy-metadata.ts`
- `apps/worker/src/orchestration/scoring/refresh-bridge.ts`
- `packages/scoring/src/experience/phase1/calculate.ts`
- `packages/scoring/src/experience/phase1/season-population-policy.ts`
- Raider.IO / Blizzard contracts and provider normalization.

## Existing Raider.IO contract observations to audit

Current repository contracts/profile fields include:
- `mythic_plus_scores_by_season:current:previous`
- `previous_mythic_plus_ranks`
- normalized `previousSeason`
- normalized `previousRanks`
- native cutoff quantiles currently represented as `p999`, `p990`, `p900`, `p750`, `p600`.

These shorthands must NOT be assumed season-correct merely because they are named "previous".

The agent must inspect provider documentation and actual normalized/raw shape and prove how event/intermediate periods behave.

## Current high-risk gaps

### A. Immutable history is not a first-class cache

Previous-season historical rating is currently acquired through provider flow rather than treated as a permanent character+season fact.

Desired lifecycle:
- successful closed-season evidence -> persist once -> permanent reusable fact;
- transient failure -> retryable;
- no repeated historical score calls during recalculation.

### B. Experience replay asymmetry

Provider-disabled Experience does not yet have the same durable evidence reconstruction quality as P/S/U.

### C. Parallel season logic risk

Experience bootstrap has its own season hydration/matching logic in addition to the canonical season authority.

Audit whether a long-lived process crossing into the next season updates Experience policy/binding without needing a restart.

### D. Generic Raider.IO "previous"

Generic `previousSeason` / `previousRanks` may not prove the same exact real season as the Blizzard binding, especially around event/intermediate periods or expansion transitions.

### E. Native cutoff simplification

The current scoring code converts cutoff thresholds to product `topPercent` anchors and interpolates.

Product decision now prefers direct Raider.IO native cutoff bands / quantiles and no unsupported percentile extrapolation.

### F. rating=0

A finite zero must not become a synthetic low-standing score when it actually represents no season activity.

### G. fallback provenance

Raider.IO may supply the historical rating only when Blizzard fails. This fallback must be exceptional, exact-season and explicit in persisted provenance.
