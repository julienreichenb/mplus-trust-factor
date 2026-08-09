# Latest Handoff

Status: AGENT 01 COMPLETE

## Baseline

- PR #84 is merged.
- CI for PR #84 passed.
- Post-merge review found the issues documented in `REVIEW_FINDINGS.md`.

## Current agent

Agent 01 — canonical replay + accounting (complete).

## Root cause proven (F1)

`runAuthoritativeScoring()` in `refresh-bridge.ts` gated the entire Experience path on `allowExperienceBlizzardProviderCalls(env)`:

```
experienceOverride?
  → use override
else if allowExperienceBlizzardProviderCalls && !disabledProviders.has("blizzard")
  → buildExperiencePhase1Result({ allowProviderCalls: true })
else
  → experience = null   // NEVER entered phase-1, even with durable evidence
```

### Call graph (before)

1. **Operational live refresh** (`ALLOW_LIVE_PROVIDER_CALLS=true`, `PROVIDER_MODE=live`, Blizzard enabled):
   - enters Experience → `buildExperiencePhase1Result(allowProviderCalls=true)` → acquire + persist.
2. **Recalculation / replay with providers disabled** (`ALLOW_LIVE_PROVIDER_CALLS=false` or non-live/fixture without allow):
   - skips `buildExperiencePhase1Result` entirely → `experience=null` despite `CharacterExperienceEvidence` rows.
3. **Fixture mode** (`PROVIDER_MODE=fixture` + `ALLOW_LIVE_PROVIDER_CALLS=true`):
   - enters Experience (same as live for the Blizzard gate); WCL remains separately gated.
4. Note: `buildExperiencePhase1Result` already supported `allowProviderCalls=false` (Agent 05 unit tests), but the production entry never called it in that mode.

### Call graph (after)

1. **Live / fixture with Experience providers permitted**:
   - always enter `buildExperiencePhase1Result({ allowProviderCalls: true })`.
2. **Providers forbidden** (recalc/replay/fixture without allow):
   - still enter `buildExperiencePhase1Result({ allowProviderCalls: false })` with evidence store;
   - reconstruct from durable rows when present;
   - miss → explicit unavailable (`PREVIOUS_EVIDENCE_UNAVAILABLE`), not silent `null` skip.
3. **Single canonical path**: one call to `buildExperiencePhase1Result`; no parallel Experience calculator.

## Gating behavior before / after

| Condition | Before | After |
|-----------|--------|-------|
| Providers allowed, no override | acquire via phase-1 | acquire via phase-1 (unchanged) |
| Providers forbidden, evidence present | `experience=null` (bug) | reconstruct identical available Experience, 0 historical calls |
| Providers forbidden, evidence absent | `experience=null` | unavailable Experience with reason; P/S/U unchanged |
| `experienceOverride` set | passthrough | passthrough (unchanged) |

Provider permission (`allowExperienceBlizzardProviderCalls` ∧ Blizzard not disabled) now sets only `allowProviderCalls`. RIO exact-season port is null when providers are forbidden or Raider.IO is disabled.

## Provider accounting before / after (F7)

| Call | Before | After |
|------|--------|-------|
| Blizzard previous-season profile | counted | counted |
| Blizzard achievements | counted | counted |
| Raider.IO exact historical rating fallback | **not counted** | counted |

`providerCalls = scoreResult.providerCalls + previousSeasonProfileCalls + achievementsCalls + raiderIoHistoricalRatingCalls`.

## Files changed

- `apps/worker/src/orchestration/scoring/refresh-bridge.ts` — separate evaluate vs acquire; include RIO historical in accounting.
- `apps/worker/src/orchestration/scoring/refresh-bridge.experience-replay.test.ts` — new regressions A/B/C (fail on PR #84).
- `apps/worker/src/orchestration/scoring/experience-phase1.e2e.test.ts` — baseline asserts explicit unavailable Experience when providers forbidden.
- `.cursor-orchestration/2026-08-experience-postmerge-hardening/common/LATEST_HANDOFF.md` — this handoff.

## Tests

```
pnpm test:raw -- \
  apps/worker/src/orchestration/scoring/refresh-bridge.experience-replay.test.ts \
  apps/worker/src/orchestration/scoring/experience-phase1.e2e.test.ts \
  apps/worker/src/orchestration/scoring/experience-evidence-persist.test.ts \
  apps/worker/src/orchestration/scoring/experience-phase1.test.ts \
  apps/worker/src/orchestration/scoring/refresh-integration.test.ts \
  apps/worker/src/orchestration/scoring/score-character.test.ts
```

Result: **49 passed** (6 files).

Also covered: `refresh-bridge.performance-aggregate.test.ts` (3 passed) during earlier focused run.

## Completed commits

- `062b9cfad4757a388150271081d75f10c13752d2` — fix(experience): reconstruct persisted Experience when providers are forbidden (Agent 01 primary)

Handoff tip may include a follow-up docs commit recording this SHA; use `git log` on `fix/experience-postmerge-hardening`.

## Remaining sequence

1. ~~Agent 01 — canonical replay + accounting.~~
2. Agent 02 — season/evidence integrity hardening (F2 remapped cutoff proof, F3 duplicate previous-season resolution, F4 persisted-evidence validation, F5 ensure-state memoization, F6 immutable RIO fallback classification).
3. Agent 03 — final regression/live acceptance.

## Blockers / concerns for Agent 02

- **F3 still open**: `refresh-bridge.ts` still has a duplicate prior-season `prisma.season.findMany` for `boundPreviousRaiderIoSlug`, while `buildExperiencePhase1Result` uses `resolvePreviousMythicSeason()`. Agent 01 did not remove this duplication (out of scope). Prefer deriving the slug from the canonical resolver result.
- **F2 / remapped cutoffs**: not touched; clean-DB positive-rating + `isRemappedSeason` still needs Agent 02/03.
- **F4**: `ratingEvidenceFromPersistedRow` binding checks unchanged; replay trusts existing schema/version/seasonId validation only.
- **F6**: Blizzard `PROVIDER_FAILURE` (including transient) can still trigger immutable RIO fallback — Agent 02.
- No P/S/U, band, weight, class-rank floor, or elite floor changes in this agent.
