# Agent 11 calibration cohort — 2026-08-01

Immutable user intake and generated calibration artifacts for the M+ Trust Factor
scoring calibration study.

## Canonical inputs (do not rewrite intake in place)

| File | Role |
|------|------|
| [`intake.v1.json`](./intake.v1.json) | Immutable user selections (41 observations / 40 identities) |
| [`../../meta-policies/midnight-season-1.meta.v1.json`](../../meta-policies/midnight-season-1.meta.v1.json) | Season meta policy (`midnight-season-1`) + explicit Blizzard season-17 binding |

## Generated cohort files

| File | Role |
|------|------|
| `resolved.v1.json` | Enriched intake (preserves original fields; adds class/spec/role/meta/provenance) |
| `manifest.v1.json` | Strict `CohortManifest 1.0.0` (only fully resolved members) |
| `exclusions.v1.json` | Every excluded/deferred member with machine-readable reason |
| `preflight.json` / `preflight.md` | Per-member preflight + provider-call summary |
| `report.md` | Public-safe study report (after Phase C) |

Private / large outputs (do not commit blindly):

```text
tmp/calibration/agent11-2026-08-01/
```

## Evidence environment

- **Canonical evidence DB:** remote **test**, joined **on the VPS** via process-scoped
  `CALIBRATION_EVIDENCE_DATABASE_URL` (see [`EVIDENCE-JOIN-RUNBOOK.md`](./EVIDENCE-JOIN-RUNBOOK.md))
- Do **not** store the test PostgreSQL URL on developer laptops
- Local `DATABASE_URL` is for development/tests only — never evidence authority
- Enrichment must not enqueue `refresh-character` jobs, WCL, or Raider.IO
- Evidence join is read-only (`SET TRANSACTION READ ONLY`) and forbids live providers

## Reproduction

### 1. Validate + Blizzard metadata enrichment (profile only)

```bash
# Dry-run (no live calls)
pnpm calibration:cohort-enrich -- --dry-run --live-blizzard

# Approved live pass (40 unique identities, getCharacterProfile only)
# PowerShell: $env:ALLOW_LIVE_PROVIDER_CALLS='true'
ALLOW_LIVE_PROVIDER_CALLS=true pnpm calibration:cohort-enrich -- --live-blizzard
```

Safety gates refuse `--enqueue-refresh`, `--call-wcl`, `--call-raiderio`, `--activate-model`.

### 2. Re-apply role-context exclusions (offline)

```bash
pnpm calibration:reapply-role-context
```

Marks `ROLE_CONTEXT_MISMATCH` when the user-labelled role disagrees with the current active
profile and cutoff evidence is not proven (Joefreckles TANK, Essetxd HEALER, Petbear dual labels).

### 3. Server-side read-only evidence join (VPS)

See [`EVIDENCE-JOIN-RUNBOOK.md`](./EVIDENCE-JOIN-RUNBOOK.md). Preferred entrypoint:

```bash
bash tools/scripts/calibration-evidence-join-vps.sh /tmp/mplus-agent11-calibration-XXXX
```

This attaches an ephemeral Node container to the discovered `mplus-test` Postgres Docker
network (`mplus-test_app`) because `DATABASE_URL` uses hostname `postgres` (not reachable from
the VPS host without publishing ports — forbidden).

### 4. After evidence join artifacts are copied back

Export/freeze the portable bundle only after the preflight counts are reviewed (not this pass):

```bash
pnpm --filter @mplus/scoring run build
pnpm --filter @mplus/scoring run calibration:harness -- --bundle ./tmp/calibration/agent11-2026-08-01/bundle.v1.json --mode persisted-snapshot-only --out ./tmp/calibration/agent11-2026-08-01 --public-safe
```

### 5. Focused unit tests

```bash
pnpm exec vitest run apps/api/src/services/calibration/calibration-cohort.test.ts
```

## Meta policy season binding

Product policy slug remains `midnight-season-1`. Applicability requires an explicit binding to
Blizzard provider season **17** / catalog slug `blizzard-season-17`. Fail closed on any other
authoritative season.

## Known intake issues (documented, not silently fixed)

- Missing `providedRole`: Xatihr, Lightreport, Reyou (resolved from active spec when available)
- Petbear duplicate TANK/C vs DPS/D → `ROLE_CONTEXT_CONFLICT` until distinct role/spec evidence is proven
- Myzouth → `MYZOUTH_BOOTSTRAP_DEFERRED` until remote-test bootstrap recovery is validated (preserve Character ID)
- `suspectedBoost` not user-labeled → technical `false` + `NOT_USER_LABELED` (no supervised boost conclusions)
