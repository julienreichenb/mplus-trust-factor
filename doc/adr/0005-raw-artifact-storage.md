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

## Supersession note

Scoring V2 (ADR 0006) implements the filesystem content-addressed store as
`@mplus/artifact-store` (`cas://sha256/…`), adds unique `contentHash` / `refCount`
on `RawArtifact`, and keeps the same compression enum (`NONE` | `GZIP` | `ZSTD`).
