# Scoring architecture

**Status:** normative. There is one scoring system: **Scoring**.

## Call graph

```
scoreCharacter(identity)
  → resolveSeason()
  → selectRuns(identity, season)          // 2 × 8 dungeons (in-memory selection)
  → loadRawRuns(selected)                 // WclRunRaw by reportCode+fightId+revision+acquisitionVersion
  → fetchMissingRawRuns(misses)           // WCL only on miss
  → loadOrBuildCharacterDigests(...)      // CharacterRunDigest by rawRunId+characterId+extractorVersion
  → loadOrFetchRankingFacts(...)
  → calculateDimensions(digests, rankings)
  → calculateComposite(...)
  → persistCharacterScore(...)
  → return result
```

Warm second run on unchanged identities: **zero WCL calls**.

## Persistence

| Object | Unique key |
|--------|------------|
| `WclRunRaw` | `reportCode + fightId + reportRevision + acquisitionVersion` |
| `CharacterRunDigest` | `rawRunId + characterId + extractorVersion` |
| `RunRankingFact` | `rawRunId + characterId + rankingVersion` |
| `CharacterScore` | `characterId + seasonId + scoringVersion` |

No supersession graphs, no compatibility-head resolution, no hash-as-UUID ownership for scoring caches.

## Public commands

| Command | Role |
|---------|------|
| `pnpm scoring:canary` | Full pipeline, no publication; WCL when armed |
| `pnpm scoring:replay` | Provider-free from cache |
| `pnpm scoring:doctor` | Diagnostics, no mutation |

Product refresh calls scoring orchestration when `SCORING_ENABLED`; the authoritative entry is `scoreCharacter()`.

## Flags

- `SCORING_ENABLED`
- `ALLOW_LIVE_PROVIDER_CALLS` / `WCL_ENABLED` / live provider mode
- `SCORING_PUBLICATION_ENABLED`

## Obsolete tables (unused; drop later)

`capability_evidence_package_records`, `participant_scoring_digests` — deprecated. Production ports read/write the minimal cache tables above.

See also `WCL_ACQUISITION.md`, `SCORING_DIMENSIONS.md`, `SCORING_OPERATIONS.md`.
