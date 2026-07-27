# Agent 11 handoff — Live foundation, secrets and developer workflow

## Branch

`agent/w3-live-foundation`

## Commit

`851229a0ad0b56b0ec854bda69e60b716b806e08`

## Summary

- Root `.env` loading for `pnpm dev` remains cross-platform via `tools/scripts/with-env.mjs` + parallel workspace filters.
- Added `BLIZZARD_ENABLED`, `WCL_ENABLED`, and kept `RAIDERIO_ENABLED` with conditional live credential validation.
- Added `ALLOW_LIVE_PROVIDER_CALLS` opt-in and redacted live smoke commands with mandatory `--region/--realm/--name`.
- Startup config summary (`getConfigSummary`) logs booleans/modes only.
- Expanded secret redaction paths and added secret-scanning tests.
- Updated `.env.example` and `doc/operations/local-development.md`.

## Tests executed

- `pnpm test` — 191 passed
- `pnpm test:security` — 12 passed
- `pnpm test:contract` — 10 tests passed (suite teardown Redis close noise only)
- Smoke refuse: `pnpm live:smoke:blizzard` and `pnpm live:smoke:raiderio` exit 2 without opt-in

## Live API calls performed

None (opt-in smokes were only verified for refusal without `ALLOW_LIVE_PROVIDER_CALLS=true`).

## Remaining blockers

- Real live smoke against an allowlisted identity requires local credentials + explicit opt-in (out of CI scope).
- Provider business-logic hardening remains with Agents 12–14.
- Built browser bundle artifact scan is covered via web source/`VITE_*` hygiene; full `vite build` bundle scan can be extended by Agent 17 if desired.

## Files changed

- `.env.example`
- `package.json`
- `packages/config/src/index.ts`, `packages/config/src/env.test.ts`
- `packages/observability/src/index.ts`, `packages/observability/src/security.ts`
- `apps/api/src/index.ts`
- `apps/worker/src/index.ts`, `apps/worker/src/container.ts`
- `apps/worker/src/providers/provider-factory.ts`, `provider-factory.test.ts`
- `tools/scripts/with-env.mjs` (unchanged behavior), `live-smoke-*.mjs`, `wcl-smoke.mjs`, `README.md`
- `tests/security/secret-scanning.test.ts`
- `doc/operations/local-development.md`
- `doc/agents/11-live-foundation-handoff.md`
