# Change request: BlizzardProvider surface (Agent 01)

**Status:** Applied (backward-compatible)  
**Date:** 2026-07-27  
**Owner:** Agent 01

## Problem

Agent 0 `BlizzardProvider` only exposes:

- `getCharacterProfile` → `CanonicalCharacter`
- `getCharacterEquipment` → `CharacterSnapshotDTO`
- `getMythicKeystoneProfile` → `unknown`

Agent 01 must also resolve realm, equipment/talent snapshots, media, M+ season profiles, season/dungeon/item static data, and an explicit (non-crawled) connected-realm leaderboard method.

## Proposal

1. Extend `BlizzardProvider` with additional methods (no removals).
2. Keep `getCharacterEquipment` returning `CharacterSnapshotDTO` for compatibility; add `getEquipmentSnapshot` / `getTalentSnapshot` for precise DTOs.
3. Type M+ profile results with provider-exported normalized types where shared contracts lack a dedicated DTO; keep `MythicRunDTO[]` for runs.
4. Map provider-intent error names onto existing `ExternalApiErrorCode` (no enum break); document `PRIVATE_OR_RESTRICTED` / `CONFIGURATION_ERROR` as `details.reason`.

## Prisma

None.

## Compatibility

Additive only. Existing three methods remain.
