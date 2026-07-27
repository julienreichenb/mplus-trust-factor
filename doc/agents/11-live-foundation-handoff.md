# Agent 11 handoff — Live foundation, secrets and developer workflow

## Branch

`agent/w3-live-foundation`

## Commit

See latest commit on this branch (recorded after commit).

## Summary

- Root `.env` loading for `pnpm dev` remains cross-platform via `tools/scripts/with-env.mjs` + parallel workspace filters.
- Added `BLIZZARD_ENABLED`, `WCL_ENABLED`, and kept `RAIDERIO_ENABLED` with conditional live credential validation.
- Added `ALLOW_LIVE_PROVIDER_CALLS` opt-in and redacted live smoke commands with mandatory `--region/--realm/--name`.
- Startup config summary (`getConfigSummary`) logs booleans/modes only.
- Expanded secret redaction paths and added secret-scanning tests.
- Updated `.env.example` and `doc/operations/local-development.md`.

## Tests executed

- `pnpm test` (unit)
- `pnpm test:security`
- Config package tests via vitest include
- Smoke refuse check without opt-in

## Live API calls performed

None (opt-in smokes were only verified for refusal without `ALLOW_LIVE_PROVIDER_CALLS=true`).

## Remaining blockers

- Real live smoke against allowlisted identity requires local credentials + explicit opt-in (out of CI scope).
- Provider business-logic hardening remains with Agents 12–14.
- Built browser bundle artifact scan is covered via web source/`VITE_*` hygiene; full `vite build` bundle scan can be extended by Agent 17 if desired.

## Files changed

See git commit.
