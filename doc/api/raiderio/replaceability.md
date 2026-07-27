# Raider.IO replaceability

## Disable switch

```env
RAIDERIO_ENABLED=false
```

Returns `DisabledRaiderIoProvider` with `enabled: false`. Workers skip Raider.IO refresh step.

## Source priority by datum

| Datum | Primary | Raider.IO role |
|-------|---------|----------------|
| Identity, class, spec | Blizzard | Not used |
| Equipment, talents | Blizzard | Not used (no `gear` field) |
| M+ rating, run list | Blizzard + Raider.IO | Convenience accelerator |
| Detailed combat | Warcraft Logs | Not Raider.IO |
| Regional top-25% cutoff | Raider.IO | MVP only; replaceable later |
| Raid progression | Blizzard / Raider.IO | Summary fallback |

## Field dependency matrix

| Normalized field | Raider.IO source | Fallback if disabled |
|------------------|------------------|----------------------|
| `currentSeason.scores` | `mythic_plus_scores_by_season` | Blizzard M+ profile |
| `recentRuns` / `bestRuns` | profile run arrays | Blizzard season data |
| `ranks` | `mythic_plus_ranks` | Missing → lower confidence |
| `top25Percent` | `cutoffs.p750` | Internal distribution (future) |
| `raidProgression` | `raid_progression` | Blizzard/WCL |
| `roster` on runs | run arrays / run-details | WCL report roster |

## Code boundaries

| Layer | Raider.IO exposure |
|-------|-------------------|
| `@mplus/provider-raiderio` | All HTTP, raw parsing, normalization |
| `@mplus/contracts/raiderio` | Provider-agnostic DTOs |
| Public API (`api.ts`) | No Raider.IO shapes |
| Frontend | Attribution only via API DTOs |

## Removal procedure

1. Set `RAIDERIO_ENABLED=false`
2. Remove worker step B (Agent 5) Raider.IO call
3. Delete `@mplus/provider-raiderio` package when alternatives exist
4. Remove `RaiderIo*` contract types if no longer referenced

## Future replacements

- **Cutoffs:** internal score distribution from ingested characters
- **Run history:** Blizzard keystone profile + WCL report matching
- **Ranks:** computed from own dataset
