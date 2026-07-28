# Raider.IO minimal call matrix (Wave 3)

## Per-trigger call budget

| Trigger | Endpoints | Max calls | Cache |
|---------|-----------|-----------|-------|
| Stale character refresh | `characters/profile` | **1** | 12h character TTL |
| Top-25% eligibility check | `mythic-plus/season-cutoffs` | 0–1 (optional) | 24h; short TTL when unavailable |
| Dungeon/season mapping | `mythic-plus/static-data` | 0–1 | 7d; expansion resolved dynamically |
| Run roster gap fill | `mythic-plus/run-details` | 0–1 | 12h |
| Period context | `periods` | 0–1 | 7d |

## Character profile fields (single request)

```
gear,talents,mythic_plus_scores_by_season:current:previous,mythic_plus_ranks,mythic_plus_recent_runs,mythic_plus_best_runs
```

## Example URL (EU)

```
GET https://raider.io/api/v1/characters/profile?region=eu&realm=tarren-mill&name=Example&fields=gear,talents,mythic_plus_scores_by_season:current:previous,mythic_plus_ranks,mythic_plus_recent_runs,mythic_plus_best_runs
```

## Explicitly excluded calls

| Endpoint / field | Reason |
|------------------|--------|
| `/api/v1/mythic-plus/runs` | Bulk crawl prohibited |
| `/api/v1/live-tracking/**` | Out of MVP scope |
| `mythic_plus_highest_level_runs` | Not in Wave 3 minimum set |
| `raid_progression:*` | Not in Wave 3 minimum set |
| Profile re-fetch on page view | Violates refresh policy |

## Worst-case per character

3 calls: profile + run-details (roster gap) + cutoffs (if attempted and not cached). Typical case: **1 call**. Cutoffs failure must not block the refresh.
