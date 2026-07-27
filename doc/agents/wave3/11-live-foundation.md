# Agent 11 — Live foundation, secrets and developer workflow

## Branch

`agent/w3-live-foundation`

## Read first

- `doc/plans/wave3-live-character-mvp.md`
- all `doc/research/providers/*.md`
- `.env.example`, `.gitignore`, `packages/config/**`, root `package.json`

## Tasks

1. Make `pnpm dev` load the root `.env` cross-platform; preserve workspace parallel startup.
2. Add explicit provider enable flags and conditional credential validation. Fixture mode must not require live credentials.
3. Ensure all provider secrets remain server-only and are redacted from logs/errors/persisted payloads.
4. Add safe root commands:
   - `live:smoke:blizzard`
   - `live:smoke:raiderio`
   - `live:smoke:wcl`
   - `live:smoke:character`
5. Require an explicit opt-in such as `ALLOW_LIVE_PROVIDER_CALLS=true`; otherwise smoke commands refuse to run.
6. Add identity arguments (`--region`, `--realm`, `--name`) without embedding a real player in source.
7. Add a startup configuration summary containing booleans and modes only, never credential values.
8. Add secret scanning tests for browser bundles, logs, fixtures and tracked `.env` files.
9. Update `.env.example` and a local-dev runbook with fixture and live instructions.

## Constraints

- No provider business logic.
- No CI live calls.
- No Unix-only shell syntax.
- Never put provider secrets in `VITE_*` variables.

## Acceptance

- `pnpm dev` starts API/worker/web with a valid root `.env` on Windows.
- Fixture mode starts with empty provider credentials.
- Live mode fails with a precise provider-specific configuration error.
- Smoke commands are redacted and opt-in only.
- Existing tests remain green.

## Handoff

Write `doc/agents/11-live-foundation-handoff.md`, commit and stop.
