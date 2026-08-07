import type { PrismaClient } from "@mplus/database";
import {
  createArtifactRepository,
  EvidenceRepository,
  WclSourceRepository,
  CapabilityEvidencePackageRepository,
  ParticipantScoringDigestRepository,
  type ArtifactRepository,
} from "@mplus/database";
import { createLocalFsArtifactStore } from "@mplus/artifact-store";
import { createAddonExportRepository, type AddonExportRepository } from "./addon-export-repository.js";
import {
  createAnalysisBatchRepository,
  type AnalysisBatchRepository,
} from "./analysis-batch-repository.js";
import {
  createBulkOperationRepository,
  type BulkOperationRepository,
} from "./bulk-operation-repository.js";
import { createCharacterRepository, type CharacterRepository } from "./character-repository.js";
import {
  createEvidenceV2BatchRepository,
  type EvidenceV2BatchRepository,
} from "./evidence-v2-batch-repository.js";
import {
  createExternalRequestRepository,
  type ExternalRequestRepository,
} from "./external-request-repository.js";
import { createJobRepository, type JobRepository } from "./job-repository.js";
import { createMechanicRuleRepository, type MechanicRuleRepository } from "./mechanic-rule-repository.js";
import { createMetricRepository, type MetricRepository } from "./metric-repository.js";
import {
  createProviderStateRepository,
  type ProviderStateRepository,
} from "./provider-state-repository.js";
import { createRealmRepository, type RealmRepository } from "./realm-repository.js";
import { createRunRepository, type RunRepository } from "./run-repository.js";
import { createScoreRepository, type ScoreRepository } from "./score-repository.js";

export interface WorkerRepositories {
  character: CharacterRepository;
  realm: RealmRepository;
  run: RunRepository;
  metric: MetricRepository;
  score: ScoreRepository;
  job: JobRepository;
  externalRequest: ExternalRequestRepository;
  addonExport: AddonExportRepository;
  mechanicRule: MechanicRuleRepository;
  providerState: ProviderStateRepository;
  analysisBatch: AnalysisBatchRepository;
  bulkOperation: BulkOperationRepository;
  evidence: EvidenceRepository;
  artifacts: ArtifactRepository;
  evidenceV2Batch: EvidenceV2BatchRepository;
  wclSource: WclSourceRepository;
  capabilityEvidencePackages: CapabilityEvidencePackageRepository;
  participantScoringDigests: ParticipantScoringDigestRepository;
}

export function createRepositories(
  prisma: PrismaClient,
  options?: { rawArtifactsDir?: string },
): WorkerRepositories {
  const legacyFsStore = options?.rawArtifactsDir
    ? createLocalFsArtifactStore(options.rawArtifactsDir)
    : undefined;
  const artifacts = createArtifactRepository(prisma, { legacyFsStore });
  return {
    character: createCharacterRepository(prisma),
    realm: createRealmRepository(prisma),
    run: createRunRepository(prisma),
    metric: createMetricRepository(prisma),
    score: createScoreRepository(prisma),
    job: createJobRepository(prisma),
    externalRequest: createExternalRequestRepository(prisma),
    addonExport: createAddonExportRepository(prisma),
    mechanicRule: createMechanicRuleRepository(prisma),
    providerState: createProviderStateRepository(prisma),
    analysisBatch: createAnalysisBatchRepository(prisma),
    bulkOperation: createBulkOperationRepository(prisma),
    evidence: new EvidenceRepository(prisma),
    artifacts,
    evidenceV2Batch: createEvidenceV2BatchRepository(prisma),
    wclSource: new WclSourceRepository(prisma),
    capabilityEvidencePackages: new CapabilityEvidencePackageRepository(
      prisma,
      artifacts,
    ),
    participantScoringDigests: new ParticipantScoringDigestRepository(
      prisma,
      artifacts,
    ),
  };
}


export * from "./addon-export-repository.js";
export * from "./analysis-batch-repository.js";
export * from "./bulk-operation-repository.js";
export * from "./character-repository.js";
export * from "./evidence-v2-batch-repository.js";
export * from "./external-request-repository.js";
export * from "./job-repository.js";
export * from "./job-staleness.js";
export * from "./mechanic-rule-repository.js";
export * from "./metric-repository.js";
export * from "./provider-state-repository.js";
export * from "./realm-repository.js";
export * from "./refresh-schedule-repository.js";
export * from "./run-repository.js";
export * from "./score-repository.js";
