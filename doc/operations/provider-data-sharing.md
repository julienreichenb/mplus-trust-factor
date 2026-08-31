# Provider-data corpus sharing (collector ↔ consumer)

Avoids duplicate expensive WCL population across deployed environments by exporting an allowlisted scoring/provider corpus from the **collector** and importing it on the **consumer**.

## Roles (`PROVIDER_DATA_ROLE`)

| Role | Automatic expensive WCL population | Nightly bundle |
|------|-----------------------------------|----------------|
| `collector` | Yes (staging/production only) | Export `0 4 * * *` UTC |
| `consumer` | No | Import `30 4 * * *` UTC |

Env-only. Not exposed in admin UI (misconfiguration would double WCL spend).

**Fail-safe default:** unset `PROVIDER_DATA_ROLE` resolves to `consumer` (no automatic expensive WCL population). Deployed collectors must set `PROVIDER_DATA_ROLE=collector` explicitly.

Bundle directory: `PROVIDER_DATA_DIR` (default `/opt/mplus/shared/provider-data`):

```text
PROVIDER_DATA_DIR/
  manifest.json
  latest.json.gz
```

## Scheduling decision

Reuses existing BullMQ job schedulers (no OS cron). Scoring-season / Key distribution sync stays registered on **both** deployed roles (cheap shared source-of-truth). Expensive relevant discovery + WCL drain require `PROVIDER_DATA_ROLE=collector`.

Local `APP_ENV=development|test`: no automatic expensive population and no automatic export/import. CLI still works for testing.

## Commands

```powershell
pnpm provider-data:export
pnpm provider-data:export -- --dir C:\temp\provider-data

pnpm provider-data:import
pnpm provider-data:import -- --dir C:\temp\provider-data
```

## Staging → first production

```powershell
# staging (PROVIDER_DATA_ROLE=collector)
pnpm provider-data:export
# copy PROVIDER_DATA_DIR/{manifest.json,latest.json.gz} onto production shared path

# production after migrate + structural seed (PROVIDER_DATA_ROLE=consumer)
pnpm provider-data:import
```

## Post-validation role switch

Config/restart only — no data migration:

```text
production: PROVIDER_DATA_ROLE=collector
staging:    PROVIDER_DATA_ROLE=consumer
```
