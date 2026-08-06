/**
 * Executable Scoring V2 live capability canary.
 *
 * Loads a compatible frozen evidence manifest (no discovery / reselection),
 * admits missing capability packages against the rate snapshot, acquires via
 * the production live adapter, calculates dimensions, then provider-free replays.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import {
  EVIDENCE_SELECTOR_VERSION,
  expectedEvidenceSlotCount,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceCandidateMetadataV2,
  type EvidenceRole,
  type EvidenceSelectionScope,
} from "@mplus/contracts";
import {
  computeScoringConfidenceV1,
  evidenceManifestAnalysisStatus,
  missingDungeonsFromCoverage,
  overallConfidenceFromDimensions,
  type ScoringConfidenceV1,
} from "@mplus/scoring";
import type { RateBudgetConfig } from "@mplus/provider-warcraftlogs";
import { LiveWarcraftLogsProvider } from "@mplus/provider-warcraftlogs";
import type { CanaryCharacterResolution, CanaryRepositoryMode } from "./canary-deps.js";
import type { CanarySeasonResolution } from "./canary-season.js";
import {
  bootstrapCanaryRateLimitSnapshot,
  fetchCanaryRateLimitSnapshotLive,
  type CanaryRateSnapshotBootstrapReport,
} from "./canary-rate-snapshot.js";
import { isManifestCompatibleWithSeasonPool } from "../run-orchestration/canary-preflight.js";
import {
  buildCanaryCostProjection,
  assertCostAdmissionAllowsLive,
  type CanaryCostProjection,
} from "../run-orchestration/cost-admission.js";
import {
  createLiveCapabilityAcquireHook,
  evaluateLiveCapabilityPermission,
  CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT,
  type LiveCapabilityAcquireResult,
} from "../run-orchestration/live-capability-adapter.js";
import { createProductionRunOrchestrationPorts } from "../run-orchestration/production-ports.js";
import { createRedisSourceFightLock } from "../run-orchestration/source-fight-lease.js";
import {
  fingerprintDimensionResults,
  orchestrateScoringV2Runs,
  replayScoringV2FromPersistedEvidence,
  sourceFightKey,
  uniqueSourceFightsFromManifest,
  type LiveProviderPermission,
  type OrchestrationParticipant,
  type RunOrchestrationPorts,
  type RunOrchestrationResult,
  type SourceFightIdentity,
} from "../run-orchestration/orchestrator.js";
import type { WorkerContainer } from "../../../container.js";
import { assertPublicationBlocked } from "../acquisition.js";

export const CANARY_LIVE_REPORT_SCHEMA = "scoring-v2-canary-live-v1" as const;

export interface CanaryLiveDimensionReport {
  status: "AVAILABLE" | "PARTIAL" | "BLOCKED" | "UNAVAILABLE";
  score: number | null;
  usableRunCount: number;
  targetRunCount: number;
  representedDungeonCount: number;
  missingDungeons: string[];
  confidenceScore: number;
  confidenceBand: ScoringConfidenceV1["confidenceBand"];
  unavailableReason: string | null;
  inputDigestIds: string[];
  inputDigestFingerprints: string[];
  blockReason: string | null;
}

export type CanaryLiveCommandOutcome =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "FAILURE";

export interface CanaryLiveReport {
  schemaVersion: typeof CANARY_LIVE_REPORT_SCHEMA;
  repositoryMode: CanaryRepositoryMode;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  charactersProcessed: 1;
  commandOutcome: CanaryLiveCommandOutcome;
  manifestId: string;
  selectedSlotCount: number;
  expectedSlotCount: number;
  analysisStatus: "EMPTY" | "PARTIAL" | "COMPLETE";
  selectedFights: Array<{
    slotId: string;
    dungeonSlug: string;
    reportCode: string;
    fightId: number;
    reportRevision: number;
  }>;
  packageCacheHits: number;
  packageCacheMisses: number;
  capabilityAcquisitionsAttempted: number;
  capabilityAcquisitionsSucceeded: number;
  capabilityAcquisitionsFailed: number;
  graphqlRequestCount: number;
  eventPageRequestCount: number;
  measuredWclPoints: number | null;
  estimatedWclPoints: number | null;
  fightFailures: RunOrchestrationResult["fightFailures"];
  packagesCreated: number;
  packagesReused: number;
  participantDigestsCreated: number;
  participantDigestsReused: number;
  wallidrixeDigestCount: number;
  dimensions: {
    performance: CanaryLiveDimensionReport;
    utility: CanaryLiveDimensionReport;
    survival: CanaryLiveDimensionReport;
  };
  composite: {
    status:
      | "AVAILABLE"
      | "PARTIAL"
      | "AVAILABLE_WITH_PARTIAL_EVIDENCE"
      | "UNAVAILABLE";
    score: number | null;
    confidence: ScoringConfidenceV1;
    blockerDimension: "PERFORMANCE" | "UTILITY" | "SURVIVAL" | null;
  };
  confidence: ScoringConfidenceV1;
  rateAdmission: CanaryCostProjection["rateLimit"]["admission"];
  rateAdmissionReasons: string[];
  bootstrap: CanaryRateSnapshotBootstrapReport | null;
  costProjection: CanaryCostProjection | null;
  replayProviderCalls: number;
  replayPackagesCreated: number;
  replayFingerprintEqual: boolean;
  replayScoresEqual: boolean;
  replayConfidenceEqual: boolean;
  publicationEnabled: false;
  publicScorePointerMutated: false;
  orchestratorExecuted: true;
  liveProviderPermission: LiveProviderPermission;
}

export interface RunCanaryLiveInput {
  prisma: PrismaClient;
  container: WorkerContainer;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  characterResolution: CanaryCharacterResolution;
  seasonResolution: CanarySeasonResolution;
  role: EvidenceRole;
  classSlug: string | null;
  specSlug: string | null;
  rateBudgetConfig: RateBudgetConfig;
  env: AppEnv;
  /** Injectable for tests — skips production WCL / Redis wiring. */
  ports?: RunOrchestrationPorts;
  ensureRateLimitSnapshot?: () => Promise<CanaryRateSnapshotBootstrapReport>;
  outputDir?: string;
  /** When false, skip Redis lock (tests). Default true for production. */
  useRedisLock?: boolean;
  /** Optional scoring model override for tests. */
  scoringModelId?: string;
  scoringModelVersion?: string | null;
}

export async function loadCompatibleFrozenManifest(input: {
  prisma: PrismaClient;
  characterId: string;
  seasonId: string;
  expectedDungeonSlugs: readonly string[];
  dungeonPoolHash: string;
}): Promise<{ rowId: string; document: CharacterSeasonEvidenceManifestV2 } | null> {
  const row = await input.prisma.evidenceManifest.findFirst({
    where: { characterId: input.characterId, seasonId: input.seasonId },
    orderBy: { frozenAt: "desc" },
  });
  if (!row?.document || typeof row.document !== "object") return null;
  const doc = row.document as CharacterSeasonEvidenceManifestV2 & {
    dungeonPoolHash?: string;
  };
  if (!Array.isArray(doc.slots)) return null;
  if (!isManifestCompatibleWithSeasonPool(doc, input.expectedDungeonSlugs)) return null;
  if (doc.dungeonPoolHash != null && doc.dungeonPoolHash !== input.dungeonPoolHash) {
    return null;
  }
  return { rowId: row.id, document: doc };
}

/** Build candidate metadata from frozen SELECTED slots — no discovery. */
export function candidatesFromFrozenManifest(
  manifest: CharacterSeasonEvidenceManifestV2,
): EvidenceCandidateMetadataV2[] {
  const out: EvidenceCandidateMetadataV2[] = [];
  for (const slot of manifest.slots) {
    if (slot.state !== "SELECTED" || !slot.identity) continue;
    out.push({
      discoveryIdentity: {
        reportCode: slot.identity.reportCode,
        fightId: slot.identity.fightId,
      },
      reportRevision: slot.identity.reportRevision,
      dungeonSlug: slot.dungeonSlug,
      keyLevel: slot.keyLevel ?? 0,
      timed: slot.timed ?? true,
      runScore: slot.runScore,
      evidenceCompleteness: 1,
      completedAt: slot.completedAt ?? "2099-01-01T00:00:00.000Z",
      fightDurationMs: null,
      actorId: slot.actorId ?? null,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: "frozen_manifest",
    });
  }
  return out;
}

function digestFingerprint(digestArtifactId: string, contentHash?: string | null): string {
  return contentHash ?? digestArtifactId;
}

function dimensionReport(input: {
  result: RunOrchestrationResult;
  dimension: "performance" | "utility" | "survival";
  targetRunCount: number;
  activeDungeonCount: number;
  activeDungeonSlugs: readonly string[];
}): CanaryLiveDimensionReport {
  const dimKey = input.dimension.toUpperCase() as "PERFORMANCE" | "UTILITY" | "SURVIVAL";
  const blocked = input.result.dimensions.blocked.find((b) => b.dimension === dimKey);
  const dim =
    input.dimension === "performance"
      ? input.result.dimensions.performance
      : input.dimension === "utility"
        ? input.result.dimensions.utility
        : input.result.dimensions.survival;

  const digests = input.result.characterDigests;
  const perfDiag = input.result.dimensions.performanceDigestDiagnostics ?? [];
  const usableDigests =
    input.dimension === "performance" && perfDiag.length > 0
      ? digests.filter((d) =>
          perfDiag.some(
            (p) => p.slotId === d.slotId && p.usable === true,
          ),
        )
      : digests;
  const usableRunCount = usableDigests.length;
  const representedDungeonSlugs = [
    ...new Set(usableDigests.map((d) => d.dungeonSlug.toLowerCase())),
  ];
  const representedDungeonCount = representedDungeonSlugs.length;
  const missingDungeons = missingDungeonsFromCoverage(
    input.activeDungeonSlugs,
    representedDungeonSlugs,
  );
  const confidence = computeScoringConfidenceV1({
    usableRunCount,
    targetRunCount: input.targetRunCount,
    representedDungeonCount,
    activeDungeonCount: input.activeDungeonCount,
    missingDungeons,
    activeDungeonSlugs: input.activeDungeonSlugs,
    representedDungeonSlugs,
  });

  if (blocked) {
    return {
      status: "BLOCKED",
      score: null,
      usableRunCount,
      targetRunCount: input.targetRunCount,
      representedDungeonCount,
      missingDungeons,
      confidenceScore: confidence.confidenceScore,
      confidenceBand: confidence.confidenceBand,
      unavailableReason: blocked.reason,
      inputDigestIds: usableDigests.map((d) => d.digestArtifactId),
      inputDigestFingerprints: usableDigests.map((d) =>
        digestFingerprint(d.digestArtifactId, d.digest.contentHash),
      ),
      blockReason: blocked.reason,
    };
  }

  if (dim == null || usableRunCount === 0) {
    return {
      status: "UNAVAILABLE",
      score: null,
      usableRunCount,
      targetRunCount: input.targetRunCount,
      representedDungeonCount,
      missingDungeons,
      confidenceScore: confidence.confidenceScore,
      confidenceBand: confidence.confidenceBand,
      unavailableReason:
        input.dimension === "performance" &&
        perfDiag.some((p) => !p.usable)
          ? "zero_compatible_performance_facts"
          : "dimension_unavailable",
      inputDigestIds: usableDigests.map((d) => d.digestArtifactId),
      inputDigestFingerprints: usableDigests.map((d) =>
        digestFingerprint(d.digestArtifactId, d.digest.contentHash),
      ),
      blockReason: null,
    };
  }

  const score =
    typeof dim.score === "number" && Number.isFinite(dim.score) ? dim.score : null;
  if (score == null) {
    return {
      status: "UNAVAILABLE",
      score: null,
      usableRunCount,
      targetRunCount: input.targetRunCount,
      representedDungeonCount,
      missingDungeons,
      confidenceScore: confidence.confidenceScore,
      confidenceBand: confidence.confidenceBand,
      unavailableReason: "score_null",
      inputDigestIds: usableDigests.map((d) => d.digestArtifactId),
      inputDigestFingerprints: usableDigests.map((d) =>
        digestFingerprint(d.digestArtifactId, d.digest.contentHash),
      ),
      blockReason: null,
    };
  }

  return {
    status: usableRunCount < input.targetRunCount ? "PARTIAL" : "AVAILABLE",
    score,
    usableRunCount,
    targetRunCount: input.targetRunCount,
    representedDungeonCount,
    missingDungeons,
    confidenceScore: confidence.confidenceScore,
    confidenceBand: confidence.confidenceBand,
    unavailableReason: null,
    inputDigestIds: usableDigests.map((d) => d.digestArtifactId),
    inputDigestFingerprints: usableDigests.map((d) =>
      digestFingerprint(d.digestArtifactId, d.digest.contentHash),
    ),
    blockReason: null,
  };
}

function compositeFromDimensions(
  dims: CanaryLiveReport["dimensions"],
  overallConfidence: ScoringConfidenceV1,
): CanaryLiveReport["composite"] {
  const required: Array<{
    key: "PERFORMANCE" | "UTILITY" | "SURVIVAL";
    report: CanaryLiveDimensionReport;
  }> = [
    { key: "PERFORMANCE", report: dims.performance },
    { key: "UTILITY", report: dims.utility },
    { key: "SURVIVAL", report: dims.survival },
  ];
  const missing = required.find(
    (r) =>
      r.report.status === "UNAVAILABLE" ||
      r.report.status === "BLOCKED" ||
      r.report.score == null,
  );
  if (missing) {
    return {
      status: "UNAVAILABLE",
      score: null,
      confidence: overallConfidence,
      blockerDimension: missing.key,
    };
  }

  const scores = required.map((r) => r.report.score!);
  const dimConfidences = required.map((r) => r.report.confidenceScore);
  const confidenceScore = overallConfidenceFromDimensions(dimConfidences);
  const confidence: ScoringConfidenceV1 = {
    ...overallConfidence,
    confidenceScore,
    confidenceBand:
      confidenceScore <= 0
        ? "NONE"
        : confidenceScore >= 85
          ? "HIGH"
          : confidenceScore >= 60
            ? "MEDIUM"
            : "LOW",
  };
  const avg = Math.round((scores[0]! + scores[1]! + scores[2]!) / 3);
  const partial =
    overallConfidence.usableRunCount < overallConfidence.targetRunCount ||
    required.some((r) => r.report.status === "PARTIAL");
  return {
    status: partial ? "AVAILABLE_WITH_PARTIAL_EVIDENCE" : "AVAILABLE",
    score: avg,
    confidence,
    blockerDimension: null,
  };
}

function resolveCommandOutcome(input: {
  result: RunOrchestrationResult;
  dimensions: CanaryLiveReport["dimensions"];
}): CanaryLiveCommandOutcome {
  const anyDimensionCalculated = [
    input.dimensions.performance,
    input.dimensions.utility,
    input.dimensions.survival,
  ].some(
    (d) =>
      (d.status === "AVAILABLE" || d.status === "PARTIAL") && d.score != null,
  );
  if (!anyDimensionCalculated || input.result.characterDigests.length === 0) {
    return "FAILURE";
  }
  if (input.result.fightFailures.length > 0) return "PARTIAL_SUCCESS";
  if (input.result.characterDigests.length < input.result.expectedSlotCount) {
    return "PARTIAL_SUCCESS";
  }
  return "SUCCESS";
}

function scoresEqual(a: RunOrchestrationResult, b: RunOrchestrationResult): boolean {
  return (
    (a.dimensions.performance?.score ?? null) ===
      (b.dimensions.performance?.score ?? null) &&
    (a.dimensions.utility?.score ?? null) === (b.dimensions.utility?.score ?? null) &&
    (a.dimensions.survival?.score ?? null) === (b.dimensions.survival?.score ?? null)
  );
}

/**
 * Production live canary entry. Never invents manifests or calls discovery.
 */
export async function runScoringV2CanaryLive(
  input: RunCanaryLiveInput,
): Promise<{ report: CanaryLiveReport; reportPath: string; result: RunOrchestrationResult }> {
  assertPublicationBlocked(input.env);

  const season = input.seasonResolution;
  if (
    season.validationStatus !== "OK" ||
    !season.seasonId ||
    !season.seasonSlug ||
    season.activeDungeonSlugs.length === 0 ||
    !season.dungeonPoolHash
  ) {
    throw Object.assign(new Error("live_canary_requires_validated_active_season"), {
      code: "SEASON_CATALOG_MISMATCH",
    });
  }

  const expectedSlotCount = expectedEvidenceSlotCount(season.activeDungeonSlugs.length);
  const frozen = await loadCompatibleFrozenManifest({
    prisma: input.prisma,
    characterId: input.characterId,
    seasonId: season.seasonId,
    expectedDungeonSlugs: season.activeDungeonSlugs,
    dungeonPoolHash: season.dungeonPoolHash,
  });
  if (!frozen) {
    throw Object.assign(new Error("canary_live_manifest_not_available"), {
      code: "CANARY_LIVE_MANIFEST_NOT_AVAILABLE",
    });
  }

  const manifest = frozen.document;
  const candidates = candidatesFromFrozenManifest(manifest);
  const uniqueFights = uniqueSourceFightsFromManifest(manifest);

  const outDir =
    input.outputDir ?? join(process.cwd(), "artifacts", "scoring-v2-canary");
  const ratePath = join(outDir, "rate-limit-snapshot.json");

  const bootstrap =
    input.ensureRateLimitSnapshot != null
      ? await input.ensureRateLimitSnapshot()
      : await bootstrapCanaryRateLimitSnapshot({
          persistPath: ratePath,
          ttlSeconds: input.env.WCL_CANARY_RATE_SNAPSHOT_TTL_SECONDS ?? 300,
          allowLiveFetch: true,
          fetchLive: async () => {
            const wcl = new LiveWarcraftLogsProvider({ env: input.env });
            if (typeof wcl.getGraphQlClient !== "function") {
              throw new Error("wcl_graphql_client_unavailable_for_rate_snapshot");
            }
            return fetchCanaryRateLimitSnapshotLive(wcl.getGraphQlClient());
          },
        });

  // Probe package cache with provider-free ports (no live acquire).
  const probePorts =
    input.ports ??
    createProductionRunOrchestrationPorts({
      prisma: input.prisma,
      artifacts: input.container.repositories.artifacts,
      evidence: input.container.repositories.evidence,
    });

  const cacheStatuses: Array<{ sourceFightKey: string; packageCacheHit: boolean }> = [];
  for (const fight of uniqueFights) {
    const hit = await probePorts.findCompatibleCapabilityPackage({
      sourceFight: fight,
    });
    cacheStatuses.push({
      sourceFightKey: sourceFightKey(fight),
      packageCacheHit: hit != null && hit.package.complete === true,
    });
  }

  const costProjection = buildCanaryCostProjection({
    fights: cacheStatuses,
    discoveryOverheadRequests: bootstrap.providerCalls,
    discoveryOverheadPoints: bootstrap.estimatedPoints,
    rateLimitSnapshot: bootstrap.snapshot,
    rateLimitSnapshotIsProviderCall: bootstrap.snapshotSource === "LIVE",
    rateBudgetConfig: input.rateBudgetConfig,
  });

  try {
    assertCostAdmissionAllowsLive(costProjection);
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      code:
        err && typeof err === "object" && "code" in err
          ? (err as { code: string }).code
          : "CANARY_COST_ADMISSION_REFUSED",
      bootstrap,
      costProjection,
      capabilityAcquisitionsAttempted: 0,
    });
  }

  const packageCacheMisses = cacheStatuses.filter((c) => !c.packageCacheHit).length;
  const liveProviderPermission: LiveProviderPermission =
    packageCacheMisses > 0 ? "ALLOWED" : "FORBIDDEN";

  const permissionInput = {
    providerMode: input.env.PROVIDER_MODE,
    wclEnabled: input.env.WCL_ENABLED === true,
    allowLiveProviderCalls: input.env.ALLOW_LIVE_PROVIDER_CALLS === true,
    liveProviderPermissionGranted: liveProviderPermission === "ALLOWED",
    scoringV2PublicationEnabled: input.env.SCORING_V2_PUBLICATION_ENABLED === true,
    hasWclCredentials: Boolean(input.env.WCL_CLIENT_ID && input.env.WCL_CLIENT_SECRET),
  };
  const liveGate = evaluateLiveCapabilityPermission(permissionInput);
  if (liveProviderPermission === "ALLOWED" && !liveGate.allowed) {
    throw Object.assign(
      new Error(`live_capability_permission_refused:${liveGate.reasons.join(",")}`),
      {
        code: "CANARY_LIVE_CAPABILITY_REFUSED",
        reasons: liveGate.reasons,
      },
    );
  }

  let eventPageRequestCount = 0;
  let measuredPointsAcc: number | null = bootstrap.measuredPoints;
  let estimatedPointsAcc = bootstrap.estimatedPoints ?? 0;
  let acquisitionsAttempted = 0;
  let acquisitionsSucceeded = 0;
  let acquisitionsFailed = 0;

  let ports = input.ports;
  let redisForLock: ReturnType<WorkerContainer["createRedisConnection"]> | null = null;

  if (!ports) {
    let liveHook:
      | ((args: {
          sourceFight: SourceFightIdentity;
          dungeonSlug: string | null;
          keyLevel: number | null;
          participants: OrchestrationParticipant[];
        }) => Promise<LiveCapabilityAcquireResult>)
      | undefined;
    if (liveProviderPermission === "ALLOWED") {
      const client = new LiveWarcraftLogsProvider({
        env: input.env,
      }).getGraphQlClient();
      const baseHook = createLiveCapabilityAcquireHook({
        env: input.env,
        prisma: input.prisma,
        artifacts: input.container.repositories.artifacts,
        wclSource: input.container.repositories.wclSource,
        client,
        region: input.region,
        permission: permissionInput,
      });
      liveHook = async (args) => {
        acquisitionsAttempted += 1;
        try {
          const result = await baseHook(args);
          if (result.created) acquisitionsSucceeded += 1;
          eventPageRequestCount += result.accounting.pagesFetched ?? 0;
          if (result.accounting.pointsConsumed != null) {
            measuredPointsAcc =
              (measuredPointsAcc ?? 0) + result.accounting.pointsConsumed;
          } else if (result.accounting.estimatedPointsConsumed != null) {
            estimatedPointsAcc += result.accounting.estimatedPointsConsumed;
          } else if (result.providerCalls > 0) {
            estimatedPointsAcc += CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT;
          }
          return result;
        } catch (err) {
          acquisitionsFailed += 1;
          throw err;
        }
      };
    }

    if (input.useRedisLock !== false) {
      redisForLock = input.container.createRedisConnection();
    }
    const packageFinder = async (args: { sourceFight: SourceFightIdentity }) => {
      const hit =
        await input.container.repositories.capabilityEvidencePackages.findCompleteBySourceFight(
          args.sourceFight,
        );
      if (!hit) return null;
      return {
        package: hit.package,
        packageArtifactId: hit.packageArtifactId,
        contentHash: hit.contentHash,
        providerCalls: 0 as const,
      };
    };
    const withSourceFightLock = redisForLock
      ? createRedisSourceFightLock({
          redis: redisForLock,
          appEnv: input.env.APP_ENV ?? input.env.NODE_ENV ?? "development",
          findCompatiblePackage: packageFinder,
        })
      : undefined;

    ports = createProductionRunOrchestrationPorts({
      prisma: input.prisma,
      artifacts: input.container.repositories.artifacts,
      evidence: input.container.repositories.evidence,
      liveAcquireCapabilityPackage: liveHook,
      withSourceFightLock,
      resolveParticipants: async ({ sourceFight }) => {
        const rosterRow = await input.prisma.wclRunSourceDigest.findFirst({
          where: {
            reportCode: sourceFight.reportCode,
            fightId: sourceFight.fightId,
            reportRevision: sourceFight.reportRevision,
          },
        });

        const hit =
          await input.container.repositories.capabilityEvidencePackages.findCompleteBySourceFight(
            sourceFight,
          );

        type RosterP = {
          wclActorId: number;
          characterName: string;
          realmSlug: string;
          regionCode: string;
          classSlug?: string | null;
          specSlug?: string | null;
          role?: string | null;
          ownedPetActorIds?: number[];
        };

        const digestDoc = rosterRow?.digest as
          | { participants?: RosterP[] }
          | null
          | undefined;
        const rosterParticipants = digestDoc?.participants ?? [];

        const targetFromRoster = rosterParticipants.find(
          (p) =>
            p.characterName.normalize("NFKC").trim().toLocaleLowerCase("en-US") ===
              input.characterName
                .normalize("NFKC")
                .trim()
                .toLocaleLowerCase("en-US") &&
            (p.realmSlug ?? "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-") ===
              input.realm.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        );

        // Before package exists: use persisted roster actor set for acquisition.
        if (!hit) {
          if (rosterParticipants.length === 0) return [];
          return rosterParticipants.map((p) => {
            const isTarget =
              targetFromRoster != null &&
              p.wclActorId === targetFromRoster.wclActorId;
            return {
              playerActorId: p.wclActorId,
              characterName: isTarget ? input.characterName : p.characterName,
              realmSlug: p.realmSlug ?? input.realm,
              regionCode: p.regionCode ?? input.region,
              classSlug: isTarget ? input.classSlug : (p.classSlug ?? null),
              specSlug: isTarget ? input.specSlug : (p.specSlug ?? null),
              role: isTarget ? input.role : (p.role ?? null),
              ownedPetActorIds: p.ownedPetActorIds ?? [],
              characterId: isTarget ? input.characterId : null,
            };
          });
        }

        // Package exists: stamp identity using roster actor (stable), not discovery actorId.
        const targetActorId = targetFromRoster?.wclActorId ?? null;
        return hit.package.friendlyPlayerActorIds.map((id) => {
          const rosterP = rosterParticipants.find((p) => p.wclActorId === id);
          const isTarget = targetActorId != null && id === targetActorId;
          return {
            playerActorId: id,
            characterName: isTarget
              ? input.characterName
              : (rosterP?.characterName ?? `Actor${id}`),
            realmSlug: rosterP?.realmSlug ?? input.realm,
            regionCode: rosterP?.regionCode ?? input.region,
            classSlug: isTarget
              ? input.classSlug
              : (rosterP?.classSlug ?? null),
            specSlug: isTarget ? input.specSlug : (rosterP?.specSlug ?? null),
            role: isTarget ? input.role : (rosterP?.role ?? null),
            ownedPetActorIds: rosterP?.ownedPetActorIds ?? [],
            characterId: isTarget ? input.characterId : null,
          };
        });
      },
      resolveFightRoster: async ({ sourceFight }) => {
        const row = await input.prisma.wclRunSourceDigest.findFirst({
          where: {
            reportCode: sourceFight.reportCode,
            fightId: sourceFight.fightId,
            reportRevision: sourceFight.reportRevision,
          },
        });
        const participants = (
          row?.digest as {
            participants?: Array<{
              wclActorId: number;
              characterName: string;
              realmSlug: string;
              regionCode: string;
            }>;
          } | null
        )?.participants;
        if (!participants || participants.length === 0) return null;
        return participants.map((p) => ({
          wclActorId: p.wclActorId,
          characterName: p.characterName,
          realmSlug: p.realmSlug,
          regionCode: p.regionCode,
        }));
      },
    });
  }

  let scoringModelId = input.scoringModelId ?? "canary-shadow-model";
  let scoringModelVersion = input.scoringModelVersion ?? null;
  if (!input.scoringModelId) {
    try {
      const activeModel = await input.container.repositories.score.getActiveModel();
      if (activeModel?.id) {
        scoringModelId = activeModel.id;
        scoringModelVersion =
          activeModel.version != null ? String(activeModel.version) : null;
      }
    } catch {
      // Tests / missing score repo — keep canary shadow model id.
    }
  }

  const scope: EvidenceSelectionScope = {
    characterId: input.characterId,
    seasonId: season.seasonId,
    seasonSlug: season.seasonSlug,
    specializationId: null,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    role: input.role,
    refreshContractHash: `canary-live|${frozen.rowId}|${manifest.contentHash}`,
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: manifest.evidenceCutoffAt ?? "2099-01-01T00:00:00.000Z",
    highKeyPolicyId: manifest.highKeyPolicyId ?? "canary-live-v1",
    activeDungeonSlugs: [...season.activeDungeonSlugs],
  };

  let result: RunOrchestrationResult;
  try {
    result = await orchestrateScoringV2Runs({
      characterId: input.characterId,
      region: input.region,
      realm: input.realm,
      characterName: input.characterName,
      seasonId: season.seasonId,
      scoringModelId,
      scoringModelVersion,
      liveProviderPermission,
      scope,
      candidates,
      existingManifest: manifest,
      ports,
    });
  } finally {
    if (redisForLock) {
      await redisForLock.quit().catch(() => undefined);
    }
  }

  const replay = await replayScoringV2FromPersistedEvidence({
    characterId: input.characterId,
    region: input.region,
    realm: input.realm,
    characterName: input.characterName,
    seasonId: season.seasonId,
    scoringModelId,
    scoringModelVersion,
    scope,
    candidates,
    existingManifest: result.manifest,
    ports,
  });

  const replayFingerprintEqual =
    fingerprintDimensionResults(result) === fingerprintDimensionResults(replay);
  const replayScoresEqual = scoresEqual(result, replay);
  const targetRunCount = expectedSlotCount;
  const activeDungeonCount = season.activeDungeonSlugs.length;
  const representedDungeonSlugs = [
    ...new Set(
      result.characterDigests.map((d) => d.dungeonSlug.toLowerCase()),
    ),
  ];
  const overallConfidence = computeScoringConfidenceV1({
    usableRunCount: result.characterDigests.length,
    targetRunCount,
    representedDungeonCount: representedDungeonSlugs.length,
    activeDungeonCount,
    activeDungeonSlugs: season.activeDungeonSlugs,
    representedDungeonSlugs,
  });

  const dimensions = {
    performance: dimensionReport({
      result,
      dimension: "performance",
      targetRunCount,
      activeDungeonCount,
      activeDungeonSlugs: season.activeDungeonSlugs,
    }),
    utility: dimensionReport({
      result,
      dimension: "utility",
      targetRunCount,
      activeDungeonCount,
      activeDungeonSlugs: season.activeDungeonSlugs,
    }),
    survival: dimensionReport({
      result,
      dimension: "survival",
      targetRunCount,
      activeDungeonCount,
      activeDungeonSlugs: season.activeDungeonSlugs,
    }),
  };

  const replayRepresented = [
    ...new Set(
      replay.characterDigests.map((d) => d.dungeonSlug.toLowerCase()),
    ),
  ];
  const replayConfidence = computeScoringConfidenceV1({
    usableRunCount: replay.characterDigests.length,
    targetRunCount,
    representedDungeonCount: replayRepresented.length,
    activeDungeonCount,
    activeDungeonSlugs: season.activeDungeonSlugs,
    representedDungeonSlugs: replayRepresented,
  });
  const replayConfidenceEqual =
    replayConfidence.confidenceScore === overallConfidence.confidenceScore &&
    replayConfidence.confidenceBand === overallConfidence.confidenceBand;

  const commandOutcome = resolveCommandOutcome({
    result,
    dimensions,
  });

  const report: CanaryLiveReport = {
    schemaVersion: CANARY_LIVE_REPORT_SCHEMA,
    repositoryMode: input.characterResolution.repositoryMode,
    characterId: input.characterId,
    characterName: input.characterName,
    region: input.region,
    realm: input.realm,
    charactersProcessed: 1,
    commandOutcome,
    manifestId: frozen.rowId,
    selectedSlotCount: result.selectedSlotCount,
    expectedSlotCount,
    analysisStatus: evidenceManifestAnalysisStatus({
      selectedSlotCount: result.characterDigests.length,
      targetRunCount: expectedSlotCount,
    }),
    selectedFights: manifest.slots
      .filter((s) => s.state === "SELECTED" && s.identity)
      .map((s) => ({
        slotId: s.slotId,
        dungeonSlug: s.dungeonSlug,
        reportCode: s.identity!.reportCode,
        fightId: s.identity!.fightId,
        reportRevision: s.identity!.reportRevision,
      })),
    packageCacheHits: cacheStatuses.filter((c) => c.packageCacheHit).length,
    packageCacheMisses,
    capabilityAcquisitionsAttempted:
      input.ports != null ? result.accounting.packagesCreated : acquisitionsAttempted,
    capabilityAcquisitionsSucceeded:
      input.ports != null ? result.accounting.packagesCreated : acquisitionsSucceeded,
    capabilityAcquisitionsFailed:
      input.ports != null ? result.fightFailures.length : acquisitionsFailed,
    graphqlRequestCount: bootstrap.providerCalls + result.accounting.providerCalls,
    eventPageRequestCount,
    measuredWclPoints: measuredPointsAcc,
    estimatedWclPoints: estimatedPointsAcc,
    fightFailures: result.fightFailures,
    packagesCreated: result.accounting.packagesCreated,
    packagesReused: result.accounting.packagesReused,
    participantDigestsCreated: result.accounting.digestsCreated,
    participantDigestsReused: result.accounting.digestsReused,
    wallidrixeDigestCount: result.characterDigests.length,
    dimensions,
    composite: compositeFromDimensions(dimensions, overallConfidence),
    confidence: overallConfidence,
    rateAdmission: costProjection.rateLimit.admission,
    rateAdmissionReasons: costProjection.rateLimit.reasons,
    bootstrap,
    costProjection,
    replayProviderCalls: replay.accounting.providerCalls,
    replayPackagesCreated: replay.accounting.packagesCreated,
    replayFingerprintEqual,
    replayScoresEqual,
    replayConfidenceEqual,
    publicationEnabled: false,
    publicScorePointerMutated: false,
    orchestratorExecuted: true,
    liveProviderPermission,
  };

  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "live-canary-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  if (report.publicationEnabled !== false || report.publicScorePointerMutated !== false) {
    throw Object.assign(new Error("canary_live_publication_invariant_violated"), {
      code: "CANARY_LIVE_PUBLICATION_INVARIANT",
      report,
    });
  }
  if (report.charactersProcessed !== 1) {
    throw Object.assign(new Error("canary_live_character_count_invariant"), {
      code: "CANARY_LIVE_CHARACTER_COUNT",
      report,
    });
  }
  if (commandOutcome === "FAILURE") {
    throw Object.assign(
      new Error(
        result.fightFailures.length > 0
          ? `canary_live_fight_failures:${result.fightFailures.map((f) => f.code).join(",")}`
          : "canary_live_no_usable_analysis",
      ),
      {
        code:
          result.fightFailures.length > 0
            ? "CANARY_LIVE_FIGHT_FAILURES"
            : "CANARY_LIVE_NO_USABLE_ANALYSIS",
        fightFailures: result.fightFailures,
        report,
      },
    );
  }
  if (!replayFingerprintEqual || !replayScoresEqual || !replayConfidenceEqual) {
    throw Object.assign(new Error("canary_live_replay_mismatch"), {
      code: "CANARY_LIVE_REPLAY_MISMATCH",
      report,
    });
  }
  if (replay.accounting.providerCalls !== 0 || replay.accounting.packagesCreated !== 0) {
    throw Object.assign(new Error("canary_live_replay_not_provider_free"), {
      code: "CANARY_LIVE_REPLAY_PROVIDER_CALLS",
      report,
    });
  }

  return { report, reportPath, result };
}
