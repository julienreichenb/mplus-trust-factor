/**
 * Provider-free Scoring V2 canary replay.
 * Loads frozen manifest + persisted packages/digests; scores via
 * runAuthoritativeScoring({ forceProviderFree:true, persistCharacterScore:false }).
 * Zero provider calls. No CharacterScore write. No publication.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import {
  OBSERVATION_SCHEMA_VERSION,
  RUN_SELECTION_VERSION,
  expectedEvidenceSlotCount,
  type EvidenceRole,
} from "@mplus/contracts";
import {
  evidenceManifestAnalysisStatus,
  type ExperiencePhase1Result,
} from "@mplus/scoring";
import { assertPublicationBlocked } from "../acquisition.js";
import type { WorkerContainer } from "../../../container.js";
import {
  candidatesFromFrozenManifest,
  loadCompatibleFrozenManifest,
} from "./canary-live.js";
import type { CanarySeasonResolution } from "./canary-season.js";
import { createProductionRunOrchestrationPorts } from "../run-orchestration/production-ports.js";
import {
  sourceFightKey,
  type RunOrchestrationPorts,
  type RunOrchestrationResult,
} from "../run-orchestration/orchestrator.js";
import { createMemoryOrchestrationPorts } from "../run-orchestration/memory-ports.js";
import { runAuthoritativeScoring } from "../refresh-bridge.js";
import type { ScoreCharacterResult } from "../score-character.js";
import {
  buildCanaryAuthoritativeComposite,
  buildCanaryAuthoritativeDimensions,
  buildEvidenceCoverageDiagnostic,
  type CanaryAuthoritativeCompositeReport,
  type CanaryAuthoritativeDimensionReport,
  type CanaryEvidenceCoverageDiagnostic,
} from "./canary-authoritative-report.js";

export const CANARY_REPLAY_SCHEMA = "scoring-canary-replay-v2" as const;

export interface CanaryReplayReport {
  schemaVersion: typeof CANARY_REPLAY_SCHEMA;
  replayMode: "PROVIDER_FREE";
  scoringAuthority: "runAuthoritativeScoring";
  forceProviderFree: true;
  persistCharacterScore: false;
  manifestId: string;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  selectedSlotCount: number;
  expectedSlotCount: number;
  analysisStatus: "EMPTY" | "PARTIAL" | "COMPLETE";
  packagesReused: number;
  packagesCreated: number;
  packageAcquisitions: 0;
  participantDigestsCreated: number;
  participantDigestsReused: number;
  wallidrixeDigestCount: number;
  targetDigestFailures: RunOrchestrationResult["targetDigestFailures"];
  performanceDigestDiagnostics: RunOrchestrationResult["dimensions"]["performanceDigestDiagnostics"];
  dimensions: {
    performance: CanaryAuthoritativeDimensionReport;
    survival: CanaryAuthoritativeDimensionReport;
    utility: CanaryAuthoritativeDimensionReport;
    experience: CanaryAuthoritativeDimensionReport;
  };
  composite: CanaryAuthoritativeCompositeReport;
  confidence: number;
  /** Legacy coverage diagnostic only — not scoring confidence. */
  evidenceCoverageDiagnostic: CanaryEvidenceCoverageDiagnostic;
  explainabilityFingerprint: string;
  providerCalls: 0;
  characterScoreWrites: 0;
  publicationEnabled: false;
  publicScorePointerMutated: false;
}

export async function runScoringCanaryReplay(input: {
  env: AppEnv;
  prisma: PrismaClient;
  container: WorkerContainer;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  classSlug: string | null;
  specSlug: string | null;
  role: EvidenceRole;
  season: CanarySeasonResolution;
  repositoryMode: "PRODUCTION" | "MEMORY";
  portsOverride?: RunOrchestrationPorts;
  outputDir?: string;
  scoringModelId?: string;
  scoringModelVersion?: number;
  experienceOverride?: ExperiencePhase1Result | null;
}): Promise<{
  report: CanaryReplayReport;
  reportPath: string;
  scoreResult: ScoreCharacterResult;
}> {
  assertPublicationBlocked(input.env);

  const season = input.season;
  if (
    season.validationStatus !== "OK" ||
    !season.seasonId ||
    !season.seasonSlug ||
    season.activeDungeonSlugs.length === 0 ||
    !season.dungeonPoolHash
  ) {
    throw Object.assign(new Error("replay_requires_validated_active_season"), {
      code: "SEASON_CATALOG_MISMATCH",
    });
  }

  const frozen = await loadCompatibleFrozenManifest({
    prisma: input.prisma,
    characterId: input.characterId,
    seasonId: season.seasonId,
    expectedDungeonSlugs: season.activeDungeonSlugs,
    dungeonPoolHash: season.dungeonPoolHash,
  });
  if (!frozen) {
    throw Object.assign(new Error("replay_manifest_not_available"), {
      code: "REPLAY_MANIFEST_NOT_AVAILABLE",
    });
  }

  const expectedSlotCount = expectedEvidenceSlotCount(
    season.activeDungeonSlugs.length,
  );

  const basePorts: RunOrchestrationPorts =
    input.portsOverride ??
    (input.repositoryMode === "MEMORY"
      ? createMemoryOrchestrationPorts()
      : createProductionRunOrchestrationPorts({
          prisma: input.prisma,
          artifacts: input.container.repositories.artifacts,
          evidence: input.container.repositories.evidence,
          // No liveAcquireCapabilityPackage — provider forbidden.
          targetCharacter: {
            characterId: input.characterId,
            characterName: input.characterName,
            realmSlug: input.realm,
            regionCode: input.region,
            classSlug: input.classSlug,
            specSlug: input.specSlug,
            role: input.role,
          },
        }));

  // Do not mutate caller-owned ports — wrap acquire for this replay only.
  const replayPorts: RunOrchestrationPorts = {
    ...basePorts,
    acquireAndPersistCapabilityPackage: async () => {
      throw Object.assign(new Error("replay_acquire_forbidden"), {
        code: "REPLAY_ACQUIRE_FORBIDDEN",
      });
    },
  };

  const zoneId = season.configuredZoneId;
  if (zoneId == null || !Number.isFinite(zoneId) || zoneId <= 0) {
    throw Object.assign(new Error("canary_replay_requires_wcl_zone_id"), {
      code: "CANARY_ZONE_ID_REQUIRED",
    });
  }

  const scoreModelId = input.scoringModelId ?? "canary-shadow-model";
  const scoreModelVersion = input.scoringModelVersion ?? 1;

  const outcome = await runAuthoritativeScoring({
    container: input.container,
    characterId: input.characterId,
    seasonId: season.seasonId,
    seasonSlug: season.seasonSlug,
    role: input.role,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    refreshContract: {
      scoringModelKey: scoreModelId,
      scoringModelVersion: scoreModelVersion,
      observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
      wclAdapterVersion: "points-and-damage-v1",
      blizzardAdapterVersion: "blizzard-v1",
      raiderIoAdapterVersion: "raiderio-v1",
      runSelectionVersion: RUN_SELECTION_VERSION,
      abilityCatalogVersion: "abilities-v1",
      mechanicCatalogVersion: "mechanics-v1",
      activeSeasonId: season.seasonSlug,
      zoneId,
      partition: null,
    },
    evidenceCutoffAt:
      frozen.document.evidenceCutoffAt ?? "2099-01-01T00:00:00.000Z",
    highKeyPolicyId: frozen.document.highKeyPolicyId ?? "canary-replay-v1",
    activeDungeonSlugs: [...season.activeDungeonSlugs],
    candidates: candidatesFromFrozenManifest(frozen.document),
    scoreModelKey: scoreModelId,
    scoreModelVersion,
    scoreModelId,
    calculatedAt: new Date().toISOString(),
    region: input.region,
    realm: input.realm,
    characterName: input.characterName,
    persistCharacterScore: false,
    forceProviderFree: true,
    existingManifest: frozen.document,
    portsOverride: replayPorts,
    experienceOverride: input.experienceOverride,
    performanceAggregateProviderOverride: null,
  });

  if (!outcome.scoreResult) {
    throw Object.assign(new Error("replay_authoritative_scoring_empty"), {
      code: "REPLAY_AUTHORITATIVE_EMPTY",
    });
  }

  const scoreResult = outcome.scoreResult;
  const result = scoreResult.orchestration;

  if (outcome.providerCalls !== 0) {
    throw Object.assign(
      new Error(`replay_nonzero_provider_calls:${outcome.providerCalls}`),
      { code: "REPLAY_PROVIDER_CALLS_NONZERO" },
    );
  }
  if (result.accounting.packagesCreated !== 0) {
    throw Object.assign(
      new Error(`replay_packages_created:${result.accounting.packagesCreated}`),
      { code: "REPLAY_PACKAGE_CREATED" },
    );
  }
  if (scoreResult.characterScoreId != null) {
    throw Object.assign(new Error("replay_character_score_write_forbidden"), {
      code: "REPLAY_CHARACTER_SCORE_WRITE",
    });
  }

  const dimensions = buildCanaryAuthoritativeDimensions(scoreResult.explainability);
  const composite = buildCanaryAuthoritativeComposite(scoreResult.explainability);
  const evidenceCoverageDiagnostic = buildEvidenceCoverageDiagnostic({
    orchestration: result,
    targetRunCount: expectedSlotCount,
    activeDungeonSlugs: season.activeDungeonSlugs,
  });

  const report: CanaryReplayReport = {
    schemaVersion: CANARY_REPLAY_SCHEMA,
    replayMode: "PROVIDER_FREE",
    scoringAuthority: "runAuthoritativeScoring",
    forceProviderFree: true,
    persistCharacterScore: false,
    manifestId: frozen.rowId,
    characterId: input.characterId,
    characterName: input.characterName,
    region: input.region,
    realm: input.realm,
    selectedSlotCount: result.selectedSlotCount,
    expectedSlotCount,
    analysisStatus: evidenceManifestAnalysisStatus({
      selectedSlotCount: result.characterDigests.length,
      targetRunCount: expectedSlotCount,
    }),
    packagesReused: result.accounting.packagesReused,
    packagesCreated: result.accounting.packagesCreated,
    packageAcquisitions: 0,
    participantDigestsCreated: result.accounting.digestsCreated,
    participantDigestsReused: result.accounting.digestsReused,
    wallidrixeDigestCount: result.characterDigests.length,
    targetDigestFailures: result.targetDigestFailures,
    performanceDigestDiagnostics:
      result.dimensions.performanceDigestDiagnostics,
    dimensions,
    composite,
    confidence: composite.confidence,
    evidenceCoverageDiagnostic,
    explainabilityFingerprint: scoreResult.explainability.fingerprint,
    providerCalls: 0,
    characterScoreWrites: 0,
    publicationEnabled: false,
    publicScorePointerMutated: false,
  };

  void sourceFightKey;

  const outDir =
    input.outputDir ?? join(process.cwd(), "artifacts", "scoring-canary");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(
    outDir,
    `replay-${input.region.toLowerCase()}-${input.realm.toLowerCase()}-${input.characterName}.json`,
  );
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { report, reportPath, scoreResult };
}
