---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Data model, persistence, retention, and reset strategy

## 1. Design rules

- PostgreSQL stores canonical metadata, normalized facts, metrics, states, and immutable score records.
- Large raw WCL responses are content-addressed compressed artifacts.
- JSONB is acceptable for bounded versioned documents, not unbounded event arrays.
- Published scores retain all input references required for replay.
- Test data may be destructively reset, but migrations and seed procedures remain deterministic.

## 2. Current model audit

Useful current concepts to preserve or adapt:

- `Character`, `Season`, `Dungeon`, `SeasonDungeon`;
- `ExternalRequest`, `ExternalPayload`, `RawArtifact`;
- `MythicRun`, `RunSourceReference`, `RunParticipant`;
- `RunAnalysis`, `MetricObservation`;
- `ScoreModel`, `ScoreSnapshot`, `DimensionScore`;
- `ScoreAnalysisBatch`, `ScoreAnalysisBatchRun`;
- `CharacterPublishedScore`;
- calibration cohorts/runs/reports from the draft calibration feature.

Problems to remove:

- competing run-selection semantics;
- large event datasets embedded in `RunAnalysis.summary`;
- score confidence based on WCL profile run count rather than detailed evidence;
- model-specific evidence selection;
- ambiguous overwrite of versioned summaries.

## 3. Proposed core entities

### 3.1 Evidence manifest

```prisma
model EvidenceManifest {
  id                    String   @id @default(uuid()) @db.Uuid
  characterId           String   @db.Uuid
  seasonId              String   @db.Uuid
  specializationId      String?  @db.Uuid
  role                  CharacterRole
  refreshContractHash   String
  selectorVersion       String
  highKeyPolicyId       String   @db.Uuid
  evidenceCutoffAt      DateTime @db.Timestamptz(3)
  expectedSlotCount     Int
  selectedSlotCount     Int
  coverageState         String
  schemaVersion         String
  contentHash           String   @unique
  document              Json
  frozenAt              DateTime @db.Timestamptz(3)

  slots                 EvidenceManifestSlot[]
}
```

### 3.2 Manifest slots

```prisma
model EvidenceManifestSlot {
  id                    String   @id @default(uuid()) @db.Uuid
  manifestId            String   @db.Uuid
  dungeonId             String   @db.Uuid
  slotIndex             Int
  runId                 String?  @db.Uuid
  reportCode            String?
  fightId               Int?
  reportRevision        Int?
  keyLevel              Int?
  candidateRank         Int?
  state                 String
  selectionReason       String?
  dimensionValidity     Json
  invalidReasons        Json
  providerDataAsOf      DateTime? @db.Timestamptz(3)

  @@unique([manifestId, dungeonId, slotIndex])
  @@unique([manifestId, reportCode, fightId])
}
```

### 3.3 WCL report/fight metadata

Optional normalized records reduce repeated JSON parsing:

```prisma
model WclReportRevision {
  id          String @id @default(uuid()) @db.Uuid
  reportCode  String
  revision    Int
  visibility  String
  archiveState String?
  startTimeMs BigInt
  endTimeMs   BigInt
  zoneId      Int?
  masterDataArtifactId String? @db.Uuid
  metadataHash String
  fetchedAt   DateTime @db.Timestamptz(3)

  @@unique([reportCode, revision])
}
```

### 3.4 Dataset artifacts

```prisma
model EvidenceDataset {
  id                    String @id @default(uuid()) @db.Uuid
  manifestSlotId        String @db.Uuid
  datasetKey            String
  /** Logical identity shared across refreshes — indexed, not globally unique. */
  compatibilityKey      String
  artifactId            String? @db.Uuid
  schemaVersion         String
  providerContractVersion String
  state                 String
  eventCount            Int
  pageCount             Int
  truncated             Boolean
  pointsConsumed        Float?
  costSource            String
  payloadFingerprint    String?
  fetchedAt             DateTime? @db.Timestamptz(3)

  @@unique([manifestSlotId, datasetKey])
  @@index([compatibilityKey])
}
```

**Acquisition → finalize persistence contract (provider-free):**

1. During slot acquisition (before the frozen manifest exists), capture bounded
   `AcquiredEvidenceDatasetDescriptor` rows on the batch slot record for every
   shared event dataset used by typed extractors. Descriptors reference already
   persisted `RawArtifact` ids and page fingerprints — they never synthesize
   raw pages or fake dataset content.
2. After `createFrozenManifest`, bind descriptors to the exact
   `EvidenceManifestSlot` by `reportCode + fightId + reportRevision` and write
   `EvidenceDataset` rows. Each frozen slot keeps its own auditable descriptor
   row (`@@unique([manifestSlotId, datasetKey])`).
3. `compatibilityKey` is a **logical** identity shared across refreshes
   (report/fight/revision/kind/contract). It is indexed, not globally unique.
   Same compatibilityKey + same immutable content → create a new slot-owned
   binding that references the same artifact. Same compatibilityKey + different
   content → fail closed. Redelivery of the same slot is idempotent.
4. `EvidenceDatasetPage` rows are scoring-neutral and durable by report
   identity (`datasetId` nullable). Finalization may attach `datasetId` only to
   still-unlinked pages; pages already linked to an older descriptor remain
   discoverable by `reportCode+fightId+reportRevision+datasetKey`. Never
   fabricates pages and never calls WCL.

### 3.5 Normalized fact sets

```prisma
model RunFactSet {
  id                String @id @default(uuid()) @db.Uuid
  manifestSlotId    String @db.Uuid
  characterId       String @db.Uuid
  runId             String? @db.Uuid
  extractorFamily   String
  extractorVersion  String
  schemaVersion     String
  inputFingerprint  String
  facts             Json
  coverage          Json
  limitations       Json
  computedAt        DateTime @db.Timestamptz(3)

  @@unique([manifestSlotId, extractorFamily, extractorVersion, inputFingerprint])
}
```

Fact documents are bounded and contain compact facts, not raw pages.

### 3.6 Dimension computations

```prisma
model DimensionComputation {
  id                 String @id @default(uuid()) @db.Uuid
  characterId        String @db.Uuid
  seasonId           String @db.Uuid
  manifestId         String @db.Uuid
  scoreModelId       String @db.Uuid
  dimension          ScoreDimension
  algorithmVersion   String
  inputFingerprint   String
  score              Decimal? @db.Decimal(8,4)
  confidence         Decimal @db.Decimal(5,4)
  state              String
  metrics             Json
  explanation         Json
  computedAt          DateTime @db.Timestamptz(3)

  @@unique([characterId, seasonId, manifestId, scoreModelId, dimension])
}
```

`ScoreSnapshot` may continue as the immutable overall/publication record, referencing the four dimension computation IDs and manifest.

## 4. Artifact storage

Preferred production storage:

- S3-compatible object storage or durable filesystem abstraction;
- content-addressed URI;
- ZSTD or GZIP compression;
- SHA-256 content hash;
- size and retention metadata;
- optional envelope encryption.

In test, local filesystem storage is acceptable through the same interface.

Artifact classes:

- raw provider response;
- WCL event page;
- WCL table payload;
- master data;
- calibration frozen export;
- admin downloadable diagnostics.

## 5. Retention

### Permanent while referenced

- published score inputs;
- active calibration bundles/reports;
- disputed score evidence;
- current manifest and fact sets;
- model activation audit.

### Long retention

- selected WCL raw artifacts;
- normalized fact sets;
- superseded public score inputs.

### Short retention

- rejected candidate metadata;
- unsuccessful/partial pages;
- negative caches;
- non-selected raw candidate reports;
- transient debugging artifacts.

Retention deletion uses reference counting or explicit dependency checks. Never delete by age alone when a published/calibration reference exists.

## 6. Destructive test reset

Because the product is in test, the preferred cutover may be a clean reset rather than complex compatibility migration.

Required reset procedure:

1. export schema, active configuration, ability catalogs, and required fixtures;
2. back up test database;
3. stop workers/API writes;
4. deploy target migrations;
5. truncate or recreate provider/evidence/score tables;
6. reseed static catalogs, season bindings, admin/IAM;
7. reimport calibration cohort labels;
8. rerun selected character fixtures;
9. validate publication and rollback;
10. retain backup until acceptance.

Identity/user/account tables should be preserved unless the reset plan explicitly includes them.

## 7. Legacy handling options

### Option A — hard test cutover, recommended

- keep identity, IAM, season/dungeon/static catalogs;
- drop legacy run-analysis/metric/score data;
- rebuild from V2 evidence;
- preserve calibration labels, not old observed results.

### Option B — dual-write shadow

- write V1 and V2;
- compare;
- cut over after calibration;
- delete V1 later.

Use Option B when live user continuity becomes important. During current test, Option A is simpler after V2 is proven on fixtures.

## 8. Data integrity constraints

- manifest immutable after freeze;
- slot report/fight unique inside manifest;
- report revision non-null for finalized selected slot;
- fact set references exact dataset fingerprints;
- dimension computation references one manifest;
- score snapshot references dimension computations from the same manifest/model;
- public pointer references only published/eligible snapshot;
- calibration bundle hash and byte length verified before replay.

## 9. Indexes

At minimum:

- manifest by character/season/frozenAt;
- slot by manifest/dungeon/slot;
- dataset by compatibility key;
- fact set by slot/family/version;
- dimension by character/season/model/computedAt;
- artifact by content hash;
- request by provider/endpoint/requestedAt;
- report revision by reportCode/revision;
- analysis batch by state/updatedAt.

## 10. Database size monitoring

Track:

- raw artifact bytes by provider/dataset;
- JSONB row sizes;
- fact-set average/percentiles;
- orphan artifact count;
- selected versus rejected candidate storage;
- bytes per character refresh;
- retention deletion throughput.
