# Scoring operations

**Status:** normative.

## Normal product path

Character refresh calls `scoreCharacter()` directly. Operators do **not** need canary commands for ordinary production scoring.

Gates:

- `SCORING_ENABLED` — master switch
- `ALLOW_LIVE_PROVIDER_CALLS` / `WCL_ENABLED` / live provider mode — provider permission
- `SCORING_PUBLICATION_ENABLED` — independent publish gate

## Public commands

| Command | Role |
|---------|------|
| `pnpm scoring:canary` | Full pipeline without publication; WCL only when explicitly armed |
| `pnpm scoring:replay` | Provider-free reconstruction from cached raw + rankings |
| `pnpm scoring:doctor` | Provider-free diagnostics; no mutation |

Deprecated contextual modes (`repair-package`, `reconcile-revisions`, `ranking-hydrate`, etc.) are rejected.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Zero scores / skipped | `SCORING_ENABLED` |
| Unexpected WCL calls on warm run | Selected identities changed (revision/acquisitionVersion) or cache miss |
| Performance unavailable, Utility/Survival OK | Missing ranking facts for selected runs |
| Digest rebuild without WCL | Extractor version bumped; raw cache still present |
| Publication blocked | `SCORING_PUBLICATION_ENABLED` must be explicit |

## Obsolete tables

`capability_evidence_package_records` and `participant_scoring_digests` are **deprecated and unused** by the production scoring path. Follow-up migration may drop them after data migration into `wcl_run_raw` / `character_run_digests`.
