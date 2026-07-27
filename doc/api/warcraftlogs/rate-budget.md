# Rate budget policy

## Environment thresholds

| Variable | Default | Action |
|----------|---------|--------|
| `WCL_RATE_WARN_PERCENT` | 70 | Log warning |
| `WCL_RATE_DEFER_PERCENT` | 80 | Defer non-urgent jobs |
| `WCL_RATE_STOP_PERCENT` | 90 | Stop expensive detailed fetches |

## Monitoring

Query `rateLimitData` before expensive batches. Persist snapshots via worker (Agent 5).

Implementation: `evaluateRateBudget`, `shouldDeferExpensiveWork` in `@mplus/provider-warcraftlogs`.

## Cost controls

- Combine fields in single GraphQL request when cheaper
- `translate: false` on masterData and events
- Filter by `fightIDs`, `sourceID`, event type
- Fetch masterData once per report revision
- Paginate with `nextPageTimestamp`; guard loops (max 50 pages)
- Cache immutable revision data in `ReportRevisionCache`
- Detailed analysis only for latest + highest run (deduped)

## Estimated character refresh budget

~55–110 points (see plan `doc/plans/02-warcraftlogs.md`).

## Fixture scenario

`tools/fixtures/warcraftlogs/rate-limit-near-stop.json` — 3300/3600 points spent (91.7%) triggers `STOP`.
