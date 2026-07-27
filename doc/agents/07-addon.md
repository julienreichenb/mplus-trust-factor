# Agent
- ID: 07
- Scope: WoW addon proof of concept + static Lua exporter
- Branch/worktree: agent/addon
- Date: 2026-07-27
- Commit(s): pending

# Summary

Implemented the MPlusTrust Retail addon and `@mplus/addon-exporter` toolchain:

- **Exporter** reads static fixture score snapshots, applies eligibility rules, partitions deterministic Lua shards, writes metadata/checksum, updates `.toc`, and packages a release ZIP.
- **Addon** loads static data only (no HTTP), provides lookup, slash commands (`/mpt status|lookup|debug|row|tooltip`), tooltip integration via safe LFG hooks, and experimental row-grade overlays (disabled by default).
- **Documentation** under `doc/architecture/addon/` and plan at `doc/plans/07-addon.md`.
- **Gitignore fix** so `addon/MPlusTrust/Data/` is tracked on Windows (`data/` rule was excluding it).

# Plan reference

[doc/plans/07-addon.md](../plans/07-addon.md)

# Files owned/changed

- `addon/MPlusTrust/**` — runtime Lua, generated `Data/`, LICENSE placeholder
- `tools/addon-exporter/**` — exporter CLI, tests, fixtures, benchmarks
- `doc/architecture/addon/**` — architecture docs (7 files)
- `doc/plans/07-addon.md`
- `doc/agents/07-addon.md`
- `.gitignore` — allow `addon/MPlusTrust/Data/`
- `pnpm-lock.yaml` — new exporter dependencies

# Public contracts

- No changes to `@mplus/contracts` types.
- Exporter internal types in `tools/addon-exporter/src/types.ts` mirror future `AddonExport` summary rows.
- Lookup key semantics align with `@mplus/domain` normalization.
- Queue `generate-addon-export` payload unchanged (Agent 5 will wire exporter later).

# Acceptance results

Commands run on Windows 10, Node 22:

| Command | Result |
|---------|--------|
| `pnpm install` | ok |
| `pnpm --filter @mplus/addon-exporter test` | 12 passed |
| `pnpm --filter @mplus/addon-exporter typecheck` | ok (`tsc -b`) |
| `pnpm --filter @mplus/addon-exporter build` | ok |
| `pnpm --filter @mplus/addon-exporter export` | 6 eligible chars, 6 shards |
| `pnpm --filter @mplus/addon-exporter lua:check` | 16 Lua files parsed |
| `pnpm --filter @mplus/addon-exporter benchmark` | 10k/100k synthetic documented |
| `pnpm --filter @mplus/addon-exporter package` | `dist/MPlusTrust-0.1.0.zip` |
| `pnpm test -- tools/addon-exporter` (root) | 12 passed |
| `pnpm lint` | ok |

Root `pnpm typecheck` fails on `@mplus/database` without `prisma generate` (pre-existing foundation gap, not introduced by Agent 7).

# External API observations

- No external APIs used. Exporter consumes `tools/addon-exporter/fixtures/score-snapshots.json` only.
- Retail LFG hook targets documented in `doc/architecture/addon/current-retail-api-research.md` (wiki/community sources; re-verify per patch).

# Security and privacy

- No HTTP/network code in Lua.
- Export includes summary fields only (score, grade, confidence bucket, public red-flag bitset, freshness).
- No dimensions, authenticity evidence, or admin fields in dataset.
- LICENSE placeholder — owner must choose license before public distribution.

# Known limitations

- Row grade is experimental and **off by default** (`/mpt row on`).
- Dataset is fixture-driven until Agent 5 connects worker `generate-addon-export` to DB snapshots.
- All shard Lua files load at login (WoW `.toc` model); true lazy IO requires companion addons (documented).
- Profile URL copy is user-driven; addon does not open browsers.
- Interface version pinned to `110000` until Agent 8 build pipeline resolves TOC.
- CurseForge/Wago publish not configured.

# Contract change requests

None.

# Follow-up work

- Agent 5: invoke exporter from `generate-addon-export` worker job using persisted snapshots.
- Agent 8: CI workflow for export/test/lua-check/package artifacts.
- Agent 10: end-to-end fixture flow including addon lookup in integration scenario.
- Project owner: select addon LICENSE before public release.

# Rollback

- Remove `addon/MPlusTrust` from AddOns folder.
- Revert Agent 7 commit on branch `agent/addon`.
- Disable worker export job when wired (Agent 5).
