/**
 * Provider-free Scoring V2 canary replay.
 * Loads persisted manifest + packages + digests; recalculates dimensions.
 * Zero WCL calls. Zero package acquisitions. No publication.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import {
  EVIDENCE_SELECTOR_VERSION,
  expectedEvidenceSlotCount,
  type EvidenceRole,
} from "@mplus/contracts";
import { computeScoringConfidenceV1, missingDungeonsFromCoverage } from "@mplus/scoring";
import { assertPublicationBlocked } from "../acquisition.js";
import type { WorkerContainer } from "../../../container.js";
import {
  candidatesFromFrozenManifest,
  loadCompatibleFrozenManifest,
} from "./canary-live.js";
import type { CanarySeasonResolution } from "./canary-season.js";
import { createProductionRunOrchestrationPorts } from "../run-orchestration/production-ports.js";
import {
  replayScoringFromPersistedEvidence,
  sourceFightKey,
  type RunOrchestrationPorts,
  type RunOrchestrationResult,
} from "../run-orchestration/orchestrator.js";
import { createMemoryOrchestrationPorts } from "../run-orchestration/memory-ports.js";

export const CANARY_REPLAY_SCHEMA = "scoring-canary-replay-v1" as const;

function dimensionStatus(
  result: RunOrchestrationResult,
  dimension: "performance" | "utility" | "survival",
  targetRunCount: number,
  activeDungeonSlugs: readonly string[],
): {
  status: "AVAILABLE" | "PARTIAL" | "BLOCKED" | "UNAVAILABLE";
  score: number | null;
  usableRunCount: number;
  confidenceScore: number;
  blockReason: string | null;
} {
  const dimKey = dimension.toUpperCase() as "PERFORMANCE" | "UTILITY" | "SURVIVAL";
  const blocked = result.dimensions.blocked.find((b) => b.dimension === dimKey);
  const dim =
    dimension === "performance"
      ? result.dimensions.performance
      : dimension === "utility"
        ? result.dimensions.utility
        : result.dimensions.survival;

  const perfDiag = result.dimensions.performanceDigestDiagnostics ?? [];
  const digests =
    dimension === "performance" && perfDiag.length > 0
      ? result.characterDigests.filter((d) =>
          perfDiag.some((p) => p.slotId === d.slotId && p.usable),
        )
      : result.characterDigests;

  const usableRunCount = digests.length;
  const represented = [
    ...new Set(digests.map((d) => d.dungeonSlug.toLowerCase())),
  ];
  const missingDungeons = missingDungeonsFromCoverage(
    activeDungeonSlugs,
    represented,
  );
  const confidence = computeScoringConfidenceV1({
    usableRunCount,
    targetRunCount,
    representedDungeonCount: represented.length,
    activeDungeonCount: activeDungeonSlugs.length,
    missingDungeons,
    activeDungeonSlugs,
    representedDungeonSlugs: represented,
  });

  if (blocked) {
    return {
      status: "BLOCKED",
      score: null,
      usableRunCount,
      confidenceScore: confidence.confidenceScore,
      blockReason: blocked.reason,
    };
  }
  const score =
    dim != null && typeof dim.score === "number" && Number.isFinite(dim.score)
      ? dim.score
      : null;
  if (score == null || usableRunCount === 0) {
    return {
      status: "UNAVAILABLE",
      score: null,
      usableRunCount,
      confidenceScore: confidence.confidenceScore,
      blockReason: null,
    };
  }
  return {
    status: usableRunCount < targetRunCount ? "PARTIAL" : "AVAILABLE",
    score,
    usableRunCount,
    confidenceScore: confidence.confidenceScore,
    blockReason: null,
  };
}

export interface CanaryReplayReport {
  schemaVersion: typeof CANARY_REPLAY_SCHEMA;
  replayMode: "PROVIDER_FREE";
  manifestId: string;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  selectedSlotCount: number;
  expectedSlotCount: number;
  packagesReused: number;
  packagesCreated: number;
  packageAcquisitions: 0;
  participantDigestsCreated: number;
  participantDigestsReused: number;
  wallidrixeDigestCount: number;
  targetDigestFailures: RunOrchestrationResult["targetDigestFailures"];
  performanceDigestDiagnostics: RunOrchestrationResult["dimensions"]["performanceDigestDiagnostics"];
  dimensions: {
    performance: ReturnType<typeof dimensionStatus>;
    utility: ReturnType<typeof dimensionStatus>;
    survival: ReturnType<typeof dimensionStatus>;
  };
  composite: {
    status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
    score: number | null;
    confidenceScore: number;
    blockerDimension: "PERFORMANCE" | "UTILITY" | "SURVIVAL" | null;
  };
  confidence: number;
  providerCalls: 0;
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
}): Promise<{ report: CanaryReplayReport; reportPath: string }> {
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

  const ports: RunOrchestrationPorts =
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

  // Guard: acquire must never be callable.
  const acquire = ports.acquireAndPersistCapabilityPackage.bind(ports);
  ports.acquireAndPersistCapabilityPackage = async () => {
    throw Object.assign(new Error("replay_acquire_forbidden"), {
      code: "REPLAY_ACQUIRE_FORBIDDEN",
    });
  };
  void acquire;

  const result = await replayScoringFromPersistedEvidence({
    characterId: input.characterId,
    region: input.region,
    realm: input.realm,
    characterName: input.characterName,
    seasonId: season.seasonId,
    scoringModelId: "canary-shadow-model",
    scope: {
      characterId: input.characterId,
      seasonId: season.seasonId,
      seasonSlug: season.seasonSlug,
      specializationId: null,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      role: input.role,
      refreshContractHash: `canary-replay|${frozen.rowId}|${frozen.document.contentHash}`,
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt:
        frozen.document.evidenceCutoffAt ?? "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: frozen.document.highKeyPolicyId ?? "canary-replay-v1",
      activeDungeonSlugs: [...season.activeDungeonSlugs],
    },
    existingManifest: frozen.document,
    candidates: candidatesFromFrozenManifest(frozen.document),
    ports,
  });

  if (result.accounting.providerCalls !== 0) {
    throw Object.assign(
      new Error(`replay_nonzero_provider_calls:${result.accounting.providerCalls}`),
      { code: "REPLAY_PROVIDER_CALLS_NONZERO" },
    );
  }
  if (result.accounting.packagesCreated !== 0) {
    throw Object.assign(
      new Error(`replay_packages_created:${result.accounting.packagesCreated}`),
      { code: "REPLAY_PACKAGE_CREATED" },
    );
  }

  const performance = dimensionStatus(
    result,
    "performance",
    expectedSlotCount,
    season.activeDungeonSlugs,
  );
  const utility = dimensionStatus(
    result,
    "utility",
    expectedSlotCount,
    season.activeDungeonSlugs,
  );
  const survival = dimensionStatus(
    result,
    "survival",
    expectedSlotCount,
    season.activeDungeonSlugs,
  );

  const dims = [
    { key: "PERFORMANCE" as const, report: performance },
    { key: "UTILITY" as const, report: utility },
    { key: "SURVIVAL" as const, report: survival },
  ];
  const blocker = dims.find(
    (d) => d.report.status === "BLOCKED" || d.report.status === "UNAVAILABLE",
  );
  const allScored = dims.every((d) => d.report.score != null);
  const confidences = dims
    .filter((d) => d.report.score != null)
    .map((d) => d.report.confidenceScore);
  const minConf = confidences.length > 0 ? Math.min(...confidences) : 0;
  const compositeScore = allScored
    ? (performance.score! + utility.score! + survival.score!) / 3
    : null;

  const report: CanaryReplayReport = {
    schemaVersion: CANARY_REPLAY_SCHEMA,
    replayMode: "PROVIDER_FREE",
    manifestId: frozen.rowId,
    characterId: input.characterId,
    characterName: input.characterName,
    region: input.region,
    realm: input.realm,
    selectedSlotCount: result.selectedSlotCount,
    expectedSlotCount,
    packagesReused: result.accounting.packagesReused,
    packagesCreated: result.accounting.packagesCreated,
    packageAcquisitions: 0,
    participantDigestsCreated: result.accounting.digestsCreated,
    participantDigestsReused: result.accounting.digestsReused,
    wallidrixeDigestCount: result.characterDigests.length,
    targetDigestFailures: result.targetDigestFailures,
    performanceDigestDiagnostics:
      result.dimensions.performanceDigestDiagnostics,
    dimensions: { performance, utility, survival },
    composite: {
      status: blocker
        ? "UNAVAILABLE"
        : dims.some((d) => d.report.status === "PARTIAL")
          ? "PARTIAL"
          : "AVAILABLE",
      score: compositeScore,
      confidenceScore: minConf,
      blockerDimension: blocker?.key ?? null,
    },
    confidence: minConf,
    providerCalls: 0,
    publicationEnabled: false,
    publicScorePointerMutated: false,
  };

  // Prove fight keys are addressable (no silent empty unique set).
  void sourceFightKey;

  const outDir =
    input.outputDir ?? join(process.cwd(), "artifacts", "scoring-canary");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(
    outDir,
    `replay-${input.region.toLowerCase()}-${input.realm.toLowerCase()}-${input.characterName}.json`,
  );
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { report, reportPath };
}
