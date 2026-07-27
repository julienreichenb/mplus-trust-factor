# Parallel file ownership

From WAVE-EXECUTION-PLAN. Agents 1–9 run only after Agent 0 is merged, on isolated branches.

| Agent | Owns |
|-------|------|
| 0 Foundation | Root workspace, shared contracts baseline, initial Prisma schema, base scripts |
| 1 Blizzard | `packages/providers/blizzard/**`, `doc/api/blizzard/**` |
| 2 Warcraft Logs | `packages/providers/warcraftlogs/**`, `doc/api/warcraftlogs/**` |
| 3 Raider.IO | `packages/providers/raiderio/**`, `doc/api/raiderio/**` |
| 4 Scoring | `packages/scoring/**`, `packages/mechanics/**` (scoring/catalog), `doc/scoring/**` |
| 5 Backend | `apps/api/**`, `apps/worker/**`, orchestration, `doc/api/internal/**` |
| 6 Frontend | `apps/web/**`, `doc/architecture/frontend/**` |
| 7 Addon | `addon/**`, `tools/addon-exporter/**`, `doc/architecture/addon/**` |
| 8 DevOps | `.github/**`, `infra/**`, production compose, `doc/operations/**` |
| 9 QA | testing utilities/fixtures not owned above, `doc/testing/**`, `doc/security/**` |

## Shared conflict policy

- Avoid editing root `package.json`, lockfile, Prisma schema, or shared contracts unless necessary.
- Required shared changes: write `doc/contracts/change-requests/<agent>-<topic>.md`, keep backward compatible, call out in handoff.
- Do not reformat unrelated files.
