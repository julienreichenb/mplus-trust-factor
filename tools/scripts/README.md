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
