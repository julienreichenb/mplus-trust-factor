# ADR 0005 — Raw artifact storage abstraction

## Status

Accepted

## Context

Provider responses (especially Warcraft Logs event pages) can be large. Storing everything uncompressed in PostgreSQL harms a small VPS.

## Decision

Persist large payloads as `RawArtifact` records pointing at a storage URI. MVP storage is the local filesystem via `RAW_ARTIFACTS_DIR` with optional compression metadata (`NONE` | `GZIP` | `ZSTD`). Object storage can replace the URI scheme later without schema redesign.

## Consequences

- `ExternalPayload.payload` remains optional for small JSON.
- Retention is controlled by `RAW_ARTIFACT_RETENTION_DAYS`.
- Agent 8 may introduce cloud object storage behind the same URI abstraction.
