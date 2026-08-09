# Post-Merge Review Findings

## F1 — HIGH — canonical provider-free replay gap

`buildExperiencePhase1Result()` supports `allowProviderCalls=false`, but `runAuthoritativeScoring()` only enters Experience acquisition when `allowExperienceBlizzardProviderCalls(env)` is true.

Therefore a canonical recalculation with providers disabled can leave `experience=null` even when durable `CharacterExperienceEvidence` exists.

Expected direction:
- separate "should evaluate/reconstruct Experience" from "may acquire Experience providers";
- always attempt durable Experience reconstruction when the scoring path has the DB evidence store;
- provider permission controls only missing evidence acquisition.

## F2 — HIGH — remapped cutoff fresh-DB gap

Live historical Raider.IO cutoffs can return `isRemappedSeason=true`.

`synchronizeSeasonPopulationPolicy()` refuses such a policy unless `exactTargetSeasonEquivalenceProven=true`, but the bootstrap currently does not propagate this proof.

Wallidrixe E=0 hides this because no-activity does not require a standing policy. A positive historical rating on a clean DB can become `MISSING_POPULATION_POLICY`.

Expected direction:
- define exactly what constitutes strong season equivalence;
- propagate that proof only when Blizzard↔RIO binding is genuinely exact;
- never accept a remapped policy merely because the slug looks plausible;
- prove clean-DB positive-rating behavior in Agent 03.

## F3 — HIGH — duplicate previous-season resolution

`buildExperiencePhase1Result()` uses `resolvePreviousMythicSeason()`, but `refresh-bridge.ts` separately queries the latest prior `Season` to obtain `boundPreviousRaiderIoSlug`.

Those algorithms do not have identical eligibility filters.

Expected direction:
- eliminate the duplicate previous-season query;
- derive `providerSeasonId` from the exact previous row chosen by the canonical resolver, or return a typed binding object from one canonical helper.

## F4 — MEDIUM — weak persisted-evidence read validation

`ratingEvidenceFromPersistedRow()` validates payload schema/version and internal `seasonId`, but does not sufficiently prove compatibility with the current resolved binding.

At minimum investigate checks for:
- row/payload Blizzard season id;
- row/payload Raider.IO slug;
- expected previous binding;
- `contentHash`;
- source vs payload rating source.

A mismatch should be treated as incompatible/stale evidence, not a valid cache hit.

## F5 — MEDIUM — ensure state after failed bootstrap

`ensureExperienceSeasonBindingReady()` may remember the current Blizzard season as "ensured" even when the region bootstrap is partial/failed.

Expected direction:
- only memoize success sufficient for the intended bind/policy lifecycle;
- partial/provider failure remains retryable, potentially with existing provider TTL/backoff rather than a permanent process-local skip.

## F6 — MEDIUM — overly broad immutable Raider.IO fallback

A generic Blizzard `PROVIDER_FAILURE` can trigger Raider.IO exact-season fallback.

If the Blizzard failure is transient (429/5xx/network), successful Raider.IO fallback can become permanently immutable evidence, preventing Blizzard from ever becoming the source for that character-season.

Expected direction:
- classify terminal historical-unavailability vs transient provider failure;
- allow immutable fallback only for the terminal/unsupported historical class the product intends;
- keep transient failures retryable.

Do not silently assume every 404 means no activity.

## F7 — MEDIUM — provider call accounting

`buildExperiencePhase1Result()` exposes `raiderIoHistoricalRatingCalls`, but `runAuthoritativeScoring()` only adds Blizzard previous-profile + achievements calls to its Experience accounting.

Expected direction:
- include Raider.IO historical fallback calls;
- tests must prove cold/warm/replay accounting.

## F8 — LOW — acceptance depth

Agent 05's "process restart" test uses a shared in-memory `Map`, which validates repository-independent logic but not a real Prisma round trip.

Agent 03 should add at least one disposable-database integration proof if the repo test harness makes that practical.

## F9 — LOW — live probe footgun

`experience-agent05-live-probe.ts` deletes Experience evidence rows before its cold run.

If retained, protect it against accidental use on shared/prod DB, or move/descope it from normal worker source.
