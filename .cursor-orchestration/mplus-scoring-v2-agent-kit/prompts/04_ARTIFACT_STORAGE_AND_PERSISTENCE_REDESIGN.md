---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 04 — Artifact storage and persistence redesign

## Dependencies

- Architecture ADRs approved.
- Evidence contracts stable.
- Must not run concurrently with calibration schema changes without coordination.

## Objective

Implement the V2 persistence model and artifact abstraction. The test database may be reset, but migration behavior must be explicit and safe.

## Scope

- `packages/database/prisma/`
- new artifact storage package or existing persistence layer;
- repositories;
- migration/reset scripts;
- integration tests;
- docs.

## Required models

Implement approved equivalents of:

- EvidenceManifest;
- EvidenceManifestSlot;
- WclReportRevision if accepted;
- EvidenceDataset;
- RunFactSet;
- DimensionComputation or approved adaptation;
- reference to ScoreSnapshot/publication;
- analysis batch/slot lifecycle.

Reuse existing models only when their semantics satisfy the V2 documents.

## Artifact abstraction

- content-addressed;
- SHA-256;
- size bounds;
- compression metadata;
- local test implementation;
- production interface;
- atomic write;
- read/hash verification;
- reference tracking;
- no path traversal;
- no raw events in hot `RunAnalysis.summary`.

## Reset/migration

Provide:

- empty DB migration validation;
- upgrade path from current test schema;
- guarded test reset command;
- calibration cohort label export/import;
- explicit tables retained/dropped;
- rollback/backup instructions.

No production destructive command without strict environment checks.

## Integrity

Add DB constraints/indexes for:

- immutable manifest/hash;
- unique slot indexes;
- unique report/fight per manifest;
- dataset compatibility key;
- fact-set uniqueness;
- model/manifest consistency.

## Tests

- artifact dedupe;
- compression round trip;
- hash mismatch;
- oversized payload;
- transaction rollback;
- manifest immutability;
- orphan prevention;
- empty/upgrade migration;
- reset guard rejects non-test DB.

Run all suites and stop at a distinct commit. No provider wiring, scoring activation, deploy, or data reset execution without explicit approval.
