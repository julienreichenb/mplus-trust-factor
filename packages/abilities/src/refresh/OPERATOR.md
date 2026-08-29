# Ability Catalog — operator notes

## Normal operation (Ubuntu dev / prod)

```text
1. Sync sources
2. Classify / edit business metadata in /admin/ability-catalog
3. Publish changes
```

### 1. Sync sources

One-shot container (same image in dev and prod). Never publishes or activates.

**Dev (local compose stack):**

```bash
docker compose -p mplus-dev -f infra/docker/docker-compose.app.yml \
  -f infra/docker/docker-compose.test.yml \
  --env-file <your-env-file> \
  --profile catalog-sync run --rm catalog-sync
```

**Prod:**

```bash
docker compose -p mplus-prod -f infra/docker/docker-compose.app.yml \
  -f infra/docker/docker-compose.prod.yml \
  --env-file <prod-env-file> \
  --profile catalog-sync run --rm catalog-sync
```

Canonical local/CLI equivalent (requires SimC + Blizzard credentials + DB):

```bash
pnpm ability-catalog:sync
```

What sync does:

- runs pinned SimC extraction (`/usr/local/bin/simc` in the image);
- fetches Blizzard static Game Data for discovered IDs;
- persists source artifacts / baselines;
- imports a PINNED refresh report into pending classification (Agent 04 relevance filtering applies);
- leaves ACTIVE catalog unchanged.

### 2–3. Classify → Publish

Open `/admin/ability-catalog`:

- **Needs classification** — Include / Exclude / Defer;
- **Included** — edit category/availability or exclude from M+;
- **Excluded** — restore exclusions;
- **Publish changes** — compile → validate → replay → atomic activate.

Emergency rollback: **History** tab.

---

## DEBUG / DEVELOPMENT (not required for product operation)

Retail Live only. The extractor always passes `ptr=0` and refuses a binary that reports PTR.

Low-level extract/shadow steps (Windows diagnostics, fixture development):

```
pnpm ability-catalog:simc:extract -- --simc-bin C:\path\to\simc.exe --out packages/abilities/generated/refresh/simc-live.json
pnpm ability-catalog:blizzard:extract -- --region eu --locale en_GB --out packages/abilities/generated/refresh/blizzard-eu.json --from-simc-snapshot packages/abilities/generated/refresh/simc-live.json
pnpm ability-catalog:refresh:shadow -- --blizzard … --simc … --out packages/abilities/generated/refresh/report.json
```

**Category cooldown audit (SimC 1210-01 / `a060a35`, Live):** `category_cooldown>=1000` adds zero spells beyond the current query for `class_spell`, `spec_spell`, and `race_spell`. No extractor change required unless a future SimC build exposes category-only rows in XML.

Golden fixtures: `pnpm ability-catalog:refresh:shadow -- --fixtures` only.

Generated snapshots under `packages/abilities/generated/` are gitignored (except committed offensive artifacts).

### Durable review import (debug)

```
pnpm ability-catalog:review:import -- --report … --simc … [--blizzard …] [--designate-baseline]
```

### Baseline recovery

```
pnpm ability-catalog:baseline:export -- --active --source SIMULATIONCRAFT --out packages/abilities/generated/refresh/previous-simc.json --json
```

Admin-only. Prefer this CLI over ad-hoc SQL. Do not expose raw snapshot payloads on public APIs.

### Product workflow (admin UI)

Normal operator flow is Sync → Classify → Publish (see top). The API must not execute SimC in production; use the catalog-sync container.

## Phase 3B.1 — Bootstrap Release 0 (compile + parity only)

Compile the current static production catalog into an immutable Bootstrap Release 0 candidate, validate it, and prove semantic parity vs `RETAIL_ABILITY_CATALOG`.

```
pnpm ability-catalog:release:bootstrap
pnpm ability-catalog:release:bootstrap -- --out packages/abilities/generated/release/bootstrap-0.json --report-out packages/abilities/generated/release/bootstrap-0-parity.json --json
```

What this does:

- Compiles from `RETAIL_ABILITY_CATALOG` + current static topology (no SimC / Blizzard / WCL / Wowhead input).
- Validates the release artifact and runs field / resolver / class-spec / racial / validation / round-trip parity.
- Prints `releaseKey`, full `contentDigest`, rule/topology counts.
- Optional `--out` writes the artifact JSON; optional `--report-out` writes the parity report.

What this does **not** do:

- **THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.**
- Does not load the catalog from DB/CAS at runtime.
- Does not persist to `RawArtifact` (CAS persistence is Phase 3B.2). `--persist` is rejected in 3B.1.
- Does not mutate Phase 3A review batches / drafts / baselines.

`wowBuild` for Bootstrap 0 is `unknown-static` until an operator attaches a trustworthy exact build from a PINNED baseline.

## Phase 3B.2 — Immutable release persistence (CAS + DB)

Persist Bootstrap Release 0 (or a curated candidate) as an immutable `AbilityCatalogRelease` row + CAS payload.

```
pnpm ability-catalog:release:bootstrap -- --persist [--json]
pnpm ability-catalog:release:verify -- --release-id <uuid> [--json]
```

What `--persist` does:

1. Compile + parity (must PASS).
2. Store **semantic** artifact bytes in `RawArtifact` / `RawArtifactPayload` (no `generatedAt` in CAS).
3. Insert `AbilityCatalogRelease` with `status=VALIDATED`.
4. Idempotent on `contentDigest` / `releaseKey`.

What it does **not** do:

- **THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.**
- Does not create `AbilityCatalogReleaseActivation`.
- Does not change runtime scoring (`RETAIL_ABILITY_CATALOG` remains authority).
- Does not mutate Phase 3A review queues.

CAS digest equals `contentDigest` because CAS stores `stableStringify(semantic content)` UTF-8 bytes. `generatedAt` is DB-only operational metadata.

Admin inspection (no publish):

- `GET /api/v1/admin/ability-catalog/releases`
- `GET /api/v1/admin/ability-catalog/releases/:id`
- `GET /api/v1/admin/ability-catalog/releases/:id/artifact-summary`
- `POST /api/v1/admin/ability-catalog/releases/candidates`
- `POST /api/v1/admin/ability-catalog/releases/:id/validate`

## Phase 3B.3 — Release replay / score impact (shadow)

Replay compares base vs candidate catalogs against frozen `CharacterRunDigest` nested `ParticipantScoringDigestV1` payloads. No WCL/Blizzard/SimC calls. Does not overwrite ScoreSnapshot / Trust / profiles.

```
pnpm ability-catalog:release:replay -- --self-bootstrap [--max-per-spec 2] [--max-total 80] [--json]
pnpm ability-catalog:release:replay -- --static-vs-bootstrap ...
pnpm ability-catalog:release:replay -- --base-release-id <uuid> --candidate-release-id <uuid>
```

Admin:

- `POST /api/v1/admin/ability-catalog/releases/:candidateId/replay`
- `GET /api/v1/admin/ability-catalog/releases/:candidateId/replays`
- `GET /api/v1/admin/ability-catalog/releases/:candidateId/replay-gate`
- `GET /api/v1/admin/ability-catalog/replays/:id`

**THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.** Replay PASS is diagnostic evidence only.

## Phase 3B.4 — Explicit analysis catalog pinning (no activation)

Jobs may carry an explicit `abilityCatalogExecutionPin`:

- `STATIC` + `catalogVersionId` — default for all normal traffic
- `RELEASE` + server-resolved `releaseId` / `releaseKey` / `contentDigest` / `schemaVersion`

**EXPLICIT RELEASE PIN != ACTIVE RELEASE**  
**THIS DOES NOT CHANGE DEFAULT ANALYSES**

There is no ACTIVE lookup, no default release env var, and no automatic Bootstrap pin.

### Operator test-run (admin / CLI)

```
pnpm ability-catalog:release:test-run -- \
  --release-id d68793e5-7389-4cd6-b4c2-2eec96bea068 \
  --character-id <uuid>

pnpm ability-catalog:release:test-run -- \
  --release-id d68793e5-7389-4cd6-b4c2-2eec96bea068 \
  --region EU --realm-slug kazzak --name Somechar --json
```

Admin HTTP (permission `admin.ability_catalog.manage`):

`POST /api/v1/admin/ability-catalog/releases/:id/test-run`

Body: `{ "characterId": "…" }` or `{ "region","realmSlug","name" }`

Server resolves the pin from DB (client digests are not trusted). Job is enqueued with the frozen pin. Worker loads that exact VALIDATED release once and binds it for the analysis lifetime.

Inspect resulting identity on `CharacterScore`:

- `abilityCatalogExecutionMode`
- `abilityCatalogExecutionKey`
- `abilityCatalogReleaseId` / `abilityCatalogContentDigest` (RELEASE only)

## Product flow — ACTIVE release authority

- **Every new analysis** resolves the current ACTIVE release at enqueue and freezes a RELEASE pin.
- Worker consumes the job pin only (unchanged from 3B.4).
- **No** `ABILITY_CATALOG_RUNTIME_MODE` env var — activation affects future jobs immediately.
- Missing ACTIVE → fail closed (no STATIC runtime fallback).

### Admin control center

`/admin/ability-catalog` — refresh, review, validate/replay, activate.

```
GET  /api/v1/admin/ability-catalog/workflow
POST /api/v1/admin/ability-catalog/refresh
```

Refresh requires server-side tooling: a SimC binary (`ABILITY_CATALOG_SIMC_BIN` on Windows/local, or bundled `/usr/local/bin/simc` in the catalog-refresh container) plus Blizzard credentials. The binary is interrogated for version/revision/WoW build/LIVE mode — operators do **not** set a manual SimC git SHA.

### Activate (admin.publish)

```
POST /api/v1/admin/ability-catalog/releases/:id/activate
{ "confirmationDigest": "<64 hex>", "confirm": true, "expectedPreviousActiveId": null }
```

Requires: VALIDATED (or SUPERSEDED for re-activate), artifact integrity, latest replay PASS.

### Rollback

```
POST /api/v1/admin/ability-catalog/releases/:id/rollback
{ "confirmationDigest": "<64 hex>", "confirm": true, "reason": "...", "expectedPreviousActiveId": "<uuid>" }
```

Does not delete the previous release. Already-queued jobs keep their pins.

### Inspect

```
GET /api/v1/admin/ability-catalog/releases/active
GET /api/v1/admin/ability-catalog/releases/activations
```

Activation immediately affects NEW job pins. Already-queued jobs keep their pins.

## Parity acceptance (Bootstrap)

Cutover runbook: [`doc/scoring/abilities/catalog-release-cutover.md`](../../../../doc/scoring/abilities/catalog-release-cutover.md).

Acceptance covers:

- frozen racial activations (Shadowmeld) STATIC registry vs Bootstrap RELEASE artifact (test-only)
- full `scoreCharacter` Trust path STATIC vs Bootstrap RELEASE pin (test-only)

See [`doc/scoring/abilities/catalog-release-cutover.md`](../../../../doc/scoring/abilities/catalog-release-cutover.md).
