# Rollback checklist

## Application rollback

1. Revert to previous container image / git tag.
2. Run previous migration down only if a new migration was applied (none in Agent 10).
3. Set `PROVIDER_MODE=fixture` to stop live provider calls immediately.

## Data rollback

- Score snapshots are append/update by fingerprint; reverting code does not delete data.
- To reset a character: admin recalculate or delete character row (destructive).
- Addon export: redeploy previous `MPlusTrustData.lua` from artifact backup.

## Feature flags

- `PUBLIC_DETAILS_ALL=false` — hide premium serializer fields
- Disable worker processors or stop worker container to halt refresh jobs
- Provider disable: pass `disabledProviders` in tests; production uses env-based factory (live vs fixture)

## Emergency

- Stop worker service to halt BullMQ consumption
- Stop API to block new refresh enqueue
- Redis/Postgres volumes persist — `pnpm compose:down` does not delete volumes unless `-v`
