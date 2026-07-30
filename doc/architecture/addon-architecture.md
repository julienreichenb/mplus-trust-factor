# Addon architecture

## Components

| Path | Role |
|------|------|
| `addon/MPlusTrust` | Retail UI consumer of static data (no HTTP) |
| `tools/addon-exporter` | Builds static Lua datasets from score snapshots |
| Worker addon-export processor | Queue-driven export jobs |

## Rules

- Addon never calls live providers or the product API at runtime.
- Exported data must be reproducible from published snapshots / approved export jobs.
- Deeper design notes: [`addon/`](addon/) (overview, data format, packaging, update model).

## Ownership

Historical Agent 7 / parallel ownership: `addon/**`, `tools/addon-exporter/**`, `doc/architecture/addon/**` — see [`../agents/file-ownership-map.md`](../agents/file-ownership-map.md).
