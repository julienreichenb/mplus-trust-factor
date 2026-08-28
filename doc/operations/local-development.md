# Local development

## Requirements

- Node.js 24 (see `.nvmrc`); Node 22+ may work for smoke tests
- pnpm 10 (`packageManager` field; prefer Corepack)
- Docker Desktop for PostgreSQL 16 and Redis 7

## Boot

```bash
pnpm bootstrap
pnpm dev
```

`pnpm bootstrap` (`tools/scripts/bootstrap.mjs`) is idempotent and cross-platform (including git worktrees). It ensures a root `.env`, applies live local-dev defaults, installs dependencies, starts Compose infra, generates the Prisma client, builds workspace packages that export `dist/`, then runs `pnpm db:migrate` and `pnpm db:seed`. It never invents credentials, never targets a non-local `DATABASE_URL`, never prints secret values, and does not start the app.

### Worktree `.env` behaviour

Each Git worktree has its own filesystem, so the untracked root `.env` is **not** shared automatically. Bootstrap uses `git worktree list --porcelain` to find the primary worktree:

1. If this worktree already has `.env` → keep non-empty values (never clobber secrets). Empty keys may be filled from the primary worktree after approval.
2. If this worktree has no `.env` but the primary worktree does → ask before copying (default **No**). Non-interactive approval:

   ```bash
   pnpm bootstrap -- --copy-env
   ```

   The same flag fills empty keys in an existing `.env` from primary (for example `BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET` left blank after copying `.env.example`).
3. If neither has `.env` → explain that `.env.example` must be copied (never invent credentials). Optional non-interactive template create:

   ```bash
   pnpm bootstrap -- --from-example
   ```

4. After `.env` is present, bootstrap applies live local-dev defaults (idempotent; overwrites mode/enable flags only):

   - root `.env`: `PROVIDER_MODE=live`, `BLIZZARD_ENABLED=true`, `WCL_ENABLED=true`, `UTILITY_PUBLICATION_MODE=published`, `VITE_API_MODE=live`
   - `apps/web/.env`: `VITE_API_MODE=live` (Vite only reads this file for the SPA)

After loading `.env`, bootstrap prints a capability summary (yes/no and mode labels only — never secret values): PostgreSQL, Redis, `PROVIDER_MODE`, `VITE_API_MODE`, Battle.net OAuth, Blizzard live provider, Warcraft Logs. Battle.net OAuth requires both `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET`. Missing OAuth credentials do **not** fail bootstrap; you will see guidance to configure them.

On success:

```text
bootstrap: ready.
  pnpm dev     — local application (development database)
  pnpm test    — isolated disposable mplus_itest_* database (never mutates mplus_trust)
```

Equivalent manual steps (same order as bootstrap after `.env` exists):

```bash
pnpm install
cp .env.example .env
pnpm dev:infra
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm dev` loads the root `.env` via `tools/scripts/with-env.mjs` on Windows and Unix, then starts API, worker and web in parallel.

PostgreSQL listens on host port **5433** by default (mapped from container 5432) so it does not collide with a local Windows Postgres install.

### CI vs local Postgres port

GitHub Actions exposes the Postgres service on host **5432** and sets `DATABASE_URL` accordingly.
Local Compose uses **5433**. Vitest must **not** hard-override `DATABASE_URL`: an explicitly supplied value (CI) wins; otherwise tests fall back to the local `:5433` URL. Forcing `:5433` in `vitest.config.ts` previously made `/health/ready` return 503 in CI because tests connected to the wrong port.

CI runs `pnpm db:migrate` then `pnpm db:seed` before `pnpm test` against the isolated Actions Postgres service (`DATABASE_URL` on `:5432`). Seed bootstraps an empty CI database with the idempotent fixture score model so Postgres-backed suites can run; it is **not** a production (or shared-environment) model-activation path. Without seed, those suites fail after the URL fix (previously many were effectively skipped when Vitest forced the unreachable `:5433` port).

Stop infra: `pnpm dev:infra:down`.

## Realm catalog

Public realm comboboxes read the local `realms` table (`GET /api/v1/realms`), not Blizzard per keystroke.

In **live** provider mode the worker bootstraps an index-first catalog sync for EU/US/KR/TW when a region is empty or stale (`REALM_CATALOG_STALE_SECONDS`, default 7 days). Empty catalog + failed bootstrap fails closed. A usable last-known-good catalog survives temporary Blizzard outages.

Fixture mode syncs from fixture Blizzard data (no live credentials). Manual maintenance:

```bash
pnpm realms:sync
pnpm realms:sync -- --force-details   # optional detail enrichment
```

See [`../architecture/character-search-and-realm-catalog.md`](../architecture/character-search-and-realm-catalog.md).

## Fixture mode

`.env.example` defaults to `PROVIDER_MODE=fixture`. After `pnpm bootstrap`, local `.env` is switched to live defaults (`PROVIDER_MODE=live`, providers enabled, `UTILITY_PUBLICATION_MODE=published`). Set `PROVIDER_MODE=fixture` again if you want fixture providers without live credentials.

Optional disable flags (still valid in fixture mode):

```bash
BLIZZARD_ENABLED=true
WCL_ENABLED=true
RAIDERIO_ENABLED=true
```

Set any of these to `false` to soft-disable that provider.

## Ability catalog refresh (optional SimC)

Admin `/admin/ability-catalog` → Refresh catalog needs a SimulationCraft CLI binary. Scoring API/worker do **not** require SimC.

Local Windows:

```powershell
$env:ABILITY_CATALOG_SIMC_BIN="C:\Tools\SimulationCraft\simc.exe"
pnpm dev
```

Do **not** set a SimC git SHA in `.env`. Refresh interrogates the binary for version, revision, WoW build, and LIVE/PTR mode.

Test/prod: package SimC with the dedicated catalog-refresh image (`infra/docker/ability-catalog-refresh.Dockerfile`), which installs `/usr/local/bin/simc`. Keep Blizzard/DB/Redis secrets as runtime env — never bake them into the SimC image.

## Live mode

1. Keep secrets in the root `.env` only (never in `VITE_*` or tracked files).
2. Set `PROVIDER_MODE=live`.
3. Enable only the providers you need and fill their credentials:

```bash
PROVIDER_MODE=live
BLIZZARD_ENABLED=true
BLIZZARD_CLIENT_ID=...
BLIZZARD_CLIENT_SECRET=...

WCL_ENABLED=true
WCL_CLIENT_ID=...
WCL_CLIENT_SECRET=...

RAIDERIO_ENABLED=true
RAIDERIO_APP_KEY=   # optional
```

Missing credentials for an **enabled** live provider fail startup with a provider-specific configuration error. Disable the provider instead if you intentionally omit credentials.

Startup logs print a configuration summary of booleans/modes only — never credential values.

## Manual live smoke (opt-in)

Live smokes never run in CI. They refuse unless you explicitly opt in:

```bash
ALLOW_LIVE_PROVIDER_CALLS=true
```

Pass an exact identity (no default player is embedded in source):

```bash
pnpm live:smoke:blizzard -- --region EU --realm <realm-slug> --name <character>
pnpm live:smoke:raiderio -- --region EU --realm <realm-slug> --name <character>
pnpm live:smoke:wcl -- --region EU --realm <realm-slug> --name <character>
pnpm live:smoke:character -- --region EU --realm <realm-slug> --name <character>
```

Supported regions for MVP: `EU`, `US`, `KR`, `TW`. Output is redacted.

## Useful URLs

- API live: `GET http://localhost:3000/health/live`
- API ready: `GET http://localhost:3000/health/ready` (DB + Redis when BullMQ)
- Meta: `GET http://localhost:3000/api/v1/meta`
- OpenAPI UI: `http://localhost:3000/docs`
- Web: `http://localhost:5173`
