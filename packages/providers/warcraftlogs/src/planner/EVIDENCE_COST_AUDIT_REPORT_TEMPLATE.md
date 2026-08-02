# Evidence / cost audit report template (WCL Planner V2)

Use after a manual planner probe run (`ALLOW_LIVE_PROVIDER_CALLS=true pnpm wcl:probe:planner`).
Do not commit live identities; store sanitized fingerprints only under `tmp/`.

## Header

| Field | Value |
|-------|-------|
| Date | |
| Operator | |
| Branch / commit | |
| Manifest content hash (if any) | |
| Character fingerprint (not raw name) | |
| Season id | |
| Live calls authorized | yes / no |

## Discovery plan

| Metric | Value |
|--------|-------|
| Input candidates | |
| Retained candidates | |
| Private/hidden skipped | |
| Truncated (total bound) | |
| Per-dungeon fallback depths | |

## Hydration groups

| Report fingerprint | Fight IDs | Notes |
|--------------------|-----------|-------|
| | | |

## Dataset plan

| Compatibility key fingerprint | Dataset | Consumers | Cache hit | Estimated points |
|-------------------------------|---------|-----------|-----------|------------------|
| | | | | |

## Cost summary

| Field | Value |
|-------|-------|
| Total estimated cost (KNOWN / UNKNOWN / ZERO_CACHE_HIT) | |
| Safety margin | |
| Total + margin | |
| Cache hit count | |
| Unknown cost entry count | |
| Rate-budget preview action (OK/WARN/DEFER/STOP) | |
| Admission enabled? | **no** (preview only in this checkpoint) |

## Probe cases

| Case id | OK | Notes |
|---------|----|-------|
| exact-same-key-parse-field | | |
| metadata-batching-multi-fight | | |
| event-vs-table-parity-scaffold | | |
| cost-and-bytes-per-dataset | | |
| archived-or-gated | | |
| tank-healer-ranking-shapes | | |

## Ownership reminder

- Discovery identity: `reportCode` + `fightId`
- Frozen identity: `reportCode` + `fightId` + `reportRevision`
- WS03 produced factual metadata / diagnostics / cost estimates only
- WS02 owns slot selection, rejection reasons, coverage, manifest freeze
