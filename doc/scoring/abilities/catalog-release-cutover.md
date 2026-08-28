# Ability catalog release — operator workflow

Production catalog authority is the **ACTIVE immutable release**. There is no runtime mode env var.

## Bootstrap (first deploy)

1. Persist Bootstrap Release 0 via `pnpm ability-catalog:release:bootstrap -- --persist`
2. Activate via admin UI or `POST .../releases/:id/activate` (requires replay PASS + `admin.ability_catalog.publish`)
3. Verify `GET .../releases/active` shows Bootstrap ACTIVE

## Ongoing refresh

1. Set tooling env (server-side only, not browser):
   - `ABILITY_CATALOG_SIMC_BIN` — optional local path to simc (Windows/dev). Linux catalog-refresh tooling defaults to `/usr/local/bin/simc` when present. Revision/version/build/LIVE are discovered from the binary — do not set a manual SHA.
   - `BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET`
2. Open `/admin/ability-catalog` → **Refresh catalog**
3. If `REVIEW_REQUIRED`: review at `/admin/ability-catalog/review`; ACTIVE unchanged
4. Build candidate release from curated drafts → validate → replay
5. **Activate catalog** when replay PASS — new analyses pin immediately

## Rollback

`POST .../releases/:id/rollback` restores a prior immutable release as ACTIVE. Queued/running jobs keep their frozen pin.

## Cutover acceptance

Bootstrap parity acceptance tests remain in `ability-catalog-cutover-acceptance.test.ts`. They prove STATIC registry ≡ Bootstrap RELEASE artifact — not a runtime path.
