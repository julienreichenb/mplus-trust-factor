import { randomUUID } from "node:crypto";
import type { Character, IngestionJob } from "@mplus/database";
import { normalizeRegion } from "@mplus/domain";
import {
  ExternalApiError,
  hashRefreshContract,
  type CanonicalCharacter,
  type CharacterIdentityInput,
  type ExcludedObservationDTO,
  type MetricObservationDTO,
  type MythicRunDTO,
  type ProviderFetchContext,
  type RaiderIoBoostSupportFacts,
  type RaiderIoCharacterProfile,
  type RaiderIoSeasonCutoffs,
  type RefreshCharacterJob,
  type ScoreModelConfig,
  type ScoreSnapshotDTO,
  type SourceDisagreementDTO,
  type WclVisibilityState,
  type WclDataState,
  refineWclDataState,
  normalizeWclProvenance,
} from "@mplus/contracts";
import { extractBoostSupportFacts } from "@mplus/provider-raiderio";
import type {
  RunCombatFacts,
  WclGraphQlClient,
  WclRankingObservation,
  WclReportFightDetails,
  WclRunEvidenceBundle,
} from "@mplus/provider-warcraftlogs";
import {
  SURVIVAL_STANDALONE_V1_1_1_CONFIG,
  createSurvivalRequestCost,
  getUtilityPublicationMode,
  buildUtilityShadowInputsFromBundles,
  ingestSharedEvidenceBundle,
  utilityEvidencePresentInBundle,
  readUtilityPublicationGatesFromModelConfig,
  type UtilityFallbackCandidateRun,
} from "@mplus/provider-warcraftlogs";
import {
  applyUtilityShadowRefreshBoundary,
  persistUtilityShadowDiagnostics,
  shadowDiagnosticsForScoreExplanation,
} from "./utility-shadow-refresh.js";
import {
  combatFactsStubFromHandle,
  readPersistedCombatFactsHandle,
  WCL_COMBAT_FACTS_ANALYSIS_VERSION,
} from "./persisted-combat-facts.js";
import { replaceUtilityObservationsDimensionScoped } from "./utility-publication-refresh.js";
import {
  classifyUtilitySampleState,
  emptyUtilityFallbackDiagnostics,
  runUtilityFallbackEvidencePass,
  buildUtilityFallbackIngestConsumers,
} from "./utility-fallback-refresh.js";
import { buildCatalogCoverageDiagnostics, getAbilityCatalog } from "@mplus/abilities";
import {
  applyRunMetadataToSelection,
  buildExperienceV2Observations,
  buildRankingEligibility,
  mergePriorSeasonCount,
  resolveExperienceProvenance,
  resolvePriorSeasonSourceDepth,
  readBlizzardSeasonDungeonSlugsFromMetadata,
  resolveActiveSeasonDungeonPool,
  selectScoringRuns,
  selectSurvivalAnalysisRuns,
  toContractScoringRunSelection,
} from "@mplus/scoring";
import { OBS_EVENTS, fingerprintIdentifier } from "@mplus/observability";
import { validateScoreSnapshot } from "@mplus/test-utils";
import { mergeObservationsWithLastKnownGood } from "@mplus/scoring";
import {
  buildWclSummaryRequestFingerprint,
  isCompatiblePointsAndDamageSummary,
  POINTS_AND_DAMAGE_ADAPTER_VERSION,
  CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
  resolveMplusZoneConfig,
} from "@mplus/provider-warcraftlogs";
import type { WorkerContainer } from "../container.js";
import { refreshCharacterDedupeKey } from "../dedupe.js";
import { negativeCache } from "../negative-cache.js";
import { ensureBlizzardCurrentSeason, ensureCurrentSeason } from "../persistence/run-repository.js";
import { mapBoostFactsToAuthenticity } from "./boost-authenticity.js";
import { extractMetricsFromCombatFacts, isUsableCombatRun, buildRunCombatAdminDiagnostics } from "./combat-metrics.js";
import { aggregateCombatObservations } from "./aggregate-combat-observations.js";
import { bindParseToSelectedRun } from "./run-parse-binding.js";
import { fingerprintObservations, buildScoringRunSelectionKey } from "./fingerprint.js";
import {
  allowFixtureZoneDefaultsForProviderMode,
  resolveActiveRefreshContract,
} from "./build-refresh-contract.js";
import {
  RefreshContractPreflightError,
  runRefreshContractPreflight,
} from "./refresh-contract-preflight.js";
import {
  RefreshEligibilityError,
  runRefreshEligibilityGate,
} from "./refresh-eligibility-gate.js";
import { isRefreshCancellationRequested, pickEarliestActiveRefreshJob, REFRESH_SUPERSEDED_DEDUPED_CANCEL_REASON } from "./refresh-job-control.js";
import {
  createPipelineAdmissionGate,
  runPipelineAdmission,
  settlePipelineAdmission,
  sumMeasuredWclPoints,
  type PipelineAdmissionSession,
} from "./refresh-admission/pipeline-admission.js";
import { acquireLanePermit, releaseLanePermit } from "./refresh-admission/lane-permits.js";
import { RefreshAdmissionError } from "./refresh-admission/errors.js";
import {
  DEFAULT_CONCURRENCY_CALIBRATION,
  DEFAULT_CONCURRENCY_OPERATION,
  RUNTIME_SETTING_KEYS,
  type RefreshWorkloadClass,
} from "@mplus/contracts";
import { buildMythicRatingObservation } from "./performance-metrics.js";
import { buildWclPerformanceObservations } from "./wcl-performance-metrics.js";
import {
  expectedSurvivalCompatibilityKey,
  isCompatibleSurvivalSummary,
  type SurvivalRunAnalysisRow,
} from "./wcl-survival-metrics.js";
import { buildWclSurvivalObservations } from "./wcl-survival-metrics.js";
import { createDurableSharedEvidenceStore } from "./shared-evidence-store.js";
import { analyzeSurvivalViaSharedEvidence } from "./live-shared-evidence-survival.js";
import {
  RefreshCostAccumulator,
  buildSharedEvidenceCostRecords,
  recordRefreshCostEntries,
} from "./refresh-cost-recorder.js";
import { recordProviderResult } from "./provider-recording.js";
import type { WclDungeonPerformanceAggregateDTO } from "@mplus/contracts";
import {
  excludedLowConfidenceMatch,
  isEnrichmentSoftSkip,
  mapErrorToProviderState,
  mapWclVisibilityToState,
  reconcileSources,
} from "./reconcile.js";
import { classifyError, isSoftSkip } from "./retry-classification.js";
import {
  canonicalDungeonKey,
  collectRaiderIoRuns,
  ensureTargetParticipant,
  filterRunsToActiveWindow,
  fuseCrossProviderRuns,
} from "./run-fusion.js";
import {
  buildSurvivalWclBindPool,
  matchSurvivalWclSource,
} from "./survival-wcl-late-bind.js";
import { attemptPublication, mapDbSnapshotToDto } from "./publication-flow.js";
export const REFRESH_STAGES = [
  "resolve-character",
  "refresh-blizzard",
  "refresh-raiderio",
  "refresh-warcraftlogs-summary",
  "match-detailed-runs",
  "analyze-run",
  "extract-metrics",
  "calculate-score",
  "refresh-character-finalize",
] as const;

export type RefreshStage = (typeof REFRESH_STAGES)[number];

export interface RefreshPipelineResult {
  character: Character;
  job: IngestionJob;
  score: ScoreSnapshotDTO | null;
  stagesSkipped: RefreshStage[];
  notFound: boolean;
  disagreements: SourceDisagreementDTO[];
  excludedObservations: ExcludedObservationDTO[];
  /** Detailed WCL ReportEvents calls via shared evidence (0 on reused second refresh). */
  sharedEvidenceDetailedEventCalls?: number;
}

function toIdentity(job: RefreshCharacterJob): CharacterIdentityInput {
  return { region: job.region, realmSlug: job.realmSlug, name: job.name };
}

const SUPPORTED_BATTLE_NET_REGIONS = ["EU", "US", "KR", "TW"] as const;
type SupportedBattleNetRegion = (typeof SUPPORTED_BATTLE_NET_REGIONS)[number];

function isSupportedBattleNetRegion(value: string): value is SupportedBattleNetRegion {
  return value === "EU" || value === "US" || value === "KR" || value === "TW";
}

/** Normalize then reject regions outside the Blizzard/WCL typed region union. */
function requireSupportedBattleNetRegion(region: string): SupportedBattleNetRegion {
  const normalized = normalizeRegion(region);
  if (!isSupportedBattleNetRegion(normalized)) {
    throw new Error(
      `Unsupported character region "${region}" (normalized: "${normalized}"); expected one of ${SUPPORTED_BATTLE_NET_REGIONS.join(", ")}`,
    );
  }
  return normalized;
}

function isFixtureDisabledIdentity(identity: CharacterIdentityInput): boolean {
  return identity.name.toLocaleLowerCase("en-US").includes("disabled-test");
}

function buildContext(job: RefreshCharacterJob, now: Date): ProviderFetchContext {
  const identity = toIdentity(job);
  const correlationId = job.correlationId?.trim() || null;
  const requestId = correlationId ?? randomUUID();
  return {
    region: normalizeRegion(job.region),
    requestId,
    correlationId,
    forceRefresh: job.forceRefresh,
    now: now.toISOString(),
    targetCharacter: identity,
  };
}

function isRaiderIoSkipped(container: WorkerContainer): boolean {
  return (
    container.disabledProviders.has("raiderio") ||
    ("enabled" in container.providers.raiderio && container.providers.raiderio.enabled === false)
  );
}

/**
 * Resolve character-level WCL visibility + data-state via the Wave 3 async contract.
 * Prefer `discoverCharacterSummary` → ProviderResult.data.{visibility,dataState}.
 * Never treat a Promise as a sync `{ summary }` object.
 */
async function resolveWclSummary(
  provider: WorkerContainer["providers"]["warcraftlogs"],
  identity: CharacterIdentityInput,
  ctx: ProviderFetchContext,
  record: (result: Awaited<ReturnType<NonNullable<typeof provider.discoverCharacterSummary>>>) => Promise<void>,
): Promise<{
  visibility: WclVisibilityState | null;
  dataState: WclDataState | null;
  dungeonAggregates: WclDungeonPerformanceAggregateDTO[];
  performance: {
    state: string;
    raw: unknown;
    global: {
      totalMythicPlusScore: number | null;
      totalLoggedRuns: number;
      bestDpsPercentileAverage: number | null;
      medianDpsPercentileAverage: number | null;
      partition: number | null;
      zoneId: number | null;
      specRanks: unknown[];
    } | null;
    diagnostics: Record<string, unknown> | null;
  } | null;
}> {
  if (typeof provider.discoverCharacterSummary === "function") {
    const summary = await provider.discoverCharacterSummary(identity, ctx);
    await record(summary);
    const normalized = normalizeWclProvenance(
      typeof summary.data.visibility === "string" ? summary.data.visibility : null,
      typeof (summary.data as { dataState?: unknown }).dataState === "string"
        ? ((summary.data as { dataState: string }).dataState)
        : null,
    );
    const perf = (summary.data as {
      performance?: {
        state: string;
        raw: unknown;
        global: {
          totalMythicPlusScore: number | null;
          totalLoggedRuns: number;
          bestDpsPercentileAverage: number | null;
          medianDpsPercentileAverage: number | null;
          partition: number | null;
          zoneId: number | null;
          specRanks: unknown[];
        } | null;
        diagnostics: Record<string, unknown> | null;
      } | null;
    }).performance;
    return {
      visibility: normalized.visibility,
      dataState: normalized.dataState ?? parseSummaryDataState(summary.data),
      dungeonAggregates: summary.data.dungeonAggregates ?? [],
      performance: perf ?? null,
    };
  }

  // Package-local fallback (fixture/live still expose discoverCharacter).
  const maybeDiscover = provider as {
    discoverCharacter?: (
      i: CharacterIdentityInput,
      c: ProviderFetchContext,
    ) =>
      | {
          summary: { visibility: WclVisibilityState | null; dataState?: WclDataState };
          dungeonAggregates?: WclDungeonPerformanceAggregateDTO[];
          performance?: {
            state: string;
            raw: unknown;
            global: {
              totalMythicPlusScore: number | null;
              totalLoggedRuns: number;
              bestDpsPercentileAverage: number | null;
              medianDpsPercentileAverage: number | null;
              partition: number | null;
              zoneId: number | null;
              specRanks: unknown[];
            } | null;
            diagnostics: Record<string, unknown> | null;
          };
        }
      | Promise<{
          summary: { visibility: WclVisibilityState | null; dataState?: WclDataState };
          dungeonAggregates?: WclDungeonPerformanceAggregateDTO[];
          performance?: {
            state: string;
            raw: unknown;
            global: {
              totalMythicPlusScore: number | null;
              totalLoggedRuns: number;
              bestDpsPercentileAverage: number | null;
              medianDpsPercentileAverage: number | null;
              partition: number | null;
              zoneId: number | null;
              specRanks: unknown[];
            } | null;
            diagnostics: Record<string, unknown> | null;
          };
        }>;
  };
  if (typeof maybeDiscover.discoverCharacter === "function") {
    const discovery = await Promise.resolve(maybeDiscover.discoverCharacter(identity, ctx));
    const normalized = normalizeWclProvenance(
      discovery?.summary?.visibility,
      discovery?.summary?.dataState,
    );
    return {
      visibility: normalized.visibility,
      dataState: normalized.dataState,
      dungeonAggregates: discovery?.dungeonAggregates ?? [],
      performance: discovery?.performance ?? null,
    };
  }

  return { visibility: null, dataState: null, dungeonAggregates: [], performance: null };
}

function parseSummaryDataState(summary: { dataState?: unknown; visibility?: unknown }): WclDataState | null {
  return normalizeWclProvenance(
    typeof summary.visibility === "string" ? summary.visibility : null,
    typeof summary.dataState === "string" ? summary.dataState : null,
  ).dataState;
}

function toPersistedCombatFacts(facts: RunCombatFacts) {
  return {
    reportCode: facts.reportCode,
    fightId: facts.fightId,
    revision: facts.revision,
    targetSourceId: facts.targetSourceId,
    attributedSourceIds: facts.attributedSourceIds,
    coverage: facts.coverage,
    limitations: facts.limitations,
  };
}

/**
 * Runs the full refresh DAG synchronously (no BullMQ). Used directly by tests and by the
 * `refresh-character` queue processor — analyze-run executes inline for simplicity, matching
 * the fixture-mode allowance in the orchestration plan.
 *
 * Blizzard is the identity gate. Raider.IO and WCL enrichment run concurrently afterward and
 * soft-skip on failure so a Blizzard-backed provisional score can still persist.
 */
export async function runRefreshPipeline(
  container: WorkerContainer,
  jobPayload: RefreshCharacterJob,
): Promise<RefreshPipelineResult> {
  const { repositories, providers, disabledProviders, logger } = container;
  const identity = toIdentity(jobPayload);
  const now = new Date();
  const ctx = buildContext(jobPayload, now);
  const stagesSkipped: RefreshStage[] = [];
  const disagreements: SourceDisagreementDTO[] = [];
  const excludedObservations: ExcludedObservationDTO[] = [];
  const fusionWarnings: string[] = [];
  const refreshCostAccumulator = new RefreshCostAccumulator();
  let sharedEvidenceDetailedEventCalls = 0;
  const sharedEvidenceBundlesForUtility: WclRunEvidenceBundle[] = [];
  const identityFingerprint = fingerprintIdentifier(
    `${identity.region}:${identity.realmSlug}:${identity.name}`.toLocaleLowerCase("en-US"),
  );
  const logBase = {
    correlationId: ctx.correlationId ?? ctx.requestId,
    identityFingerprint,
    region: identity.region,
    characterId: jobPayload.characterId ?? null,
    triggerSource: jobPayload.triggerSource ?? "UNKNOWN",
    requestedRefreshContractHash: jobPayload.refreshContractHash ?? null,
  };

  logger.info({ ...logBase, event: OBS_EVENTS.refreshWorkerStarted }, OBS_EVENTS.refreshWorkerStarted);

  const dedupeKey = refreshCharacterDedupeKey(jobPayload);
  const { job: createdJob, reused } = await repositories.job.createOrGetByDedupe({
    jobType: "refresh-character",
    dedupeKey,
    payload: jobPayload,
  });
  logger.info(
    { ...logBase, event: OBS_EVENTS.refreshDedupe, dedupeKey, reused, jobId: createdJob.id },
    OBS_EVENTS.refreshDedupe,
  );

  // Provider-free terminal-state guard: refuse before markActive / provider work.
  // Covers QUEUED losers collapsed to REFRESH_SUPERSEDED_DEDUPED whose BullMQ message
  // still arrived (createOrGetByDedupe will not resurrect that error code).
  if (
    createdJob.status === "FAILED" ||
    createdJob.status === "CANCELLED" ||
    createdJob.status === "COMPLETED"
  ) {
    const terminalCode =
      (createdJob.error as { code?: string } | null)?.code ?? createdJob.status;
    logger.info(
      {
        ...logBase,
        event: OBS_EVENTS.refreshTerminal,
        jobId: createdJob.id,
        status: createdJob.status,
        stage: "terminal_guard_pre_mark_active",
        providerCalls: 0,
        errorCode: terminalCode,
      },
      OBS_EVENTS.refreshTerminal,
    );
    const err = Object.assign(
      new Error(`Refresh refused — job already terminal (${createdJob.status})`),
      {
        code: terminalCode,
        retryable: false,
        providerFailure: false,
      },
    );
    throw err;
  }

  let job = await repositories.job.markActive(createdJob.id);
  let terminalized = false;
  let admissionSession: PipelineAdmissionSession | null = null;
  let admissionRedis: ReturnType<WorkerContainer["createRedisConnection"]> | null = null;
  let laneHeld: RefreshWorkloadClass | null = null;

  const releaseAdmission = async (
    status: "SETTLED" | "RELEASED" | "CANCELLED" | "EXPIRED",
  ): Promise<void> => {
    try {
      await settlePipelineAdmission({
        session: admissionSession,
        ingestionJobId: job.id,
        measuredWclPoints: sumMeasuredWclPoints(refreshCostAccumulator.records),
        status,
        logger,
      });
    } catch (err) {
      logger.warn(
        { ...logBase, event: "refresh_admission_settle_failed", err, status },
        "refresh_admission_settle_failed",
      );
    } finally {
      if (laneHeld && admissionRedis) {
        try {
          await releaseLanePermit({
            redis: admissionRedis,
            appEnv: container.env.APP_ENV,
            lane: laneHeld,
            ingestionJobId: job.id,
            logger,
          });
        } catch {
          /* ignore */
        }
        laneHeld = null;
      }
      admissionSession = null;
      if (admissionRedis) {
        try {
          await admissionRedis.quit();
        } catch {
          /* ignore */
        }
        admissionRedis = null;
      }
    }
  };

  const ensureFailed = async (error: unknown): Promise<void> => {
    if (terminalized) return;
    const current = await repositories.job.findById(job.id);
    if (current && (current.status === "QUEUED" || current.status === "ACTIVE")) {
      if (current.cancelRequestedAt || (error as { code?: string })?.code === "CANCELLED") {
        await releaseAdmission("CANCELLED");
        job = await repositories.job.markCancelled(job.id, {
          reason: current.cancelReason ?? "admin_cancel",
          error:
            error && typeof error === "object"
              ? error
              : {
                  code: "CANCELLED",
                  message: "Refresh cancelled",
                  retryable: false,
                  providerFailure: false,
                },
        });
      } else {
        const status =
          error instanceof RefreshAdmissionError && error.deferred ? "RELEASED" : "RELEASED";
        await releaseAdmission(status);
        job = await repositories.job.markFailed(job.id, error);
      }
    }
    terminalized = true;
  };

  const assertNotCancelled = async (checkpoint: string): Promise<void> => {
    if (terminalized) return;
    const requested = await isRefreshCancellationRequested(repositories.job, job.id);
    if (!requested) return;
    const current = await repositories.job.findById(job.id);
    // Cross-process collapse uses cooperative cancel with a dedicated reason —
    // terminalize as REFRESH_SUPERSEDED_DEDUPED (not generic CANCELLED).
    if (current?.cancelReason === REFRESH_SUPERSEDED_DEDUPED_CANCEL_REASON) {
      await releaseAdmission("CANCELLED");
      job = await repositories.job.markFailed(job.id, {
        code: "REFRESH_SUPERSEDED_DEDUPED",
        message: "Superseded by an earlier in-flight refresh for the same character",
        retryable: false,
        providerFailure: false,
        checkpoint,
      });
      terminalized = true;
      const err = Object.assign(new Error(`Refresh superseded at ${checkpoint}`), {
        code: "REFRESH_SUPERSEDED_DEDUPED",
        retryable: false,
        providerFailure: false,
      });
      throw err;
    }
    await releaseAdmission("CANCELLED");
    job = await repositories.job.markCancelled(job.id, {
      reason: current?.cancelReason ?? "admin_cancel",
      error: {
        code: "CANCELLED",
        message: `Cancelled at checkpoint ${checkpoint}`,
        retryable: false,
        providerFailure: false,
        checkpoint,
      },
    });
    terminalized = true;
    const err = Object.assign(new Error(`Refresh cancelled at ${checkpoint}`), {
      code: "CANCELLED",
      retryable: false,
      providerFailure: false,
    });
    throw err;
  };

  /**
   * Provider-free character-scoped winner guard (defense in depth after collapse).
   * If another ACTIVE/QUEUED refresh is earlier, refuse before contract preflight.
   */
  const assertStillWinningRefresh = async (checkpoint: string): Promise<void> => {
    if (terminalized) return;
    const characterId = job.characterId ?? jobPayload.characterId ?? null;
    if (!characterId || typeof repositories.job.listActiveRefreshJobsForCharacter !== "function") {
      return;
    }
    const actives = await repositories.job.listActiveRefreshJobsForCharacter(characterId);
    const winner = pickEarliestActiveRefreshJob(actives);
    if (!winner || winner.id === job.id) return;
    await releaseAdmission("CANCELLED");
    job = await repositories.job.markFailed(job.id, {
      code: "REFRESH_SUPERSEDED_DEDUPED",
      message: "Superseded by an earlier in-flight refresh for the same character",
      winnerJobId: winner.id,
      retryable: false,
      providerFailure: false,
      checkpoint,
    });
    terminalized = true;
    logger.info(
      {
        ...logBase,
        event: OBS_EVENTS.refreshTerminal,
        jobId: job.id,
        status: "FAILED",
        stage: checkpoint,
        providerCalls: 0,
        errorCode: "REFRESH_SUPERSEDED_DEDUPED",
        winnerJobId: winner.id,
      },
      OBS_EVENTS.refreshTerminal,
    );
    const err = Object.assign(new Error(`Refresh superseded at ${checkpoint}`), {
      code: "REFRESH_SUPERSEDED_DEDUPED",
      retryable: false,
      providerFailure: false,
    });
    throw err;
  };

  await assertNotCancelled("post_mark_active");
  await assertStillWinningRefresh("post_mark_active_winner_guard");

  try {
  // ── Contract preflight barrier (fail-fast, before any provider work) ─────
  // Guarantees zero Blizzard / Raider.IO / WCL calls, zero run/metric/
  // provider-state/snapshot writes, and zero WCL budget on mismatch.
  let preflightAuthority: Awaited<ReturnType<typeof runRefreshContractPreflight>>["authority"];
  try {
    const preflight = await runRefreshContractPreflight(
      {
        prisma: container.prisma,
        blizzard: providers.blizzard,
        logger,
        env: container.env,
        getActiveModel: (key) => repositories.score.getActiveModel(key),
      },
      jobPayload,
      {
        jobId: job.id,
        correlationId: ctx.correlationId ?? ctx.requestId,
      },
    );
    preflightAuthority = preflight.authority;
  } catch (preflightError) {
    if (preflightError instanceof RefreshContractPreflightError) {
      job = await repositories.job.markFailed(job.id, preflightError.toJobError());
      terminalized = true;
      logger.info(
        {
          ...logBase,
          event: OBS_EVENTS.refreshTerminal,
          jobId: job.id,
          status: "FAILED",
          stage: "preflight",
          providerCalls: 0,
          costLedgerRecords: refreshCostAccumulator.records.length,
          errorCode: preflightError.code,
        },
        OBS_EVENTS.refreshTerminal,
      );
      // Diagnostic: preflight must leave the in-memory cost ledger empty.
      if (refreshCostAccumulator.records.length !== 0) {
        logger.error(
          {
            ...logBase,
            event: "refresh_contract_preflight_cost_invariant_violated",
            costLedgerRecords: refreshCostAccumulator.records.length,
          },
          "preflight mismatch recorded provider cost — invariant violated",
        );
      }
      throw preflightError;
    }
    throw preflightError;
  }

  await assertNotCancelled("post_preflight");

  if (negativeCache.has(identity) && !jobPayload.forceRefresh) {
    job = await repositories.job.markFailed(job.id, new Error("negative cache hit: identity not found"));
    terminalized = true;
    throw new ExternalApiError({
      message: `Character ${identity.name} is negatively cached as NOT_FOUND`,
      code: "NOT_FOUND",
      provider: "blizzard",
      retryable: false,
    });
  }

  let character = await repositories.character.upsertCharacter(identity, { displayName: jobPayload.name });
  job = await repositories.job.attachCharacter(job.id, character.id);

  // ── Eligibility gate (fail-fast, after contract preflight, before providers) ─
  // Uses persisted Character + season-scoped evidence only — zero provider calls.
  // Identical fail-closed behavior in live / fixture / mock / inline / BullMQ.
  try {
    await runRefreshEligibilityGate(
      { prisma: container.prisma, logger, maxCharacterLevel: container.env.MAX_CHARACTER_LEVEL },
      {
        characterId: character.id,
        authority: preflightAuthority,
        jobId: job.id,
        triggerSource: jobPayload.triggerSource ?? null,
      },
    );
  } catch (eligibilityError) {
    if (eligibilityError instanceof RefreshEligibilityError) {
      job = await repositories.job.markFailed(job.id, eligibilityError.toJobError());
      terminalized = true;
      logger.info(
        {
          ...logBase,
          event: OBS_EVENTS.refreshTerminal,
          jobId: job.id,
          status: "FAILED",
          stage: "eligibility",
          providerCalls: 0,
          costLedgerRecords: refreshCostAccumulator.records.length,
          errorCode: eligibilityError.code,
        },
        OBS_EVENTS.refreshTerminal,
      );
      throw eligibilityError;
    }
    throw eligibilityError;
  }

  await assertNotCancelled("post_eligibility");

  // ── Admission gate (Stage 3: enforce @ serial concurrency 1) ───────────────
  // After cancel / contract / eligibility; before any Blizzard / RIO / WCL work.
  // Always open Redis for lane permits (even when REFRESH_ADMISSION_MODE=off).
  try {
    admissionRedis = container.createRedisConnection();
  } catch {
    admissionRedis = null;
  }

  const workloadClass: RefreshWorkloadClass =
    (payload.workloadClass as RefreshWorkloadClass | undefined) ??
    (job.workloadClass as RefreshWorkloadClass | undefined) ??
    "OPERATION";

  if (admissionRedis) {
    const settings = await container.prisma.runtimeSetting.findMany({
      where: {
        key: {
          in: [
            RUNTIME_SETTING_KEYS.concurrencyCalibration,
            RUNTIME_SETTING_KEYS.concurrencyOperation,
          ],
        },
      },
    });
    const cal =
      Number(
        settings.find((s) => s.key === RUNTIME_SETTING_KEYS.concurrencyCalibration)?.value,
      ) || DEFAULT_CONCURRENCY_CALIBRATION;
    const op =
      Number(
        settings.find((s) => s.key === RUNTIME_SETTING_KEYS.concurrencyOperation)?.value,
      ) || DEFAULT_CONCURRENCY_OPERATION;
    const limit = workloadClass === "CALIBRATION" ? cal : op;
    const permit = await acquireLanePermit({
      redis: admissionRedis,
      appEnv: container.env.APP_ENV,
      lane: workloadClass,
      ingestionJobId: job.id,
      limit,
      logger,
    });
    if (!permit.acquired) {
      const err = new RefreshAdmissionError({
        reason: "INSUFFICIENT_GLOBAL_SLOTS",
        message: `Refresh lane ${workloadClass} at limit ${permit.limit}`,
      });
      job = await repositories.job.markFailed(job.id, err.toJobError());
      terminalized = true;
      await releaseAdmission("RELEASED");
      throw err;
    }
    laneHeld = workloadClass;
  }

  if (container.env.REFRESH_ADMISSION_MODE !== "off") {
    const { gate, repository } = createPipelineAdmissionGate({
      env: container.env,
      redis: admissionRedis,
      prisma: container.prisma,
      logger,
    });
    try {
      admissionSession = await runPipelineAdmission({
        env: container.env,
        gate,
        repository,
        ingestionJobId: job.id,
        characterId: character.id,
        wclEnabled: !disabledProviders.has("warcraftlogs") && container.env.WCL_ENABLED,
        logger,
        correlationId: ctx.correlationId ?? ctx.requestId,
      });
    } catch (admissionError) {
      if (admissionError instanceof RefreshAdmissionError) {
        job = await repositories.job.markFailed(job.id, admissionError.toJobError());
        terminalized = true;
        logger.info(
          {
            ...logBase,
            event: OBS_EVENTS.refreshTerminal,
            jobId: job.id,
            status: "FAILED",
            stage: "admission",
            providerCalls: 0,
            costLedgerRecords: refreshCostAccumulator.records.length,
            errorCode: admissionError.code,
            admissionReason: admissionError.reason,
            deferred: admissionError.deferred,
          },
          OBS_EVENTS.refreshTerminal,
        );
        await releaseAdmission("RELEASED");
        throw admissionError;
      }
      throw admissionError;
    }
  }

  await assertNotCancelled("post_admission");

  const failHard = async (stage: RefreshStage, error: unknown): Promise<never> => {
    if (error instanceof ExternalApiError && error.code === "NOT_FOUND") {
      negativeCache.set(identity);
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "blizzard",
        state: "NOT_FOUND",
        detail: error.message,
        lastAttemptAt: now,
      });
    }
    const classification = classifyError(error);
    logger.error({ stage, identity, err: error, classification }, "refresh pipeline: stage failed");
    await ensureFailed(error);
    throw error;
  };

  let blizzardProfile: CanonicalCharacter | null = null;
  let blizzardItemLevel: number | null = null;
  let mythicKeystoneScore: number | null = null;
  let currentSeasonId: number | null = null;
  let authoritativeSeasonSource: "season_index.current_season" | "season_index.last" | null = null;
  let characterProfileSeasonIds: number[] = [];
  let blizzardRuns: MythicRunDTO[] = [];
  let raiderIoProfile: RaiderIoCharacterProfile | null = null;
  let seasonCutoffs: RaiderIoSeasonCutoffs | null = null;
  let boostFacts: RaiderIoBoostSupportFacts | null = null;
  let wclVisibility: WclVisibilityState | null = null;
  let wclDataState: WclDataState | null = null;
  let discoveredRuns: MythicRunDTO[] = [];

  // ── Blizzard identity gate ──────────────────────────────────────────────
  await assertNotCancelled("pre_blizzard");
  if (disabledProviders.has("blizzard") || isFixtureDisabledIdentity(identity)) {
    stagesSkipped.push("refresh-blizzard");
    await repositories.providerState.upsert({
      characterId: character.id,
      provider: "blizzard",
      state: "UNAVAILABLE",
      detail: "provider disabled",
      lastAttemptAt: now,
    });
  } else {
    try {
      logger.info(
        { ...logBase, event: OBS_EVENTS.refreshProviderPhaseStarted, provider: "blizzard" },
        OBS_EVENTS.refreshProviderPhaseStarted,
      );
      const profile = await providers.blizzard.getCharacterProfile(identity, ctx);
      blizzardProfile = profile.data;
      character = await repositories.character.applyProviderProfile(character.id, profile.data);
      await recordProviderResult(repositories, profile);

      const equipment = await providers.blizzard.getCharacterEquipment(identity, ctx);
      blizzardItemLevel =
        equipment.data.itemLevelEquipped ?? blizzardProfile.itemLevelEquipped ?? null;
      const equipmentSnapshot = await providers.blizzard.getEquipmentSnapshot(identity, ctx);

      let mediaExtras: {
        avatarUrl: string | null;
        insetUrl: string | null;
        mainRawUrl: string | null;
      } | null = null;
      try {
        const media = await providers.blizzard.getCharacterMedia(identity, ctx);
        await recordProviderResult(repositories, media);
        mediaExtras = {
          avatarUrl: media.data.avatarUrl,
          insetUrl: media.data.insetUrl,
          mainRawUrl: media.data.mainUrl,
        };
      } catch (mediaError) {
        logger.info({ identity, err: mediaError }, "refresh pipeline: character media soft-skip");
      }

      let talentExtras: {
        specializationSlug: string | null;
        loadoutCode: string | null;
        talents: unknown;
      } | null = null;
      try {
        const talents = await providers.blizzard.getTalentSnapshot(identity, ctx);
        await recordProviderResult(repositories, talents);
        talentExtras = {
          specializationSlug: talents.data.specializationSlug,
          loadoutCode: talents.data.loadoutCode,
          talents: talents.data.talents,
        };
      } catch (talentError) {
        logger.info({ identity, err: talentError }, "refresh pipeline: talent snapshot soft-skip");
      }

      const equippedItemLevel =
        equipmentSnapshot.data.equippedItemLevel ?? blizzardProfile.itemLevelEquipped ?? null;
      const averageItemLevel =
        equipmentSnapshot.data.averageItemLevel ?? blizzardProfile.itemLevelAverage ?? null;

      await repositories.character.recordSnapshot(
        character.id,
        {
          ...equipment.data,
          itemLevelEquipped: equipment.data.itemLevelEquipped ?? blizzardProfile.itemLevelEquipped ?? null,
        },
        {
          averageItemLevel,
          equippedItemLevel,
          items: equipmentSnapshot.data.items,
          keyItems: equipmentSnapshot.data.keyItems,
        },
        { media: mediaExtras, talent: talentExtras },
      );
      await recordProviderResult(repositories, equipment);
      await recordProviderResult(repositories, equipmentSnapshot);

      // Prefer specialization/role from the equipment+talents bundle when profile omitted them.
      if (
        (!blizzardProfile.specSlug || !blizzardProfile.role) &&
        (equipment.data.activeSpecSlug || equipment.data.role)
      ) {
        character = await repositories.character.applyProviderProfile(character.id, {
          ...blizzardProfile,
          specSlug: blizzardProfile.specSlug ?? equipment.data.activeSpecSlug,
          role: blizzardProfile.role ?? equipment.data.role,
        });
        blizzardProfile = {
          ...blizzardProfile,
          specSlug: blizzardProfile.specSlug ?? equipment.data.activeSpecSlug,
          role: blizzardProfile.role ?? equipment.data.role,
        };
      }

      const authoritativeSeason = await providers.blizzard.resolveAuthoritativeCurrentSeasonId(ctx);
      currentSeasonId = authoritativeSeason.data.seasonId;
      authoritativeSeasonSource = authoritativeSeason.data.source;
      await recordProviderResult(repositories, authoritativeSeason);

      const keystoneProfile = await providers.blizzard.getMythicKeystoneProfile(identity, ctx);
      mythicKeystoneScore = keystoneProfile.data.currentMythicRating;
      characterProfileSeasonIds = keystoneProfile.data.seasons.map((s) => s.seasonId);
      // Prefer authoritative regional season — never character seasons[] order.
      currentSeasonId = authoritativeSeason.data.seasonId;
      await recordProviderResult(repositories, keystoneProfile);

      if (currentSeasonId != null) {
        try {
          const seasonProfile = await providers.blizzard.getMythicKeystoneSeasonProfile(
            identity,
            currentSeasonId,
            ctx,
          );
          blizzardRuns = seasonProfile.data.runs;
          await recordProviderResult(repositories, seasonProfile);
        } catch (seasonError) {
          logger.info(
            { identity, err: seasonError },
            "refresh pipeline: Blizzard season profile optional fetch failed",
          );
        }
      }

      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "blizzard",
        state: "OK",
        lastAttemptAt: now,
        lastSuccessAt: now,
        fetchedAt: now,
        expiresAt: keystoneProfile.freshness.expiresAt
          ? new Date(keystoneProfile.freshness.expiresAt)
          : null,
      });
      logger.info(
        {
          ...logBase,
          event: OBS_EVENTS.refreshProviderPhaseCompleted,
          provider: "blizzard",
          resultState: "OK",
          recordsDiscovered: blizzardRuns.length,
        },
        OBS_EVENTS.refreshProviderPhaseCompleted,
      );
    } catch (error) {
      if (isSoftSkip(error)) {
        stagesSkipped.push("refresh-blizzard");
        await repositories.providerState.upsert({
          characterId: character.id,
          provider: "blizzard",
          state: "UNAVAILABLE",
          detail: error instanceof Error ? error.message : "soft-skip",
          lastAttemptAt: now,
        });
      } else {
        await failHard("refresh-blizzard", error);
      }
    }
  }

  await assertNotCancelled("post_blizzard");

  // ── Concurrent Raider.IO + WCL enrichment ───────────────────────────────
  type RaiderIoEnrichment = {
    profile: RaiderIoCharacterProfile | null;
    cutoffs: RaiderIoSeasonCutoffs | null;
    boost: RaiderIoBoostSupportFacts | null;
  };
  type WclEnrichment = {
    visibility: WclVisibilityState | null;
    dataState: WclDataState | null;
    runs: MythicRunDTO[];
    dungeonAggregates: WclDungeonPerformanceAggregateDTO[];
    rankings: WclRankingObservation[];
    performance: Awaited<ReturnType<typeof resolveWclSummary>>["performance"];
    rejectedLegacyCache: boolean;
  };

  const enrichRaiderIo = async (): Promise<RaiderIoEnrichment> => {
    if (isRaiderIoSkipped(container) || isFixtureDisabledIdentity(identity)) {
      stagesSkipped.push("refresh-raiderio");
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "raiderio",
        state: "UNAVAILABLE",
        detail: "provider disabled",
        lastAttemptAt: now,
      });
      return { profile: null, cutoffs: null, boost: null };
    }

    try {
      logger.info(
        { ...logBase, event: OBS_EVENTS.refreshProviderPhaseStarted, provider: "raiderio" },
        OBS_EVENTS.refreshProviderPhaseStarted,
      );
      const profile = await providers.raiderio.getCharacterProfile(identity, ctx);
      const boost = extractBoostSupportFacts(profile.data);
      if (profile.data.profileUrl) {
        character = await repositories.character.updateRaiderioProfile(
          character.id,
          profile.data.profileUrl,
        );
      }
      await recordProviderResult(repositories, profile);
      await recordProviderResult(repositories, {
        ...profile,
        data: boost,
        metadata: {
          ...profile.metadata,
          endpointKey: "extractBoostSupportFacts",
          requestFingerprint: `${profile.metadata.requestFingerprint}:boost-facts`,
        },
      });

      let cutoffs: RaiderIoSeasonCutoffs | null = null;
      // Season cutoffs are optional and must remain non-blocking (live often HTTP 500).
      try {
        const seasonSlug =
          profile.data.currentSeason?.seasonSlug ??
          (await ensureCurrentSeason(container.prisma, character.regionId)).slug;
        const cutoffsResult = await providers.raiderio.getSeasonCutoffs(
          identity.region,
          seasonSlug,
          ctx,
        );
        cutoffs = cutoffsResult.data;
        await recordProviderResult(repositories, cutoffsResult);
        if (!cutoffsResult.data.top25Percent) {
          fusionWarnings.push("RAIDERIO_SEASON_CUTOFFS_UNAVAILABLE");
        }
      } catch (cutoffError) {
        fusionWarnings.push("RAIDERIO_SEASON_CUTOFFS_UNAVAILABLE");
        logger.info(
          { identity, err: cutoffError },
          "refresh pipeline: Raider.IO season-cutoffs non-blocking failure",
        );
      }

      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "raiderio",
        state: profile.data.crawlStale ? "STALE" : "OK",
        warnings: profile.data.crawlStale ? ["CRAWL_STALE"] : [],
        lastAttemptAt: now,
        lastSuccessAt: now,
        fetchedAt: now,
        expiresAt: profile.freshness.expiresAt ? new Date(profile.freshness.expiresAt) : null,
        metadata: {
          raiderIoScore: profile.data.currentSeason?.scores.all ?? null,
          profileUrl: profile.data.profileUrl,
        },
      });
      return { profile: profile.data, cutoffs, boost };
    } catch (error) {
      if (isEnrichmentSoftSkip(error)) {
        stagesSkipped.push("refresh-raiderio");
        await repositories.providerState.upsert({
          characterId: character.id,
          provider: "raiderio",
          state: mapErrorToProviderState(error),
          detail: error instanceof Error ? error.message : "enrichment soft-skip",
          lastAttemptAt: now,
        });
        logger.info({ identity, err: error }, "refresh pipeline: Raider.IO soft-skipped");
        return { profile: null, cutoffs: null, boost: null };
      }
      return await failHard("refresh-raiderio", error);
    }
  };

  const enrichWarcraftLogs = async (
    hydrationHints: NonNullable<ProviderFetchContext["wclHydrationHints"]>,
  ): Promise<WclEnrichment> => {
    if (disabledProviders.has("warcraftlogs") || isFixtureDisabledIdentity(identity)) {
      stagesSkipped.push("refresh-warcraftlogs-summary");
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "warcraftlogs",
        state: "UNAVAILABLE",
        detail: "provider disabled",
        lastAttemptAt: now,
      });
      return { visibility: null, dataState: null, runs: [], dungeonAggregates: [], rankings: [], performance: null, rejectedLegacyCache: false };
    }

    const wclCtx: ProviderFetchContext = {
      ...ctx,
      wclHydrationHints: hydrationHints,
    };

    let visibility: WclVisibilityState | null = null;
    let dataState: WclDataState | null = null;
    let dungeonAggregates: WclDungeonPerformanceAggregateDTO[] = [];
    let performance: WclEnrichment["performance"] = null;
    let rejectedLegacyCache = false;
    try {
      logger.info(
        { ...logBase, event: OBS_EVENTS.refreshProviderPhaseStarted, provider: "warcraftlogs" },
        OBS_EVENTS.refreshProviderPhaseStarted,
      );

      const zoneId = resolveMplusZoneConfig({
        env: process.env,
        allowFixtureDefault: allowFixtureZoneDefaultsForProviderMode(container.env.PROVIDER_MODE),
      }).zoneId;
      const summaryFingerprint = buildWclSummaryRequestFingerprint({
        region: identity.region,
        realmSlug: identity.realmSlug,
        name: identity.name,
        zoneId,
        partition: null,
      });

      // Always inspect the fingerprint cache — even on forceRefresh — so legacy payloads are
      // explicitly rejected and never treated as a successful points_and_damage dataset.
      const cached = await repositories.externalRequest.findFreshPayloadByFingerprint({
        requestFingerprint: summaryFingerprint,
        now,
      });
      if (cached?.payload?.payload != null) {
        if (!isCompatiblePointsAndDamageSummary(cached.payload.payload)) {
          rejectedLegacyCache = true;
          fusionWarnings.push("WCL_LEGACY_SUMMARY_CACHE_REJECTED");
          logger.warn(
            {
              identity,
              requestFingerprint: summaryFingerprint,
              schemaVersion: cached.payload.schemaVersion,
              forceRefresh: jobPayload.forceRefresh,
            },
            "refresh pipeline: rejected incompatible legacy WCL summary cache — forcing live points_and_damage fetch",
          );
        }
      }

      const summary = await resolveWclSummary(
        providers.warcraftlogs,
        identity,
        { ...wclCtx, forceRefresh: jobPayload.forceRefresh || rejectedLegacyCache },
        async (result) => {
          // Never persist an incompatible legacy-shaped summary as a successful cache entry.
          if (
            result.metadata.endpointKey === "discoverCharacterSummary" &&
            !isCompatiblePointsAndDamageSummary(result.data) &&
            (result.data as { performance?: { state?: string } })?.performance?.state !== "SKIPPED"
          ) {
            fusionWarnings.push("WCL_POINTS_AND_DAMAGE_SUMMARY_INCOMPATIBLE");
            await recordProviderResult(repositories, {
              ...result,
              metadata: {
                ...result.metadata,
                cacheHit: false,
                statusCode: result.metadata.statusCode ?? 200,
              },
              provenance: {
                ...result.provenance,
                schemaVersion: `${POINTS_AND_DAMAGE_ADAPTER_VERSION}:rejected`,
              },
            });
            return;
          }
          await recordProviderResult(repositories, {
            ...result,
            metadata: {
              ...result.metadata,
              cacheHit: false,
            },
          });
        },
      );
      visibility = summary.visibility;
      dataState = summary.dataState;
      dungeonAggregates = summary.dungeonAggregates;
      performance = summary.performance;

      const performanceOkForSuccess =
        performance?.state === "OK" || performance?.state === "SKIPPED";

      const runsResult = await providers.warcraftlogs.discoverCharacterRuns(identity, wclCtx);
      await recordProviderResult(repositories, runsResult);
      const wclRankings =
        (runsResult as { wclRankings?: WclRankingObservation[] }).wclRankings ?? [];

      // Do not mark WCL refresh successful when Performance came back incompatible/error.
      const markSuccess = performanceOkForSuccess || performance == null;
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "warcraftlogs",
        state: markSuccess
          ? mapWclVisibilityToState(visibility, dataState)
          : "UNAVAILABLE",
        detail: markSuccess
          ? undefined
          : `points_and_damage Performance unavailable (${performance?.state ?? "missing"})`,
        wclVisibility: visibility,
        lastAttemptAt: now,
        ...(markSuccess ? { lastSuccessAt: now } : {}),
        fetchedAt: now,
        expiresAt: runsResult.freshness.expiresAt ? new Date(runsResult.freshness.expiresAt) : null,
        metadata: {
          wclDataState: dataState,
          discoveredRunCount: runsResult.data.length,
          hydrationHintCount: hydrationHints.length,
          dungeonAggregateCount: dungeonAggregates.length,
          performanceState: performance?.state ?? null,
          performanceAdapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
          rejectedLegacyCache,
          summaryFingerprint,
        },
      });
      return {
        visibility,
        dataState,
        runs: runsResult.data,
        dungeonAggregates,
        rankings: wclRankings,
        performance,
        rejectedLegacyCache,
      };
    } catch (error) {
      // WCL is enrichment-only: never block a Blizzard/Raider.IO-backed MVP score.
      // GraphQL schema / invalid-response errors stay UNAVAILABLE with detail.
      // Performance may already be OK from summary even if combat/report hydration fails later.
      stagesSkipped.push("refresh-warcraftlogs-summary");
      const state = mapErrorToProviderState(error);
      const failedDataState: WclDataState =
        state === "RATE_LIMITED" ? "RATE_LIMITED" : dataState ?? "UNAVAILABLE";
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "warcraftlogs",
        state:
          state === "PRIVATE_OR_HIDDEN"
            ? "PRIVATE_OR_HIDDEN"
            : visibility
              ? mapWclVisibilityToState(visibility, failedDataState)
              : state,
        detail: error instanceof Error ? error.message : "enrichment soft-skip",
        wclVisibility: visibility,
        lastAttemptAt: now,
        metadata: {
          wclDataState: failedDataState,
          performanceState: performance?.state ?? null,
          performanceAdapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
          rejectedLegacyCache,
        },
      });
      logger.info({ identity, err: error }, "refresh pipeline: WCL soft-skipped");
      return {
        visibility,
        dataState: failedDataState,
        runs: [],
        dungeonAggregates,
        rankings: [],
        performance,
        rejectedLegacyCache,
      };
    }
  };

  // Raider.IO first so current-season run hints can prioritize WCL report hydration.
  await assertNotCancelled("pre_raiderio");
  const rioEnrichment = await enrichRaiderIo();
  raiderIoProfile = rioEnrichment.profile;
  seasonCutoffs = rioEnrichment.cutoffs;
  boostFacts = rioEnrichment.boost;
  await assertNotCancelled("post_raiderio");

  const rioRunsRaw =
    raiderIoProfile != null
      ? collectRaiderIoRuns(raiderIoProfile.recentRuns, raiderIoProfile.bestRuns, identity)
      : [];
  const nowMs = now.getTime();
  blizzardRuns = filterRunsToActiveWindow(blizzardRuns, { nowMs });
  const rioRuns = filterRunsToActiveWindow(rioRunsRaw, { nowMs });
  const hydrationHints = [...blizzardRuns, ...rioRuns].map((run) => ({
    completedAt: run.completedAt,
    dungeonSlug: run.dungeonSlug,
    keyLevel: run.keyLevel,
  }));

  await assertNotCancelled("pre_warcraftlogs");
  const wclEnrichment = await enrichWarcraftLogs(hydrationHints);
  wclVisibility = wclEnrichment.visibility;
  wclDataState = wclEnrichment.dataState;
  discoveredRuns = wclEnrichment.runs;
  const wclDungeonAggregates = wclEnrichment.dungeonAggregates;
  const wclRankings = wclEnrichment.rankings;
  const wclPerformanceRecord = wclEnrichment.performance;
  const wclRejectedLegacyCache = wclEnrichment.rejectedLegacyCache;
  await assertNotCancelled("post_warcraftlogs");

  // ── Reconcile + fuse runs ───────────────────────────────────────────────
  const reconcile = reconcileSources({
    blizzard: blizzardProfile,
    blizzardItemLevel,
    raiderIo: raiderIoProfile,
    blizzardMythicRating: mythicKeystoneScore,
  });
  disagreements.push(...reconcile.disagreements);
  fusionWarnings.push(...reconcile.warnings);

  // Resolve Blizzard current season from the regional season index — never from
  // a character profile seasons[] array — before persistence so runs/scores share one identity.
  const previousDatabaseSeason = await container.prisma.season.findFirst({
    where: { regionId: character.regionId, isCurrent: true },
    select: { id: true, slug: true, blizzardSeasonId: true },
  });

  // Real season transition after enqueue: supersede obsolete jobs without a public technical failure.
  if (
    jobPayload.authoritativeSeasonId != null &&
    currentSeasonId != null &&
    jobPayload.authoritativeSeasonId !== currentSeasonId
  ) {
    logger.info(
      {
        ...logBase,
        event: "refresh_season_authority",
        reason: "job_season_superseded",
        authoritativeSeasonId: currentSeasonId,
        jobAuthoritativeSeasonId: jobPayload.authoritativeSeasonId,
        previousDatabaseSeasonId: previousDatabaseSeason?.blizzardSeasonId ?? null,
        previousDatabaseSeasonSlug: previousDatabaseSeason?.slug ?? null,
      },
      "refresh job superseded by season authority change",
    );
    await repositories.job.markFailed(job.id, {
      code: "SEASON_AUTHORITY_SUPERSEDED",
      message: "Refresh superseded by season authority change",
    });
    terminalized = true;
    return {
      character,
      job: (await repositories.job.findById(job.id)) ?? job,
      score: null,
      stagesSkipped,
      notFound: false,
      disagreements,
      excludedObservations,
    };
  }

  const season =
    currentSeasonId != null
      ? await ensureBlizzardCurrentSeason(container.prisma, character.regionId, currentSeasonId, {
          authoritySource:
            authoritativeSeasonSource === "season_index.current_season"
              ? "season_index.current_season"
              : "blizzard",
          authorityVerifiedAt: new Date(),
        })
      : await ensureCurrentSeason(container.prisma, character.regionId);
  logger.info(
    {
      ...logBase,
      event: "refresh_season_authority",
      region: identity.region,
      authoritativeSeasonId: currentSeasonId,
      authoritativeSeasonSlug: currentSeasonId != null ? `blizzard-season-${currentSeasonId}` : null,
      authoritySource: authoritativeSeasonSource,
      seasonResolutionSource: authoritativeSeasonSource,
      characterProfileSeasonIds,
      characterProfileContainsCurrentSeason:
        currentSeasonId != null && characterProfileSeasonIds.includes(currentSeasonId),
      previousDatabaseSeasonId: previousDatabaseSeason?.id ?? null,
      previousDatabaseSeasonSlug: previousDatabaseSeason?.slug ?? null,
      resultingDatabaseSeasonId: season.id,
      resultingDatabaseSeasonSlug: season.slug,
      jobAuthoritativeSeasonId: jobPayload.authoritativeSeasonId ?? null,
      jobAuthoritativeSeasonSlug: jobPayload.authoritativeSeasonSlug ?? null,
    },
    "refresh_season_authority",
  );

  // Raider.IO fallback for missing Blizzard class/spec/role/gear/talents.
  if (raiderIoProfile) {
    const needsIdentityFallback =
      !blizzardProfile?.classSlug ||
      !blizzardProfile?.specSlug ||
      !blizzardProfile?.role ||
      !character.classId ||
      !character.activeSpecId ||
      !character.role;
    if (needsIdentityFallback) {
      character = await repositories.character.applyProviderProfile(character.id, {
        id: character.id,
        region: identity.region,
        realmSlug: identity.realmSlug,
        normalizedName: character.normalizedName,
        displayName: character.displayName,
        classSlug: blizzardProfile?.classSlug ?? raiderIoProfile.classSlug,
        specSlug: blizzardProfile?.specSlug ?? raiderIoProfile.specSlug,
        role: blizzardProfile?.role ?? raiderIoProfile.role,
        blizzardCharacterId: blizzardProfile?.blizzardCharacterId ?? null,
        wclCanonicalId: null,
        raiderioProfileUrl: raiderIoProfile.profileUrl,
        lastSeenAt: null,
        lastPublicRefreshAt: null,
      });
    }

    if (blizzardItemLevel == null && raiderIoProfile.gear) {
      const rioIlvl = raiderIoProfile.gear.itemLevelEquipped;
      // Preserve null — never fabricate zero item level.
      if (rioIlvl != null) {
        await repositories.character.recordSnapshot(
          character.id,
          {
            id: randomUUID(),
            characterId: character.id,
            capturedAt: now.toISOString(),
            itemLevelEquipped: rioIlvl,
            activeSpecSlug: raiderIoProfile.specSlug,
            role: raiderIoProfile.role,
            mythicRating: mythicKeystoneScore,
            sourcePayloadId: null,
          },
          {
            averageItemLevel: raiderIoProfile.gear.itemLevelTotal ?? rioIlvl,
            equippedItemLevel: rioIlvl,
            items: raiderIoProfile.gear.items ?? [],
            keyItems: [],
          },
        );
      }
    }
  }

  const fusion = fuseCrossProviderRuns([...blizzardRuns, ...rioRuns, ...discoveredRuns]);
  const fusedRuns = fusion.runs.map((run) =>
    ensureTargetParticipant(
      {
        ...run,
        // Current-season refresh always persists under the resolved Blizzard season identity.
        seasonSlug: season.slug,
      },
      identity,
    ),
  );
  const sharedSourceRunCount = fusedRuns.filter(
    (run) => new Set(run.sources.map((s) => s.provider)).size > 1,
  ).length;
  const sourcelessRows = fusedRuns.filter((run) => run.sources.length === 0).length;
  logger.info(
    {
      ...logBase,
      event: OBS_EVENTS.refreshFusionCompleted,
      providerSourceCounts: {
        blizzard: blizzardRuns.length,
        raiderio: rioRuns.length,
        warcraftlogs: discoveredRuns.length,
      },
      canonicalRunCount: fusion.mergedCanonicalRunCount,
      sharedSourceRunCount,
      duplicatesReconciled: fusion.matchedPairCount,
      unresolvedCandidateMatches: fusion.unresolvedCrossProviderMatches,
      sourcelessRows,
    },
    OBS_EVENTS.refreshFusionCompleted,
  );

  for (const run of fusedRuns) {
    const hasWcl = run.sources.some((s) => s.provider === "WARCRAFT_LOGS");
    const hasExternal = run.sources.some(
      (s) => s.provider === "BLIZZARD" || s.provider === "RAIDER_IO",
    );

    // Near-miss cross-provider pairs (outside merge window) → exclude WCL combat attachment.
    if (hasWcl && !hasExternal) {
      const nearMiss = fusedRuns.find((other) => {
        if (other === run) return false;
        if (!other.sources.some((s) => s.provider === "BLIZZARD" || s.provider === "RAIDER_IO")) {
          return false;
        }
        if (other.dungeonSlug !== run.dungeonSlug) return false;
        if (Math.abs(other.keyLevel - run.keyLevel) > 1) return false;
        const delta = Math.abs(
          new Date(other.completedAt).getTime() - new Date(run.completedAt).getTime(),
        );
        return delta > 120_000 && delta <= 300_000;
      });
      if (nearMiss) {
        excludedObservations.push(
          excludedLowConfidenceMatch({
            runId: run.id,
            nearMissRunId: nearMiss.id,
            dungeonSlug: run.dungeonSlug,
            keyLevel: run.keyLevel,
            matchConfidence: "LOW",
          }),
        );
        run.sources = run.sources.filter((s) => s.provider !== "WARCRAFT_LOGS");
      }
    }

    await repositories.run.upsertRunWithSourcesAndParticipants(run, {
      regionCode: identity.region,
      targetCharacterId: character.id,
      seasonId: season.id,
    });
  }

  const reconcileResult = await repositories.run.reconcileDuplicateRunsForCharacter(
    character.id,
    season.id,
  );
  if (reconcileResult.deletedRunCount > 0) {
    logger.info(
      {
        identity,
        mergedGroups: reconcileResult.mergedGroups,
        deletedRunCount: reconcileResult.deletedRunCount,
      },
      "refresh pipeline: reconciled duplicate MythicRun rows",
    );
  }

  // Re-count after reconcile so volume_recency / seasonSummary use canonical rows.
  const canonicalRunCount = await repositories.run.countForCharacter(character.id, season.id);
  const volumeRunCount = canonicalRunCount > 0 ? canonicalRunCount : fusion.mergedCanonicalRunCount;

  if (disagreements.length > 0 || excludedObservations.length > 0 || fusionWarnings.length > 0) {
    await repositories.providerState.upsert({
      characterId: character.id,
      provider: "blizzard",
      state: blizzardProfile ? "OK" : "UNAVAILABLE",
      warnings: fusionWarnings,
      disagreements,
      excludedObservations,
      lastAttemptAt: now,
      lastSuccessAt: blizzardProfile ? now : null,
      fetchedAt: blizzardProfile ? now : null,
      metadata: { fusion: true },
    });
  }

  // ── Select + analyze detailed runs (eight-run scoring set) ───────────────
  const persistedRunsSeason = await repositories.run.findRunsForCharacterInSeason(
    character.id,
    season.id,
  );
  const persistedRuns =
    persistedRunsSeason.length > 0
      ? persistedRunsSeason
      : await repositories.run.findAllTargetRunsForCharacter(character.id);
  const persistedByFingerprint = new Map(
    persistedRuns.map((run) => [run.canonicalFingerprint, run]),
  );
  const candidateFromPersisted = persistedRuns.map((run) => ({
    canonicalRunId: run.id,
    dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
    keyLevel: run.keyLevel,
    timed: run.timed,
    completedAt: run.completedAt.toISOString(),
    durationMs: run.durationMs,
    scoreValue: run.scoreValue,
    hasWclSource: run.sources.some((s) => s.provider === "WARCRAFT_LOGS"),
  }));
  const candidateFromFusion = fusedRuns
    .filter((run) => persistedByFingerprint.has(run.canonicalFingerprint))
    .map((run) => {
      const persisted = persistedByFingerprint.get(run.canonicalFingerprint)!;
      return {
        canonicalRunId: persisted.id,
        dungeonSlug: canonicalDungeonKey(persisted.dungeon.slug),
        keyLevel: persisted.keyLevel,
        timed: persisted.timed,
        completedAt: persisted.completedAt.toISOString(),
        durationMs: persisted.durationMs,
        scoreValue: persisted.scoreValue,
        hasWclSource: persisted.sources.some((s) => s.provider === "WARCRAFT_LOGS"),
      };
    });
  const scoringCandidates =
    candidateFromPersisted.length > 0 ? candidateFromPersisted : candidateFromFusion;
  const expectedDungeonCount = season.dungeonCount > 0 ? season.dungeonCount : 8;
  const seasonDungeonRows = await container.prisma.seasonDungeon.findMany({
    where: { seasonId: season.id },
    include: { dungeon: true },
    orderBy: { sortOrder: "asc" },
  });
  const blizzardSeasonDungeonSlugs = readBlizzardSeasonDungeonSlugsFromMetadata(season.metadata);
  const activeSeasonDungeonPool = resolveActiveSeasonDungeonPool({
    expectedDungeonCount,
    seasonDungeonSlugs: seasonDungeonRows.map((row) => canonicalDungeonKey(row.dungeon.slug)),
    blizzardSeasonDungeonSlugs,
    // Never leave the pool empty — empty allowlists reintroduce Icecrown/legacy 9-run selections.
    raiderioDungeonSlugs: CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
    wclDungeonSlugs: wclDungeonAggregates.map((d) => d.dungeonSlug),
  });
  const activeDungeonSlugs = activeSeasonDungeonPool.canonicalSlugs;
  const selectionFilter =
    activeDungeonSlugs.length > 0
      ? { allowedDungeonSlugs: activeDungeonSlugs }
      : { allowedDungeonSlugs: CURRENT_MPLUS_ZONE_DUNGEON_SLUGS };
  let scoringRunSelection = selectScoringRuns(scoringCandidates, {
    seasonSlug: season.slug,
    expectedDungeonCount,
    ...selectionFilter,
  });
  if (scoringRunSelection.selectedRuns.length !== expectedDungeonCount) {
    logger.warn(
      {
        identity,
        expectedDungeonCount,
        selectedRunCount: scoringRunSelection.selectedRuns.length,
        activeDungeonSlugs,
        activeSeasonPoolSource: activeSeasonDungeonPool.source,
        wclOffPoolSlugs: activeSeasonDungeonPool.wclOffPoolSlugs,
        candidateDungeonCount: new Set(scoringCandidates.map((c) => c.dungeonSlug)).size,
      },
      "refresh pipeline: scoring run selection count mismatch after active-season filter",
    );
  }

  const survivalRunSelection = selectSurvivalAnalysisRuns(scoringCandidates, {
    allowedDungeonSlugs: selectionFilter.allowedDungeonSlugs,
    maxRunsPerDungeon: SURVIVAL_STANDALONE_V1_1_1_CONFIG.selection.maxRunsPerDungeon,
  });

  const selectedRunRows = new Map<
    string,
    (typeof persistedRuns)[number]
  >();
  for (const entry of scoringRunSelection.selectedRuns) {
    const row = persistedRuns.find((r) => r.id === entry.canonicalRunId);
    if (row) selectedRunRows.set(row.id, row);
  }
  for (const entry of survivalRunSelection.selectedRuns) {
    const row = persistedRuns.find((r) => r.id === entry.canonicalRunId);
    if (row) selectedRunRows.set(row.id, row);
  }

  if (selectedRunRows.size === 0) {
    const [latestRun, highestRun] = await Promise.all([
      repositories.run.findLatestForCharacter(character.id),
      repositories.run.findHighestForCharacter(character.id),
    ]);
    if (latestRun) selectedRunRows.set(latestRun.id, latestRun);
    if (highestRun) selectedRunRows.set(highestRun.id, highestRun);
    if (scoringRunSelection.selectedRuns.length === 0 && selectedRunRows.size > 0) {
      scoringRunSelection = selectScoringRuns(
        [...selectedRunRows.values()].map((run) => ({
          canonicalRunId: run.id,
          dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
          keyLevel: run.keyLevel,
          timed: run.timed,
          completedAt: run.completedAt.toISOString(),
          durationMs: run.durationMs,
          scoreValue: run.scoreValue,
          hasWclSource: run.sources.some((s) => s.provider === "WARCRAFT_LOGS"),
        })),
        {
          seasonSlug: season.slug,
          expectedDungeonCount,
          ...selectionFilter,
        },
      );
    }
  }

  const combatFactsList: RunCombatFacts[] = [];
  const combatFactsByRunId = new Map<string, RunCombatFacts>();
  const fightMetaByRunId = new Map<
    string,
    { startTime: number; endTime: number; encounterId: number | null; encounterName: string | null }
  >();
  const runCoverageById: Record<string, number> = {};
  const runDiagnostics: Array<Record<string, unknown>> = [];
  const earlyClassSlug = blizzardProfile?.classSlug ?? raiderIoProfile?.classSlug ?? null;
  const earlySpecSlug = blizzardProfile?.specSlug ?? raiderIoProfile?.specSlug ?? null;
  let analysisAttemptedCount = 0;

  if (!disabledProviders.has("warcraftlogs")) {
    let runsToAnalyze = [...selectedRunRows.values()];
    if (runsToAnalyze.length === 0) {
      const [latestRun, highestRun] = await Promise.all([
        repositories.run.findLatestForCharacter(character.id),
        repositories.run.findHighestForCharacter(character.id),
      ]);
      runsToAnalyze = [latestRun, highestRun].filter((run): run is NonNullable<typeof run> => run != null);
    }
    if (runsToAnalyze.length === 0) {
      stagesSkipped.push("analyze-run");
    }
    await assertNotCancelled("pre_analyze_run");
    for (const run of runsToAnalyze) {
      await assertNotCancelled("analyze_run_iteration");
      analysisAttemptedCount += 1;
      const source = await repositories.run.findWclSource(run.id);
      const parseBinding = bindParseToSelectedRun({
        runId: run.id,
        dungeonSlug: run.dungeon.slug,
        reportCode: source?.reportCode ?? null,
        fightId: source?.fightId ?? null,
        rankings: wclRankings,
      });

      if (!source) {
        runDiagnostics.push({
          runId: run.id,
          dungeonSlug: run.dungeon.slug,
          keyLevel: run.keyLevel,
          wclReportMatched: false,
          parse: parseBinding,
          detailedAnalysis: false,
          reason: "no_wcl_source_on_selected_run",
        });
        continue;
      }

      try {
        const detailsResult = await providers.warcraftlogs.getReportFightDetails(
          source.reportCode,
          source.fightId,
          ctx,
        );
        const details = detailsResult.data as WclReportFightDetails;
        const payloadId = await recordProviderResult(repositories, detailsResult);
        combatFactsList.push(details.combatFacts);
        combatFactsByRunId.set(run.id, details.combatFacts);
        fightMetaByRunId.set(run.id, {
          startTime: details.fight.startTime,
          endTime: details.fight.endTime,
          encounterId: details.fight.encounterId,
          encounterName: details.fight.name,
        });

        const coverageRatio =
          Object.values(details.combatFacts.coverage).filter(Boolean).length /
          Object.keys(details.combatFacts.coverage).length;
        const usableCombat = isUsableCombatRun(details.combatFacts);
        if (usableCombat) {
          runCoverageById[run.id] = coverageRatio;
        }

        const combatAdmin = buildRunCombatAdminDiagnostics(details.combatFacts, {
          dungeonSlug: run.dungeon.slug,
          runDurationMs: run.durationMs,
          classSlug: earlyClassSlug,
          specSlug: earlySpecSlug,
        });

        await repositories.run.upsertRunAnalysis({
          runId: run.id,
          characterId: character.id,
          analysisVersion: "wcl-combat-facts-v1",
          analyzedAt: now,
          coverage: usableCombat ? coverageRatio : 0,
          summary: {
            wclVisibility,
            combatFacts: toPersistedCombatFacts(details.combatFacts),
            deathCount: details.combatFacts.deaths.length,
            interruptCount: details.combatFacts.interrupts.length,
            parseBinding,
            fightStartTime: details.fight.startTime,
            fightEndTime: details.fight.endTime,
            encounterId: details.fight.encounterId,
            encounterName: details.fight.name,
            ...combatAdmin,
          },
          sourcePayloadIds: payloadId ? [payloadId] : [],
        });

        runDiagnostics.push({
          runId: run.id,
          dungeonSlug: run.dungeon.slug,
          keyLevel: run.keyLevel,
          reportCode: source.reportCode,
          fightId: source.fightId,
          wclReportMatched: true,
          parse: parseBinding,
          detailedAnalysis: usableCombat,
          coverageRatio: usableCombat ? coverageRatio : null,
          attributedSourceIds: details.combatFacts.attributedSourceIds,
          ...combatAdmin,
        });
      } catch (error) {
        if (isEnrichmentSoftSkip(error)) {
          // Soft-skip must not drop Survival: hydrate actor/revision from persisted combat facts.
          const persistedCombat = await repositories.run.findRunAnalysis(
            run.id,
            character.id,
            WCL_COMBAT_FACTS_ANALYSIS_VERSION,
          );
          const handle = readPersistedCombatFactsHandle(persistedCombat?.summary);
          if (handle && source) {
            const stub = combatFactsStubFromHandle(handle);
            combatFactsByRunId.set(run.id, stub);
            if (handle.startTime != null && handle.endTime != null) {
              fightMetaByRunId.set(run.id, {
                startTime: handle.startTime,
                endTime: handle.endTime,
                encounterId: handle.encounterId,
                encounterName: handle.encounterName,
              });
            }
            runDiagnostics.push({
              runId: run.id,
              dungeonSlug: run.dungeon.slug,
              keyLevel: run.keyLevel,
              reportCode: source.reportCode,
              fightId: source.fightId,
              wclReportMatched: true,
              parse: parseBinding,
              detailedAnalysis: false,
              reason: "fight_details_hydrated_from_persisted_combat_facts",
              attributedSourceIds: handle.attributedSourceIds,
            });
            continue;
          }
          logger.info({ identity, err: error, runId: run.id }, "refresh pipeline: analyze-run soft-skipped");
          runDiagnostics.push({
            runId: run.id,
            dungeonSlug: run.dungeon.slug,
            detailedAnalysis: false,
            reason: error instanceof Error ? error.message : "analyze_soft_skip",
            parse: parseBinding,
          });
          continue;
        }
        await failHard("analyze-run", error);
      }
    }
  } else {
    stagesSkipped.push("analyze-run");
  }

  // ── Survival V1.1.1 run analyses (reuse compatible cache; fetch missing only) ──
  const survivalCost = createSurvivalRequestCost();
  const survivalRows: SurvivalRunAnalysisRow[] = [];
  let survivalRequiredFailed = false;
  let survivalLateBoundRunCount = 0;
  const survivalBindPool = buildSurvivalWclBindPool(discoveredRuns, wclRankings);
  const survivalCatalog = getAbilityCatalog({
    classSlug: earlyClassSlug,
    specSlug: earlySpecSlug,
    role:
      (blizzardProfile?.role ?? raiderIoProfile?.role) === "TANK"
        ? "TANK"
        : (blizzardProfile?.role ?? raiderIoProfile?.role) === "HEALER"
          ? "HEALER"
          : "DPS",
    includeShared: true,
    includeRacials: false,
  });

  if (!disabledProviders.has("warcraftlogs") && scoringCandidates.length > 0) {
    const maxSurvivalPerDungeon =
      SURVIVAL_STANDALONE_V1_1_1_CONFIG.selection.maxRunsPerDungeon;
    const allowedSurvivalDungeons = new Set(
      (selectionFilter.allowedDungeonSlugs ?? []).map((s) => s.trim().toLowerCase()),
    );
    const survivalCandidatesByDungeon = new Map<string, typeof scoringCandidates>();
    for (const candidate of scoringCandidates) {
      const slug = canonicalDungeonKey(candidate.dungeonSlug);
      if (allowedSurvivalDungeons.size > 0 && !allowedSurvivalDungeons.has(slug)) continue;
      const bucket = survivalCandidatesByDungeon.get(slug) ?? [];
      bucket.push(candidate);
      survivalCandidatesByDungeon.set(slug, bucket);
    }

    const compareSurvivalCandidates = (
      a: (typeof scoringCandidates)[number],
      b: (typeof scoringCandidates)[number],
    ): number => {
      if (a.keyLevel !== b.keyLevel) return b.keyLevel - a.keyLevel;
      const scoreA = a.scoreValue ?? -1;
      const scoreB = b.scoreValue ?? -1;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
    };

    const usedSurvivalRunIds = new Set<string>();
    const usedReportFightKeys = new Set<string>();
    const liveWcl = providers.warcraftlogs as {
      analyzeSurvivalCanonicalRun?: (
        input: Record<string, unknown>,
        ctx: ProviderFetchContext,
      ) => Promise<{
        data: {
          summary: SurvivalRunAnalysisRow["summary"];
          requestCount: number;
          maxHpFailureReason: string | null;
        };
      }>;
      getGraphQlClient?: () => WclGraphQlClient;
    };
    const wclGraphClient =
      typeof liveWcl.getGraphQlClient === "function" ? liveWcl.getGraphQlClient() : null;

    for (const dungeonSlug of [...survivalCandidatesByDungeon.keys()].sort((a, b) =>
      a.localeCompare(b),
    )) {
      const bucket = [...(survivalCandidatesByDungeon.get(dungeonSlug) ?? [])].sort(
        compareSurvivalCandidates,
      );
      let acceptedForDungeon = 0;

      for (const candidate of bucket) {
        if (acceptedForDungeon >= maxSurvivalPerDungeon) break;
        if (usedSurvivalRunIds.has(candidate.canonicalRunId)) continue;

        const run = persistedRuns.find((r) => r.id === candidate.canonicalRunId);
        if (!run) {
          survivalCost.rejectedCandidates.push({
            reason: "run_row_missing",
            runId: candidate.canonicalRunId,
            dungeonSlug,
          });
          continue;
        }

        let source = await repositories.run.findWclSource(run.id);
        let lateBound = false;
        if (!source) {
          const bind = matchSurvivalWclSource(
            {
              dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
              keyLevel: run.keyLevel,
              completedAt: run.completedAt.toISOString(),
              durationMs: run.durationMs,
            },
            survivalBindPool,
            { excludeReportFightKeys: usedReportFightKeys },
          );
          if (!bind.matched) {
            survivalCost.rejectedCandidates.push({
              reason: bind.reason,
              runId: run.id,
              dungeonSlug,
            });
            continue;
          }
          source = await repositories.run.attachWclSource(run.id, {
            reportCode: bind.reportCode,
            fightId: bind.fightId,
          });
          lateBound = true;
          survivalLateBoundRunCount += 1;
        }

        const reportFightKey = `${source.reportCode}:${source.fightId}`;
        if (usedReportFightKeys.has(reportFightKey)) {
          survivalCost.rejectedCandidates.push({
            reason: "wcl_report_fight_already_used",
            runId: run.id,
            dungeonSlug,
          });
          continue;
        }

        let facts = combatFactsByRunId.get(run.id) ?? null;
        if (!facts) {
          try {
            const detailsResult = await providers.warcraftlogs.getReportFightDetails(
              source.reportCode,
              source.fightId,
              ctx,
            );
            survivalCost.wclHttpRequestCount += 1;
            survivalCost.graphqlOperationCount += 1;
            await recordProviderResult(repositories, detailsResult);
            facts = (detailsResult.data as WclReportFightDetails).combatFacts;
            combatFactsByRunId.set(run.id, facts);
            combatFactsList.push(facts);
            const details = detailsResult.data as WclReportFightDetails;
            fightMetaByRunId.set(run.id, {
              startTime: details.fight.startTime,
              endTime: details.fight.endTime,
              encounterId: details.fight.encounterId,
              encounterName: details.fight.name,
            });
          } catch (error) {
            if (isEnrichmentSoftSkip(error)) {
              const persistedCombat = await repositories.run.findRunAnalysis(
                run.id,
                character.id,
                WCL_COMBAT_FACTS_ANALYSIS_VERSION,
              );
              const handle = readPersistedCombatFactsHandle(persistedCombat?.summary);
              if (handle) {
                facts = combatFactsStubFromHandle(handle);
                combatFactsByRunId.set(run.id, facts);
                if (handle.startTime != null && handle.endTime != null) {
                  fightMetaByRunId.set(run.id, {
                    startTime: handle.startTime,
                    endTime: handle.endTime,
                    encounterId: handle.encounterId,
                    encounterName: handle.encounterName,
                  });
                }
              } else {
                survivalCost.rejectedCandidates.push({
                  reason: "fight_details_soft_skip",
                  runId: run.id,
                  dungeonSlug,
                });
                continue;
              }
            } else {
              survivalRequiredFailed = true;
              await failHard("analyze-run", error);
            }
          }
        }
        if (!facts) continue;

        const expectedKey = expectedSurvivalCompatibilityKey({
          characterId: character.id,
          reportCode: source.reportCode,
          fightId: source.fightId,
          reportRevision: facts.revision,
          abilityCatalogVersion: survivalCatalog.catalogVersion,
        });

        const cached = await repositories.run.findRunAnalysis(
          run.id,
          character.id,
          SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
        );
        if (
          !jobPayload.forceRefresh &&
          cached &&
          isCompatibleSurvivalSummary(cached.summary, expectedKey)
        ) {
          survivalCost.reusedRunAnalyses += 1;
          // Reuse / complete persisted shared evidence for Utility shadow (0 detailed WCL
          // event calls when datasets already exist; masterData may still need one fill).
          try {
            const sharedStore = createDurableSharedEvidenceStore({
              runRepository: repositories.run,
              characterId: character.id,
              runId: run.id,
              now,
            });
            const revision =
              typeof facts.revision === "number"
                ? facts.revision
                : Number(facts.revision) || null;
            let persistedBundle = sharedStore.loadBundleSummary
              ? await sharedStore.loadBundleSummary(source.reportCode, source.fightId, revision)
              : null;
            if (
              !persistedBundle ||
              !utilityEvidencePresentInBundle(persistedBundle).complete
            ) {
              const meta = fightMetaByRunId.get(run.id);
              const fightStart = meta?.startTime ?? 0;
              const fightEnd = meta?.endTime ?? fightStart + run.durationMs;
              const supportedRegion = requireSupportedBattleNetRegion(identity.region);
              persistedBundle = await ingestSharedEvidenceBundle({
                client: wclGraphClient,
                store: sharedStore,
                reportCode: source.reportCode,
                reportRevision: revision,
                fightId: source.fightId,
                playerActorId: facts.targetSourceId,
                ownedPetActorIds: facts.attributedSourceIds.filter(
                  (id) => id !== facts.targetSourceId,
                ),
                dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
                startTime: fightStart,
                endTime: fightEnd,
                consumers: ["survival", "utility"],
                forceRefetch: false,
                localOnly: wclGraphClient == null,
                region: supportedRegion,
              });
              sharedEvidenceDetailedEventCalls += persistedBundle.accounting.providerCalls;
            }
            if (persistedBundle) {
              sharedEvidenceBundlesForUtility.push(persistedBundle);
            }
          } catch {
            // Shadow-only best effort — never fail Survival cache reuse.
          }
          survivalRows.push({
            runId: run.id,
            dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
            dungeonName: run.dungeon.name,
            keyLevel: run.keyLevel,
            summary: cached.summary,
            fromCache: true,
          });
          usedSurvivalRunIds.add(run.id);
          usedReportFightKeys.add(reportFightKey);
          acceptedForDungeon += 1;
          if (lateBound) {
            const selected = survivalRunSelection.selectedRuns.find(
              (e) => e.canonicalRunId === run.id,
            );
            if (selected) selected.wclReportMatched = true;
          }
          continue;
        }

        if (typeof liveWcl.analyzeSurvivalCanonicalRun !== "function" && !wclGraphClient) {
          survivalCost.rejectedCandidates.push({
            reason: "survival_canonical_analyze_unsupported",
            runId: run.id,
            dungeonSlug,
          });
          survivalRequiredFailed = true;
          continue;
        }

        try {
          const meta = fightMetaByRunId.get(run.id);
          const fightStart = meta?.startTime ?? 0;
          const fightEnd = meta?.endTime ?? fightStart + run.durationMs;
          const sharedStore = createDurableSharedEvidenceStore({
            runRepository: repositories.run,
            characterId: character.id,
            runId: run.id,
            now,
          });

          let summary: SurvivalRunAnalysisRow["summary"];
          let requestCount = 0;
          let maxHpFailureReason: string | null = null;
          let payloadId: string | null = null;

          // Preferred path: one shared evidence ingest for Survival (+ Utility datasets for later).
          // Second compatible refresh reuses RunAnalysis datasets → zero detailed event calls.
          const preferSharedEvidence = wclGraphClient != null || !jobPayload.forceRefresh;
          if (preferSharedEvidence) {
            try {
              const supportedRegion = requireSupportedBattleNetRegion(identity.region);
              const sharedIdentity = {
                region: supportedRegion,
                realmSlug: identity.realmSlug,
                name: identity.name,
              };
              const sharedResult = await analyzeSurvivalViaSharedEvidence({
                client: wclGraphClient,
                store: sharedStore,
                identity: sharedIdentity,
                characterId: character.id,
                reportCode: source.reportCode,
                fightId: source.fightId,
                reportRevision:
                  typeof facts.revision === "number"
                    ? facts.revision
                    : Number(facts.revision) || null,
                dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
                keyLevel: run.keyLevel,
                playerActorId: facts.targetSourceId,
                ownedPetActorIds: facts.attributedSourceIds.filter(
                  (id) => id !== facts.targetSourceId,
                ),
                fightStartTime: fightStart,
                fightEndTime: fightEnd,
                encounterId: meta?.encounterId ?? null,
                encounterName: meta?.encounterName ?? null,
                catalog: survivalCatalog,
                classSlug: earlyClassSlug,
                specSlug: earlySpecSlug,
                timed: run.timed,
                completed: true,
                score: run.scoreValue,
                forceRefetch: jobPayload.forceRefresh === true,
                includeUtilityDatasets: true,
                region: supportedRegion,
              });
              summary = sharedResult.summary;
              requestCount = sharedResult.detailedWclEventCalls;
              maxHpFailureReason = sharedResult.maxHpFailureReason;
              sharedEvidenceDetailedEventCalls += sharedResult.detailedWclEventCalls;
              sharedEvidenceBundlesForUtility.push(sharedResult.bundle);
              refreshCostAccumulator.addMany(
                buildSharedEvidenceCostRecords({
                  characterId: character.id,
                  jobId: job.id,
                  runId: run.id,
                  refreshReason: jobPayload.forceRefresh
                    ? "admin_provider_refetch"
                    : "scheduled_refresh",
                  reportCode: source.reportCode,
                  fightId: source.fightId,
                  providerCalls: sharedResult.bundle.accounting.providerCalls,
                  pages: sharedResult.bundle.accounting.pages,
                  pointsConsumed: sharedResult.bundle.accounting.pointsConsumed,
                  estimatedPointsConsumed:
                    sharedResult.bundle.accounting.estimatedPointsConsumed,
                  costSource: sharedResult.bundle.accounting.costSource,
                  cacheHits: sharedResult.bundle.accounting.cacheHits,
                  persistedHits: sharedResult.bundle.accounting.persistedHits,
                }),
              );
            } catch (sharedError) {
              // Fall back to legacy canonical path when GraphQL client exists but shared ingest fails.
              if (typeof liveWcl.analyzeSurvivalCanonicalRun !== "function") {
                throw sharedError;
              }
              logger.warn(
                {
                  ...logBase,
                  event: "shared_evidence_fallback",
                  runId: run.id,
                  err: sharedError,
                },
                "shared_evidence_fallback",
              );
              const canonicalResult = await liveWcl.analyzeSurvivalCanonicalRun(
                {
                  identity,
                  characterId: character.id,
                  reportCode: source.reportCode,
                  fightId: source.fightId,
                  reportRevision: facts.revision,
                  dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
                  keyLevel: run.keyLevel,
                  playerActorId: facts.targetSourceId,
                  ownedPetActorIds: facts.attributedSourceIds.filter(
                    (id) => id !== facts.targetSourceId,
                  ),
                  fightStartTime: fightStart,
                  fightEndTime: fightEnd,
                  encounterId: meta?.encounterId ?? null,
                  encounterName: meta?.encounterName ?? null,
                  catalog: survivalCatalog,
                  classSlug: earlyClassSlug,
                  specSlug: earlySpecSlug,
                  timed: run.timed,
                  completed: true,
                  score: run.scoreValue,
                },
                ctx,
              );
              summary = canonicalResult.data.summary;
              requestCount = canonicalResult.data.requestCount;
              maxHpFailureReason = canonicalResult.data.maxHpFailureReason;
              payloadId = await recordProviderResult(repositories, canonicalResult as never);
            }
          } else if (typeof liveWcl.analyzeSurvivalCanonicalRun === "function") {
            const canonicalResult = await liveWcl.analyzeSurvivalCanonicalRun(
              {
                identity,
                characterId: character.id,
                reportCode: source.reportCode,
                fightId: source.fightId,
                reportRevision: facts.revision,
                dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
                keyLevel: run.keyLevel,
                playerActorId: facts.targetSourceId,
                ownedPetActorIds: facts.attributedSourceIds.filter(
                  (id) => id !== facts.targetSourceId,
                ),
                fightStartTime: fightStart,
                fightEndTime: fightEnd,
                encounterId: meta?.encounterId ?? null,
                encounterName: meta?.encounterName ?? null,
                catalog: survivalCatalog,
                classSlug: earlyClassSlug,
                specSlug: earlySpecSlug,
                timed: run.timed,
                completed: true,
                score: run.scoreValue,
              },
              ctx,
            );
            summary = canonicalResult.data.summary;
            requestCount = canonicalResult.data.requestCount;
            maxHpFailureReason = canonicalResult.data.maxHpFailureReason;
            payloadId = await recordProviderResult(repositories, canonicalResult as never);
          } else {
            survivalCost.rejectedCandidates.push({
              reason: "survival_canonical_analyze_unsupported",
              runId: run.id,
              dungeonSlug,
            });
            survivalRequiredFailed = true;
            continue;
          }

          survivalCost.wclHttpRequestCount += requestCount;
          survivalCost.graphqlOperationCount += requestCount;
          if (
            summary.maxHpResolution.baselineMaxHp == null &&
            maxHpFailureReason
          ) {
            summary.maxHpResolution = {
              ...summary.maxHpResolution,
              resolutionFailureReason:
                summary.maxHpResolution.resolutionFailureReason ?? maxHpFailureReason,
            };
          }
          await repositories.run.upsertRunAnalysis({
            runId: run.id,
            characterId: character.id,
            analysisVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
            analyzedAt: now,
            coverage: summary.maxHpResolution.baselineMaxHp != null ? 1 : 0.35,
            summary,
            sourcePayloadIds: payloadId ? [payloadId] : [],
          });
          survivalCost.newRunAnalyses += 1;
          survivalRows.push({
            runId: run.id,
            dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
            dungeonName: run.dungeon.name,
            keyLevel: run.keyLevel,
            summary,
            fromCache: false,
          });
          usedSurvivalRunIds.add(run.id);
          usedReportFightKeys.add(reportFightKey);
          acceptedForDungeon += 1;
          if (lateBound) {
            const selected = survivalRunSelection.selectedRuns.find(
              (e) => e.canonicalRunId === run.id,
            );
            if (selected) selected.wclReportMatched = true;
          }
        } catch (error) {
          if (isEnrichmentSoftSkip(error)) {
            survivalCost.rejectedCandidates.push({
              reason: "survival_canonical_soft_skip",
              runId: run.id,
              dungeonSlug,
            });
            continue;
          }
          survivalRequiredFailed = true;
          await failHard("analyze-run", error);
        }
      }
    }
  }

  const selectedRunCount = scoringRunSelection.selectedRuns.length;
  const matchedReportCount = runDiagnostics.filter((d) => d.wclReportMatched === true).length;
  const usableCombatRunCount = runDiagnostics.filter((d) => d.detailedAnalysis === true).length;
  const detailedRunCount = usableCombatRunCount;

  const presentationMetaByRunId: Record<
    string,
    {
      dungeonName: string;
      wclReportMatched: boolean;
      wclCoverageRatio: number | null;
      hasDetailedAnalysis: boolean;
    }
  > = {};
  const dungeonNamesBySlug: Record<string, string> = {};
  for (const entry of scoringRunSelection.selectedRuns) {
    const row = persistedRuns.find((r) => r.id === entry.canonicalRunId);
    const diag = runDiagnostics.find((d) => String(d.runId) === entry.canonicalRunId);
    const coverage = runCoverageById[entry.canonicalRunId];
    const dungeonName = row?.dungeon.name ?? entry.dungeonSlug;
    dungeonNamesBySlug[entry.dungeonSlug] = dungeonName;
    presentationMetaByRunId[entry.canonicalRunId] = {
      dungeonName,
      wclReportMatched: Boolean(diag?.wclReportMatched),
      wclCoverageRatio: typeof coverage === "number" ? coverage : null,
      hasDetailedAnalysis: Boolean(diag?.detailedAnalysis),
    };
  }
  scoringRunSelection = applyRunMetadataToSelection(scoringRunSelection, presentationMetaByRunId);
  const contractScoringRunSelection = toContractScoringRunSelection(
    scoringRunSelection,
    presentationMetaByRunId,
    dungeonNamesBySlug,
  );

  const seasonPrune = await repositories.run.pruneOtherSeasonParticipations(
    character.id,
    season.id,
  );
  if (seasonPrune.deletedRuns > 0 || seasonPrune.detachedParticipations > 0) {
    logger.info(
      {
        identity,
        detachedOtherSeasonParticipations: seasonPrune.detachedParticipations,
        deletedOtherSeasonRuns: seasonPrune.deletedRuns,
      },
      "refresh pipeline: pruned other-season run participations",
    );
  }

  // Character-level WCL visibility + data-state even when zero runs / no analysis target.
  // Never overwrite PUBLIC/HIDDEN visibility with a matching outcome such as NO_MATCHED_RUN.
  if (wclVisibility !== null || wclDataState !== null) {
    wclDataState = refineWclDataState({
      visibility: wclVisibility,
      baseDataState: wclDataState,
      combatFactsCount: combatFactsList.length,
      dungeonAggregateCount: wclDungeonAggregates.length,
    });
    const performanceOkForSuccess =
      wclPerformanceRecord?.state === "OK" ||
      wclPerformanceRecord?.state === "SKIPPED" ||
      wclPerformanceRecord == null;
    const survivalCandidatesWithWcl =
      survivalRows.length > 0 ||
      survivalBindPool.length > 0 ||
      survivalRunSelection.selectedRuns.some((e) => e.wclReportMatched);
    const survivalOkForSuccess =
      !survivalRequiredFailed &&
      (!survivalCandidatesWithWcl || survivalRows.length > 0);
    const wclOkForSuccess = performanceOkForSuccess && survivalOkForSuccess;
    const visibilitySummary = {
      wclVisibility,
      wclDataState,
      discoveredRunCount: discoveredRuns.length,
      matchedSelectedRuns: detailedRunCount,
      matchedPairCount: fusion.matchedPairCount,
      mergedCanonicalRunCount: volumeRunCount,
      unresolvedCrossProviderMatches: fusion.unresolvedCrossProviderMatches,
      reconciledDuplicateGroups: reconcileResult.mergedGroups,
      reconciledDeletedRuns: reconcileResult.deletedRunCount,
      prunedOtherSeasonParticipations: seasonPrune.detachedParticipations,
      prunedOtherSeasonRuns: seasonPrune.deletedRuns,
      performanceState: wclPerformanceRecord?.state ?? null,
      performanceAdapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
      rejectedLegacyCache: wclRejectedLegacyCache,
      survivalAnalyzedRunCount: survivalRows.length,
      survivalCachedRunCount: survivalRows.filter((r) => r.fromCache).length,
      survivalNewlyFetchedRunCount: survivalRows.filter((r) => !r.fromCache).length,
      survivalRequiredFailed,
      survivalAdapterVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.adapterVersion,
      survivalConfigVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.version,
      survivalRequestCost: survivalCost,
    };
    // Always persist character-level provider visibility (including zero matched runs).
    // Preserve Performance + Survival success gating — do not stamp lastSuccessAt over a failed required dataset.
    await repositories.providerState.upsert({
      characterId: character.id,
      provider: "warcraftlogs",
      state: wclOkForSuccess
        ? mapWclVisibilityToState(wclVisibility, wclDataState)
        : "UNAVAILABLE",
      detail: wclOkForSuccess
        ? undefined
        : !performanceOkForSuccess
          ? `points_and_damage Performance unavailable (${wclPerformanceRecord?.state ?? "missing"})`
          : "Survival V1.1.1 required datasets failed",
      wclVisibility,
      lastAttemptAt: now,
      ...(wclOkForSuccess ? { lastSuccessAt: now } : {}),
      fetchedAt: now,
      metadata: visibilitySummary,
    });
    if (combatFactsList.length === 0) {
      const anyRun =
        persistedRuns[0] ?? (await repositories.run.findLatestForCharacter(character.id));
      if (anyRun) {
        await repositories.run.upsertRunAnalysis({
          runId: anyRun.id,
          characterId: character.id,
          analysisVersion: "wcl-visibility-v1",
          analyzedAt: now,
          coverage: 0,
          summary: visibilitySummary,
          sourcePayloadIds: [],
        });
      }
    }
  }

  // ── Extract metrics ─────────────────────────────────────────────────────
  const observedAt = now.toISOString();
  const observations: MetricObservationDTO[] = [];

  // Mythic rating is emitted later via CHARACTER_HISTORY experience builder.
  void mythicKeystoneScore;

  const roleSlug = (character.role ?? blizzardProfile?.role ?? raiderIoProfile?.role ?? null)
    ?.toString()
    .toLowerCase();
  const specSlug =
    blizzardProfile?.specSlug ?? raiderIoProfile?.specSlug ?? null;

  const classSlug = blizzardProfile?.classSlug ?? raiderIoProfile?.classSlug ?? null;

  const parseByRunId = new Map(
    runDiagnostics.map((d) => [String(d.runId), d.parse as { parsePercentile?: number | null } | undefined]),
  );

  const explanatoryRuns = scoringRunSelection.selectedRuns.map((entry) => {
    const fused = fusedRuns.find((r) => r.id === entry.canonicalRunId);
    const parse = parseByRunId.get(entry.canonicalRunId);
    return {
      runId: entry.canonicalRunId,
      dungeonSlug: entry.dungeonSlug,
      keyLevel: entry.keyLevel,
      completedAt: entry.completedAt,
      timed: entry.timed ?? false,
      parsePercentile: parse?.parsePercentile ?? null,
      scoreValue: entry.raiderIoScore ?? fused?.scoreValue ?? null,
      hasWclSource: entry.wclReportMatched,
    };
  });

  const selectedRunWclCoverage =
    selectedRunCount > 0 ? detailedRunCount / selectedRunCount : 0;

  // Performance uses points_and_damage aggregates only — never fight-bound parse fallback.
  // Missing dungeons reduce coverage; never invent zero percentiles.
  const performanceOk =
    wclPerformanceRecord?.state === "OK" && wclDungeonAggregates.length > 0;
  const activeWclAggregates = performanceOk
    ? wclDungeonAggregates.filter(
        (d) =>
          activeDungeonSlugs.length === 0 ||
          activeDungeonSlugs.includes(canonicalDungeonKey(d.dungeonSlug)),
      )
    : [];
  const performanceProvenance =
    activeWclAggregates.length > 0 ? "AGGREGATE_ZONE_RANKINGS" : "NONE";

  const wclPerformance = buildWclPerformanceObservations({
    currentSeasonDungeons: activeWclAggregates.map((d) => ({
      dungeonSlug: d.dungeonSlug,
      dungeonName: d.dungeonName,
      encounterId: d.encounterId,
      bestParsePercentile: d.bestParsePercentile,
      medianParsePercentile: d.medianParsePercentile,
      loggedRunCount: d.loggedRunCount,
      specSlug: d.specSlug,
      roleSlug: d.roleSlug,
      keystoneLevel: d.keystoneLevel,
      throughputBracket: d.throughputBracket,
      ratingPoints: d.ratingPoints,
      scoreRank: d.scoreRank,
      regionRank: d.regionRank,
      serverRank: d.serverRank,
      scoreRankPercent: d.scoreRankPercent,
      specialization: d.specialization,
      bestDps: d.bestDps,
      completion: d.completion,
    })),
    expectedDungeonCount,
    activeSpecSlug: specSlug,
    activeRoleSlug: roleSlug,
    hasResolvedSpecAndRole: Boolean(specSlug && roleSlug),
    // Aggregate Performance is independent of report matching / combat ingestion.
    selectedRunWclCoverage:
      performanceProvenance === "AGGREGATE_ZONE_RANKINGS" ? 1 : selectedRunWclCoverage,
    explanatoryRuns,
    logFreshness:
      performanceProvenance === "AGGREGATE_ZONE_RANKINGS"
        ? 0.85
        : wclVisibility === "PUBLIC" &&
            (wclDataState === "MATCHED_COMBAT_LOGS" ||
              wclDataState === "RANKINGS_ONLY" ||
              wclDataState === "NO_MATCHED_RUN")
          ? 0.85
          : 0.4,
    observedAt,
  });
  wclPerformance.summary.currentSeason.provenance = performanceProvenance;
  wclPerformance.summary.currentSeason.availableDungeonCount =
    wclPerformance.summary.currentSeason.dungeonCount;
  if (wclPerformanceRecord?.global) {
    wclPerformance.summary.currentSeason.totalMythicPlusScore =
      wclPerformanceRecord.global.totalMythicPlusScore;
    wclPerformance.summary.currentSeason.totalLoggedRuns =
      wclPerformanceRecord.global.totalLoggedRuns;
    wclPerformance.summary.currentSeason.partition = wclPerformanceRecord.global.partition;
    wclPerformance.summary.currentSeason.zoneId = wclPerformanceRecord.global.zoneId;
    wclPerformance.summary.currentSeason.specRanks =
      wclPerformanceRecord.global.specRanks as typeof wclPerformance.summary.currentSeason.specRanks;
  }
  wclPerformance.summary.currentSeason.diagnostics = {
    ratingPointsExcludedFromScore: true,
    keystoneLevelExcludedFromScore: true,
    scoreRankPercentExcludedFromScore: true,
    throughputSampleCountUnavailable: true,
    performanceState: wclPerformanceRecord?.state ?? null,
    unavailableEncounters: Array.isArray(wclPerformanceRecord?.diagnostics?.unavailableEncounters)
      ? (wclPerformanceRecord!.diagnostics!.unavailableEncounters as Array<{
          encounterID: number;
          encounterName: string | null;
          dungeonSlug: string | null;
          reason: string;
        }>)
      : undefined,
  };
  observations.push(...wclPerformance.observations);

  // Keep Raider.IO score as a separate non-product observation (never fed as product score).
  const rioScore = raiderIoProfile?.currentSeason?.scores.all ?? null;
  if (rioScore != null) {
    observations.push({
      metricKey: "source.raiderio_score",
      dimension: "EXPERIENCE",
      rawValue: rioScore,
      normalizedValue: null,
      confidence: raiderIoProfile?.crawlStale ? 0.4 : 0.7,
      observedAt,
      sourceProvider: "raiderio",
      coverage: null,
      context: {
        keptSeparateFromProductScore: true,
        ranks: raiderIoProfile?.ranks ?? null,
        profileUrl: raiderIoProfile?.profileUrl ?? null,
      },
    });
  }

  const roleForCatalog =
    roleSlug === "tank" ? "TANK" : roleSlug === "healer" ? "HEALER" : "DPS";
  const abilityCatalog = getAbilityCatalog({
    classSlug,
    specSlug,
    role: roleForCatalog,
    includeShared: true,
    includeRacials: false,
  });
  const catalogDiagnostics = buildCatalogCoverageDiagnostics({
    classSlug,
    specSlug,
    role: roleForCatalog,
    includeShared: true,
    includeRacials: false,
  });

  const perRunCombatObservations = [...combatFactsByRunId.entries()].map(([runId, facts]) => {
    const runRow = selectedRunRows.get(runId);
    return extractMetricsFromCombatFacts(facts, observedAt, {
      dungeonSlug: runRow?.dungeon.slug ?? "unknown",
      runDurationMs: runRow?.durationMs ?? 1_800_000,
      classSlug,
      specSlug,
      catalog: abilityCatalog,
    });
  });
  observations.push(
    ...aggregateCombatObservations(perRunCombatObservations, observedAt, {
      selectedRunCount,
      detailedRunCount,
    }).filter((o) => !o.metricKey.startsWith("survival.")),
  );

  const mythicRatingObs =
    mythicKeystoneScore !== null
      ? buildMythicRatingObservation({
          mythicRating: mythicKeystoneScore,
          observedAt,
          cutoffs: seasonCutoffs,
        })
      : null;

  // EXPERIENCE V2 from CHARACTER_HISTORY only — durable run/season metadata, no WCL combat events.
  const blizzardOk = !stagesSkipped.includes("refresh-blizzard");
  const raiderIoOk = !stagesSkipped.includes("refresh-raiderio");
  const rioPriorSeasonCount = raiderIoProfile?.previousSeason ? 1 : 0;
  // Durable local prior seasons (snapshots / runs outside the active season).
  const [localPriorFromSnapshots, localPriorFromRuns] = await Promise.all([
    container.prisma.scoreSnapshot.findMany({
      where: { characterId: character.id, seasonId: { not: season.id } },
      distinct: ["seasonId"],
      select: { seasonId: true },
    }),
    container.prisma.mythicRun.findMany({
      where: {
        seasonId: { not: season.id },
        participants: { some: { characterId: character.id, isTargetCharacter: true } },
      },
      distinct: ["seasonId"],
      select: { seasonId: true },
    }),
  ]);
  const localPriorSeasonCount = new Set([
    ...localPriorFromSnapshots.map((r) => r.seasonId),
    ...localPriorFromRuns.map((r) => r.seasonId),
  ]).size;
  const priorSeasonCount = mergePriorSeasonCount(rioPriorSeasonCount, localPriorSeasonCount);
  const priorSeasonSourceDepth = resolvePriorSeasonSourceDepth({
    rioPriorSeasonCount,
    localPriorSeasonCount,
  });
  const seasonPoolRuns = scoringCandidates.map((r) => ({
    dungeonSlug: r.dungeonSlug,
    keyLevel: r.keyLevel,
    completedAt: r.completedAt,
  }));
  const selectedExperienceRuns = scoringRunSelection.selectedRuns.map((r) => ({
    dungeonSlug: r.dungeonSlug,
    keyLevel: r.keyLevel,
    completedAt: r.completedAt,
  }));
  const hasExperienceHistorySignal =
    selectedExperienceRuns.length > 0 ||
    seasonPoolRuns.length > 0 ||
    priorSeasonCount > 0;
  const experienceProvenance = resolveExperienceProvenance({
    blizzardOk,
    raiderIoOk,
    hasAnyHistorySignal: hasExperienceHistorySignal,
  });

  const experienceObservations =
    experienceProvenance === "PROVIDER_FAILURE"
      ? []
      : buildExperienceV2Observations({
          observedAt,
          expectedDungeonCount,
          selectedRuns: selectedExperienceRuns,
          seasonRuns: seasonPoolRuns,
          priorSeasonCount,
          priorSeasonSourceDepth,
          provenance: experienceProvenance,
          sourceProvider: "character_history",
        });
  observations.push(...experienceObservations);
  // Legacy rating kept as non-scoring explanatory observation (not in model v5 Experience weights).
  if (mythicRatingObs) {
    observations.push({
      ...mythicRatingObs,
      context: {
        ...(mythicRatingObs.context && typeof mythicRatingObs.context === "object"
          ? (mythicRatingObs.context as Record<string, unknown>)
          : {}),
        retiredFromExperienceV2: true,
        scoringWeight: 0,
        independentOfWclDetails: true,
      },
    });
  }

  const authenticityFeatures = boostFacts ? mapBoostFactsToAuthenticity(boostFacts) : undefined;
  // Coverage is actual combat-facts analysis over selected runs — never invent 1.0 or treat
  // zero coverage as evidence that logs are hidden.
  const selectedRunCoverage = selectedRunCount > 0 ? detailedRunCount / selectedRunCount : 0;
  const freshness =
    wclVisibility === "HIDDEN"
      ? 0.35
      : wclDataState === "NO_PUBLIC_LOGS" ||
          wclDataState === "RATE_LIMITED" ||
          wclDataState === "UNAVAILABLE"
        ? 0.45
        : stagesSkipped.includes("refresh-raiderio") || stagesSkipped.includes("refresh-warcraftlogs-summary")
          ? 0.55
          : 0.75;

  const wclSurvival = buildWclSurvivalObservations({
    rows: survivalRows,
    expectedDungeonCount,
    observedAt,
    selectedRunWclCoverage: (() => {
      const slots = Math.max(survivalRunSelection.selectedRuns.length, survivalRows.length);
      return slots > 0 ? survivalRows.length / slots : 0;
    })(),
    logFreshness: freshness,
    requestCost: survivalCost,
    lateBoundRunCount: survivalLateBoundRunCount,
    bindPoolSize: survivalBindPool.length,
  });
  observations.push(...wclSurvival.observations);

  // Load active model before Utility publication so gates come from ScoreModel.config.
  const model = await repositories.score.getActiveModel();
  if (!model) {
    const error = new Error(`No active score model found in the database`);
    await repositories.job.markFailed(job.id, error);
    terminalized = true;
    throw error;
  }

  // ── Utility OBSERVED_CONTRIBUTION (shadow diagnostics / published when eligible) ──
  // Reuses shared evidence bundles already fetched/persisted — no extra WCL when reused.
  // Bounded fallback (≤4) stays inside this refresh-character execution only (Option A).
  const utilityPublicationMode = getUtilityPublicationMode();
  const utilityGates = readUtilityPublicationGatesFromModelConfig(model.config);
  let utilityBundles = [...sharedEvidenceBundlesForUtility];
  let utilityDetailedCalls = sharedEvidenceDetailedEventCalls;
  let shadowInputs = buildUtilityShadowInputsFromBundles({
    bundles: utilityBundles,
    classSlug,
    specSlug,
    roleSlug: roleSlug ?? null,
    detailedWclEventCallsMade: utilityDetailedCalls,
  });
  const observedAtForUtility = new Date().toISOString();
  const utilityShadowPreview = applyUtilityShadowRefreshBoundary({
    observations,
    hasPersistedSharedEvidence: shadowInputs.hasPersistedSharedEvidence,
    observedAt: observedAtForUtility,
    classSlug,
    specSlug,
    scoreModelConfig: model.config,
    coverage: {
      ...shadowInputs.coverage,
      classSlug,
      specSlug,
      evidenceAnalysisVersion: "wcl-run-evidence-v1",
    },
    shadowScoreInput: {
      mode: utilityPublicationMode,
      hasPersistedSharedEvidence: shadowInputs.hasPersistedSharedEvidence,
      runs: shadowInputs.runs,
      rawByRunId: shadowInputs.rawByRunId,
      masterByReport: shadowInputs.masterByReport,
      opportunities: shadowInputs.opportunities,
      hostileCastEventsByRun: shadowInputs.hostileCastEventsByRun,
      detailedWclEventCallsMade: shadowInputs.detailedWclEventCallsMade,
    },
  });

  let utilityBaseline = classifyUtilitySampleState({
    coverage: {
      ...shadowInputs.coverage,
      notes: shadowInputs.notes,
    },
    shadow: utilityShadowPreview.shadow,
    gates: utilityGates,
    expectedDungeonCount,
    wclDataState,
    bundles: utilityBundles,
  });
  let utilityFallbackDiagnostics = emptyUtilityFallbackDiagnostics(
    utilityBaseline.state,
    utilityBaseline.fallbackAllowed ? "pending" : "not_triggered",
  );

  await assertNotCancelled("pre_utility_fallback");
  if (utilityBaseline.fallbackAllowed && !disabledProviders.has("warcraftlogs")) {
    const liveWclForUtility = providers.warcraftlogs as {
      getGraphQlClient?: () => WclGraphQlClient;
      getRateLimit?: () => Promise<{
        pointsSpentThisHour?: number;
        limitPerHour?: number;
        pointsRemaining?: number;
      } | null>;
    };
    const utilityGraphClient =
      typeof liveWclForUtility.getGraphQlClient === "function"
        ? liveWclForUtility.getGraphQlClient()
        : null;

    const baselineKeys = new Set(
      utilityBundles.map((b) => `${b.reportCode}:${b.fightId}`),
    );
    const baselineDungeonSlugs = utilityBundles.map((b) =>
      canonicalDungeonKey(b.dungeonSlug),
    );
    const fallbackCandidates: UtilityFallbackCandidateRun[] = [];
    for (const candidate of scoringCandidates) {
      const run = persistedRuns.find((r) => r.id === candidate.canonicalRunId);
      if (!run) continue;
      const source = await repositories.run.findWclSource(run.id);
      if (!source?.reportCode || source.fightId == null || source.fightId <= 0) {
        const bind = matchSurvivalWclSource(
          {
            dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
            keyLevel: run.keyLevel,
            completedAt: run.completedAt.toISOString(),
            durationMs: run.durationMs,
          },
          survivalBindPool,
        );
        if (!bind.matched) continue;
        const key = `${bind.reportCode}:${bind.fightId}`;
        if (baselineKeys.has(key)) continue;
        fallbackCandidates.push({
          dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
          reportCode: bind.reportCode,
          fightId: bind.fightId,
          reportRevision: null,
          scoreValue: run.scoreValue,
          completedAt: run.completedAt.toISOString(),
          hasPublicReport: true,
          alreadyInBaseline: false,
          predictedUtilityEvidenceComplete: false,
          predictedProviderCalls: null,
        });
        continue;
      }
      const key = `${source.reportCode}:${source.fightId}`;
      if (baselineKeys.has(key)) continue;
      const meta = fightMetaByRunId.get(run.id);
      const facts = combatFactsByRunId.get(run.id);
      fallbackCandidates.push({
        dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
        reportCode: source.reportCode,
        fightId: source.fightId,
        reportRevision:
          typeof facts?.revision === "number"
            ? facts.revision
            : facts?.revision != null
              ? Number(facts.revision) || null
              : null,
        scoreValue: run.scoreValue,
        completedAt: run.completedAt.toISOString(),
        hasPublicReport: true,
        alreadyInBaseline: false,
        predictedUtilityEvidenceComplete: false,
        predictedProviderCalls: meta ? 0 : null,
      });
    }

    try {
      const fallbackPass = await runUtilityFallbackEvidencePass({
        baselineState: utilityBaseline.state,
        baselineBundles: utilityBundles,
        baselineDungeonSlugs,
        activeDungeonPool: activeDungeonSlugs,
        candidates: fallbackCandidates,
        classSlug,
        specSlug,
        roleSlug: roleSlug ?? null,
        detailedWclEventCallsMade: utilityDetailedCalls,
        gates: utilityGates,
        expectedDungeonCount,
        wclDataState,
        ingestExtraRun: async ({ candidate, selectionReason }) => {
          // Resolve / attach WCL source onto a persisted run when possible.
          let runRow =
            persistedRuns.find((r) => {
              const src = r.sources?.find((s) => s.provider === "WARCRAFT_LOGS");
              return (
                src &&
                src.reportCode === candidate.reportCode &&
                src.fightId === candidate.fightId
              );
            }) ?? null;
          if (!runRow) {
            for (const c of scoringCandidates) {
              if (canonicalDungeonKey(c.dungeonSlug) !== canonicalDungeonKey(candidate.dungeonSlug)) {
                continue;
              }
              const row = persistedRuns.find((r) => r.id === c.canonicalRunId);
              if (!row) continue;
              const existing = await repositories.run.findWclSource(row.id);
              if (
                existing?.reportCode === candidate.reportCode &&
                existing.fightId === candidate.fightId
              ) {
                runRow = row;
                break;
              }
              if (!existing) {
                await repositories.run.attachWclSource(row.id, {
                  reportCode: candidate.reportCode,
                  fightId: candidate.fightId,
                });
                runRow = row;
                break;
              }
            }
          }
          if (!runRow) {
            return { bundle: null, skippedReason: "no_persisted_run_for_fallback_candidate" };
          }

          let facts = combatFactsByRunId.get(runRow.id) ?? null;
          let meta = fightMetaByRunId.get(runRow.id);
          if (!facts || !meta) {
            try {
              const detailsResult = await providers.warcraftlogs.getReportFightDetails(
                candidate.reportCode,
                candidate.fightId,
                ctx,
              );
              const details = detailsResult.data as WclReportFightDetails;
              facts = details.combatFacts;
              combatFactsByRunId.set(runRow.id, facts);
              meta = {
                startTime: details.fight.startTime,
                endTime: details.fight.endTime,
                encounterId: details.fight.encounterId,
                encounterName: details.fight.name,
              };
              fightMetaByRunId.set(runRow.id, meta);
            } catch {
              return { bundle: null, skippedReason: "fight_details_unavailable" };
            }
          }
          if (!facts || !meta || facts.targetSourceId == null) {
            return { bundle: null, skippedReason: "actor_or_fight_meta_missing" };
          }

          const revision =
            typeof facts.revision === "number"
              ? facts.revision
              : Number(facts.revision) || null;
          const sharedStore = createDurableSharedEvidenceStore({
            runRepository: repositories.run,
            characterId: character.id,
            runId: runRow.id,
            now,
          });
          const supportedRegion = requireSupportedBattleNetRegion(identity.region);
          const bundle = await ingestSharedEvidenceBundle({
            client: utilityGraphClient,
            store: sharedStore,
            reportCode: candidate.reportCode,
            reportRevision: revision,
            fightId: candidate.fightId,
            playerActorId: facts.targetSourceId,
            ownedPetActorIds: facts.attributedSourceIds.filter(
              (id) => id !== facts!.targetSourceId,
            ),
            dungeonSlug: canonicalDungeonKey(candidate.dungeonSlug),
            startTime: meta.startTime,
            endTime: meta.endTime,
            // Utility-evidence-only: never tag/fetch as Survival scoring evidence.
            consumers: buildUtilityFallbackIngestConsumers(),
            forceRefetch: false,
            localOnly: utilityGraphClient == null,
            region: supportedRegion,
          });
          void selectionReason;
          refreshCostAccumulator.addMany(
            buildSharedEvidenceCostRecords({
              characterId: character.id,
              jobId: job.id,
              runId: runRow.id,
              refreshReason: jobPayload.forceRefresh
                ? "admin_provider_refetch"
                : "utility_fallback_extra_run",
              reportCode: candidate.reportCode,
              fightId: candidate.fightId,
              providerCalls: bundle.accounting.providerCalls,
              pages: bundle.accounting.pages,
              pointsConsumed: bundle.accounting.pointsConsumed,
              estimatedPointsConsumed: bundle.accounting.estimatedPointsConsumed,
              costSource: bundle.accounting.costSource,
              cacheHits: bundle.accounting.cacheHits,
              persistedHits: bundle.accounting.persistedHits,
            }),
          );
          return { bundle };
        },
      });

      utilityBundles = fallbackPass.bundles;
      utilityDetailedCalls = fallbackPass.detailedWclEventCallsMade;
      sharedEvidenceDetailedEventCalls = utilityDetailedCalls;
      sharedEvidenceBundlesForUtility.length = 0;
      sharedEvidenceBundlesForUtility.push(...utilityBundles);
      utilityBaseline = fallbackPass.baseline;
      utilityFallbackDiagnostics = fallbackPass.diagnostics;
      shadowInputs = buildUtilityShadowInputsFromBundles({
        bundles: utilityBundles,
        classSlug,
        specSlug,
        roleSlug: roleSlug ?? null,
        detailedWclEventCallsMade: utilityDetailedCalls,
      });
    } catch (err) {
      logger.warn(
        { characterId: character.id, err },
        "utility fallback pass failed — continuing with baseline evidence only",
      );
      utilityFallbackDiagnostics = {
        ...utilityFallbackDiagnostics,
        triggered: true,
        stoppedReason: "ingest_error",
        remainingEvidenceGaps: [...utilityBaseline.reasons, "fallback_ingest_error"],
      };
    }
  }

  // Apply publication once with the final baseline state (Option A: only PUBLISHABLE publishes).
  const utilityShadowBoundary = applyUtilityShadowRefreshBoundary({
    observations,
    hasPersistedSharedEvidence: shadowInputs.hasPersistedSharedEvidence,
    observedAt: observedAtForUtility,
    classSlug,
    specSlug,
    scoreModelConfig: model.config,
    baselineState: utilityBaseline.state,
    coverage: {
      ...shadowInputs.coverage,
      classSlug,
      specSlug,
      evidenceAnalysisVersion: "wcl-run-evidence-v1",
    },
    shadowScoreInput: {
      mode: utilityPublicationMode,
      hasPersistedSharedEvidence: shadowInputs.hasPersistedSharedEvidence,
      runs: shadowInputs.runs,
      rawByRunId: shadowInputs.rawByRunId,
      masterByReport: shadowInputs.masterByReport,
      opportunities: shadowInputs.opportunities,
      hostileCastEventsByRun: shadowInputs.hostileCastEventsByRun,
      detailedWclEventCallsMade: shadowInputs.detailedWclEventCallsMade,
    },
  });
  // Align classifier with the scored shadow used for publication.
  utilityBaseline = classifyUtilitySampleState({
    coverage: {
      ...shadowInputs.coverage,
      notes: shadowInputs.notes,
    },
    shadow: utilityShadowBoundary.shadow,
    gates: utilityGates,
    expectedDungeonCount,
    wclDataState,
    bundles: utilityBundles,
  });
  // Dimension-scoped replace — never clear Survival/Performance/Experience.
  // Eligibility already fails closed for non-PUBLISHABLE baseline states (Option A).
  const nextObservations = replaceUtilityObservationsDimensionScoped(
    observations,
    utilityShadowBoundary.publicUtilitySafeObservations,
  );
  observations.length = 0;
  observations.push(...nextObservations);
  const utilityShadow = utilityShadowBoundary.shadow;
  const utilityBaselineDiagnosticRecord = {
    ...utilityBaseline,
    fallbackTriggered: utilityFallbackDiagnostics.triggered,
  };
  if (scoringRunSelection.selectedRuns[0]?.canonicalRunId) {
    try {
      await persistUtilityShadowDiagnostics({
        runRepository: repositories.run,
        characterId: character.id,
        runId: scoringRunSelection.selectedRuns[0]!.canonicalRunId,
        shadow: utilityShadow,
        now,
        published: utilityShadowBoundary.published,
        eligibilityReasons: utilityShadowBoundary.eligibilityReasons,
        baselineDiagnostic: utilityBaselineDiagnosticRecord as Record<string, unknown>,
        fallbackDiagnostics: utilityFallbackDiagnostics as unknown as Record<string, unknown>,
      });
    } catch (err) {
      logger.warn(
        { characterId: character.id, err },
        "utility shadow diagnostics persist failed — continuing without altering public Utility",
      );
    }
  }

  // Season already resolved above for run persistence.
  const scoreCalculatedAt = new Date();
  const observedAtForScore = scoreCalculatedAt.toISOString();
  // Rebuild survival observations with final freshness, then persist metrics using score clock.
  for (const obs of wclSurvival.observations) {
    obs.observedAt = observedAtForScore;
  }
  for (const obs of observations) {
    if (obs.dimension === "UTILITY" || obs.metricKey.startsWith("utility.")) {
      obs.observedAt = observedAtForScore;
    }
  }

  const persistedObservations = await repositories.metric.listForCharacter(character.id, season.id);
  const failedDimensions = new Set<string>();
  const refreshedMetricKeys = new Set<string>();

  const wclSummaryFailed = stagesSkipped.includes("refresh-warcraftlogs-summary");
  const wclAnalyzeFailed = stagesSkipped.includes("analyze-run");

  if (wclPerformance.observations.length === 0 && (wclSummaryFailed || wclAnalyzeFailed)) {
    failedDimensions.add("PERFORMANCE");
  } else {
    for (const obs of wclPerformance.observations) {
      refreshedMetricKeys.add(obs.metricKey);
    }
  }

  if (wclSurvival.observations.length === 0 && (wclSummaryFailed || wclAnalyzeFailed)) {
    failedDimensions.add("SURVIVAL");
  } else if (wclSurvival.observations.length === 0) {
    // Soft-skips / required Survival failure: preserve last-known-good (do not wipe to UNAVAILABLE).
    // Genuine empty (no usable matches) leaves failedDimensions alone → UNAVAILABLE without fabricating.
    const softSkipReasons = new Set([
      "fight_details_soft_skip",
      "survival_canonical_soft_skip",
      "analyze_soft_skip",
    ]);
    const softSkipped = survivalCost.rejectedCandidates.some(
      (r) => softSkipReasons.has(r.reason) || r.reason.includes("already cached"),
    );
    if (survivalRequiredFailed || softSkipped) {
      failedDimensions.add("SURVIVAL");
    }
  } else {
    for (const obs of wclSurvival.observations) {
      refreshedMetricKeys.add(obs.metricKey);
    }
  }

  if (experienceProvenance === "PROVIDER_FAILURE") {
    // Preserve last-known-good Experience — do not convert a valid score into UNAVAILABLE.
    failedDimensions.add("EXPERIENCE");
  } else {
    for (const obs of experienceObservations) {
      refreshedMetricKeys.add(obs.metricKey);
    }
  }

  // Utility: when published mode runs (eligible or not), mark Utility metrics refreshed so
  // last-known-good does not resurrect combat-facts Utility under v6.
  if (utilityPublicationMode === "published") {
    const utilityProviderFailed =
      (wclSummaryFailed || wclAnalyzeFailed) && !utilityShadowBoundary.published;
    if (utilityProviderFailed && utilityShadow.status !== "SHADOW_SCORED") {
      // Preserve last-known-good Utility on provider failure.
      failedDimensions.add("UTILITY");
    } else {
      for (const obs of observations) {
        if (obs.dimension === "UTILITY" || obs.metricKey.startsWith("utility.")) {
          refreshedMetricKeys.add(obs.metricKey);
        }
      }
      refreshedMetricKeys.add("utility.observed_contribution");
      for (const key of [
        "utility.interrupts",
        "utility.crowd_control",
        "utility.dispels",
        "utility.externals",
        "utility.class_specific",
        "utility.catalog_coverage",
      ]) {
        refreshedMetricKeys.add(key);
      }
    }
  } else {
    for (const obs of observations) {
      if (obs.dimension === "UTILITY" || obs.metricKey.startsWith("utility.")) {
        refreshedMetricKeys.add(obs.metricKey);
      }
    }
  }

  const mergedObservations = mergeObservationsWithLastKnownGood({
    incoming: observations,
    persisted: persistedObservations,
    failedDimensions,
    refreshedMetricKeys,
  });

  const survivalLastKnownGoodPreserved =
    failedDimensions.has("SURVIVAL") &&
    wclSurvival.observations.length === 0 &&
    persistedObservations.some((o) => o.dimension === "SURVIVAL");
  const survivalLkgObservedAt = survivalLastKnownGoodPreserved
    ? persistedObservations
        .filter((o) => o.dimension === "SURVIVAL")
        .map((o) => Date.parse(o.observedAt))
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => b - a)[0]
    : null;
  const survivalEvidenceDiagnostics = {
    survivalStatus:
      wclSurvival.observations.length > 0
        ? "SCORED"
        : survivalLastKnownGoodPreserved
          ? "LAST_KNOWN_GOOD_PRESERVED"
          : "UNAVAILABLE",
    candidateRunCount: survivalRunSelection.selectedRuns.length,
    matchedReportCount: survivalRunSelection.selectedRuns.filter((r) => r.wclReportMatched).length,
    compatibleEvidenceCount: survivalRows.length,
    completeSurvivalEvidenceCount: survivalRows.length,
    incompleteEvidenceCount: survivalCost.rejectedCandidates.filter((r) =>
      r.reason.includes("incomplete") || r.reason.includes("soft_skip"),
    ).length,
    reusedEvidenceCount: survivalCost.reusedRunAnalyses,
    newlyFetchedEvidenceCount: survivalCost.newRunAnalyses,
    analyzedRunCount: survivalRows.length,
    rejectedRunCount: survivalCost.rejectedCandidates.length,
    missingDatasets: [
      ...new Set(
        survivalCost.rejectedCandidates
          .map((r) => r.reason)
          .filter((reason) => reason.includes("missing") || reason.includes("incomplete")),
      ),
    ],
    actorAttributionFailures: survivalCost.rejectedCandidates.filter((r) =>
      r.reason.includes("actor") || r.reason.includes("attribution"),
    ).length,
    staleRevisionCount: survivalCost.rejectedCandidates.filter((r) =>
      r.reason.includes("revision") || r.reason.includes("stale"),
    ).length,
    detailedWclEventCallsMade: sharedEvidenceDetailedEventCalls,
    lastKnownGoodPreserved: survivalLastKnownGoodPreserved,
    lastKnownGoodAgeSeconds:
      survivalLkgObservedAt != null
        ? Math.max(0, Math.round((scoreCalculatedAt.getTime() - survivalLkgObservedAt) / 1000))
        : null,
    rejectionReasons: survivalCost.rejectedCandidates.slice(0, 40),
    reasons:
      wclSurvival.observations.length > 0
        ? []
        : survivalLastKnownGoodPreserved
          ? ["SURVIVAL_REFRESH_INCOMPLETE_LKG_PRESERVED"]
          : ["NO_SURVIVAL_OBSERVATIONS"],
  };

  await repositories.metric.upsertObservations(character.id, season.id, mergedObservations);

  // ── Calculate + structurally validate score ─────────────────────────────
  // Active model already loaded before Utility publication.
  await assertNotCancelled("pre_recalculation");

  const modelConfig = {
    ...(model.config as unknown as ScoreModelConfig & Record<string, unknown>),
    version: model.version,
    key: model.key,
    metricWeights: {
      ...((model.config as { metricWeights?: Record<string, unknown> }).metricWeights ?? {}),
      PERFORMANCE: wclPerformance.performanceMetricWeights,
      SURVIVAL: wclSurvival.survivalMetricWeights,
    },
  } as ScoreModelConfig;

  // ── Final publication / TOCTOU contract barrier ─────────────────────────
  // Re-resolve immediately before score calculation/publication. Protects
  // against contract changes that occur after the job-start preflight.
  // Do not remove or weaken this guard. Cancellation is re-checked atomically
  // inside the publication transaction (publicationGuard).
  await assertNotCancelled("pre_publication");

  const { contract: refreshContract, hash: computedContractHash } = resolveActiveRefreshContract({
    scoringModelKey: model.key,
    scoringModelVersion: model.version,
    activeSeasonId: season.slug,
    providerMode: container.env.PROVIDER_MODE,
    env: process.env,
  });

  if (
    jobPayload.refreshContractHash &&
    jobPayload.refreshContractHash !== computedContractHash
  ) {
    logger.error(
      {
        ...logBase,
        event: "refresh_contract_hash_mismatch",
        barrier: "publication_toctou",
        stage: "publication",
        requestedRefreshContractHash: jobPayload.refreshContractHash,
        currentRefreshContractHash: computedContractHash,
        refreshContract,
        characterId: character.id,
        contractSeasonSlug: season.slug,
        triggerSource: jobPayload.triggerSource ?? "UNKNOWN",
      },
      "refresh contract publication/TOCTOU mismatch — refusing to publish divergent snapshot",
    );
    const mismatchError = {
      code: "REFRESH_CONTRACT_HASH_MISMATCH",
      message: "Refresh contract mismatch",
    };
    await repositories.job.markFailed(job.id, mismatchError);
    terminalized = true;
    throw Object.assign(new Error("Refresh contract mismatch"), mismatchError);
  }

  // Scoring V2 shadow orchestration (flags default off — no-op). Never blocks V1 publish.
  if (container.env.SCORING_V2_ENABLED) {
    const { maybeStartScoringV2ShadowFromRefresh } = await import("./scoring-v2/refresh-bridge.js");
    const { resolveFrozenCharacterIdentity } = await import("./scoring-v2/class-spec-identity.js");
    const { mythicRunToEvidenceCandidateMetadata } = await import("@mplus/scoring");
    // Coherent class/spec/role from the same provider chain — never Character.role, never DPS default.
    const frozenIdentity = resolveFrozenCharacterIdentity({
      blizzard: blizzardProfile
        ? {
            classSlug: blizzardProfile.classSlug,
            specSlug: blizzardProfile.specSlug,
            role: blizzardProfile.role,
          }
        : null,
      raiderIo: raiderIoProfile
        ? {
            classSlug: raiderIoProfile.classSlug,
            specSlug: raiderIoProfile.specSlug,
            role: raiderIoProfile.role,
          }
        : null,
    });
    const v2Candidates = fusedRuns
      .map((run) => mythicRunToEvidenceCandidateMetadata(run))
      .filter((c): c is NonNullable<typeof c> => c != null);
    await maybeStartScoringV2ShadowFromRefresh({
      container,
      characterId: character.id,
      seasonId: season.id,
      seasonSlug: season.slug,
      role: frozenIdentity.role,
      classSlug: frozenIdentity.classSlug,
      specSlug: frozenIdentity.specSlug,
      refreshContract,
      evidenceCutoffAt: new Date(0).toISOString(),
      highKeyPolicyId: "high-key-policy-v1",
      activeDungeonSlugs:
        activeDungeonSlugs.length > 0 ? activeDungeonSlugs : CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
      candidates: v2Candidates,
      scoreModelId: model.id,
      parentIngestionJobId: job.id,
      correlationId: ctx.correlationId ?? ctx.requestId,
      refreshGeneration: Date.parse(jobPayload.requestedAt) || Date.now(),
      region: identity.region,
    });
  }

  const scoreDto = container.calculateScore({
    characterId: character.id,
    seasonSlug: season.slug,
    model: modelConfig,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations: mergedObservations,
    calculatedAt: scoreCalculatedAt.toISOString(),
    inputFingerprint: fingerprintObservations(character.id, model.key, model.version, mergedObservations, {
      refreshContract,
      scoringRunSelectionKey: buildScoringRunSelectionKey(scoringRunSelection.selectedRuns),
      forceRefreshToken: jobPayload.forceRefresh ? jobPayload.requestedAt : null,
      overallFormula:
        typeof (model.config as { overallFormula?: unknown }).overallFormula === "string"
          ? String((model.config as { overallFormula: string }).overallFormula)
          : model.version >= 6
            ? "WEIGHTED_DIMENSIONS"
            : "LEGACY_AUTHENTICITY_CONFIDENCE_BLEND",
    }),
    context: {
      role: character.role ?? blizzardProfile?.role ?? raiderIoProfile?.role ?? "DPS",
      freshness,
      selectedRunCoverage,
      wclVisibility,
      matchedWclRunCount: combatFactsList.length,
      authenticity: authenticityFeatures,
      mechanicCatalogVersion: refreshContract.mechanicCatalogVersion,
    },
  });
  logger.info(
    {
      ...logBase,
      event: OBS_EVENTS.refreshScoreCalculated,
      modelKey: model.key,
      modelVersion: model.version,
      scoreConfidence: scoreDto.confidence,
      observationCount: observations.length,
      dimensionCoverage: scoreDto.dimensions.map((d) => d.dimension),
    },
    OBS_EVENTS.refreshScoreCalculated,
  );

  // Override PERFORMANCE dimension confidence with independent WCL confidence when freshly scored.
  // When WCL failed, merged observations preserve last-known-good — do not force UNAVAILABLE.
  if (wclPerformance.observations.length > 0) {
    for (const dim of scoreDto.dimensions) {
      if (dim.dimension === "PERFORMANCE") {
        dim.confidence = wclPerformance.confidence;
        if (dim.score != null && dim.confidence > 0) {
          dim.state = dim.confidence < 0.35 ? "PARTIAL" : "AVAILABLE";
          dim.reason = dim.state === "PARTIAL" ? "INCOMPLETE_COVERAGE" : null;
        }
      }
    }
  } else if (!failedDimensions.has("PERFORMANCE")) {
    for (const dim of scoreDto.dimensions) {
      if (dim.dimension === "PERFORMANCE") {
        dim.confidence = 0;
        dim.score = null;
        dim.state = "UNAVAILABLE";
        dim.reason = "NO_WCL_PERFORMANCE_OBSERVATIONS";
      }
    }
  }

  const providerStates = await repositories.providerState.listForCharacter(character.id);
  const timestampFor = (provider: "blizzard" | "raiderio" | "warcraftlogs") =>
    providerStates.find((s) => s.provider === provider)?.fetchedAt ?? null;

  const rankingEligibility = buildRankingEligibility({
    scoreModelVersion: model.version,
    dimensions: scoreDto.dimensions,
    overallState: scoreDto.overallState,
    provisionalReason: scoreDto.provisionalReason,
    utilityPublicationEligible: utilityShadowBoundary.utilityPublicationEligible,
    utilityPublicationReasons: utilityShadowBoundary.eligibilityReasons,
  });
  // Profiles without eligible Utility remain viewable but are provisional for ranking.
  if (!rankingEligibility.eligible && model.version >= 6) {
    scoreDto.overallState = "PROVISIONAL";
    scoreDto.provisionalReason = [
      scoreDto.provisionalReason,
      "RANKING_INELIGIBLE",
      ...rankingEligibility.reasons.slice(0, 5),
    ]
      .filter(Boolean)
      .join("; ");
    if (scoreDto.grade !== "U" && !rankingEligibility.utilityEligible) {
      // Keep numeric Trust; grade U only when model coverage already forced it.
    }
  }
  scoreDto.rankingEligibility = rankingEligibility;

  // Enrich explanation with fusion provenance (model version already present).
  const explanation =
    scoreDto.explanation && typeof scoreDto.explanation === "object"
      ? {
          ...(scoreDto.explanation as Record<string, unknown>),
          observations: mergedObservations.map((o) => ({
            metricKey: o.metricKey,
            sourceProvider: o.sourceProvider,
            observedAt: o.observedAt,
            confidence: o.confidence,
            rawValue: o.rawValue,
            normalizedValue: o.normalizedValue,
            context: o.context,
          })),
          providerTimestamps: {
            blizzard: timestampFor("blizzard") ?? (blizzardProfile ? now.toISOString() : null),
            raiderio: timestampFor("raiderio") ?? (raiderIoProfile ? now.toISOString() : null),
            warcraftlogs:
              timestampFor("warcraftlogs") ?? (wclVisibility != null ? now.toISOString() : null),
          },
          warnings: fusionWarnings,
          disagreements,
          excludedObservations,
          confidence: scoreDto.confidence,
          coverage: {
            selectedRunCoverage,
            freshness,
            selectedRunCount,
            detailedRunCount,
            analysisAttemptedCount,
            matchedReportCount,
            usableCombatRunCount,
            availableModelWeight: scoreDto.availableModelWeight,
            totalModelWeight: scoreDto.totalModelWeight,
            modelCoverageRatio: scoreDto.modelCoverageRatio,
            overallState: scoreDto.overallState,
            provisionalReason: scoreDto.provisionalReason,
          },
          scoringRunSelection: contractScoringRunSelection,
          runDiagnostics,
          runCoverageById,
          seasonSlug: season.slug,
          fusedRunCount: fusedRuns.length,
          wclVisibility,
          wclDataState,
          performanceSummary: wclPerformance.summary,
          survivalSummary: wclSurvival.summary,
          survivalEvidence: survivalEvidenceDiagnostics,
          utilityObservedShadow: shadowDiagnosticsForScoreExplanation(
            utilityShadow,
            {
              ...shadowInputs.coverage,
              matchedReportCount: shadowInputs.coverage.compatibleEvidenceCount,
              notes: shadowInputs.notes,
            },
            {
              published: utilityShadowBoundary.published,
              eligibilityReasons: utilityShadowBoundary.eligibilityReasons,
              utilityPublicationEligible: utilityShadowBoundary.utilityPublicationEligible,
              baselineDiagnostic: utilityBaselineDiagnosticRecord as Record<string, unknown>,
              fallbackDiagnostics: utilityFallbackDiagnostics as unknown as Record<string, unknown>,
            },
          ),
          rankingEligibility,
          rawZoneRankingsPointsAndDamage: wclPerformanceRecord?.raw ?? null,
          abilityCatalog: catalogDiagnostics,
          historyMode: "CHARACTER_HISTORY",
          experienceModel: "v2",
          refreshContract,
          refreshContractHash: hashRefreshContract(refreshContract),
        }
      : scoreDto.explanation;

  const enrichedScore: ScoreSnapshotDTO = { ...scoreDto, explanation };

  const quality = validateScoreSnapshot(enrichedScore, model.config as unknown as ScoreModelConfig);
  if (!quality.ok) {
    logger.warn(
      { characterId: character.id, violations: quality.violations },
      "refresh pipeline: score snapshot failed structural data-quality invariants — blocking persistence",
    );
    const error = new Error(
      `Score snapshot failed structural validation: ${quality.violations.map((v) => v.code).join(", ")}`,
    );
    await repositories.job.markFailed(job.id, error);
    terminalized = true;
    throw error;
  }

  // Fan-in batch: record selected-run terminal states then publish once.
  const analysisBatch = await repositories.analysisBatch.createBatch({
    characterId: character.id,
    seasonId: season.id,
    refreshId: job.id,
    scoreModelId: model.id,
    runIds: scoringRunSelection.selectedRuns.map((r) => r.canonicalRunId),
    deadlineAt: new Date(now.getTime() + 15 * 60_000),
    metadata: {
      selectedRunCount,
      detailedRunCount,
      catalogVersion: abilityCatalog.catalogVersion,
      catalogSupported: abilityCatalog.supported,
    },
  });

  for (const entry of scoringRunSelection.selectedRuns) {
    const diag = runDiagnostics.find((d) => String(d.runId) === entry.canonicalRunId);
    const detailed = Boolean(diag?.detailedAnalysis);
    const status = detailed
      ? ("SUCCEEDED" as const)
      : entry.wclReportMatched
        ? ("FAILED" as const)
        : ("UNAVAILABLE" as const);
    await repositories.analysisBatch.markRunStatus({
      batchId: analysisBatch.id,
      runId: entry.canonicalRunId,
      status,
      terminalReason: detailed
        ? null
        : String(diag?.reason ?? (entry.wclReportMatched ? "ANALYZE_FAILED" : "NO_WCL_SOURCE")),
    });
  }

  const claimed = await repositories.analysisBatch.claimFinalization(analysisBatch.id);
  if (!claimed) {
    logger.warn(
      { batchId: analysisBatch.id, characterId: character.id },
      "refresh pipeline: finalization claim skipped (duplicate or not ready)",
    );
  }

  const contractHash = hashRefreshContract(refreshContract);
  const explanationContractHash =
    explanation && typeof explanation === "object"
      ? (explanation as { refreshContractHash?: unknown }).refreshContractHash
      : null;
  if (
    typeof explanationContractHash === "string" &&
    explanationContractHash !== contractHash
  ) {
    const mismatchError = new Error(
      `REFRESH_CONTRACT_EXPLANATION_HASH_MISMATCH: published=${contractHash} explanation=${explanationContractHash}`,
    );
    logger.error(
      {
        ...logBase,
        event: "refresh_contract_explanation_hash_mismatch",
        publishedRefreshContractHash: contractHash,
        explanationRefreshContractHash: explanationContractHash,
        characterId: character.id,
      },
      "refresh contract explanation hash mismatch — refusing to publish",
    );
    await repositories.job.markFailed(job.id, mismatchError);
    terminalized = true;
    throw mismatchError;
  }
  if (jobPayload.refreshContractHash && jobPayload.refreshContractHash !== contractHash) {
    const mismatchError = new Error(
      `REFRESH_CONTRACT_JOB_PUBLISH_HASH_MISMATCH: requested=${jobPayload.refreshContractHash} published=${contractHash}`,
    );
    logger.error(
      {
        ...logBase,
        event: "refresh_contract_job_publish_hash_mismatch",
        requestedRefreshContractHash: jobPayload.refreshContractHash,
        publishedRefreshContractHash: contractHash,
        characterId: character.id,
      },
      "job requested contract hash differs from publish hash — refusing to publish",
    );
    await repositories.job.markFailed(job.id, mismatchError);
    terminalized = true;
    throw mismatchError;
  }

  const publication = await attemptPublication({
    characterId: character.id,
    seasonId: season.id,
    scoreModelId: model.id,
    model: modelConfig,
    candidate: enrichedScore,
    incomingObservations: observations,
    persistedObservations,
    failedDimensions,
    refreshedMetricKeys,
    refreshContractHash: contractHash,
    providerDataAsOf: (() => {
      const warcraftlogsAt = timestampFor("warcraftlogs");
      return warcraftlogsAt ? new Date(warcraftlogsAt) : now;
    })(),
    analysisBatchId: analysisBatch.id,
    scoreRepository: repositories.score,
    metricRepository: repositories.metric,
    publicationGuard: { ingestionJobId: job.id },
  });

  if (publication.cancelled) {
    await assertNotCancelled("publication_atomic");
  }

  if (publication.rejectionReason === "REFRESH_CONTRACT_HASH_MISMATCH") {
    const mismatchError = {
      code: "REFRESH_CONTRACT_HASH_MISMATCH",
      message: "Refresh contract mismatch at atomic publication barrier",
    };
    await repositories.job.markFailed(job.id, mismatchError);
    terminalized = true;
    throw Object.assign(new Error(mismatchError.message), mismatchError);
  }

  if (!publication.published) {
    logger.warn(
      {
        ...logBase,
        event: "refresh_publication_rejected",
        rejectionReason: publication.rejectionReason,
        violations: publication.coherence.violations,
        regressedDimensions: publication.coherence.regressedDimensions,
      },
      "refresh pipeline: candidate rejected — keeping published snapshot",
    );
  } else {
    logger.info(
      {
        ...logBase,
        event: OBS_EVENTS.refreshPersistenceCompleted,
        coverageState: publication.coherence.coverageState,
      },
      OBS_EVENTS.refreshPersistenceCompleted,
    );
  }

  if (claimed) {
    await repositories.analysisBatch.markFinalized(analysisBatch.id);
  }

  const publishedForReturn = publication.published
    ? null
    : await repositories.score.getPublishedSnapshot(character.id, season.id, model.id);

  character = await repositories.character.updateRefreshTimestamps(character.id, {
    lastSeenAt: now,
    ...(publication.published ? { lastPublicRefreshAt: now } : {}),
  });

  try {
    if (refreshCostAccumulator.records.length > 0) {
      await recordRefreshCostEntries(container.prisma, refreshCostAccumulator.records);
    }
  } catch (costErr) {
    logger.warn(
      { ...logBase, event: "refresh_cost_ledger_write_failed", err: costErr },
      "refresh_cost_ledger_write_failed",
    );
  }

  job = await repositories.job.markCompleted(job.id);
  terminalized = true;
  await releaseAdmission("SETTLED");
  logger.info(
    {
      ...logBase,
      event: OBS_EVENTS.refreshTerminal,
      jobId: job.id,
      status: "COMPLETED",
      stagesSkipped,
      publicationRejected: !publication.published,
      sharedEvidenceDetailedEventCalls,
    },
    OBS_EVENTS.refreshTerminal,
  );

  return {
    character,
    job,
    score: publication.published
      ? enrichedScore
      : publishedForReturn
        ? mapDbSnapshotToDto(publishedForReturn)
        : enrichedScore,
    stagesSkipped,
    notFound: false,
    disagreements,
    excludedObservations,
    sharedEvidenceDetailedEventCalls,
  };
  } catch (error) {
    await ensureFailed(error);
    const cancelled =
      (error as { code?: string })?.code === "CANCELLED" ||
      (await repositories.job.findById(job.id))?.status === "CANCELLED";
    logger.warn(
      {
        ...logBase,
        event: OBS_EVENTS.refreshTerminal,
        jobId: job.id,
        status: cancelled ? "CANCELLED" : "FAILED",
      },
      OBS_EVENTS.refreshTerminal,
    );
    throw error;
  }
}
