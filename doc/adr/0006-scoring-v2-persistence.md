# ADR 0006 — Scoring V2 persistence and artifact store

## Status

Accepted

## Context

Scoring V2 requires immutable evidence manifests, content-addressed raw payloads,
normalized fact sets, and dimension computations that are separable from
publication (`ScoreSnapshot`). Large WCL pages must not live in hot JSONB
(`RunAnalysis.summary`).

## Decision

1. Add additive Prisma models: `EvidenceManifest`, `EvidenceManifestSlot`,
   `WclReportRevision`, `EvidenceDataset`, `RunFactSet`, `DimensionComputation`,
   and `ArtifactReference`.
2. Keep `ScoreSnapshot` / `ScoreAnalysisBatch` as publication and batch lifecycle
   records; both may optionally reference an `EvidenceManifest`.
3. Introduce `@mplus/artifact-store` with a content-addressed interface
   (`cas://sha256/<hash>…`), SHA-256 identity, compression metadata
   (`NONE` | `GZIP` | `ZSTD`), size bounds, atomic local writes, and hash
   verification on read. Local filesystem is the test/MVP backend.
   GZIP/NONE are always available; ZSTD write uses optional native
   `@mongodb-js/zstd` (fail closed when unavailable) with pure-JS
   decompress fallback via `fzstd`.
4. Strengthen `RawArtifact` with unique `contentHash`, uncompressed size,
   artifact class, and `refCount` for orphan prevention.
5. Enforce manifest immutability with PostgreSQL triggers; unique slot and
   report/fight constraints (partial unique index for non-null identities).
6. Provide a guarded Option A test reset (`APP_ENV` + confirmation token +
   non-production DB name checks) plus calibration label export/import.

## Alternatives

- Dual-write V1/V2 immediately — deferred until continuity matters.
- Embed raw events in JSONB — rejected (size and reproducibility).
- S3-only artifacts from day one — deferred; URI scheme stays backend-agnostic.

## Consequences

- Migrations are additive; V1 tables remain until cutover (Prompt 15).
- Workers/providers must use `ArtifactRepository` for large payloads.
- Destructive reset is never a default deploy step and refuses production.

## Migration / rollback

- Forward: `pnpm db:migrate` applies `20260802120000_scoring_v2_persistence`.
- Empty-DB validation: migrate deploy on disposable Postgres succeeds.
- Upgrade path: existing test schemas gain V2 tables; `raw_artifacts`
  content hashes are deduplicated before uniqueness.
- Rollback: restore pre-migration `pg_dump`; do not run reset in production.
