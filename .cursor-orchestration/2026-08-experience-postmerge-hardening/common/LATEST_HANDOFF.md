# Latest Handoff

Status: AGENT 02 COMPLETE

## Baseline

- PR #84 is merged.
- Agent 01 accepted (`062b9cf` — provider-free Experience reconstruction + RIO accounting).
- Agent 02 owns F2–F6 (season/evidence integrity).

## Current agent

Agent 02 — season binding + evidence integrity hardening (complete; corrective follow-up applied).

## Corrective follow-up (explicit Blizzard↔RIO identity)

### RIO match algorithm

When target Blizzard season id is known:

1. exact-id candidates among real main seasons;
2. unique exact-id → chronology sanity (see below) then select; multiple → date-disambiguate **only among exact-id**;
3. no exact-id → date match **only** among RIO seasons with missing/unavailable `blizzardSeasonId`;
4. explicitly mismatched ids → `RIO_DATE_MATCH_EXPLICIT_BLIZZARD_ID_MISMATCH` (never win by dates).

Unique exact-id chronology (`RIO_BLIZZARD_EXACT_ID_CHRONOLOGY_MAX_MS` = 2× proximity):
- both starts missing/partial → ID sufficient, accept;
- both starts present and within max → accept;
- both starts present and absurdly far → `RIO_DATE_MATCH_EXACT_ID_CHRONOLOGY_ABSURD`.

### Stale legacy `providerSeasonId`

After a failed fresh match, bootstrap revalidates any persisted previous slug via
`revalidatePersistedRaiderIoSeasonSlug` (same identity semantics as fresh match,
including Blizzard start/end chronology):

| Evidence | Result |
|----------|--------|
| Explicit matching Blizzard id + absurd chronology | `PROVEN_INCOMPATIBLE` |
| Explicit matching Blizzard id + compatible/missing dates | `COMPATIBLE` |
| Explicit mismatched Blizzard id / non-main | `PROVEN_INCOMPATIBLE` |
| Missing RIO id + conservative date match OK | `COMPATIBLE` |
| Missing RIO id + dates prove mismatch | `PROVEN_INCOMPATIBLE` |
| Missing RIO id + insufficient dates / static down / absent slug | `COULD_NOT_REVALIDATE` |

| Status | Action |
|--------|--------|
| `PROVEN_INCOMPATIBLE` | clear `providerSeasonId`; do not sync cutoffs; leave binding unbound |
| `COULD_NOT_REVALIDATE` | retain LKG slug (static down / slug not in loaded pools / dates insufficient) |
| `COMPATIBLE` | reuse slug as binding + proof season |

### providerSeasonId writes

- Write `Season.providerSeasonId` only after a successful identity match.
- Do **not** fall back to `rioPair.current.slug` after a failed match (especially explicit id mismatch).
- Fail closed: wrong slug is never persisted; cutoff sync is skipped when previous RIO slug is unbound.

### RAIDERIO_FALLBACK replay

When binding has a known exact RIO slug, `RAIDERIO_FALLBACK` rows require non-null matching `payload.raiderIoSeasonSlug` and `row.raiderIoSeasonSlug`. BLIZZARD-primary may still tolerate legacy null RIO provenance.

### Ensure retry proof

`ensureExperienceSeasonBindingReady`: transient failure → same-process retry executes bootstrap again and succeeds (auto-memoizes) → third call returns `EXPERIENCE_SEASON_BINDING_ALREADY_ENSURED`. No manual `rememberExperienceSeasonBindingEnsured` in the proof.

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
| raiderIoSeasonSlug | BLIZZARD: present values must match when expected known; legacy null OK. RAIDERIO_FALLBACK: payload + row slug required and must equal expected |
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

Result: **163 passed** (12 files).

## Completed commits

- Agent 01: `062b9cfad4757a388150271081d75f10c13752d2`
- Agent 02 primary: `2c08699edfb77aede081386c168e326bd704d7ff`
- Agent 02 corrective (id-mismatch): `0159f6a31695196f31c8be3dd18b6abee94c8675`
- Agent 02 corrective (stale slug + exact-id chronology): `1fb57a83ad09daf5ccdbe8a43f06243934254dae`
- Agent 02 corrective (revalidation chronology parity): `2be03df197a1ed853184b43299dc03c02994342b`
- Tip: `2be03df197a1ed853184b43299dc03c02994342b`

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
