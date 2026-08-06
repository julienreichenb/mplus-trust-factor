/**
 * Consolidated Scoring V2 shadow pipeline.
 * Contextual repair commands are internalized as automatic stages.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import type { EvidenceRole } from "@mplus/contracts";
import {
  LiveWarcraftLogsProvider,
  OPERATIONS,
  mapRegionToWcl,
  resolveRankingParseFromZoneRankings,
  type ZoneRankingsPayload,
} from "@mplus/provider-warcraftlogs";
import type { WorkerContainer } from "../../../container.js";
import { assertPublicationBlocked } from "../acquisition.js";
import {
  assertNotSentinelCharacterId,
  assertOperatorRepositoryMode,
  type CanaryCharacterResolution,
} from "../canary/canary-deps.js";
import type { CanarySeasonResolution } from "../canary/canary-season.js";
import type { ResolvedCanaryZone } from "../canary/canary-zone.js";
import {
  loadCompatibleFrozenManifest,
  runScoringV2CanaryLive,
  type CanaryLiveReport,
} from "../canary/canary-live.js";
import { runScoringV2CanaryReplay } from "../canary/canary-replay.js";
import {
  rankingEvidenceArtifactBytes,
  runScoringV2CanaryRankingHydrate,
} from "../canary/canary-ranking-hydrate.js";
import {
  createGraphqlReportRevisionFetcher,
  runScoringV2CanaryReconcileRevisions,
} from "../canary/canary-reconcile-revisions.js";
import { runTargetDigestDiagnostic } from "../canary/canary-target-digest-diagnostic.js";
import { createTargetedCapabilityRepairAcquireHook } from "../run-orchestration/live-capability-adapter.js";
import { evaluateLiveCapabilityPermission } from "../run-orchestration/live-capability-adapter.js";
import { repairIncompatibleCapabilityPackages } from "../run-orchestration/self-healing-evidence.js";

export const CONSOLIDATED_SHADOW_PIPELINE_SCHEMA =
  "scoring-v2-consolidated-shadow-pipeline-v1" as const;

export interface ConsolidatedStageSummary {
  name: string;
  status: "SKIPPED" | "OK" | "PARTIAL" | "FAILED" | "REFUSED";
  detail: Record<string, unknown>;
}

export interface ConsolidatedShadowPipelineReport {
  schemaVersion: typeof CONSOLIDATED_SHADOW_PIPELINE_SCHEMA;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  stages: ConsolidatedStageSummary[];
  season: Record<string, unknown> | null;
  discovery: Record<string, unknown> | null;
  revisionReconciliation: Record<string, unknown> | null;
  packageIntegrity: Record<string, unknown> | null;
  rankingEvidence: Record<string, unknown> | null;
  liveHydration: CanaryLiveReport | null;
  digestDiagnostic: Record<string, unknown> | null;
  replay: Record<string, unknown> | null;
  publicationEnabled: false;
  publicScorePointerMutated: false;
  automaticRepairs: {
    packagesSuperseded: number;
    rankingFactsCreated: number;
    revisionsReconciled: boolean;
  };
  providerCalls: number;
  outcome: "COMPLETE" | "REFUSED" | "PARTIAL";
}

export type DiscoverStageFn = () => Promise<{
  manifestId: string | null;
  selectedSlotCount: number;
  providerCalls: number;
  reused: boolean;
}>;

/**
 * Full production-shaped shadow pipeline for one character.
 * Inject `discoverStage` to run discovery when no frozen manifest exists.
 */
export async function runConsolidatedShadowPipeline(input: {
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
  characterResolution: CanaryCharacterResolution;
  zone: ResolvedCanaryZone;
  confirmExecute: boolean;
  outputDir?: string;
  providerFreeOnly?: boolean;
  discoverStage?: DiscoverStageFn;
}): Promise<{ report: ConsolidatedShadowPipelineReport; reportPath: string }> {
  assertNotSentinelCharacterId(input.characterId);
  assertOperatorRepositoryMode(input.characterResolution.repositoryMode);
  assertPublicationBlocked(input.env);

  const stages: ConsolidatedStageSummary[] = [];
  let providerCalls = 0;
  let packagesSuperseded = 0;
  let rankingFactsCreated = 0;
  let revisionsReconciled = false;
  let liveHydration: CanaryLiveReport | null = null;
  let discoverySummary: Record<string, unknown> | null = null;
  let revisionSummary: Record<string, unknown> | null = null;
  let packageSummary: Record<string, unknown> | null = null;
  let rankingSummary: Record<string, unknown> | null = null;
  let digestSummary: Record<string, unknown> | null = null;
  let replaySummary: Record<string, unknown> | null = null;

  stages.push({
    name: "season",
    status: input.season.validationStatus === "OK" ? "OK" : "FAILED",
    detail: {
      seasonId: input.season.seasonId,
      seasonSlug: input.season.seasonSlug,
      dungeonPoolHash: input.season.dungeonPoolHash,
      activeDungeonCount: input.season.activeDungeonSlugs.length,
      validationStatus: input.season.validationStatus,
    },
  });

  if (input.season.validationStatus !== "OK" || !input.season.seasonId) {
    return persist(
      finish(input, stages, {
        outcome: "REFUSED",
        providerCalls: 0,
      }),
      input.outputDir,
    );
  }

  let frozen = await loadCompatibleFrozenManifest({
    prisma: input.prisma,
    characterId: input.characterId,
    seasonId: input.season.seasonId,
    expectedDungeonSlugs: input.season.activeDungeonSlugs,
    dungeonPoolHash: input.season.dungeonPoolHash!,
  });

  if (!frozen && input.discoverStage && input.confirmExecute && !input.providerFreeOnly) {
    const discovered = await input.discoverStage();
    providerCalls += discovered.providerCalls;
    discoverySummary = { ...discovered };
    stages.push({
      name: "discovery_manifest",
      status: discovered.manifestId ? "OK" : "PARTIAL",
      detail: discoverySummary,
    });
    frozen = await loadCompatibleFrozenManifest({
      prisma: input.prisma,
      characterId: input.characterId,
      seasonId: input.season.seasonId,
      expectedDungeonSlugs: input.season.activeDungeonSlugs,
      dungeonPoolHash: input.season.dungeonPoolHash!,
    });
  } else if (frozen) {
    discoverySummary = {
      manifestId: frozen.rowId,
      selectedSlotCount: frozen.document.selectedSlotCount,
      reused: true,
      providerCalls: 0,
    };
    stages.push({
      name: "discovery_manifest",
      status: "OK",
      detail: discoverySummary,
    });
  } else {
    stages.push({
      name: "discovery_manifest",
      status: "SKIPPED",
      detail: { reason: "no_manifest" },
    });
  }

  if (!frozen) {
    return persist(
      finish(input, stages, {
        outcome: "PARTIAL",
        providerCalls,
        discovery: discoverySummary,
      }),
      input.outputDir,
    );
  }

  const liveGate = evaluateLiveCapabilityPermission({
    providerMode: input.env.PROVIDER_MODE,
    wclEnabled: input.env.WCL_ENABLED,
    allowLiveProviderCalls: input.env.ALLOW_LIVE_PROVIDER_CALLS,
    liveProviderPermissionGranted: true,
    scoringV2PublicationEnabled: input.env.SCORING_V2_PUBLICATION_ENABLED,
    hasWclCredentials: Boolean(
      input.env.WCL_CLIENT_ID && input.env.WCL_CLIENT_SECRET,
    ),
  });
  const liveOk =
    !input.providerFreeOnly && input.confirmExecute && liveGate.allowed;

  if (liveOk) {
    try {
      const client = new LiveWarcraftLogsProvider({
        env: input.env,
      }).getGraphQlClient();
      const reconcile = await runScoringV2CanaryReconcileRevisions({
        prisma: input.prisma,
        container: input.container,
        characterId: input.characterId,
        characterName: input.characterName,
        seasonResolution: input.season,
        role: input.role,
        fetchMetadata: createGraphqlReportRevisionFetcher(client),
        outputDir: input.outputDir,
      });
      revisionsReconciled = Boolean(reconcile.report.changed);
      revisionSummary = {
        changed: reconcile.report.changed,
        supersedingManifestId: reconcile.report.supersedingManifestId,
        metadataProviderCalls: reconcile.report.metadataProviderCalls,
      };
      providerCalls += reconcile.report.metadataProviderCalls;
      stages.push({
        name: "revision_reconciliation",
        status: "OK",
        detail: revisionSummary,
      });
      frozen =
        (await loadCompatibleFrozenManifest({
          prisma: input.prisma,
          characterId: input.characterId,
          seasonId: input.season.seasonId!,
          expectedDungeonSlugs: input.season.activeDungeonSlugs,
          dungeonPoolHash: input.season.dungeonPoolHash!,
        })) ?? frozen;
    } catch (err) {
      stages.push({
        name: "revision_reconciliation",
        status: "PARTIAL",
        detail: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  } else {
    stages.push({
      name: "revision_reconciliation",
      status: "SKIPPED",
      detail: { reason: liveOk ? "n/a" : "live_not_armed" },
    });
  }

  {
    const client = liveOk
      ? new LiveWarcraftLogsProvider({ env: input.env }).getGraphQlClient()
      : null;
    const acquire = liveOk
      ? createTargetedCapabilityRepairAcquireHook({
          env: input.env,
          prisma: input.prisma,
          artifacts: input.container.repositories.artifacts,
          wclSource: input.container.repositories.wclSource,
          client: client!,
          region: input.region,
          permission: {
            providerMode: input.env.PROVIDER_MODE,
            wclEnabled: input.env.WCL_ENABLED,
            allowLiveProviderCalls: input.env.ALLOW_LIVE_PROVIDER_CALLS,
            liveProviderPermissionGranted: true,
            scoringV2PublicationEnabled:
              input.env.SCORING_V2_PUBLICATION_ENABLED,
            hasWclCredentials: Boolean(
              input.env.WCL_CLIENT_ID && input.env.WCL_CLIENT_SECRET,
            ),
          },
        })
      : async () => {
          throw new Error("acquire_disabled");
        };

    const integrity = await repairIncompatibleCapabilityPackages({
      prisma: input.prisma,
      container: input.container,
      characterId: input.characterId,
      characterName: input.characterName,
      region: input.region,
      realm: input.realm,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      role: input.role,
      manifestId: frozen.rowId,
      acquire,
      liveRepairEnabled: liveOk,
    });
    packagesSuperseded = integrity.repaired;
    providerCalls += integrity.providerCalls;
    packageSummary = {
      inspected: integrity.inspected,
      repaired: integrity.repaired,
      alreadyCompatible: integrity.alreadyCompatible,
      skipped: integrity.skipped,
      capabilityAcquisitions: integrity.capabilityAcquisitions,
      liveRepairEnabled: liveOk,
    };
    stages.push({
      name: "package_integrity",
      status: "OK",
      detail: packageSummary,
    });
  }

  if (liveOk) {
    const client = new LiveWarcraftLogsProvider({
      env: input.env,
    }).getGraphQlClient();
    let zonePayloadCache: ZoneRankingsPayload | null | undefined;
    let zonePayloadProviderCalls = 0;
    const hydrate = await runScoringV2CanaryRankingHydrate({
      prisma: input.prisma,
      container: input.container,
      characterId: input.characterId,
      characterName: input.characterName,
      region: input.region,
      realm: input.realm,
      season: input.season,
      confirmRankingHydrate: true,
      repositoryMode: "PRODUCTION",
      env: input.env,
      outputDir: input.outputDir,
      fetchRanking: async (fight) => {
        if (zonePayloadCache === undefined) {
          const rankingsResult = await client.request({
            operationName: OPERATIONS.CharacterZoneRankings.operationName,
            query: OPERATIONS.CharacterZoneRankings.query,
            variables: {
              name: input.characterName,
              serverSlug: input.realm,
              serverRegion: mapRegionToWcl(
                input.region.toUpperCase() as "EU" | "US" | "KR" | "TW" | "CN",
              ),
              zoneID: input.zone.zoneId,
            },
            region: input.region,
          });
          zonePayloadProviderCalls = 1;
          const characterData = rankingsResult.response.data as {
            characterData?: {
              character?: { zoneRankings?: ZoneRankingsPayload | null };
            };
          } | null;
          zonePayloadCache =
            characterData?.characterData?.character?.zoneRankings ?? null;
        }
        const resolved = resolveRankingParseFromZoneRankings({
          payload: zonePayloadCache,
          zoneId: input.zone.zoneId,
          reportCode: fight.reportCode,
          fightId: fight.fightId,
          reportRevision: fight.reportRevision,
          dungeonSlug: fight.dungeonSlug,
          keyLevel: fight.keyLevel,
        });
        if (!resolved.evidence) return null;
        const { bytes, payloadFingerprint } = rankingEvidenceArtifactBytes(
          resolved.evidence,
        );
        const calls = zonePayloadProviderCalls;
        zonePayloadProviderCalls = 0;
        return {
          evidence: resolved.evidence,
          artifactBytes: bytes,
          payloadFingerprint,
          providerCalls: calls,
          estimatedPoints: resolved.estimatedPointsCost,
        };
      },
    });
    rankingFactsCreated = hydrate.report.factsCreated;
    providerCalls += hydrate.report.providerCalls;
    rankingSummary = {
      rankingFactsAlreadyReady: hydrate.report.rankingFactsAlreadyReady,
      rankingFactsMissingBefore: hydrate.report.rankingFactsMissingBefore,
      factsCreated: hydrate.report.factsCreated,
      factsReused: hydrate.report.factsReused,
      rankingStillMissing: hydrate.report.rankingStillMissing,
      capabilityEventPageRequests: hydrate.report.capabilityEventPageRequests,
      packageAcquisitions: hydrate.report.capabilityAcquisitions,
    };
    stages.push({
      name: "ranking_evidence",
      status: hydrate.report.rankingStillMissing > 0 ? "PARTIAL" : "OK",
      detail: rankingSummary,
    });
  } else {
    stages.push({
      name: "ranking_evidence",
      status: "SKIPPED",
      detail: { reason: "live_not_armed" },
    });
  }

  if (liveOk) {
    const live = await runScoringV2CanaryLive({
      prisma: input.prisma,
      container: input.container,
      characterId: input.characterId,
      characterName: input.characterName,
      region: input.region,
      realm: input.realm,
      characterResolution: input.characterResolution,
      seasonResolution: input.season,
      role: input.role,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      rateBudgetConfig: {
        warnPercent: input.env.WCL_RATE_WARN_PERCENT ?? 70,
        deferPercent: input.env.WCL_RATE_DEFER_PERCENT ?? 80,
        stopPercent: input.env.WCL_RATE_STOP_PERCENT ?? 90,
      },
      env: input.env,
      outputDir: input.outputDir,
    });
    liveHydration = live.report;
    providerCalls += live.report.graphqlRequestCount ?? 0;
    stages.push({
      name: "digest_and_dimensions",
      status: "OK",
      detail: {
        packagesCreated: live.report.packagesCreated,
        packagesReused: live.report.packagesReused,
        targetDigestCount: live.report.wallidrixeDigestCount,
        confidenceScore: live.report.confidence?.confidenceScore,
        graphqlRequestCount: live.report.graphqlRequestCount,
      },
    });
  } else {
    stages.push({
      name: "digest_and_dimensions",
      status: "SKIPPED",
      detail: { reason: "live_not_armed" },
    });
  }

  try {
    const diag = await runTargetDigestDiagnostic({
      prisma: input.prisma,
      manifestId: frozen.rowId,
      characterId: input.characterId,
      characterName: input.characterName,
      region: input.region,
      realm: input.realm,
      outputDir: input.outputDir,
    });
    digestSummary = {
      targetDigestCountByStableIdentity:
        diag.report.targetDigestCountByStableIdentity,
      problemClassSummary: diag.report.problemClassSummary,
      performance: diag.report.performance,
    };
    stages.push({
      name: "target_digest_diagnostic",
      status: "OK",
      detail: digestSummary,
    });
  } catch (err) {
    stages.push({
      name: "target_digest_diagnostic",
      status: "PARTIAL",
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  try {
    const replay = await runScoringV2CanaryReplay({
      env: input.env,
      prisma: input.prisma,
      container: input.container,
      characterId: input.characterId,
      characterName: input.characterName,
      region: input.region,
      realm: input.realm,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      role: input.role,
      season: input.season,
      repositoryMode: "PRODUCTION",
      outputDir: input.outputDir,
    });
    replaySummary = {
      providerCalls: replay.report.providerCalls,
      packagesReused: replay.report.packagesReused,
      packageAcquisitions: replay.report.packageAcquisitions,
      targetDigestCount: replay.report.wallidrixeDigestCount,
      dimensions: replay.report.dimensions,
      composite: replay.report.composite,
      publicationEnabled: replay.report.publicationEnabled,
    };
    stages.push({
      name: "replay",
      status: replay.report.providerCalls === 0 ? "OK" : "FAILED",
      detail: replaySummary,
    });
  } catch (err) {
    stages.push({
      name: "replay",
      status: "PARTIAL",
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  stages.push({
    name: "publication_safety",
    status: "OK",
    detail: {
      publicationEnabled: false,
      publicScorePointerMutated: false,
      policy: "independent_publication_gate",
    },
  });

  return persist(
    finish(input, stages, {
      outcome: "COMPLETE",
      providerCalls,
      discovery: discoverySummary,
      revisionReconciliation: revisionSummary,
      packageIntegrity: packageSummary,
      rankingEvidence: rankingSummary,
      liveHydration,
      digestDiagnostic: digestSummary,
      replay: replaySummary,
      automaticRepairs: {
        packagesSuperseded,
        rankingFactsCreated,
        revisionsReconciled,
      },
    }),
    input.outputDir,
  );
}

function finish(
  input: {
    characterId: string;
    characterName: string;
    region: string;
    realm: string;
    season: CanarySeasonResolution;
  },
  stages: ConsolidatedStageSummary[],
  extra: Partial<ConsolidatedShadowPipelineReport> & {
    outcome: ConsolidatedShadowPipelineReport["outcome"];
    providerCalls: number;
  },
): ConsolidatedShadowPipelineReport {
  return {
    schemaVersion: CONSOLIDATED_SHADOW_PIPELINE_SCHEMA,
    characterId: input.characterId,
    characterName: input.characterName,
    region: input.region,
    realm: input.realm,
    stages,
    season: {
      seasonId: input.season.seasonId,
      seasonSlug: input.season.seasonSlug,
      dungeonPoolHash: input.season.dungeonPoolHash,
    },
    discovery: extra.discovery ?? null,
    revisionReconciliation: extra.revisionReconciliation ?? null,
    packageIntegrity: extra.packageIntegrity ?? null,
    rankingEvidence: extra.rankingEvidence ?? null,
    liveHydration: extra.liveHydration ?? null,
    digestDiagnostic: extra.digestDiagnostic ?? null,
    replay: extra.replay ?? null,
    publicationEnabled: false,
    publicScorePointerMutated: false,
    automaticRepairs: extra.automaticRepairs ?? {
      packagesSuperseded: 0,
      rankingFactsCreated: 0,
      revisionsReconciled: false,
    },
    providerCalls: extra.providerCalls,
    outcome: extra.outcome,
  };
}

async function persist(
  report: ConsolidatedShadowPipelineReport,
  outputDir?: string,
): Promise<{ report: ConsolidatedShadowPipelineReport; reportPath: string }> {
  const outDir =
    outputDir ?? join(process.cwd(), "artifacts", "scoring-v2-canary");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "consolidated-pipeline-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { report, reportPath };
}
