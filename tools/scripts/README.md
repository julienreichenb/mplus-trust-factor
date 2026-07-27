# Monorepo helper scripts

Cross-platform Node scripts (Windows + Unix). Prefer `node tools/scripts/...` over shell one-liners.

## Env loading

`with-env.mjs` loads the root `.env` into the child process environment without overwriting existing vars. Used by `pnpm dev`, DB commands and live smokes.

## Live smoke (manual only)

Require:

```bash
ALLOW_LIVE_PROVIDER_CALLS=true
```

Identity args are mandatory (`--region`, `--realm`, `--name`). No default player is embedded.

| Command | Script |
|---|---|
| `pnpm live:smoke:blizzard` | `live-smoke-blizzard.mjs` |
| `pnpm live:smoke:raiderio` | `live-smoke-raiderio.mjs` |
| `pnpm live:smoke:wcl` | `live-smoke-wcl.mjs` |
| `pnpm live:smoke:character` | `live-smoke-character.mjs` |

Never invoke these from CI.
