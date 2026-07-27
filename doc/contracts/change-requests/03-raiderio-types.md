# Contract change request — Agent 3 Raider.IO types

## Summary

Additive Raider.IO normalized DTOs and extended `RaiderIoProvider` interface.

## Motivation

Agent 3 must return typed, provider-agnostic normalized outputs for Agent 4 (boost facts) and Agent 5 (worker orchestration) without leaking raw Raider.IO payloads.

## Changes

### New: `packages/contracts/src/raiderio.ts`

- `RaiderIoAttribution`
- `RaiderIoScoreSummary`, `RaiderIoSeasonScores`, `RaiderIoRankSummary`
- `RaiderIoRunCandidate`, `RaiderIoRosterMember`
- `RaiderIoRaidProgressionEntry`
- `RaiderIoCharacterProfile`
- `RaiderIoSeasonCutoffs`, `RaiderIoCutoffThreshold`
- `RaiderIoStaticData`, `RaiderIoPeriod`
- `RaiderIoRunDetails`
- `RaiderIoBoostSupportFacts`

### Modified: `packages/contracts/src/provider.ts`

- `RaiderIoProvider.enabled: boolean`
- Typed method returns (replace `unknown`)
- Add `getStaticData`, `getRunDetails`, `getPeriods`

### Modified: `packages/config/src/index.ts`

- `RAIDERIO_ENABLED` (default `true`)
- `RAIDERIO_NEGATIVE_CACHE_SECONDS` (default `2700`)
- `RAIDERIO_CUTOFFS_TTL_SECONDS` (default `86400`)
- `RAIDERIO_STATIC_DATA_TTL_SECONDS` (default `604800`)

## Backward compatibility

- Existing `RaiderIoProvider` method signatures remain; return types narrow from `unknown` to concrete DTOs
- New methods are additive
- No breaking changes to public API DTOs (`api.ts`)

## Consumers

- Agent 4: `RaiderIoBoostSupportFacts`
- Agent 5: worker refresh DAG step B
- Agent 6: `RaiderIoAttribution` for UI display
