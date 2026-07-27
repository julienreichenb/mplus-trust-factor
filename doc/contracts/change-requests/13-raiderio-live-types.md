# Contract change request — Agent 13 Raider.IO live DTOs

## Summary

Additive fields on `RaiderIoCharacterProfile` for Wave 3 live profile normalization.

## Motivation

Wave 3 requires gear, talents, and crawl-staleness as stable DTO facts while keeping Raider.IO score as a source observation (not product score).

## Changes (additive)

### `packages/contracts/src/raiderio.ts`

- `RaiderIoGearItem`, `RaiderIoGearSummary`
- `RaiderIoTalentSummary`
- `RaiderIoCharacterProfile.gear`
- `RaiderIoCharacterProfile.talents`
- `RaiderIoCharacterProfile.crawlStale`

## Backward compatibility

- Existing fields retained (`previousSeason`, `highestLevelRuns`, `raidProgression` may be empty when Wave 3 minimal fields are used).
- No changes to `RaiderIoProvider` method signatures.
- Capability state remains provider-local (`getCapabilities()` on concrete provider) for Agent 15 promotion if desired.

## Consumers

- Agent 15: fusion / refresh DAG / persistent cache
- Agent 16: attribution + gear/score display
