# File ownership map

Use this map to avoid drive-by edits across domains. Prefer the narrowest owner for the change.

| Domain | Typical paths |
|--------|----------------|
| Blizzard provider | `packages/providers/blizzard/**`, `doc/api/blizzard/**` |
| Warcraft Logs | `packages/providers/warcraftlogs/**`, `doc/api/warcraftlogs/**` |
| Raider.IO | `packages/providers/raiderio/**`, `doc/api/raiderio/**` |
| Scoring / abilities | `packages/scoring/**`, `packages/abilities/**`, `packages/mechanics/**`, `doc/scoring/**` |
| API / worker | `apps/api/**`, `apps/worker/**`, `doc/api/internal/**` |
| Frontend | `apps/web/**`, `doc/architecture/frontend/**` |
| Addon | `addon/**`, `tools/addon-exporter/**`, `doc/architecture/addon/**` |
| DevOps / ops docs | `.github/**`, `infra/**`, `doc/operations/**` |
| QA / security docs | `doc/testing/**`, `doc/security/**`, shared fixtures |
| Agent / docs entry | `AGENTS.md`, `doc/README.md`, `doc/agents/**` |

## Shared conflict policy

- Avoid drive-by edits to root `package.json`, lockfile, Prisma schema, or shared contracts.
- Required shared changes: keep backward compatible and call out in the handoff / PR.
- Do not delete Utility/Survival research probes without an explicit prompt.
