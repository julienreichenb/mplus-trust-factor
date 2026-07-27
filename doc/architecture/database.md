# Database

Prisma schema: `packages/database/prisma/schema.prisma`.

## Core model groups

- Static game data: Region, Realm, Season, Dungeon, SeasonDungeon, GameClass, GameSpecialization
- Characters: Character, CharacterAlias, snapshots, lean BattleNetAccount / AccountCharacter
- Provenance: ExternalRequest, ExternalPayload, RawArtifact
- Runs: MythicRun, RunSourceReference, RunParticipant, RunAnalysis
- Metrics: MetricDefinition, MetricObservation, MechanicRule
- Scores: ScoreModel, ScoreSnapshot, DimensionScore, red flags, ScoreDispute
- Ops: IngestionJob, User, Entitlement, AddonExport

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
