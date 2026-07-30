# File ownership map

## Stabilization programme (2026-07)

| Agent | Focus | May touch |
|-------|-------|-----------|
| 00 | CI repair | CI config, vitest, worker test expectations |
| 01 | Inventory | `docs/audits/**` only (no deletes) |
| 02 | Docs canonicalization | `doc/**`, `docs/**`, `AGENTS.md`, `.cursor/rules/**`, safe doc clutter, frontend guidance consolidation assets |
| 03 | Refresh lifecycle | API freshness / character service / enqueue |
| 04 | Admin RBAC | IAM / admin routes / grants |
| 05 | CI/CD hardening | `.github/workflows/cd.yml`, deploy docs |
| 06–07 | Utility audit / fallback | WCL utility + worker orchestration (preserve probes) |
| 08 | Model lifecycle | Admin activation + recalculate cohort |
| 09 | Bulk processing | Bulk orchestrator |
| 10–11 | Calibration | Harness + study (preserve probes) |
| 12 | Deep clean | DELETE_SAFE §B + probe retirement with manifest |
| 13 | Final integration | Cross-cutting close-out |

Never delete Utility/Survival probes in Agents 02–11.

## Historical wave ownership (reference)

From the original parallel plan ([`../architecture/parallel-ownership.md`](../architecture/parallel-ownership.md)):

| Historical agent | Owns |
|------------------|------|
| 0 Foundation | Workspace, contracts baseline, Prisma baseline |
| 1 Blizzard | `packages/providers/blizzard/**`, `doc/api/blizzard/**` |
| 2 Warcraft Logs | `packages/providers/warcraftlogs/**`, `doc/api/warcraftlogs/**` |
| 3 Raider.IO | `packages/providers/raiderio/**`, `doc/api/raiderio/**` |
| 4 Scoring | `packages/scoring/**`, `packages/mechanics/**`, `doc/scoring/**` |
| 5 Backend | `apps/api/**`, `apps/worker/**`, `doc/api/internal/**` |
| 6 Frontend | `apps/web/**`, `doc/architecture/frontend/**` |
| 7 Addon | `addon/**`, `tools/addon-exporter/**`, `doc/architecture/addon/**` |
| 8 DevOps | `.github/**`, `infra/**`, `doc/operations/**` |
| 9 QA | `doc/testing/**`, `doc/security/**`, shared fixtures |

## Shared conflict policy

- Avoid drive-by edits to root `package.json`, lockfile, Prisma schema, or shared contracts.
- Required shared changes: `doc/contracts/change-requests/<topic>.md`, keep backward compatible, call out in handoff.
