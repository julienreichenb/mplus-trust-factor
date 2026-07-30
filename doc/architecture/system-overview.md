# System overview

## Components

| Component | Role |
|-----------|------|
| `apps/web` | Vue 3 SPA; stable API DTOs only |
| `apps/api` | Fastify HTTP API; enqueue refresh; IAM/admin |
| `apps/worker` | BullMQ processors: refresh, analyze, recalculate, addon export, discover-owned-characters |
| PostgreSQL | Normalized domain + provenance + score models/snapshots |
| Redis | BullMQ + coordination |
| `packages/providers/*` | Blizzard / Warcraft Logs / Raider.IO → contracts |
| `packages/scoring` | Deterministic scoring; no network |
| `tools/addon-exporter` + `addon/` | Static Lua datasets for the retail addon |

## Flow

```text
Vue Web → Fastify API → PostgreSQL
                ↓
         BullMQ / Redis → Worker
                            → providers (Blizzard / WCL / Raider.IO)
                            → scoring
                            → score snapshots / addon export
```

## Invariants

1. Provider packages never compute the final Trust Score.
2. Scoring never performs network I/O.
3. Public API DTOs never leak provider-specific payloads.
4. Every external datum keeps source provenance and fetch time.
5. Region is a first-class key.
6. Boost language is probabilistic only.
7. Published snapshots are immutable; failed refresh keeps last-known-good public pointer.

## Deeper docs

- Refresh: [`refresh-lifecycle.md`](refresh-lifecycle.md)
- WCL pipeline: [`wcl-data-pipeline.md`](wcl-data-pipeline.md)
- Publication: [`scoring-publication.md`](scoring-publication.md)
- IAM: [`iam-and-admin.md`](iam-and-admin.md)
- Addon: [`addon-architecture.md`](addon-architecture.md)
- Frontend brand/UX: [`frontend/`](frontend/)
- Database notes: [`database.md`](database.md)
- Legacy short overview: [`system.md`](system.md) (prefer this file)
