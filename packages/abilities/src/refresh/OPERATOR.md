# Ability catalog shadow refresh — operator notes

Tooling only. Nothing is published. `RETAIL_ABILITY_CATALOG` stays authoritative.

Retail Live only. The extractor always passes `ptr=0` and refuses a binary that reports PTR.

1. Obtain a SimulationCraft `simc` / `simc.exe`. Prefer a known build (packaged catalog-refresh runner, or local override via `ABILITY_CATALOG_SIMC_BIN`). Do not invent identity from folder names or branches.
2. The binary is interrogated at extract time for application version, git revision, WoW build, and LIVE/PTR mode. Short banner hashes are stored honestly as `PREFIX` unless an optional expected full SHA proves expansion.
3. Extract SpellQuery XML for cooldown-bearing class/spec/race spells (`cooldown>=1000ms` or `charge_cooldown>=1000ms`, then normalized in-extractor). The extractor first interrogates the binary (`ptr=0` SpellQuery probe) and **fails closed** if the banner is PTR, data mode is unreported, or the git revision is unreported. Optional `--expected-simc-revision` is a CI assertion only:

```
pnpm ability-catalog:simc:extract -- --simc-bin C:\path\to\simc.exe --out packages/abilities/generated/refresh/simc-live.json
```

4. Export Blizzard EU Retail static Game Data (OAuth env `BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET`). Identity lookup should use SimC-discovered IDs, not only the three known bugs:

```
pnpm ability-catalog:blizzard:extract -- --region eu --locale en_GB --out packages/abilities/generated/refresh/blizzard-eu.json --from-simc-snapshot packages/abilities/generated/refresh/simc-live.json
```

Blizzard spell rows are identity-only. They never claim a complete spec toolkit.

5. Run the shadow audit (both snapshot files required). File-based runs **must** be `datasetKind=PINNED`:

```
pnpm ability-catalog:refresh:shadow -- --blizzard packages/abilities/generated/refresh/blizzard-eu.json --simc packages/abilities/generated/refresh/simc-live.json --out packages/abilities/generated/refresh/report.json
```

6. Read the JSON/report. Publication is always `NONE`.
7. Golden fixtures: `pnpm ability-catalog:refresh:shadow -- --fixtures` only.

Generated snapshots under `packages/abilities/generated/` are gitignored (except committed offensive artifacts).

## Phase 3A — durable review import

`packages/abilities/generated/refresh/` remains gitignored. Local paths alone are not production durability.

Import a PINNED report into the admin review queue (idempotent by SHA-256 of report bytes):

```
pnpm ability-catalog:review:import -- --report packages/abilities/generated/refresh/report.json --simc packages/abilities/generated/refresh/simc-live.json [--blizzard packages/abilities/generated/refresh/blizzard-eu.json] [--designate-baseline]
```

What is stored durably:

- Report JSON bytes → `RawArtifact` (`provider=INTERNAL`) + `RawArtifactPayload` keyed by SHA-256, referenced from `AbilityCatalogReviewBatch`.
- Optional SimC / Blizzard snapshot bytes → same CAS tables, referenced from the batch (and from `AbilityCatalogSourceBaseline` when `--designate-baseline` is used).
- Active `AbilityCatalogSourceBaseline` points at `contentHash` (+ optional `artifactId`). The next shadow refresh should pass `--previous-simc` using bytes recovered from that artifact (or an operator-retained copy of the same hash). Publication / runtime catalog mutation is out of scope for Phase 3A.

## Baseline recovery runbook (Phase 3A.5)

1. Locate the active baseline (API or DB):

```
# Prefer CLI: resolve active baseline and write verified bytes
pnpm ability-catalog:baseline:export -- --active --source SIMULATIONCRAFT --out packages/abilities/generated/refresh/previous-simc.json --json
```

Or by id:

```
pnpm ability-catalog:baseline:export -- --baseline-id <uuid> --out packages/abilities/generated/refresh/previous-simc.json
```

2. The command loads `AbilityCatalogSourceBaseline` → `RawArtifact` / `RawArtifactPayload`.
3. It verifies SHA-256(uncompressed bytes) === `baseline.contentHash` (fails closed on missing artifact or digest mismatch).
4. Bytes are written atomically to `--out` (temp + rename). No DB mutation.
5. Feed into the next shadow refresh:

```
pnpm ability-catalog:refresh:shadow -- --blizzard … --simc … --previous-simc packages/abilities/generated/refresh/previous-simc.json --out …
```

6. Delete the temporary export when finished (`Remove-Item` / `rm`). Do not commit `generated/refresh/*`.

Admin-only. Prefer this CLI over ad-hoc SQL. Do not expose raw snapshot payloads on public APIs.

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
