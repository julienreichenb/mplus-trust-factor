# Addon update model

## Source of truth

Trust Factor scores are computed server-side and stored as `ScoreSnapshot` rows. The addon never recalculates scores; it only displays exported summaries.

## Update cadence (target production)

1. Worker job `generate-addon-export` runs on a schedule (daily MVP).
2. Exporter selects eligible EU characters for the active season/model.
3. Lua shards + metadata are written to an artifact (DB `AddonExport` row + filesystem artifact).
4. Release pipeline packages a new addon ZIP (Agent 8).
5. Users update via CurseForge/Wago/GitHub release — **no in-game downloader**.

## Freshness signaling

- `meta.generatedAt` — when the dataset was built.
- Per-record `freshnessDays` — age of the underlying score calculation.
- `/mpt status` prints model version, checksum prefix, and character count.

Stale score snapshots are excluded when `excludeStale` eligibility is enabled (default).

## Version coupling

| Component | Version field |
|-----------|---------------|
| Addon code | `## Version:` in TOC / `MPT.ADDON_VERSION` |
| Dataset | `meta.formatVersion`, `meta.scoreModelVersion` |
| Website API | `modelKey` + `modelVersion` on `ScoreSnapshotDTO` |

Mismatch between website and addon dataset is expected until the user updates the addon. Future: show a chat warning when `meta.scoreModelVersion` lags API meta (not in MVP).

## Settings migration

`MPlusTrustDB.settingsVersion` tracks SavedVariables schema. Agent 7 ships version `1` with defaults:

- `showRowGrade = false`
- `showTooltip = true`
- `showNumericScore = true`
- `minConfidenceBucket = 0`
- `debug = false`

## Profile URL copy flow

Tooltip hints `Ctrl+C` for the profile URL. The addon does not open browsers automatically (no protected actions). URL base from `X-Website` TOC field:

`{X-Website}/character/{region}/{realm}/{name}`

## Rollback

- Users: install previous ZIP from release artifacts.
- Operators: re-run exporter against prior snapshot artifact; publish previous checksum.

## Security

- No secrets in the dataset.
- No HTTP from Lua.
- Export excludes non-public red flags and premium dimensions.
