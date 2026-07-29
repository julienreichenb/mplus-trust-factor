# Cohort Feasibility Matrix

Recommended first denominator: **tracked characters with current-season rating + published score**.

| Strategy | Denominator | Source | Cost | Bias | Regional coverage | Full-pop scan? | Complexity | Abuse risk |
|----------|-------------|--------|------|------|-------------------|----------------|------------|------------|
| `RATING_THRESHOLD` | Tracked above threshold | `CharacterSnapshot.mythicRating` | Predictable | High-rated only | Tracked regions | No | Low | Low |
| `TRACKED_PERCENTILE` | **Must declare** CohortDenominator | Ranked rating in denominator | ∝ top-N% size | Discovery bias | As in denominator | No | Low | Medium if claimed global |
| `TOP_N_REGION` | Published tracked in one region | Same + region filter | Medium | Populous regions | Single region / plan | No | Medium | Low |
| `TOP_N_SPEC_ROLE` | Published tracked for spec/role | Same + spec filter | Medium | Popular specs | Depends | No | Medium | Low |
| `RECENTLY_VIEWED` | Views in last N days | `character_profile_views` | Low | Popularity / streamers | Global demand | No | Medium | High w/o limits |
| `RECENTLY_ACTIVE` | Active in last N days | `Character.lastSeenAt` | Medium | Frequently refreshed | Tracked | No | Low | Low |
| `PUBLISHED_AND_STALE` | Published past TTL | Published pointer + `lastPublicRefreshAt` | Medium | Ignores unpublished | Tracked | No | Low | Low |
| `MANUAL_PRIORITY` | Explicit set | Admin / priority flags | Operator-bounded | Operator | As selected | No | Low | Medium |
| `DAILY_ELITE_COHORT` | Configurable intersection | Rating ∩ activity ∩ published ∩ stale | Budget-capped | Active elites | Tracked (+ fairness) | No | Medium | Low |

“Top 25%” in product language maps to `REFRESH_TRACKED_TOP_PERCENT=25` **inside the declared denominator**, never the global WoW population.
