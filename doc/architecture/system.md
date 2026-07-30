# System architecture

Prefer the canonical overview: [`system-overview.md`](system-overview.md).

## Components

- **apps/web** — Vue 3 SPA; reads stable API DTOs only
- **apps/api** — Fastify HTTP API; enqueues refresh work; does not call providers synchronously without policy
- **apps/worker** — BullMQ processors for ingestion, analysis, scoring, addon export
- **PostgreSQL** — normalized domain + provenance
- **Redis** — BullMQ + cache coordination
- **packages/providers/** — normalize external APIs to contracts; retain provenance
- **packages/scoring** — deterministic, no network
- **tools/addon-exporter** — builds static Lua datasets from score snapshots
- **addon/MPlusTrust** — WoW UI consumer of static data (no HTTP)

## Flow

```text
Vue Web → Fastify API → PostgreSQL
                ↓
         BullMQ / Redis → Worker
                            → providers (Blizzard / WCL / Raider.IO)
                            → scoring
                            → score snapshots / addon export
```

## Rules

1. Provider packages never compute final Trust Factor.
2. Scoring never performs network I/O.
3. Public API DTOs never leak provider-specific payloads.
4. Every external datum keeps source provenance and fetch time.
5. Region is a first-class key everywhere.
6. "Boost" language is probabilistic only.
