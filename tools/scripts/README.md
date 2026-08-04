# Monorepo helper scripts

Cross-platform Node scripts (Windows + Unix). Prefer `node tools/scripts/...` over shell one-liners.

## Local bootstrap

`bootstrap.mjs` (`pnpm bootstrap`) prepares a fresh clone/worktree for `pnpm dev`: worktree-aware `.env` setup, live-mode defaults (`PROVIDER_MODE=live`, provider enable flags, `UTILITY_PUBLICATION_MODE=published`, `VITE_API_MODE=live` in `apps/web/.env`), install, Compose infra, Prisma generate, `./packages/**` builds, migrate, seed. Never invents credentials, never prints secrets, never touches a non-local `DATABASE_URL`. Does not start `pnpm dev`.

## Env loading

`with-env.mjs` loads the root `.env` into the child process environment without overwriting existing vars. Used by `pnpm dev`, DB commands and live smokes.

## WCL fight-ownership diagnostic (read-only)

Identifies potentially poisoned WCL digests/pages created without fight-roster proof.
Never deletes by default. `--execute` is refused in production and remains a no-op stub
until an explicit cleanup task is approved.

```bash
node tools/scripts/with-env.mjs pnpm --filter @mplus/database exec tsx ../../tools/scripts/diagnose-wcl-fight-ownership.ts
```

## Local WCL / scoring-derived reset (destructive, guarded)

Resets provider-derived and scoring-derived rows on the **local** `mplus_trust`
database while retaining users, characters, catalog and static configuration.

Default is DRY-RUN. Actual deletion requires `--execute` and all safety gates.

```bash
# Dry-run (no mutations)
pnpm db:reset:wcl-scoring-derived -- --confirm=RESET_LOCAL_WCL_SCORING_DATA

# Execute (local development only)
pnpm db:reset:wcl-scoring-derived -- --confirm=RESET_LOCAL_WCL_SCORING_DATA --execute
```

Gates: `APP_ENV=development`, DB host localhost/127.0.0.1, DB name exactly
`mplus_trust`, confirmation token exact, Redis localhost, and an explicit local
`RAW_ARTIFACTS_DIR` resolved from the repository/config root via
`@mplus/artifact-store` (no path guessing; remote CAS refused). Live-writer
blocking uses Redis/BullMQ activity, not stale DB status rows alone.
Never uses Redis `FLUSHALL`.

The older `pnpm db:reset:scoring-v2` tooling remains for disposable `mplus_itest_*`
databases only and still blocks the shared `mplus_trust` name.

## Identity-data reset (destructive, guarded — more destructive than WCL reset)

**Warning:** `pnpm db:reset:identity-data` is significantly more destructive than
`pnpm db:reset:wcl-scoring-derived`. It deletes **every Character**, every
ownership row (including the retained admin's), and every User except one
explicitly selected administrator and that administrator's Battle.net account.

Supported targets only (no default / no inference):

| Target | Confirmation token |
|--------|--------------------|
| `local-development` | `RESET_LOCAL_IDENTITY_DATA` |
| `deployed-test` | `RESET_DEPLOYED_TEST_IDENTITY_DATA` |

Retained (exact UUIDs required — never inferred from email, BattleTag, “only admin”, etc.):

- the User identified by `--keep-user-id`
- the BattleNetAccount identified by `--keep-bnet-account-id` (must belong to that User)
- that user's ExternalIdentity / UserSession / active admin role assignment / entitlements / feature grants
- static catalogs: regions, **realms** (unchanged), seasons, dungeons, classes/specs, score models, metric definitions, mechanic rules, roles/permissions, runtime settings

Deleted:

- all Characters / CharacterAliases / VerifiedCharacterOwnerships (including the retained account's)
- all other Users and BattleNetAccounts
- provider / refresh / scoring / evidence / canary / calibration-run / publication derived data (reuses the WCL scoring-derived clear table plan)

After reset the retained Battle.net account stays linked and keeps OAuth tokens, but
discovery/ownership sync fields are cleared — characters must be rediscovered.

### Local development (PowerShell)

```powershell
# Dry-run
pnpm db:reset:identity-data -- `
  --target=local-development `
  --keep-user-id=11111111-1111-4111-8111-111111111111 `
  --keep-bnet-account-id=22222222-2222-4222-8222-222222222222 `
  --confirm=RESET_LOCAL_IDENTITY_DATA

# Execute
pnpm db:reset:identity-data -- `
  --target=local-development `
  --keep-user-id=11111111-1111-4111-8111-111111111111 `
  --keep-bnet-account-id=22222222-2222-4222-8222-222222222222 `
  --confirm=RESET_LOCAL_IDENTITY_DATA `
  --execute
```

Local gates: `APP_ENV=development`, `NODE_ENV` not production, DB host loopback,
DB name exactly `mplus_trust`, Redis loopback, confirmation token exact,
`MPLUS_CLEANUP_TARGET=deployed-test` must **not** be set.

### Deployed test (PowerShell)

Required environment assertions (positive identity — not “any remote DB”):

```powershell
$env:MPLUS_CLEANUP_TARGET = "deployed-test"
$env:MPLUS_IDENTITY_RESET_ENVIRONMENT_ID = "mplus-test"   # compose project; never mplus-prod
$env:MPLUS_DEPLOYED_TEST_WRITERS_STOPPED = "true"         # required for --execute
# APP_ENV must be staging (canonical deployed-test). DATABASE_URL must parse to mplus_trust_test.
```

Stop or scale API and worker services to zero **before** `--execute`. The writers-stopped
assertion is necessary but not sufficient — the command still probes Redis/BullMQ.

```powershell
# Dry-run
pnpm db:reset:identity-data -- `
  --target=deployed-test `
  --expected-database-name=mplus_trust_test `
  --keep-user-id=11111111-1111-4111-8111-111111111111 `
  --keep-bnet-account-id=22222222-2222-4222-8222-222222222222 `
  --confirm=RESET_DEPLOYED_TEST_IDENTITY_DATA

# Execute (only after dry-run review + writers stopped)
pnpm db:reset:identity-data -- `
  --target=deployed-test `
  --expected-database-name=mplus_trust_test `
  --keep-user-id=11111111-1111-4111-8111-111111111111 `
  --keep-bnet-account-id=22222222-2222-4222-8222-222222222222 `
  --confirm=RESET_DEPLOYED_TEST_IDENTITY_DATA `
  --execute
```

Production identity reset remains categorically forbidden.

### Safe deployed-test operator sequence

1. Identify the exact retained User UUID (read-only query).
2. Identify the exact retained BattleNetAccount UUID.
3. Verify account ownership and admin role with read-only queries.
4. Stop or scale API and worker services to zero; set `MPLUS_DEPLOYED_TEST_WRITERS_STOPPED=true`.
5. Run dry-run; inspect blocked conditions and deletion counts.
6. Run execute only after explicit operator approval.
7. Restart services.
8. Authenticate with the retained admin account.
9. Trigger a fresh Battle.net character discovery.
10. Verify characters are newly recreated.

### Partial-failure recovery

If the database transaction commits but Redis/artifact cleanup is partial, the CLI
exits non-zero and reports `externalCleanup`. Re-run the **same** command with
`--execute` — it is idempotent and finishes remaining cleanup without damaging
static catalogs or retained OAuth identity data.

Never uses Redis `FLUSHALL` / `FLUSHDB`.

## Live smoke (manual only)

Require:

```bash
ALLOW_LIVE_PROVIDER_CALLS=true
```

Identity args are mandatory (`--region`, `--realm`, `--name`). No default player is embedded.

| Command | Script |
|---|---|
| `pnpm live:smoke:blizzard` | `live-smoke-blizzard.mjs` |
| `pnpm live:smoke:raiderio` | `live-smoke-raiderio.mjs` |
| `pnpm live:smoke:wcl` | `live-smoke-wcl.mjs` |
| `pnpm live:smoke:character` | `live-smoke-character.mjs` |

Never invoke these from CI.
