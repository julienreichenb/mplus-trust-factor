/**
 * Executable Scoring V2 live capability canary.
 *
 * Operational wrapper: frozen manifest, cost/rate admission, live capability
 * gates, package acquisition accounting, publication blocked.
 *
 * Scoring authority: runAuthoritativeScoring → scoreCharacter (P/S/U/E +
 * explainability). Never an alternate composite/confidence path.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import {
  OBSERVATION_SCHEMA_VERSION,
  RUN_SELECTION_VERSION,
  expectedEvidenceSlotCount,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceCandidateMetadataV2,
  type EvidenceRole,
} from "@mplus/contracts";
import {
  evidenceManifestAnalysisStatus,
  type ExperiencePhase1Result,
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
import type { FetchCharacterPerformanceAggregateProvider } from "../run-orchestration/ensure-performance-aggregate.js";
import {
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
import {
  runAuthoritativeScoring,
  type AuthoritativeScoringResult,
} from "../refresh-bridge.js";
import type { ScoreCharacterResult } from "../score-character.js";
import {
  buildCanaryAuthoritativeComposite,
  buildCanaryAuthoritativeDimensions,
  buildEvidenceCoverageDiagnostic,
  compareAuthoritativeScoringParity,
  type CanaryAuthoritativeCompositeReport,
  type CanaryAuthoritativeDimensionReport,
  type CanaryAuthoritativeReplayAssertion,
  type CanaryEvidenceCoverageDiagnostic,
} from "./canary-authoritative-report.js";

export const CANARY_LIVE_REPORT_SCHEMA = "scoring-canary-live-v2" as const;

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
  /** WCL GraphQL / bootstrap request diagnostic (not full authoritative total). */
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
  /** Canonical P/S/U/E from runAuthoritativeScoring / scoreCharacter. */
  dimensions: {
    performance: CanaryAuthoritativeDimensionReport;
    survival: CanaryAuthoritativeDimensionReport;
    utility: CanaryAuthoritativeDimensionReport;
    experience: CanaryAuthoritativeDimensionReport;
  };
  /** Canonical composite / tier from partial composite + explainability. */
  composite: CanaryAuthoritativeCompositeReport;
  /** Alias of composite.confidence for operators (0–1). */
  confidence: number;
  /**
   * Legacy run-coverage diagnostic only — NOT dimension/composite confidence.
   * @deprecated Prefer dimensions[].confidence and composite.confidence.
   */
  evidenceCoverageDiagnostic: CanaryEvidenceCoverageDiagnostic;
  rateAdmission: CanaryCostProjection["rateLimit"]["admission"];
  rateAdmissionReasons: string[];
  bootstrap: CanaryRateSnapshotBootstrapReport | null;
  costProjection: CanaryCostProjection | null;
  /** Full authoritative provider total (orchestration + aggregate + Experience). */
  authoritativeProviderCalls: number;
  characterScoreWrites: 0;
  persistCharacterScore: false;
  authoritativeReplay: CanaryAuthoritativeReplayAssertion;
  /** @deprecated Prefer authoritativeReplay.providerCalls */
  replayProviderCalls: number;
  replayPackagesCreated: number;
  /** @deprecated Prefer authoritativeReplay.explainabilityFingerprintEqual */
  replayFingerprintEqual: boolean;
  /** @deprecated Prefer authoritativeReplay.scoresEqual */
  replayScoresEqual: boolean;
  /** @deprecated Prefer authoritativeReplay.confidenceEqual */
  replayConfidenceEqual: boolean;
  publicationEnabled: false;
  publicScorePointerMutated: false;
  orchestratorExecuted: true;
  scoringAuthority: "runAuthoritativeScoring";
  /**
   * WCL capability-package live gate based on package cache misses + canary
   * cost admission. Diagnostic only — NOT the full authoritative scoring
   * provider permission (which follows env + forceProviderFree).
   */
  capabilityLiveProviderPermission: LiveProviderPermission;
  /**
   * Effective WCL/orchestration provider permission used by cold
   * runAuthoritativeScoring (env gates). Replay always forceProviderFree.
   */
  authoritativeProviderPermission: LiveProviderPermission;
  /** Replay always sets forceProviderFree:true on runAuthoritativeScoring. */
  forceProviderFreeReplay: true;
  /** @deprecated Prefer capabilityLiveProviderPermission */
  liveProviderPermission: LiveProviderPermission;
  explainabilityFingerprint: string;
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
  /** Test seam: skip Experience acquisition. */
  experienceOverride?: ExperiencePhase1Result | null;
  /** Test seam: force aggregate provider null/override into authoritative scoring. */
  performanceAggregateProviderOverride?:
    | FetchCharacterPerformanceAggregateProvider
    | null;
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

function resolveCommandOutcome(input: {
  result: RunOrchestrationResult;
  dimensions: CanaryLiveReport["dimensions"];
}): CanaryLiveCommandOutcome {
  const anyDimensionCalculated = [
    input.dimensions.performance,
    input.dimensions.utility,
    input.dimensions.survival,
    input.dimensions.experience,
  ].some(
    (d) =>
      (d.state === "AVAILABLE" || d.state === "PARTIAL") && d.score != null,
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

function buildCanaryRefreshContract(input: {
  seasonSlug: string;
  zoneId: number;
  scoreModelKey: string;
  scoreModelVersion: number;
}) {
  return {
    scoringModelKey: input.scoreModelKey,
    scoringModelVersion: input.scoreModelVersion,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    wclAdapterVersion: "points-and-damage-v1",
    blizzardAdapterVersion: "blizzard-v1",
    raiderIoAdapterVersion: "raiderio-v1",
    runSelectionVersion: RUN_SELECTION_VERSION,
    abilityCatalogVersion: "abilities-v1",

    abilityCatalogExecutionKey: "static:abilities-v1",
    mechanicCatalogVersion: "mechanics-v1",
    activeSeasonId: input.seasonSlug,
    zoneId: input.zoneId,
    partition: null as number | null,
  };
}

/**
 * Production live canary entry. Never invents manifests or calls discovery.
 * Scoring goes through runAuthoritativeScoring(persistCharacterScore:false).
 */
export async function runScoringCanaryLive(
  input: RunCanaryLiveInput,
): Promise<{
  report: CanaryLiveReport;
  reportPath: string;
  result: RunOrchestrationResult;
  scoreResult: ScoreCharacterResult;
  authoritative: AuthoritativeScoringResult;
}> {
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
    input.outputDir ?? join(process.cwd(), "artifacts", "scoring-canary");
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
      targetCharacter: {
        characterId: input.characterId,
        characterName: input.characterName,
        realmSlug: input.realm,
        regionCode: input.region,
        classSlug: input.classSlug,
        specSlug: input.specSlug,
        role: input.role,
      },
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
  // Capability-package gate only (cache miss → may acquire). Distinct from
  // authoritative env-derived allowProviderCalls used by runAuthoritativeScoring.
  const capabilityLiveProviderPermission: LiveProviderPermission =
    packageCacheMisses > 0 ? "ALLOWED" : "FORBIDDEN";

  const permissionInput = {
    providerMode: input.env.PROVIDER_MODE,
    wclEnabled: input.env.WCL_ENABLED === true,
    allowLiveProviderCalls: input.env.ALLOW_LIVE_PROVIDER_CALLS === true,
    liveProviderPermissionGranted: capabilityLiveProviderPermission === "ALLOWED",
    scoringPublicationEnabled: input.env.SCORING_PUBLICATION_ENABLED === true,
    hasWclCredentials: Boolean(input.env.WCL_CLIENT_ID && input.env.WCL_CLIENT_SECRET),
  };
  const liveGate = evaluateLiveCapabilityPermission(permissionInput);
  if (capabilityLiveProviderPermission === "ALLOWED" && !liveGate.allowed) {
    throw Object.assign(
      new Error(`live_capability_permission_refused:${liveGate.reasons.join(",")}`),
      {
        code: "CANARY_LIVE_CAPABILITY_REFUSED",
        reasons: liveGate.reasons,
      },
    );
  }

  const envAllowsAuthoritativeProviders =
    input.env.ALLOW_LIVE_PROVIDER_CALLS === true &&
    input.env.PROVIDER_MODE === "live" &&
    input.env.WCL_ENABLED === true;
  const authoritativeProviderPermission: LiveProviderPermission =
    envAllowsAuthoritativeProviders ? "ALLOWED" : "FORBIDDEN";

  let eventPageRequestCount = 0;
  let measuredPointsAcc: number | null = bootstrap.measuredPoints;
  let estimatedPointsAcc = bootstrap.estimatedPoints ?? 0;
  let acquisitionsAttempted = 0;
  let acquisitionsSucceeded = 0;
  let acquisitionsFailed = 0;

  let ports = input.ports;
  let redisForLock: ReturnType<WorkerContainer["createRedisConnection"]> | null = null;
  let cold: AuthoritativeScoringResult;
  let replay: AuthoritativeScoringResult;

  // Every path after createRedisConnection must quit — including early validation failures.
  try {
    // One Redis connection for the full cold+replay canary operation.
    if (input.useRedisLock !== false) {
      redisForLock = input.container.createRedisConnection();
    }

    if (!ports) {
      let liveHook:
        | ((args: {
            sourceFight: SourceFightIdentity;
            dungeonSlug: string | null;
            keyLevel: number | null;
            participants: OrchestrationParticipant[];
          }) => Promise<LiveCapabilityAcquireResult>)
        | undefined;
      if (capabilityLiveProviderPermission === "ALLOWED") {
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

      const rosterPorts = createProductionRunOrchestrationPorts({
        prisma: input.prisma,
        artifacts: input.container.repositories.artifacts,
        evidence: input.container.repositories.evidence,
        liveAcquireCapabilityPackage: liveHook,
        targetCharacter: {
          characterId: input.characterId,
          characterName: input.characterName,
          realmSlug: input.realm,
          regionCode: input.region,
          classSlug: input.classSlug,
          specSlug: input.specSlug,
          role: input.role,
        },
      });
      const withSourceFightLock = redisForLock
        ? createRedisSourceFightLock({
            redis: redisForLock,
            appEnv: input.env.APP_ENV ?? input.env.NODE_ENV ?? "development",
            findCompatiblePackage: (args) =>
              rosterPorts.findCompatibleCapabilityPackage(args),
          })
        : undefined;

      ports = {
        ...rosterPorts,
        withSourceFightLock: withSourceFightLock ?? rosterPorts.withSourceFightLock,
      };
    } else if (redisForLock) {
      // Injected ports (tests): keep Redis open for cold+replay and fail if quit early.
      const redis = redisForLock as {
        assertOpen?: () => void;
      } & typeof redisForLock;
      const innerLock = ports.withSourceFightLock.bind(ports);
      ports = {
        ...ports,
        withSourceFightLock: async (sourceFight, work) => {
          if (typeof redis.assertOpen === "function") {
            redis.assertOpen();
          }
          return innerLock(sourceFight, work);
        },
      };
    }

    let scoringModelId = input.scoringModelId ?? "canary-shadow-model";
    let scoreModelKey = "canary-shadow-model";
    let scoreModelVersionNum = 1;
    if (!input.scoringModelId) {
      try {
        const activeModel = await input.container.repositories.score.getActiveModel();
        if (activeModel?.id) {
          scoringModelId = activeModel.id;
          const modelKey =
            "key" in activeModel && typeof activeModel.key === "string"
              ? activeModel.key
              : activeModel.id;
          scoreModelKey = modelKey;
          scoreModelVersionNum =
            typeof activeModel.version === "number"
              ? activeModel.version
              : Number(activeModel.version) || 1;
        }
      } catch {
        // Tests / missing score repo — keep canary shadow model id.
      }
    } else if (input.scoringModelVersion != null) {
      scoreModelVersionNum = Number(input.scoringModelVersion) || 1;
      scoreModelKey = input.scoringModelId;
    }

    const zoneId = season.configuredZoneId;
    if (zoneId == null || !Number.isFinite(zoneId) || zoneId <= 0) {
      throw Object.assign(new Error("canary_live_requires_wcl_zone_id"), {
        code: "CANARY_ZONE_ID_REQUIRED",
      });
    }

    const refreshContract = buildCanaryRefreshContract({
      seasonSlug: season.seasonSlug,
      zoneId,
      scoreModelKey,
      scoreModelVersion: scoreModelVersionNum,
    });

    const evidenceCutoffAt =
      manifest.evidenceCutoffAt ?? "2099-01-01T00:00:00.000Z";
    const highKeyPolicyId = manifest.highKeyPolicyId ?? "canary-live-v1";
    const calculatedAt = new Date().toISOString();

    const commonScoringInput = {
      container: input.container,
      characterId: input.characterId,
      seasonId: season.seasonId,
      seasonSlug: season.seasonSlug,
      role: input.role,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      refreshContract,
      evidenceCutoffAt,
      highKeyPolicyId,
      activeDungeonSlugs: [...season.activeDungeonSlugs],
      candidates,
      scoreModelKey,
      scoreModelVersion: scoreModelVersionNum,
      scoreModelId: scoringModelId,
      calculatedAt,
      region: input.region,
      realm: input.realm,
      characterName: input.characterName,
      persistCharacterScore: false as const,
      existingManifest: manifest,
      portsOverride: ports,
      experienceOverride: input.experienceOverride,
      performanceAggregateProviderOverride:
        input.performanceAggregateProviderOverride,
    };

    // Cold + replay are one canary operation — keep Redis lock alive for both.
    cold = await runAuthoritativeScoring(commonScoringInput);

    if (!cold.scoreResult) {
      throw Object.assign(new Error("canary_live_authoritative_scoring_empty"), {
        code: "CANARY_LIVE_AUTHORITATIVE_EMPTY",
      });
    }

    // TRUE provider-free authoritative replay (one-way forceProviderFree).
    replay = await runAuthoritativeScoring({
      ...commonScoringInput,
      forceProviderFree: true,
      calculatedAt,
    });

    if (!replay.scoreResult) {
      throw Object.assign(new Error("canary_live_replay_authoritative_empty"), {
        code: "CANARY_LIVE_REPLAY_EMPTY",
      });
    }
  } finally {
    if (redisForLock) {
      await redisForLock.quit().catch(() => undefined);
    }
  }

  const result = cold.scoreResult!.orchestration;

  const authoritativeReplay = compareAuthoritativeScoringParity({
    cold: cold.scoreResult!,
    replay: replay.scoreResult!,
    replayProviderCalls: replay.providerCalls,
  });

  const dimensions = buildCanaryAuthoritativeDimensions(
    cold.scoreResult!.explainability,
  );
  const composite = buildCanaryAuthoritativeComposite(
    cold.scoreResult!.explainability,
  );
  const evidenceCoverageDiagnostic = buildEvidenceCoverageDiagnostic({
    orchestration: result,
    targetRunCount: expectedSlotCount,
    activeDungeonSlugs: season.activeDungeonSlugs,
  });

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
    graphqlRequestCount:
      bootstrap.providerCalls + result.accounting.providerCalls,
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
    composite,
    confidence: composite.confidence,
    evidenceCoverageDiagnostic,
    rateAdmission: costProjection.rateLimit.admission,
    rateAdmissionReasons: costProjection.rateLimit.reasons,
    bootstrap,
    costProjection,
    authoritativeProviderCalls: cold.providerCalls,
    characterScoreWrites: 0,
    persistCharacterScore: false,
    authoritativeReplay,
    replayProviderCalls: authoritativeReplay.providerCalls,
    replayPackagesCreated: replay.scoreResult!.orchestration.accounting.packagesCreated,
    replayFingerprintEqual: authoritativeReplay.explainabilityFingerprintEqual,
    replayScoresEqual: authoritativeReplay.scoresEqual,
    replayConfidenceEqual: authoritativeReplay.confidenceEqual,
    publicationEnabled: false,
    publicScorePointerMutated: false,
    orchestratorExecuted: true,
    scoringAuthority: "runAuthoritativeScoring",
    capabilityLiveProviderPermission,
    authoritativeProviderPermission,
    forceProviderFreeReplay: true,
    liveProviderPermission: capabilityLiveProviderPermission,
    explainabilityFingerprint: cold.scoreResult!.explainability.fingerprint,
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
  if (cold.scoreResult!.characterScoreId != null || replay.scoreResult!.characterScoreId != null) {
    throw Object.assign(new Error("canary_live_character_score_write_forbidden"), {
      code: "CANARY_LIVE_CHARACTER_SCORE_WRITE",
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
  if (
    !authoritativeReplay.scoresEqual ||
    !authoritativeReplay.confidenceEqual ||
    !authoritativeReplay.compositeEqual ||
    !authoritativeReplay.tierEqual ||
    !authoritativeReplay.explainabilityFingerprintEqual ||
    !authoritativeReplay.publicProjectionEqual
  ) {
    throw Object.assign(new Error("canary_live_replay_mismatch"), {
      code: "CANARY_LIVE_REPLAY_MISMATCH",
      report,
    });
  }
  if (
    authoritativeReplay.providerCalls !== 0 ||
    replay.scoreResult!.orchestration.accounting.packagesCreated !== 0
  ) {
    throw Object.assign(new Error("canary_live_replay_not_provider_free"), {
      code: "CANARY_LIVE_REPLAY_PROVIDER_CALLS",
      report,
    });
  }

  return {
    report,
    reportPath,
    result,
    scoreResult: cold.scoreResult!,
    authoritative: cold,
  };
}
