# Rollback (per environment)

```bash
./infra/scripts/rollback.sh prod <previous-sha>
./infra/scripts/rollback.sh test <previous-sha>
```

- Rolls back **web/api/worker** for that Compose project only to an **immutable previous SHA**.
- Refuses `latest`.
- Validates env, waits for `/health/ready` container health, checks running image tag, runs public ready/revision smoke.
- Updates `/opt/mplus/{env}/.env` `IMAGE_TAG` and `releases/current`.
- The other environment keeps running its current SHA.

If `<previous-sha>` is omitted, the script reads the previous column from `releases/history.tsv` when present.

## Database limits

Same as single-env policy, scoped to one database:

- Failed migrate before app rollout → fix forward; restore **that** env’s backup if needed
- Never undo schema with `migrate reset`
- Redis loss is fine — scores live in that env’s Postgres
