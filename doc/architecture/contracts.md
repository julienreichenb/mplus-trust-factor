# Shared contracts

Stable TypeScript contracts live in `packages/contracts`.

## Identity

`RegionCode`, `CharacterIdentityInput`, `CharacterRef`, `CanonicalCharacter`, snapshot DTOs.

## Runs

`MythicRunDTO`, `RunParticipantDTO`, `RunSourceRefDTO`, `DetailedRunSelection` (`LATEST` | `HIGHEST`, dedupe identical).

## Provider

`ProviderName`, fetch context/metadata, `ProviderResult<T>`, `DataFreshness`, `SourceProvenance`, `ExternalApiError`, provider interfaces.

## Raider.IO (Agent 3)

Normalized DTOs in `raiderio.ts`: character profile, cutoffs, static data, run details, boost-support facts, attribution.

## Scoring

`ScoreDimension`, observations, coverage, scopes, model config, dimension/score snapshots, red flags, grades.

Score DTOs always include `modelKey`, `modelVersion`, and `calculatedAt`.

## Jobs

Typed payloads + Zod schemas for refresh / analyze / recalculate / addon export; `JobStatusDTO`.

## API

Search/profile/compare/refresh/admin DTOs and standard `ApiErrorEnvelope`.

## Change policy

After baseline merge, do not silently change shared contracts. Keep changes backward compatible and call them out in the PR.
