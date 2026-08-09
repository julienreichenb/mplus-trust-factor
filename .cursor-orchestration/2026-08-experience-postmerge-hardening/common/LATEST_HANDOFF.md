# Latest Handoff

Status: AGENT 02 COMPLETE

## Baseline

- PR #84 is merged.
- Agent 01 accepted (`062b9cf` — provider-free Experience reconstruction + RIO accounting).
- Agent 02 owns F2–F6 (season/evidence integrity).

## Current agent

Agent 02 — season binding + evidence integrity hardening (complete).

## 1. Canonical season-binding architecture (F3)

### Before (PR #84 / Agent 01)

Two independent previous-season inferences:

1. `buildExperiencePhase1Result` → `resolvePreviousMythicSeason()` (authority slug + chronology).
2. `refresh-bridge.ts` → separate `season.findMany` ordered by `startsAt desc` (no authority-slug filter) → `boundPreviousRaiderIoSlug`.

A fixture/non-authority Season with a later `startsAt` and a plausible `providerSeasonId` could supply the RIO slug for exact historical acquisition while phase-1 selected a different previous row.

### After

- `resolveCanonicalPreviousSeasonBinding()` = `resolvePreviousMythicSeason()` + `providerSeasonId` from **that same selected row**.
- `refresh-bridge` resolves once and passes `canonicalPreviousBinding` into phase-1 (no re-inference of previous / slug).
- Phase-1 prefers the selected row’s `providerSeasonId` over any poisoned caller slug override.
- Fixture pollution cannot attach a fake RIO slug to the canonical previous Season.

## 2. Evidence compatibility contract (F4)

`ratingEvidenceFromPersistedRow(row, expected?)` now validates against the current binding when `expected` is supplied:

| Check | Rule |
|-------|------|
| characterId / seasonId / compat version | must match |
| payload.internalSeasonId | must match row + expected |
| blizzardSeasonId | payload (+ row when present) must match expected |
| raiderIoSeasonSlug | when expected slug known, present row/payload values must match; legacy null tolerated |
| source ↔ ratingSource | BLIZZARD / RAIDERIO_FALLBACK consistency |
| contentHash | when present, must equal hash of normalized payload |

Incompatible row: providers allowed → ignore + reacquire; providers forbidden → unavailable. Immutable row is never mutated in place.

## 3. Remapped cutoff equivalence proof (F2)

`proveExactRaiderIoCutoffSeasonEquivalence()` — narrow typed proof, **not** unconditional `exactTargetSeasonEquivalenceProven: true`.

Requires:

- exact bound RIO slug match;
- `isMainSeason === true`;
- matching `blizzardSeasonId` when RIO supplies it (mismatch → reject);
- if RIO omits blizzard id → chronology proximity / containment required;
- absurd start distance rejected even when ids match.

Bootstrap passes `exactTargetSeasonEquivalenceProven: proof.proven` into `synchronizeSeasonPopulationPolicy`. Remapped cutoffs without proof remain rejected; proven exact-season remapped policy can become LKG (Agent 03 fresh-DB positive-rating path).

## 4. Ensure retry semantics (F5)

- `isExperienceSeasonBindingEnsureComplete(region)` gates memoization.
- Transient / insufficient (provider failure, missing previous RIO slug, etc.) → **do not** remember.
- Sequence: failed ensure → retry → successful ensure → subsequent ensure may SKIP.
- Applies to both `ensureExperienceSeasonBindingReady` and `runExperienceSeasonBootstrapSafe`.

## 5. Blizzard terminal vs transient (F6)

`classifyBlizzardPreviousSeasonFailureForRioFallback(cause)`:

| Class | Examples | Immutable RIO fallback |
|-------|----------|------------------------|
| `TRANSIENT` | 429 / RATE_LIMITED, 5xx, NETWORK, TIMEOUT, `retryable: true` | **No** (no RIO call, no persist) |
| `TERMINAL_HISTORICAL_UNAVAILABLE` | 404 / NOT_FOUND / PROFILE_UNAVAILABLE | **Yes** if exact RIO season evidence available |
| `NON_FALLBACK` | other | **No** |

Successful Blizzard evidence never calls RIO. Confirmed no-activity / ambiguous-zero / class-rank fail-closed / native bands / P/S/U / Agent 01 accounting unchanged.

## Files changed

- `apps/worker/src/orchestration/scoring/experience-previous-season-evidence.ts` — canonical binding + failure classification
- `apps/worker/src/orchestration/scoring/experience-evidence-persist.ts` — binding compatibility checks
- `apps/worker/src/orchestration/scoring/experience-phase1.ts` — consume canonical binding; gate RIO fallback; validate cache
- `apps/worker/src/orchestration/scoring/refresh-bridge.ts` — single canonical resolve; pass binding into phase-1
- `apps/worker/src/orchestration/scoring/experience-season-bootstrap.ts` — remapped proof; ensure memoization only on complete
- `apps/worker/src/orchestration/scoring/experience-agent02-integrity.test.ts` — new F2–F6 regressions
- `.cursor-orchestration/.../common/LATEST_HANDOFF.md` — this handoff

## Tests

```
pnpm test:raw -- \
  apps/worker/src/orchestration/scoring/experience-agent02-integrity.test.ts \
  apps/worker/src/orchestration/scoring/experience-previous-season-evidence.test.ts \
  apps/worker/src/orchestration/scoring/experience-evidence-persist.test.ts \
  apps/worker/src/orchestration/scoring/experience-season-bootstrap.test.ts \
  apps/worker/src/orchestration/scoring/experience-season-population-policy-sync.test.ts \
  apps/worker/src/orchestration/scoring/experience-phase1.test.ts \
  apps/worker/src/orchestration/scoring/experience-phase1.e2e.test.ts \
  apps/worker/src/orchestration/scoring/refresh-bridge.experience-replay.test.ts \
  apps/worker/src/orchestration/scoring/experience-agent05-acceptance.test.ts \
  apps/worker/src/orchestration/scoring/experience-season-rollover.audit.test.ts \
  apps/worker/src/orchestration/scoring/refresh-integration.test.ts \
  apps/worker/src/orchestration/scoring/score-character.test.ts
```

Result: **139 passed** (12 files; 79 + 60 across the two focused runs).

## Completed commits

- Agent 01: `062b9cfad4757a388150271081d75f10c13752d2`
- Agent 02: _(this commit — fill SHA after commit)_

## Remaining sequence

1. ~~Agent 01 — canonical replay + accounting.~~
2. ~~Agent 02 — season/evidence integrity hardening.~~
3. Agent 03 — final regression / live acceptance (fresh-DB positive-rating + remapped policy path).

## Blockers / concerns for Agent 03

- Prove clean-DB positive historical rating with remapped cutoffs when `proveExactRaiderIoCutoffSeasonEquivalence` is true (Wallidrixe E=0 hides policy need).
- Exercise canonical `runAuthoritativeScoring` entry, not only `buildExperiencePhase1Result`.
- Optional disposable-DB integration for evidence round-trip (F8).
- Live probe footgun (F9) still open — descope/protect if retained.
- Incompatible immutable rows are ignored for scoring but not deleted; a future compat-version bump may be needed if repair is required in production.
- No P/S/U, band, weight, class-rank floor, or elite floor changes in this agent.
