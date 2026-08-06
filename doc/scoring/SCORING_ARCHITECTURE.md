# Scoring architecture

**Status:** normative. There is one scoring system: **Scoring**.

## Call graph

```
scoreCharacter(identity)
  → resolveSeason()
  → selectRuns(identity, season)          // 2 × 8 dungeons (in-memory selection)
  → loadRawRuns(selected)                 // WclRunRaw by reportCode+fightId+revision+acquisitionVersion
  → fetchMissingRawRuns(misses)           // WCL only on miss
  → resolveScoringFightRoster(raw.payload) // shared roster from capability package + masterData
  → loadOrBuildCharacterDigests(...)      // CharacterRunDigest by rawRunId+participantActorId+extractorVersion
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
| `CharacterRunDigest` | `rawRunId + participantActorId + extractorVersion` |
| `RunRankingFact` | `rawRunId + characterId + rankingVersion` |
| `CharacterScore` | `characterId + seasonId + scoringVersion` |

One shared raw fight yields **up to five durable participant digests** (one per Mythic+ player). `characterId` on a digest is an **optional** link to an internal `Character` row:

- Only the requested character needs a known `characterId` at score time.
- Other participants are persisted with `characterId: null` and stable name/realm/region metadata.
- A later request can **attach** an existing digest to a Character without refetching WCL.
- Digests never auto-create Character rows.
- `participantActorId` is **report-local** (not a cross-report identity).

### Roster resolution (shared)

Cold acquisition, warm `WclRunRaw` hits, and provider-free replay all use the same pure resolver (`resolveScoringFightRoster`):

1. Read `WclRunRaw.payload` (envelope `wcl-run-raw-payload-v1` = capability package + `masterData`, or legacy bare package).
2. Intersect `friendlyPlayerActorIds` with masterData `Player` actors.
3. Attach owned pets by `petOwner`; never promote pets/NPCs to participants.
4. Link the requested Character only via exact target actor ID or name+realm+region (never name-only).
5. Leave non-target `characterId` null unless a safe existing match is supplied by the caller.

Missing masterData / fight roster on a raw payload is a structured failure. Replay must **not** call WCL to invent participants.

Production ports (`createProductionRunOrchestrationPorts`) wire this resolver by default. Product refresh / `scoreCharacter()` and canary delegate to those ports — there is no canary-only roster path.

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

## Obsolete tables (unused by the new roster path; drop later)

`capability_evidence_package_records`, `participant_scoring_digests`, `wcl_run_source_digests` — not used for Scoring roster resolution. Production ports read/write the minimal cache tables above.

See also `WCL_ACQUISITION.md`, `SCORING_DIMENSIONS.md`, `SCORING_OPERATIONS.md`.
