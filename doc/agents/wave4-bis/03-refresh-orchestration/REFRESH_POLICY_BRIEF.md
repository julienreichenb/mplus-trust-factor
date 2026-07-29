# Refresh Policy Brief

Refresh frequency should be determined by player priority, activity, score freshness, profile demand, provider cost, WCL budget and persisted-evidence reuse.

## Practical first denominator

Use tracked characters rather than the full WoW population.

A workable first elite cohort is:

```text
published score exists
AND current-season rating >= configured threshold
AND recently active (lastSeenAt)
AND stale for assigned cadence tier
AND provider budget available
```

Denominator key: `tracked_published_current_season_rating`.

## Candidate cadence (config hypotheses — validate before live)

| Tier | Who | Interval |
|------|-----|----------|
| A | elite, active, high demand | daily (24h) |
| B | strong and active | every 3 days (72h) |
| C | other active tracked | weekly (168h) |
| D | inactive / low priority | on demand |

Implemented in `packages/config/src/refresh-policy.ts` via env-backed `buildRefreshPolicyConfig`.  
`REFRESH_SCHEDULER_ENABLED` defaults to **false**; `REFRESH_DRY_RUN_ONLY` defaults to **true**.

## Safety

- Never delete the current published score when a job begins or providers fail
- Admin/premium must not bypass global WCL safety (`preflightWithGlobalSafety`)
- Percentile strategies require an explicit `CohortDenominator`
