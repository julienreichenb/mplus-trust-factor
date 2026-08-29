# Ability Catalog — operator notes

## Normal operation

```text
1. Sync sources
2. Classify / edit on /admin/ability-catalog
3. Publish changes
```

### 1. Sync

One-shot container (Ubuntu dev and prod). Never publishes or activates.

```bash
docker compose -p <stack> \
  -f infra/docker/docker-compose.app.yml \
  -f infra/docker/docker-compose.<env>.yml \
  --env-file <env-file> \
  --profile catalog-sync run --rm catalog-sync
```

Local equivalent (requires SimC + Blizzard + DB):

```bash
pnpm ability-catalog:sync
```

Required env: `DATABASE_URL`, `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`, and SimC at `ABILITY_CATALOG_SIMC_BIN` (image default `/usr/local/bin/simc`).

### 2. Classify

Open `/admin/ability-catalog`:

- **Needs classification** — Include / Exclude / Defer
- **Included** — edit category/availability or exclude from M+
- **Excluded** — restore exclusions

### 3. Publish

Click **Publish changes**. Backend compiles → validates → replays → atomically activates. Scoring pins the ACTIVE immutable release.

Emergency rollback: **History** tab.

---

## Recovery / debug

Not required for normal operation.

| Command | Purpose |
|---------|---------|
| `pnpm ability-catalog:simc:extract` | Offline SimC SpellQuery extract |
| `pnpm ability-catalog:blizzard:extract` | Offline Blizzard enrich |
| `pnpm ability-catalog:refresh:shadow` | File-based shadow diff |
| `pnpm ability-catalog:review:import` | Import a PINNED report into DB |
| `pnpm ability-catalog:baseline:export` | Export active SimC baseline bytes |
| `pnpm ability-catalog:release:bootstrap` | Bootstrap Release 0 compile/parity |
| `pnpm ability-catalog:release:verify` | Verify release CAS |
| `pnpm ability-catalog:release:replay` | Manual replay |
| `pnpm ability-catalog:release:test-run` | RELEASE-pinned character refresh |
| `pnpm ability-catalog:dev:reset` | Wipe local catalog state (dev only) |

Retail Live only (`ptr=0`). SimC identity comes from binary interrogation. Low-level HTTP endpoints for draft/validate/activate/replay remain for ops recovery; product UI does not expose them.
