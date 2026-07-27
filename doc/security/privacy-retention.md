# Privacy and retention

## Principles

- Public game character data is still handled responsibly.
- Minimize stored Battle.net account data; OAuth profile fields only when claimed (future).
- No private logs in MVP.
- Support future deletion, recompute, and dispute workflows via schema (`ScoreDispute`).

## Retention defaults

| Data class | Default | Env |
|------------|---------|-----|
| Raw provider payloads / artifacts | 30 days | `RAW_ARTIFACT_RETENTION_DAYS` |
| Derived score snapshots | Longer (season + history) | Policy in worker |
| Compact metric observations | Season-scoped | DB |
| OAuth tokens | Memory/Redis TTL only | Never committed |

## Raw artifacts

Large event pages stored under `RAW_ARTIFACTS_DIR` with compression metadata in `RawArtifact`. Purge by `retention_until`.

## User rights (future)

- Mark score stale / request recompute
- Dispute record in DB without public workflow in MVP

## Logging

Structured logs must not include full provider responses, tokens, or private report codes. Use redaction paths in `@mplus/observability`.

## Addon export

Only addon-safe summary fields (score, grade, confidence bucket, public red-flag bitset, freshness). Validated by `assertAddonExportSafe`.
