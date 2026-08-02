# Database

Prisma schema: `packages/database/prisma/schema.prisma`.

## Core model groups

- Static game data: Region, Realm, Season, Dungeon, SeasonDungeon, GameClass, GameSpecialization
- Characters: Character, CharacterAlias, snapshots, lean BattleNetAccount / AccountCharacter
- Provenance: ExternalRequest, ExternalPayload, RawArtifact, ArtifactReference
- Runs: MythicRun, RunSourceReference, RunParticipant, RunAnalysis
- Scoring V2 evidence: EvidenceManifest, EvidenceManifestSlot, WclReportRevision,
  EvidenceDataset, RunFactSet, DimensionComputation
- Metrics: MetricDefinition, MetricObservation, MechanicRule
- Scores: ScoreModel, ScoreSnapshot (optional `evidenceManifestId`), DimensionScore,
  red flags, ScoreDispute, ScoreAnalysisBatch
- Ops: IngestionJob, User, Entitlement, AddonExport

Large provider pages use `@mplus/artifact-store` (content-addressed `cas://sha256/…`)
with SHA-256 identity, compression metadata, and reference counting on `RawArtifact`.
See ADR [`../adr/0006-scoring-v2-persistence.md`](../adr/0006-scoring-v2-persistence.md)
and reset runbook [`../operations/scoring-v2-persistence-reset.md`](../operations/scoring-v2-persistence-reset.md).

## Seed

Idempotent seed creates:

- EU region
- Placeholder current season (`placeholder-current`, marked in metadata)
- Score model `default` v1 with COMMON-CONTEXT weights/thresholds
- Metric definition keys
- Public red-flag definitions

## Commands

```bash
pnpm db:generate
pnpm db:migrate        # deploy
pnpm db:migrate:dev    # create/apply in development
pnpm db:seed
pnpm db:studio
```

Timestamps are UTC (`Timestamptz`). Large raw pages belong in compressed `RawArtifact` storage, not unbounded JSONB.
