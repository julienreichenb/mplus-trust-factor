# Rollback (per environment)

```bash
./infra/scripts/rollback.sh prod <previous-sha>
./infra/scripts/rollback.sh test <previous-sha>
```

Rolls back **web/api/worker** for that Compose project only. The other environment keeps running its current SHA.

## Database limits

Same as single-env policy, scoped to one database:

- Failed migrate before app rollout → fix forward; restore **that** env’s backup if needed
- Never undo schema with `migrate reset`
- Redis loss is fine — scores live in that env’s Postgres
