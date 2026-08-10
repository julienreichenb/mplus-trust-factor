import type { Character, IngestionJob } from "@mplus/database";
import type {
  CanonicalCharacter,
  CharacterIdentityInput,
  CharacterProfileResponse,
  CharacterResolveResponse,
  PerformanceSummaryDTO,
  ProviderName,
  RefreshCharacterJob,
  RefreshStatusResponse,
  RefreshTriggerSource,
  ScoreSnapshotDTO,
  ScoringRunSelection,
  SearchCharacterResponse,
  SurvivalSummaryPublicDTO,
  WclContributionType,
  WclDataState,
  WclVisibilityState,
} from "@mplus/contracts";
import { deriveWclContributionTypes, normalizeWclProvenance } from "@mplus/contracts";
import { normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import {
  decideScoreRefresh,
  extractJobErrorCode,
  buildCharacterRefreshEligibilityPolicy,
  evaluateCharacterRefreshEligibility,
  isEligibilityFailureCode,
  type CharacterRefreshEligibilityResult,
  type ScoreRefreshDecision,
} from "@mplus/config";
import type { EnqueueResult } from "@mplus/worker";
import {
  pickEarliestActiveRefreshJob,
  supersedeDuplicateRefreshJob,
  resolveActiveRefreshContract,
  SeasonAuthorityUnavailableError,
  requireVerifiedSeasonAuthority,
  loadCharacterRefreshEligibilitySignals,
  fetchBlizzardPublicBootstrap,
  persistPublicCharacterBootstrap,
  CURRENT_SEASON_EVIDENCE_REUSED,
  CURRENT_SEASON_EVIDENCE_REPAIRED,
  CURRENT_SEASON_CONFIRMED_NO_SCORE,
  CURRENT_SEASON_EVIDENCE_PROVIDER_FAILURE,
  type CurrentSeasonMythicEvidence,
  type RefreshJobControlDeps,
  type VerifiedSeasonAuthority,
} from "@mplus/worker";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { cooldownSecondsRemaining } from "../lib/freshness.js";
import {
  mapCharacterProfile,
  mapRunSummary,
  mapScoreSnapshot,
  type CharacterSourceAttribution,
  type RunSummaryDTO,
} from "../lib/mappers.js";
import { resolveProductScoreDto } from "../lib/product-score-resolve.js";
import { mapJobStatusWithEta } from "./refresh-eta-service.js";
import { applyProfileWarnings, appendRefreshContractWarnings, buildProfileEnrichments, isScoreStaleVersusProviders, resolveWclUrlFromSources, scoreSnapshotContractStaleReasons, toPublicProviderKey } from "../lib/profile-enrichment.js";
import { characterCacheKey } from "../lib/response-cache.js";
import { scheduleProfileViewRecording } from "../lib/profile-view-recorder.js";
import { ExplainabilityV2Service } from "./explainability-v2-service.js";
import {
  CHARACTER_BOOTSTRAP_INCOMPLETE,
  CHARACTER_IDENTITY_COLLISION,
  characterLacksBootstrapEvidence,
  eligibilityConflictNeedsBootstrapRepair,
  formatIdentityCollisionMessage,
  isBootstrapRepairRequired,
  shouldRepairCharacterBootstrap,
} from "./character-bootstrap-repair.js";

const ALL_PROVIDERS: ProviderName[] = ["blizzard", "raiderio", "warcraftlogs"];
const DEFAULT_RETRY_AFTER_MS = 2_000;
const PROFILE_PATH_PREFIX = "/character";

/** Process-local serialize exact-resolve bootstrap/repair per identity (tests + single API instance). */
const resolveIdentityLocks = new Map<string, Promise<void>>();

function resolveIdentityLockKey(identity: CharacterIdentityInput): string {
  return `${normalizeRegion(identity.region)}|${normalizeRealmSlug(identity.realmSlug)}|${identity.name
    .trim()
    .toLocaleLowerCase("en-US")}`;
}

async function withResolveIdentityLock<T>(
  identity: CharacterIdentityInput,
  run: () => Promise<T>,
): Promise<T> {
  const key = resolveIdentityLockKey(identity);
  const previous = resolveIdentityLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  resolveIdentityLocks.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (resolveIdentityLocks.get(key) === tail) {
      resolveIdentityLocks.delete(key);
    }
  }
}

function jobMatchesRefreshContract(
  job: IngestionJob,
  hash: string,
  authoritativeSeasonId: number,
): boolean {
  const payload = job.payload as Partial<RefreshCharacterJob> | null;
  if (!payload || typeof payload !== "object") return false;
  if (payload.refreshContractHash && payload.refreshContractHash !== hash) return false;
  if (
    typeof payload.authoritativeSeasonId === "number" &&
    payload.authoritativeSeasonId !== authoritativeSeasonId
  ) {
    return false;
  }
  // Legacy active jobs without hash: do not treat as matching a verified contract.
  if (!payload.refreshContractHash) return false;
  return payload.refreshContractHash === hash;
}

function buildProfilePath(identity: CharacterIdentityInput): string {
  const region = normalizeRegion(identity.region);
  const realm = normalizeRealmSlug(identity.realmSlug);
  const name = identity.name.trim();
  return `${PROFILE_PATH_PREFIX}/${encodeURIComponent(region)}/${encodeURIComponent(realm)}/${encodeURIComponent(name)}`;
}

function readScoreObservationProviders(explanation: unknown): string[] {
  return readScoreObservations(explanation)
    .map((o) => (typeof o.sourceProvider === "string" ? o.sourceProvider : null))
    .filter((p): p is string => Boolean(p));
}

function readScoreObservations(
  explanation: unknown,
): Array<{ sourceProvider?: string | null; context?: unknown; metricKey?: string | null }> {
  if (!explanation || typeof explanation !== "object") return [];
  const observations = (explanation as { observations?: unknown }).observations;
  if (!Array.isArray(observations)) return [];
  return observations.filter((o): o is { sourceProvider?: string | null; context?: unknown; metricKey?: string | null } =>
    Boolean(o) && typeof o === "object",
  );
}

function readFreshness(explanation: unknown): number | null {
  if (!explanation || typeof explanation !== "object") return null;
  const coverage = (explanation as { coverage?: { freshness?: unknown } }).coverage;
  return typeof coverage?.freshness === "number" && Number.isFinite(coverage.freshness)
    ? coverage.freshness
    : null;
}

function readWclVisibilityFromSummary(summary: unknown): WclVisibilityState | null {
  if (!summary || typeof summary !== "object") return null;
  const record = summary as { wclVisibility?: unknown; wclDataState?: unknown };
  return normalizeWclProvenance(
    typeof record.wclVisibility === "string" ? record.wclVisibility : null,
    typeof record.wclDataState === "string" ? record.wclDataState : null,
  ).visibility;
}

function readWclDataStateFromSummary(summary: unknown): WclDataState | null {
  if (!summary || typeof summary !== "object") return null;
  const record = summary as { wclVisibility?: unknown; wclDataState?: unknown };
  return normalizeWclProvenance(
    typeof record.wclVisibility === "string" ? record.wclVisibility : null,
    typeof record.wclDataState === "string" ? record.wclDataState : null,
  ).dataState;
}

async function resolveWclProvenance(
  prisma: ApiContainer["worker"]["prisma"],
  characterId: string,
): Promise<{ visibility: WclVisibilityState | null; dataState: WclDataState | null }> {
  // Prefer character-level provider state (present even with zero matched runs).
  const providerState = await prisma.characterProviderState.findUnique({
    where: {
      characterId_provider: { characterId, provider: "WARCRAFT_LOGS" },
    },
    select: { wclVisibility: true, metadata: true },
  });
  if (providerState) {
    const metadata =
      providerState.metadata && typeof providerState.metadata === "object"
        ? (providerState.metadata as Record<string, unknown>)
        : {};
    const provenance = normalizeWclProvenance(
      providerState.wclVisibility,
      typeof metadata.wclDataState === "string" ? metadata.wclDataState : null,
    );
    if (provenance.visibility != null || provenance.dataState != null) {
      return provenance;
    }
  }

  const analysis = await prisma.runAnalysis.findFirst({
    where: { characterId },
    orderBy: { analyzedAt: "desc" },
    select: { summary: true },
  });
  return {
    visibility: readWclVisibilityFromSummary(analysis?.summary),
    dataState: readWclDataStateFromSummary(analysis?.summary),
  };
}

function readSelectedRunCoverage(explanation: unknown): number | null {
  if (!explanation || typeof explanation !== "object") return null;
  const coverage = (explanation as { coverage?: { selectedRunCoverage?: unknown } }).coverage;
  const value = coverage?.selectedRunCoverage;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readPerformanceSummary(explanation: unknown): PerformanceSummaryDTO | null {
  if (!explanation || typeof explanation !== "object") return null;
  const summary = (explanation as { performanceSummary?: unknown }).performanceSummary;
  if (!summary || typeof summary !== "object") return null;
  return summary as PerformanceSummaryDTO;
}

function readSurvivalSummary(explanation: unknown): SurvivalSummaryPublicDTO | null {
  if (!explanation || typeof explanation !== "object") return null;
  const summary = (explanation as { survivalSummary?: unknown }).survivalSummary;
  if (!summary || typeof summary !== "object") return null;
  return summary as SurvivalSummaryPublicDTO;
}

function readScoringRunSelection(explanation: unknown): ScoringRunSelection | null {
  if (!explanation || typeof explanation !== "object") return null;
  const selection = (explanation as { scoringRunSelection?: unknown }).scoringRunSelection;
  if (!selection || typeof selection !== "object") return null;
  return selection as ScoringRunSelection;
}

function readCoverageCounts(explanation: unknown): {
  selectedRunCount: number | null;
  detailedRunCount: number | null;
  runCoverageById: Record<string, number | null>;
} {
  if (!explanation || typeof explanation !== "object") {
    return { selectedRunCount: null, detailedRunCount: null, runCoverageById: {} };
  }
  const record = explanation as {
    coverage?: { selectedRunCount?: unknown; detailedRunCount?: unknown };
    runCoverageById?: Record<string, number | null>;
  };
  return {
    selectedRunCount:
      typeof record.coverage?.selectedRunCount === "number" ? record.coverage.selectedRunCount : null,
    detailedRunCount:
      typeof record.coverage?.detailedRunCount === "number" ? record.coverage.detailedRunCount : null,
    runCoverageById: record.runCoverageById ?? {},
  };
}

export interface CharacterHistoryResponse {
  characterId: string;
  snapshots: ScoreSnapshotDTO[];
}

export interface GetProfileResult {
  statusCode: 200 | 202;
  body: CharacterProfileResponse;
}

export class CharacterService {
  constructor(private readonly container: ApiContainer) {}

  private get worker() {
    return this.container.worker;
  }

  private get repositories() {
    return this.container.worker.repositories;
  }

  private get freshnessTtlSeconds(): number {
    // Published Trust Score TTL (calculation time). Provider TTLs remain separate.
    return this.container.env.SCORE_TTL_SECONDS;
  }

  private get failureBackoffSeconds(): number {
    return this.container.env.REFRESH_FAILURE_BACKOFF_SECONDS;
  }

  private async findOrCreateCharacter(identity: CharacterIdentityInput): Promise<Character> {
    const existing = await this.repositories.character.findByIdentity(identity);
    if (existing) return existing;
    return this.repositories.character.upsertCharacter(identity, { displayName: identity.name });
  }

  private async requireCharacter(identity: CharacterIdentityInput): Promise<Character> {
    if (this.container.negativeCache.has(identity)) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character is confirmed not found upstream");
    }
    const character = await this.repositories.character.findByIdentity(identity);
    if (!character) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character has not been resolved yet");
    }
    return character;
  }

  private seasonAuthorityDeps() {
    return {
      prisma: this.container.worker.prisma,
      blizzard: this.container.worker.providers.blizzard,
      logger: this.container.logger,
    };
  }

  private async resolveActiveRefreshContract(
    character: Character,
    opts: { allowProviderSync?: boolean; correlationId?: string | null } = {},
  ) {
    const region = await this.container.worker.prisma.region.findUnique({
      where: { id: character.regionId },
      select: { id: true, code: true },
    });
    if (!region) {
      throw new SeasonAuthorityUnavailableError("UNKNOWN", "Character region is missing");
    }

    const authority = await requireVerifiedSeasonAuthority(
      this.seasonAuthorityDeps(),
      region.code,
      region.id,
      {
        allowProviderSync: opts.allowProviderSync ?? false,
        correlationId: opts.correlationId,
      },
    );

    const activeModel =
      (await this.repositories.score.getActiveModel()) ?? {
        key: this.container.env.ACTIVE_SCORE_MODEL_KEY,
        version: this.container.env.ACTIVE_SCORE_MODEL_VERSION,
      };
    const resolved = resolveActiveRefreshContract({
      scoringModelKey: activeModel.key,
      scoringModelVersion: activeModel.version,
      activeSeasonId: authority.slug,
      providerMode: this.container.env.PROVIDER_MODE,
      env: process.env,
    });
    return {
      contract: resolved.contract,
      hash: resolved.hash,
      activeModel: { key: activeModel.key, version: activeModel.version },
      authority,
    };
  }

  /**
   * Atomic: verified season → contract → re-check authority → enqueue.
   * Never enqueues from an unverified/stale DB season.
   */
  private async enqueueRefresh(
    identity: CharacterIdentityInput,
    character: Character,
    opts: {
      forceRefresh?: boolean;
      correlationId?: string | null;
      triggerSource: RefreshTriggerSource;
      /** Manual paths may attempt one provider sync; profile reads must not. */
      allowProviderSync?: boolean;
      workloadClass?: "CALIBRATION" | "OPERATION";
    },
  ): Promise<EnqueueResult> {
    this.container.responseCache.invalidate(characterCacheKey(identity));

    const buildOnce = async () => {
      const resolved = await this.resolveActiveRefreshContract(character, {
        allowProviderSync: opts.allowProviderSync ?? false,
        correlationId: opts.correlationId,
      });
      return resolved;
    };

    let { hash, contract, authority } = await buildOnce();

    // TOCTOU: if authority moved between resolve and enqueue prep, rebuild once.
    const region = await this.container.worker.prisma.region.findUniqueOrThrow({
      where: { id: character.regionId },
      select: { id: true, code: true },
    });
    const recheck = await requireVerifiedSeasonAuthority(
      this.seasonAuthorityDeps(),
      region.code,
      region.id,
      {
        allowProviderSync: opts.allowProviderSync ?? false,
        correlationId: opts.correlationId,
      },
    );
    if (recheck.blizzardSeasonId !== authority.blizzardSeasonId || recheck.slug !== authority.slug) {
      this.container.logger.info(
        {
          event: "refresh_enqueue_deferred",
          characterId: character.id,
          triggerSource: opts.triggerSource,
          reason: "season_authority_changed_before_enqueue",
          previousAuthoritativeSeasonId: authority.blizzardSeasonId,
          authoritativeSeasonId: recheck.blizzardSeasonId,
        },
        "season authority changed before enqueue — rebuilding contract once",
      );
      ({ hash, contract, authority } = await buildOnce());
    }

    // Do not reuse an active job under a different contract / season identity.
    const activeJob = await this.repositories.job.findActiveForCharacter(character.id);
    if (activeJob && !jobMatchesRefreshContract(activeJob, hash, authority.blizzardSeasonId)) {
      await this.repositories.job.markFailed(activeJob.id, {
        code: "SEASON_AUTHORITY_SUPERSEDED",
        message: "Active refresh superseded by verified season authority change",
      });
      this.container.logger.info(
        {
          event: "refresh_enqueue",
          characterId: character.id,
          triggerSource: opts.triggerSource,
          reason: "superseded_obsolete_active_job",
          obsoleteJobId: activeJob.id,
          requestedRefreshContractHash: hash,
          authoritativeSeasonId: authority.blizzardSeasonId,
        },
        "superseded obsolete active refresh job",
      );
    } else if (activeJob && jobMatchesRefreshContract(activeJob, hash, authority.blizzardSeasonId)) {
      // Cross-process race: another replica already published an in-flight job.
      return {
        jobId: activeJob.id,
        dedupeKey: "",
        reused: true,
        enqueued: false,
      };
    }

    const result = await this.container.producers.enqueueRefreshCharacter({
      characterId: character.id,
      region: identity.region,
      realmSlug: identity.realmSlug,
      name: identity.name,
      priority: "normal",
      forceRefresh: opts.forceRefresh ?? false,
      correlationId: opts.correlationId ?? null,
      refreshContractHash: hash,
      scoringModelKey: contract.scoringModelKey,
      scoringModelVersion: contract.scoringModelVersion,
      triggerSource: opts.triggerSource,
      authoritativeSeasonId: authority.blizzardSeasonId,
      authoritativeSeasonSlug: authority.slug,
      authoritySource: authority.authoritySource,
      workloadClass: opts.workloadClass ?? "OPERATION",
    });

    // forceRefresh:true uses unique dedupe keys — collapse replica races to one active job.
    const winnerJobId = await this.collapseSupersededActiveRefreshJobs(character.id, result.jobId);
    const collapsed = winnerJobId !== result.jobId;

    this.container.logger.info(
      {
        event: "refresh_enqueue",
        characterId: character.id,
        triggerSource: opts.triggerSource,
        region: region.code,
        authoritativeSeasonId: authority.blizzardSeasonId,
        authoritativeSeasonSlug: authority.slug,
        authoritySource: authority.authoritySource,
        authorityVerifiedAt: authority.authorityVerifiedAt.toISOString(),
        contractSeasonId: authority.blizzardSeasonId,
        contractSeasonSlug: authority.slug,
        requestedRefreshContractHash: hash,
        zoneId: contract.zoneId,
        partition: contract.partition,
        reused: result.reused || collapsed,
        enqueued: collapsed ? false : (result.enqueued ?? false),
        jobId: winnerJobId,
        collapsedFromJobId: collapsed ? result.jobId : undefined,
      },
      "refresh enqueue",
    );
    return {
      ...result,
      jobId: winnerJobId,
      reused: result.reused || collapsed,
      enqueued: collapsed ? false : result.enqueued,
    };
  }

  /**
   * Cross-process safety net: when concurrent forceRefresh enqueues create multiple
   * active jobs for one character, keep the earliest and supersede the rest.
   * QUEUED losers: BullMQ remove + FAILED REFRESH_SUPERSEDED_DEDUPED + admission release.
   * ACTIVE losers: cooperative cancel (worker refuses before provider work) + admission release.
   * Preserves historical FAILED rows (they are not active).
   */
  private async collapseSupersededActiveRefreshJobs(
    characterId: string,
    preferredJobId: string,
  ): Promise<string> {
    const listFn = this.repositories.job.listActiveRefreshJobsForCharacter;
    if (typeof listFn !== "function") {
      return preferredJobId;
    }
    const actives = await listFn.call(this.repositories.job, characterId);
    if (actives.length <= 1) {
      return actives[0]?.id ?? preferredJobId;
    }
    const winner = pickEarliestActiveRefreshJob(actives);
    if (!winner) {
      return preferredJobId;
    }
    const controlDeps = this.refreshJobControlDeps();
    for (const job of actives) {
      if (job.id === winner.id) continue;
      const result = await supersedeDuplicateRefreshJob(controlDeps, job.id, winner.id);
      this.container.logger.info(
        {
          event: "refresh_enqueue",
          characterId,
          reason: "collapsed_duplicate_active_refresh",
          winnerJobId: winner.id,
          supersededJobId: job.id,
          outcome: result.outcome,
          queueRemoved: result.queueRemoved,
          databaseStatus: result.databaseStatus,
        },
        "collapsed duplicate active refresh job",
      );
    }
    return winner.id;
  }

  /** Shared cancel/supersede deps — admission release is idempotent best-effort. */
  private refreshJobControlDeps(): RefreshJobControlDeps {
    const env = this.container.env;
    const releaseAdmission =
      env.REFRESH_ADMISSION_MODE === "enforce"
        ? async (ingestionJobId: string) => {
            const redis = this.container.worker.createRedisConnection();
            try {
              const { createPipelineAdmissionGate } = await import("@mplus/worker");
              const { gate } = createPipelineAdmissionGate({
                env,
                redis,
                prisma: this.container.worker.prisma,
                logger: this.container.logger,
              });
              await gate.tryRelease(ingestionJobId, { status: "CANCELLED" });
            } finally {
              try {
                await redis.quit();
              } catch {
                /* ignore */
              }
            }
          }
        : undefined;
    return {
      jobRepository: this.repositories.job,
      refreshQueue: this.container.producers.getRefreshCharacterQueue?.() ?? null,
      logger: this.container.logger,
      releaseAdmission,
    };
  }

  /**
   * Bounded Blizzard profile + current-season Mythic+ reads for resolve bootstrap.
   * Never invents eligibility evidence on NOT_FOUND.
   * Keystone UNKNOWN is returned as ok:true with currentSeasonMythic.state=UNKNOWN
   * (profile may still be usable for shell repair) — callers must not treat it as no-score.
   */
  private async fetchBlizzardBootstrap(
    identity: CharacterIdentityInput,
    opts: { correlationId?: string | null },
    notFoundMessage: string,
  ): Promise<
    | {
        ok: true;
        profile: CanonicalCharacter;
        currentSeasonMythic: CurrentSeasonMythicEvidence;
        providerCalls: number;
      }
    | { ok: false; statusCode: number; body: CharacterResolveResponse }
  > {
    const fetched = await fetchBlizzardPublicBootstrap(
      this.container.worker.providers.blizzard,
      identity,
      { correlationId: opts.correlationId, forceRefresh: true },
    );
    if (fetched.ok) {
      return {
        ok: true,
        profile: fetched.profile,
        currentSeasonMythic: fetched.currentSeasonMythic,
        providerCalls: fetched.providerCalls,
      };
    }
    const error = fetched.error;
    if (error.code === "NOT_FOUND") {
      this.container.negativeCache.set(identity);
      return {
        ok: false,
        statusCode: 404,
        body: {
          status: "NOT_FOUND",
          message: notFoundMessage,
        },
      };
    }
    if (error.retryable) {
      return {
        ok: false,
        statusCode: 503,
        body: {
          status: "PROVIDER_UNAVAILABLE",
          retryable: true,
          message: "Blizzard is temporarily unavailable. Please retry shortly.",
        },
      };
    }
    return {
      ok: false,
      statusCode: 502,
      body: {
        status: "FAILED",
        retryable: false,
        message: error.message || "Character verification failed.",
      },
    };
  }

  private providerUnavailableBody(): CharacterResolveResponse {
    return {
      status: "PROVIDER_UNAVAILABLE",
      retryable: true,
      message: "Blizzard is temporarily unavailable. Please retry shortly.",
    };
  }

  /**
   * Persist authoritative Blizzard bootstrap metadata + season-scoped Mythic+ evidence.
   * Exact resolve only — never GET profile or background admission.
   * UNKNOWN current-season evidence does not write rating rows.
   */
  private async persistBootstrapFromBlizzardProfile(
    character: Character,
    identity: CharacterIdentityInput,
    authority: VerifiedSeasonAuthority,
    profile: CanonicalCharacter,
    currentSeasonMythic: CurrentSeasonMythicEvidence,
  ): Promise<Character> {
    void identity;
    return persistPublicCharacterBootstrap({
      prisma: this.container.worker.prisma,
      characterRepository: this.repositories.character,
      character,
      profile,
      currentSeasonMythic,
      authority,
    });
  }

  /**
   * Fail visibly when two persisted rows claim conflicting non-null Blizzard IDs.
   * Never silently merges ownerships / snapshots / jobs.
   */
  private async assertBlizzardIdentitySafe(
    target: Character,
    profile: CanonicalCharacter,
  ): Promise<{ ok: true } | { ok: false; statusCode: number; body: CharacterResolveResponse }> {
    const incomingId = profile.blizzardCharacterId?.trim() || null;
    if (!incomingId) return { ok: true };

    if (
      target.blizzardCharacterId != null &&
      target.blizzardCharacterId.toString() !== incomingId
    ) {
      return {
        ok: false,
        statusCode: 409,
        body: {
          status: "FAILED",
          retryable: false,
          message: formatIdentityCollisionMessage({
            existingCharacterId: target.id,
            conflictingCharacterId: target.id,
            blizzardCharacterId: `${target.blizzardCharacterId.toString()} vs ${incomingId}`,
          }),
        },
      };
    }

    const other = await this.repositories.character.findByBlizzardCharacterId(incomingId);
    if (other && other.id !== target.id) {
      this.container.logger.warn(
        {
          event: "character_identity_collision",
          code: CHARACTER_IDENTITY_COLLISION,
          targetCharacterId: target.id,
          conflictingCharacterId: other.id,
          blizzardCharacterId: incomingId,
        },
        "refusing silent character merge on conflicting Blizzard identity",
      );
      return {
        ok: false,
        statusCode: 409,
        body: {
          status: "FAILED",
          retryable: false,
          message: formatIdentityCollisionMessage({
            existingCharacterId: target.id,
            conflictingCharacterId: other.id,
            blizzardCharacterId: incomingId,
          }),
        },
      };
    }
    return { ok: true };
  }

  /**
   * Shared refresh eligibility decision (CHARACTER_REFRESH_ELIGIBILITY_POLICY_V1).
   * Identical for resolve, manual refresh, profile auto-enqueue, admin, and bulk.
   */
  private async evaluateSharedRefreshEligibility(
    character: Character,
    authority: VerifiedSeasonAuthority | null,
  ): Promise<CharacterRefreshEligibilityResult> {
    const policy = buildCharacterRefreshEligibilityPolicy(this.container.env.MAX_CHARACTER_LEVEL);
    const signals = await loadCharacterRefreshEligibilitySignals(this.container.worker.prisma, {
      characterId: character.id,
      authority,
    });
    return evaluateCharacterRefreshEligibility(signals, policy);
  }

  private async enqueueRecalculate(
    character: Character,
    snapshot: { seasonId: string },
  ): Promise<EnqueueResult> {
    const { activeModel } = await this.resolveActiveRefreshContract(character, {
      allowProviderSync: false,
    });
    return this.container.producers.enqueueRecalculateScore({
      characterId: character.id,
      seasonId: snapshot.seasonId,
      scoreModelKey: activeModel.key,
      scoreModelVersion: activeModel.version,
    });
  }

  /**
   * Single policy evaluation for profile/search reads.
   * At most one enqueue/recalculate side effect per call.
   */
  private async evaluateAndApplyRefreshPolicy(params: {
    identity: CharacterIdentityInput;
    character: Character;
    snapshot: Parameters<typeof mapScoreSnapshot>[0] | null;
    correlationId?: string | null;
    /** When true, skip side effects (status-only reads). */
    readOnly?: boolean;
    /**
     * Operational grade from CharacterScore when available. Overrides published
     * snapshot grade for GRADE_U_ELIGIBILITY so a calculable partial composite
     * is not treated as permanently unranked.
     */
    operationalGrade?: string | null;
  }): Promise<{
    decision: ScoreRefreshDecision;
    activeJob: IngestionJob | null;
    latestJob: IngestionJob | null;
    enqueueResult: EnqueueResult | null;
  }> {
    const {
      identity,
      character,
      snapshot,
      correlationId,
      readOnly = false,
      operationalGrade,
    } = params;
    const [activeJobRaw, latestJobBefore] = await Promise.all([
      this.repositories.job.findActiveForCharacter(character.id),
      this.repositories.job.findLatestForCharacter(character.id),
    ]);

    let contractReasons: string[] = [];
    let storedContractHash: string | null = null;
    let currentContractHash: string | null = null;
    let authority: VerifiedSeasonAuthority | null = null;
    let seasonAuthorityUnavailable = false;

    try {
      if (snapshot) {
        const mapped = mapScoreSnapshot(snapshot);
        const resolved = await this.resolveActiveRefreshContract(character, {
          allowProviderSync: false,
          correlationId,
        });
        authority = resolved.authority;
        currentContractHash = resolved.hash;
        const stored =
          mapped.explanation && typeof mapped.explanation === "object"
            ? (mapped.explanation as { refreshContractHash?: unknown }).refreshContractHash
            : null;
        storedContractHash = typeof stored === "string" ? stored : null;
        contractReasons = scoreSnapshotContractStaleReasons({
          score: mapped,
          activeModel: resolved.activeModel,
          activeContract: resolved.contract,
        });
      } else {
        // Still need authority for matching active jobs / enqueue gating.
        const resolved = await this.resolveActiveRefreshContract(character, {
          allowProviderSync: false,
          correlationId,
        });
        authority = resolved.authority;
        currentContractHash = resolved.hash;
      }
    } catch (error) {
      if (error instanceof SeasonAuthorityUnavailableError) {
        seasonAuthorityUnavailable = true;
        this.container.logger.info(
          {
            event: "refresh_decision",
            characterId: character.id,
            reason: "season_authority_unavailable",
            triggerSource: readOnly ? "UNKNOWN" : "PROFILE_READ",
          },
          "season authority unavailable — skipping refresh enqueue",
        );
      } else {
        throw error;
      }
    }

    const activeJob =
      authority &&
      activeJobRaw &&
      currentContractHash &&
      jobMatchesRefreshContract(activeJobRaw, currentContractHash, authority.blizzardSeasonId)
        ? activeJobRaw
        : null;

    const publishedGrade = snapshot?.grade ?? null;
    const effectiveGrade = operationalGrade ?? publishedGrade;
    const decisionBase = decideScoreRefresh({
      hasPublishedScore: Boolean(snapshot) || operationalGrade != null,
      scoreCalculatedAt: snapshot?.calculatedAt ?? null,
      gradeIsU: effectiveGrade === "U",
      scoreTtlSeconds: this.freshnessTtlSeconds,
      failureBackoffSeconds: this.failureBackoffSeconds,
      activeJobStatus: activeJob ? (activeJob.status as "QUEUED" | "ACTIVE") : null,
      latestJobStatus: latestJobBefore?.status ?? null,
      latestJobFinishedAt: latestJobBefore?.completedAt ?? null,
      latestJobErrorCode: extractJobErrorCode(latestJobBefore?.error),
      contractReasons: seasonAuthorityUnavailable ? [] : contractReasons,
      providerNewerThanScore: false,
    });
    let decision: ScoreRefreshDecision = decisionBase;

    // Fail closed: never enqueue without verified season authority.
    if (seasonAuthorityUnavailable && (decision.action === "ENQUEUE" || decision.action === "RECALCULATE")) {
      decision = {
        ...decision,
        action: "NONE",
        reason: decision.reason,
        warningCodes: decision.warningCodes,
      };
    }

    let enqueueResult: EnqueueResult | null = null;
    if (!readOnly && !seasonAuthorityUnavailable) {
      if (decision.action === "ENQUEUE") {
        const eligibility = await this.evaluateSharedRefreshEligibility(character, authority);
        if (!eligibility.eligible) {
          this.container.logger.info(
            {
              event: "refresh_enqueue",
              characterId: character.id,
              triggerSource: "PROFILE_READ",
              reason: "refresh_eligibility_blocked",
              code: eligibility.code,
              enqueued: false,
              reused: false,
            },
            "refresh enqueue denied — character not refresh-eligible",
          );
          const warning =
            eligibility.code ??
            (characterLacksBootstrapEvidence(character)
              ? "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN"
              : "NOT_REFRESH_ELIGIBLE");
          decision = {
            ...decision,
            action: "NONE",
            reason: "NOT_REFRESH_ELIGIBLE",
            publicState: snapshot ? "STALE_USABLE" : "UNAVAILABLE",
            profileRefreshStatus: snapshot ? "STALE" : "FAILED",
            detailedRefreshStatus: "FAILED",
            warningCodes: [...new Set([...decision.warningCodes, warning])],
          };
        } else {
          try {
            enqueueResult = await this.enqueueRefresh(identity, character, {
              forceRefresh: false,
              correlationId,
              triggerSource: "PROFILE_READ",
              allowProviderSync: false,
            });
          } catch (error) {
            if (error instanceof SeasonAuthorityUnavailableError) {
              this.container.logger.info(
                {
                  event: "refresh_enqueue",
                  characterId: character.id,
                  triggerSource: "PROFILE_READ",
                  reason: "season_authority_unavailable",
                  enqueued: false,
                  reused: false,
                },
                "refresh enqueue denied — season authority unavailable",
              );
              decision = { ...decision, action: "NONE" };
            } else {
              throw error;
            }
          }
        }
      } else if (decision.action === "RECALCULATE" && snapshot) {
        try {
          enqueueResult = await this.enqueueRecalculate(character, snapshot);
        } catch (error) {
          if (error instanceof SeasonAuthorityUnavailableError) {
            decision = { ...decision, action: "NONE" };
          } else {
            throw error;
          }
        }
      }
    }

    const latestJob =
      enqueueResult != null
        ? ((await this.repositories.job.findById(enqueueResult.jobId)) ?? latestJobBefore)
        : latestJobBefore;

    const activeJobAfter =
      enqueueResult != null && decision.action !== "REUSE_ACTIVE_JOB"
        ? ((await this.repositories.job.findActiveForCharacter(character.id)) ?? activeJob)
        : activeJob;

    // Usable published score + in-flight work is REFRESHING (not coarse STALE).
    if (snapshot && (decision.action === "REUSE_ACTIVE_JOB" || activeJobAfter != null)) {
      decision = {
        ...decision,
        publicState: "REFRESHING",
        profileRefreshStatus: "REFRESHING",
        detailedRefreshStatus:
          activeJobAfter?.status === "ACTIVE" || decision.detailedRefreshStatus === "IN_PROGRESS"
            ? "IN_PROGRESS"
            : "QUEUED",
      };
    }

    // Never present QUEUED without an active durable job — incomplete / blocked shells
    // must surface as FAILED so CharacterPage does not disable controls forever.
    if (
      !snapshot &&
      activeJobAfter == null &&
      decision.profileRefreshStatus === "QUEUED" &&
      decision.action !== "ENQUEUE"
    ) {
      decision = {
        ...decision,
        publicState: "UNAVAILABLE",
        profileRefreshStatus: "FAILED",
        detailedRefreshStatus: "FAILED",
      };
    }

    this.container.logger.info(
      {
        event: "refresh_decision",
        characterId: character.id,
        triggerSource: readOnly ? "UNKNOWN" : "PROFILE_READ",
        action: decision.action,
        reason: decision.reason,
        contractReasons,
        storedContractHash,
        currentContractHash,
        authoritativeSeasonId: authority?.blizzardSeasonId ?? null,
        authoritativeSeasonSlug: authority?.slug ?? null,
        seasonAuthorityUnavailable,
        reused: enqueueResult?.reused ?? decision.action === "REUSE_ACTIVE_JOB",
        enqueued: enqueueResult?.enqueued ?? false,
        readOnly,
      },
      "refresh decision",
    );

    return {
      decision,
      activeJob: activeJobAfter,
      latestJob,
      enqueueResult,
    };
  }

  private applyDecisionWarnings(
    body: CharacterProfileResponse,
    decision: ScoreRefreshDecision,
  ): void {
    if (decision.warningCodes.length === 0) return;
    const contractCodes = decision.warningCodes.filter(
      (c) =>
        c !== "SCORE_STALE_VS_PROVIDERS" &&
        c !== "REFRESH_FAILED" &&
        c !== "STALE_CONTRACT" &&
        !isEligibilityFailureCode(c) &&
        c !== "NOT_REFRESH_ELIGIBLE" &&
        c !== CHARACTER_BOOTSTRAP_INCOMPLETE,
    );
    if (contractCodes.length > 0) {
      body.warnings = appendRefreshContractWarnings(
        body.warnings,
        contractCodes as Parameters<typeof appendRefreshContractWarnings>[1],
      );
    }
    for (const code of decision.warningCodes) {
      if (code === "SCORE_STALE_VS_PROVIDERS") {
        if (!body.warnings?.some((w) => w.code === "SCORE_STALE_VS_PROVIDERS")) {
          body.warnings = [
            ...(body.warnings ?? []),
            {
              code: "SCORE_STALE_VS_PROVIDERS",
              message:
                "Provider data is newer than the published score snapshot — diagnostic only; score TTL unchanged.",
              severity: "WARN",
            },
          ];
        }
      } else if (code === "REFRESH_FAILED") {
        if (!body.warnings?.some((w) => w.code === "REFRESH_FAILED")) {
          body.warnings = [
            ...(body.warnings ?? []),
            {
              code: "REFRESH_FAILED",
              message: "La dernière actualisation a échoué.",
              severity: "WARN",
            },
          ];
        }
      } else if (code === "STALE_CONTRACT") {
        if (!body.warnings?.some((w) => w.code === "STALE_CONTRACT")) {
          body.warnings = [
            ...(body.warnings ?? []),
            {
              code: "STALE_CONTRACT",
              message:
                "Published score contract is obsolete. Explicit refresh may enqueue under the current contract.",
              severity: "WARN",
            },
          ];
        }
      } else if (isEligibilityFailureCode(code) || code === "NOT_REFRESH_ELIGIBLE") {
        if (!body.warnings?.some((w) => w.code === code)) {
          body.warnings = [
            ...(body.warnings ?? []),
            {
              code,
              message:
                code === "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN"
                  ? "Profile data incomplete — refresh eligibility cannot be decided from local evidence alone."
                  : code === "CHARACTER_BELOW_MAX_LEVEL"
                    ? "Character is below the maximum level required for Trust Score refresh."
                    : code === "CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE"
                      ? "No current-season Mythic+ score evidence — character is not refresh-eligible."
                      : "Character is not eligible for Trust Score refresh.",
              severity: "WARN",
            },
          ];
        }
      }
    }
  }

  private applyBootstrapRepairSignal(
    body: CharacterProfileResponse,
    character: Character,
    latestJob: IngestionJob | null,
    missingSeasonMythicEvidence = false,
  ): void {
    const repairRequired = isBootstrapRepairRequired({
      character,
      latestJob,
      missingSeasonMythicEvidence,
    });
    body.bootstrapRepairRequired = repairRequired;
    if (!repairRequired) return;
    if (!body.warnings?.some((w) => w.code === CHARACTER_BOOTSTRAP_INCOMPLETE)) {
      body.warnings = [
        ...(body.warnings ?? []),
        {
          code: CHARACTER_BOOTSTRAP_INCOMPLETE,
          message: "Profile data incomplete. Retry Blizzard profile lookup to restore character metadata.",
          severity: "WARN",
        },
      ];
    }
  }

  private buildSources(
    character: Character,
    observationProviders: string[] = [],
    contributionTypesByProvider: Partial<Record<string, WclContributionType[]>> = {},
  ): CharacterSourceAttribution[] {
    const fetchedAt = (character.lastPublicRefreshAt ?? character.lastSeenAt)?.toISOString();
    if (!fetchedAt) return [];
    return ALL_PROVIDERS.filter((provider) => !this.worker.disabledProviders.has(provider)).map(
      (provider) => {
        const publicKey = toPublicProviderKey(provider);
        const contributed = observationProviders.some(
          (p) => toPublicProviderKey(p) === publicKey,
        );
        return {
          provider: publicKey,
          fetchedAt,
          url: provider === "raiderio" ? (character.raiderioProfileUrl ?? null) : null,
          contributedToScore: contributed,
          contributionTypes: contributionTypesByProvider[publicKey],
        };
      },
    );
  }

  private async buildEnrichedProfile(
    identity: CharacterIdentityInput,
    character: Character,
    snapshot: Awaited<ReturnType<typeof this.repositories.score.getPublishedSnapshot>>,
    latestRunId: string | null,
    highestRunId: string | null,
    sources: CharacterSourceAttribution[],
    refreshStatus: CharacterProfileResponse["refreshStatus"],
  ): Promise<CharacterProfileResponse> {
    const [characterDetail, latestRun, highestRun, latestCharSnapshot, runCount, wclProvenance, providerStates] =
      await Promise.all([
      this.container.worker.prisma.character.findUnique({
        where: { id: character.id },
        include: { gameClass: true, activeSpec: true, realm: true },
      }),
      latestRunId ? this.repositories.run.findById(latestRunId) : Promise.resolve(null),
      highestRunId ? this.repositories.run.findById(highestRunId) : Promise.resolve(null),
      this.container.worker.prisma.characterSnapshot.findFirst({
        where: { characterId: character.id },
        orderBy: { capturedAt: "desc" },
        include: { equipment: true, talents: true },
      }),
      this.repositories.run.countForCharacter(character.id, snapshot?.seasonId),
      resolveWclProvenance(this.container.worker.prisma, character.id),
      this.repositories.providerState.listForCharacter(character.id),
    ]);

    const observationProviders = readScoreObservationProviders(snapshot?.explanation);
    const freshness = readFreshness(snapshot?.explanation);
    const selectedRunCoverage = readSelectedRunCoverage(snapshot?.explanation);
    const performanceSummary = readPerformanceSummary(snapshot?.explanation);
    const survivalSummary = readSurvivalSummary(snapshot?.explanation);
    const scoringRunSelection = readScoringRunSelection(snapshot?.explanation);
    const coverageCounts = readCoverageCounts(snapshot?.explanation);
    const wclContributionTypes = deriveWclContributionTypes(
      readScoreObservations(snapshot?.explanation),
    );
    const explanationDataState = readWclDataStateFromSummary(snapshot?.explanation);
    const wclVisibility = wclProvenance.visibility;
    const wclDataState = wclProvenance.dataState ?? explanationDataState;

    const normalizedSources = sources.map((s) => {
      const publicKey = toPublicProviderKey(s.provider);
      const contributed =
        s.contributedToScore ??
        observationProviders.some((p) => toPublicProviderKey(p) === publicKey);
      return {
        ...s,
        provider: publicKey,
        contributedToScore: contributed,
        contributionTypes:
          publicKey === "WARCRAFT_LOGS"
            ? (s.contributionTypes ?? wclContributionTypes)
            : s.contributionTypes,
      };
    });

    const base = mapCharacterProfile({
      character,
      identity,
      snapshot,
      latestRunId,
      highestRunId,
      sources: normalizedSources,
      refreshStatus,
    });

    if (!characterDetail) return base;

    const runIds = [
      ...new Set(
        [
          latestRun?.id,
          highestRun?.id,
          ...(scoringRunSelection?.selectedRuns.map((r) => r.canonicalRunId) ?? []),
          ...(performanceSummary?.currentSeason.dungeons.flatMap((d) => [
            d.bestRun?.runId,
            d.latestRun?.runId,
          ]) ?? []),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    const runCoverageById: Record<string, number | null> = {
      ...coverageCounts.runCoverageById,
    };
    const runNamesById: Record<string, { dungeonName: string }> = {};
    const wclUrlByRunId: Record<string, string | null> = {};
    await Promise.all(
      runIds.map(async (runId) => {
        runCoverageById[runId] = await this.repositories.run.findLatestAnalysisCoverage(
          character.id,
          runId,
        );
        const runRow = await this.repositories.run.findById(runId);
        if (runRow) {
          runNamesById[runId] = {
            dungeonName: runRow.dungeon.name ?? runRow.dungeon.slug,
          };
          wclUrlByRunId[runId] = resolveWclUrlFromSources(runRow.sources);
        }
      }),
    );

    const enrichments = applyProfileWarnings(
      buildProfileEnrichments({
        character: characterDetail,
        latestSnapshot: latestCharSnapshot,
        latestRun,
        highestRun,
        runCount,
        seasonSlug: snapshot?.season.slug ?? null,
        seasonName: snapshot?.season.name ?? null,
        wclVisibility,
        wclDataState,
        providerStates: providerStates.map((state) =>
          state.provider === "warcraftlogs"
            ? {
                ...state,
                wclVisibility,
                wclDataState: state.wclDataState ?? wclDataState,
                contributionTypes: wclContributionTypes,
                contributedToScore: wclContributionTypes.length > 0,
              }
            : state,
        ),
        selectedRunCoverage,
        runCoverageById,
        performanceSummary,
        survivalSummary,
        scoringRunSelection,
        selectedRunCount: coverageCounts.selectedRunCount,
        detailedRunCount: coverageCounts.detailedRunCount,
        runNamesById,
        wclUrlByRunId,
        freshness,
        scoreObservationProviders: observationProviders,
        env: this.container.env,
      }),
      base.score,
    );

    // Additive V2 explainability — DB-only, never provider calls; null while shadow-only.
    let explainabilityV2 = null;
    try {
      explainabilityV2 = await new ExplainabilityV2Service(this.container).getPublicExplainability({
        characterId: character.id,
        seasonId: snapshot?.seasonId,
      });
    } catch (error) {
      this.container.logger.warn(
        { err: error, characterId: character.id },
        "explainability_v2_public_attach_failed",
      );
    }

    return { ...base, ...enrichments, explainabilityV2 };
  }

  /** SWR profile read. 200 fresh/stale (background refresh enqueued when stale), 202 queued, 404 confirmed absent. */
  async getProfile(
    identity: CharacterIdentityInput,
    opts: { correlationId?: string | null } = {},
  ): Promise<GetProfileResult> {
    if (this.container.negativeCache.has(identity)) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character is confirmed not found upstream");
    }

    const cacheKey = characterCacheKey(identity);
    const cached = this.container.responseCache.get<GetProfileResult>(cacheKey);
    if (cached) return cached;

    const character = await this.findOrCreateCharacter(identity);
    const snapshot = await this.repositories.score.getPublishedSnapshot(character.id);
    const activeModel =
      (await this.repositories.score.getActiveModel()) ?? {
        key: "unknown",
        version: 0,
      };
    const productScore = await resolveProductScoreDto({
      prisma: this.container.worker.prisma,
      characterId: character.id,
      publishedSnapshot: snapshot,
      modelKey: activeModel.key,
      modelVersion: activeModel.version,
    });

    const { decision, latestJob } = await this.evaluateAndApplyRefreshPolicy({
      identity,
      character,
      snapshot,
      correlationId: opts.correlationId,
      operationalGrade: productScore.score?.grade ?? null,
    });

    if (!snapshot && !productScore.score) {
      const body = await this.buildEnrichedProfile(
        identity,
        character,
        null,
        null,
        null,
        [],
        decision.profileRefreshStatus,
      );
      this.applyDecisionWarnings(body, decision);
      this.applyBootstrapRepairSignal(body, character, latestJob);
      // 202 only when an actual queue admission happened / is in flight.
      const statusCode = decision.profileRefreshStatus === "QUEUED" ? 202 : 200;
      return { statusCode, body };
    }

    const [latestRun, highestRun] = await Promise.all([
      this.repositories.run.findLatestForCharacter(character.id),
      this.repositories.run.findHighestForCharacter(character.id),
    ]);

    const body = await this.buildEnrichedProfile(
      identity,
      character,
      snapshot,
      latestRun?.id ?? null,
      highestRun?.id ?? null,
      this.buildSources(character, readScoreObservationProviders(snapshot?.explanation), {
        WARCRAFT_LOGS: deriveWclContributionTypes(readScoreObservations(snapshot?.explanation)),
      }),
      decision.profileRefreshStatus,
    );

    // Operational CharacterScore wins over published ScoreSnapshot for product UI.
    if (productScore.score) {
      body.score = productScore.score;
    }

    // Provider-newer-than-score is diagnostic only — never an enqueue trigger.
    if (isScoreStaleVersusProviders(body.score?.calculatedAt, body.providerStates)) {
      decision.warningCodes = [...new Set([...decision.warningCodes, "SCORE_STALE_VS_PROVIDERS"])];
    }
    this.applyDecisionWarnings(body, decision);
    this.applyBootstrapRepairSignal(body, character, latestJob);

    const result: GetProfileResult = { statusCode: 200, body };
    // Cache only strictly fresh reads — never cache STALE/QUEUED (would bypass policy on hit).
    if (decision.action === "NONE" && decision.profileRefreshStatus === "FRESH") {
      this.container.responseCache.set(cacheKey, result);
    }

    // Aggregated profile view — async, non-blocking, abuse-resistant. Zero provider calls.
    scheduleProfileViewRecording(
      this.container.worker.prisma,
      {
        characterId: character.id,
        viewerHash: null,
        source: "public",
      },
      (err) => {
        this.container.logger.warn({ err, characterId: character.id }, "profile_view_record_failed");
      },
    );

    return result;
  }

  /** Lightweight identity lookup for search/autocomplete flows; same SWR semantics as `getProfile`. */
  async searchCharacter(
    identity: CharacterIdentityInput,
    opts: { correlationId?: string | null } = {},
  ): Promise<SearchCharacterResponse> {
    if (this.container.negativeCache.has(identity)) {
      return { characterId: null, identity, refreshStatus: "NOT_FOUND", job: null, score: null };
    }

    const character = await this.findOrCreateCharacter(identity);
    const snapshot = await this.repositories.score.getPublishedSnapshot(character.id);
    const activeModel =
      (await this.repositories.score.getActiveModel()) ?? {
        key: "unknown",
        version: 0,
      };
    const productScore = await resolveProductScoreDto({
      prisma: this.container.worker.prisma,
      characterId: character.id,
      publishedSnapshot: snapshot,
      modelKey: activeModel.key,
      modelVersion: activeModel.version,
    });

    const { decision, enqueueResult, latestJob, activeJob } = await this.evaluateAndApplyRefreshPolicy({
      identity,
      character,
      snapshot,
      correlationId: opts.correlationId,
      operationalGrade: productScore.score?.grade ?? null,
    });

    const jobRow = enqueueResult
      ? await this.repositories.job.findById(enqueueResult.jobId)
      : decision.action === "REUSE_ACTIVE_JOB"
        ? (activeJob ?? latestJob)
        : null;

    return {
      characterId: character.id,
      identity,
      refreshStatus: decision.profileRefreshStatus,
      job: await mapJobStatusWithEta(this.container, jobRow),
      score: productScore.score,
    };
  }

  /**
   * Exact character+realm resolution for the dual-field search UI.
   * Verifies unknown characters against Blizzard before creating a stable profile resource.
   */
  async resolveCharacter(
    input: CharacterIdentityInput,
    opts: {
      correlationId?: string | null;
      forceRetry?: boolean;
      workloadClass?: "CALIBRATION" | "OPERATION";
      /**
       * When true, complete Blizzard bootstrap/identity only — never enqueue refresh-character.
       * Used by admin calibration cohort membership (no WCL acquisition on add).
       */
      skipRefreshEnqueue?: boolean;
    } = {},
  ): Promise<{ statusCode: number; body: CharacterResolveResponse }> {
    const identity: CharacterIdentityInput = {
      region: normalizeRegion(input.region),
      realmSlug: normalizeRealmSlug(input.realmSlug),
      name: input.name.trim(),
    };
    if (!identity.name) {
      return {
        statusCode: 400,
        body: { status: "FAILED", retryable: false, message: "Character name is required." },
      };
    }

    return withResolveIdentityLock(identity, () => this.resolveCharacterLocked(identity, opts));
  }

  private profileOnlyResolve(
    characterId: string,
    profilePath: string,
    reason: "BOOTSTRAP_INCOMPLETE" | "NOT_REFRESH_ELIGIBLE",
    character: Pick<
      Character,
      "level" | "blizzardCharacterId" | "classId" | "activeSpecId" | "role"
    >,
  ): { statusCode: number; body: CharacterResolveResponse } {
    const incomplete = characterLacksBootstrapEvidence(character);
    return {
      statusCode: 200,
      body: {
        status: "PROFILE_ONLY",
        characterId,
        profilePath,
        reason: incomplete ? "BOOTSTRAP_INCOMPLETE" : reason,
        bootstrapRepairRequired: incomplete,
      },
    };
  }

  private async compensateFailedNewShell(
    characterId: string,
    createdFresh: boolean,
  ): Promise<void> {
    if (!createdFresh) return;
    try {
      const deleted = await this.repositories.character.deleteUnreferencedBootstrapShell(characterId);
      if (deleted) {
        this.container.logger.info(
          { event: "character_bootstrap_compensate_delete", characterId },
          "deleted unreferenced shell after bootstrap failure",
        );
      }
    } catch (error) {
      this.container.logger.warn(
        { err: error, event: "character_bootstrap_compensate_delete_failed", characterId },
        "failed to compensate-delete incomplete resolve shell",
      );
    }
  }

  private async resolveCharacterLocked(
    identity: CharacterIdentityInput,
    opts: {
      correlationId?: string | null;
      forceRetry?: boolean;
      workloadClass?: "CALIBRATION" | "OPERATION";
      skipRefreshEnqueue?: boolean;
    },
  ): Promise<{ statusCode: number; body: CharacterResolveResponse }> {
    const realm = await this.repositories.realm.findBySlug(identity.region, identity.realmSlug);
    if (!realm) {
      return {
        statusCode: 400,
        body: {
          status: "FAILED",
          retryable: false,
          message: "Unknown or inactive realm for this region. Pick a realm from the catalog.",
        },
      };
    }

    // Prefer catalog slug (already normalized) and preserve user capitalization for display/path.
    identity.realmSlug = realm.slug;
    const profilePath = buildProfilePath(identity);

    if (this.container.negativeCache.has(identity) && !opts.forceRetry) {
      return {
        statusCode: 404,
        body: {
          status: "NOT_FOUND",
          message: `Character not found on ${realm.name} — ${identity.region}.`,
        },
      };
    }

    if (opts.forceRetry) {
      this.container.negativeCache.clear(identity);
    }

    const existing = await this.repositories.character.findByIdentity(identity);
    if (existing) {
      const snapshot = await this.repositories.score.getPublishedSnapshot(existing.id);
      const activeJob = await this.repositories.job.findActiveForCharacter(existing.id);
      const latestJob = await this.repositories.job.findLatestForCharacter(existing.id);
      const providerStates = await this.repositories.providerState.listForCharacter(existing.id);
      const blizzardNotFound = providerStates.some(
        (s) => s.provider === "blizzard" && s.state === "NOT_FOUND",
      );

      if (blizzardNotFound && !opts.forceRetry) {
        return {
          statusCode: 404,
          body: {
            status: "NOT_FOUND",
            message: `Character not found on ${realm.name} — ${identity.region}.`,
          },
        };
      }

      // Always reuse in-flight refresh — forceRetry must not stack concurrent score jobs.
      if (activeJob) {
        if (opts.skipRefreshEnqueue) {
          return {
            statusCode: 200,
            body: { status: "READY", characterId: existing.id, profilePath },
          };
        }
        return {
          statusCode: 202,
          body: {
            status: activeJob.status === "ACTIVE" ? "PROCESSING" : "QUEUED",
            characterId: existing.id,
            refreshId: activeJob.id,
            profilePath,
            retryAfterMs: DEFAULT_RETRY_AFTER_MS,
          },
        };
      }

      try {
        let character = existing;
        const { authority } = await this.resolveActiveRefreshContract(character, {
          allowProviderSync: true,
          correlationId: opts.correlationId,
        });

        const signalsBefore = await loadCharacterRefreshEligibilitySignals(
          this.container.worker.prisma,
          { characterId: character.id, authority },
        );
        const missingSeasonMythicEvidence = signalsBefore.currentSeasonMythicScore === undefined;
        const needsRepair = shouldRepairCharacterBootstrap({
          character,
          latestJob,
          forceRetry: Boolean(opts.forceRetry),
          missingSeasonMythicEvidence,
        });

        // Fast path: published + idle + season evidence known → zero provider repair calls.
        if (snapshot && !opts.forceRetry && !needsRepair && latestJob?.status !== "FAILED") {
          this.container.logger.info(
            {
              event: CURRENT_SEASON_EVIDENCE_REUSED,
              characterId: character.id,
              evidenceSource: signalsBefore.evidenceSource,
            },
            "reused persisted current-season Mythic+ eligibility evidence",
          );
          return {
            statusCode: 200,
            body: { status: "READY", characterId: existing.id, profilePath },
          };
        }

        if (needsRepair || latestJob?.status === "FAILED" || opts.forceRetry || !snapshot) {
          if (needsRepair) {
            const fetched = await this.fetchBlizzardBootstrap(
              identity,
              { correlationId: opts.correlationId },
              `Character not found on ${realm.name} — ${identity.region}.`,
            );
            if (!fetched.ok) return fetched;

            const identitySafe = await this.assertBlizzardIdentitySafe(character, fetched.profile);
            if (!identitySafe.ok) return identitySafe;

            if (character.realmId !== realm.id) {
              try {
                character = await this.repositories.character.reassignToCatalogIdentity(
                  character.id,
                  identity,
                  { displayName: fetched.profile.displayName },
                );
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : "Character identity reconciliation failed.";
                return {
                  statusCode: 409,
                  body: { status: "FAILED", retryable: false, message },
                };
              }
            }

            character = await this.persistBootstrapFromBlizzardProfile(
              character,
              identity,
              authority,
              fetched.profile,
              fetched.currentSeasonMythic,
            );

            if (fetched.currentSeasonMythic.state === "UNKNOWN") {
              this.container.logger.info(
                {
                  event: CURRENT_SEASON_EVIDENCE_PROVIDER_FAILURE,
                  characterId: character.id,
                  providerCalls: fetched.providerCalls,
                  forceRetry: Boolean(opts.forceRetry),
                },
                "current-season Mythic+ lookup failed — not treating as confirmed no-score",
              );
              return { statusCode: 503, body: this.providerUnavailableBody() };
            }

            const outcome =
              fetched.currentSeasonMythic.state === "CONFIRMED_NO_SCORE"
                ? CURRENT_SEASON_CONFIRMED_NO_SCORE
                : CURRENT_SEASON_EVIDENCE_REPAIRED;
            this.container.logger.info(
              {
                event: outcome,
                characterId: character.id,
                blizzardCharacterId: fetched.profile.blizzardCharacterId,
                level: fetched.profile.level ?? null,
                currentSeasonMythicState: fetched.currentSeasonMythic.state,
                forceRetry: Boolean(opts.forceRetry),
                providerCalls: fetched.providerCalls,
              },
              "repaired character bootstrap / current-season Mythic+ evidence via exact resolve",
            );
          } else if (signalsBefore.currentSeasonMythicScore !== undefined) {
            this.container.logger.info(
              {
                event: CURRENT_SEASON_EVIDENCE_REUSED,
                characterId: character.id,
                evidenceSource: signalsBefore.evidenceSource,
              },
              "reused persisted current-season Mythic+ eligibility evidence",
            );
          }

          if (characterLacksBootstrapEvidence(character)) {
            return this.profileOnlyResolve(
              character.id,
              profilePath,
              "BOOTSTRAP_INCOMPLETE",
              character,
            );
          }

          const eligibility = await this.evaluateSharedRefreshEligibility(character, authority);
          if (!eligibility.eligible) {
            return {
              statusCode: 200,
              body: { status: "READY", characterId: character.id, profilePath },
            };
          }

          const activeAfter = await this.repositories.job.findActiveForCharacter(character.id);
          if (activeAfter) {
            if (opts.skipRefreshEnqueue) {
              return {
                statusCode: 200,
                body: { status: "READY", characterId: character.id, profilePath },
              };
            }
            return {
              statusCode: 202,
              body: {
                status: activeAfter.status === "ACTIVE" ? "PROCESSING" : "QUEUED",
                characterId: character.id,
                refreshId: activeAfter.id,
                profilePath,
                retryAfterMs: DEFAULT_RETRY_AFTER_MS,
              },
            };
          }

          if (opts.skipRefreshEnqueue) {
            return {
              statusCode: 200,
              body: { status: "READY", characterId: character.id, profilePath },
            };
          }

          const enqueueResult = await this.enqueueRefresh(identity, character, {
            forceRefresh: true,
            correlationId: opts.correlationId,
            triggerSource: "SYSTEM",
            allowProviderSync: true,
            workloadClass: opts.workloadClass ?? "OPERATION",
          });
          return {
            statusCode: 202,
            body: {
              status: "QUEUED",
              characterId: character.id,
              refreshId: enqueueResult.jobId,
              profilePath,
              retryAfterMs: DEFAULT_RETRY_AFTER_MS,
            },
          };
        }

        return {
          statusCode: 200,
          body: { status: "READY", characterId: existing.id, profilePath },
        };
      } catch (error) {
        if (error instanceof SeasonAuthorityUnavailableError) {
          return {
            statusCode: 503,
            body: {
              status: "PROVIDER_UNAVAILABLE",
              retryable: true,
              message: "Season authority is temporarily unavailable. Please retry shortly.",
            },
          };
        }
        throw error;
      }
    }

    // New character: verify against Blizzard before creating a stable DB row.
    // Resolve may fetch identity/level/current-season rating and persist evidence
    // before enqueue — the worker gate remains provider-free.
    const fetched = await this.fetchBlizzardBootstrap(
      identity,
      { correlationId: opts.correlationId },
      `Character not found on ${realm.name} — ${identity.region}.`,
    );
    if (!fetched.ok) return fetched;

    // Prefer immutable Blizzard ID when an earlier malformed row exists under another realm.
    let character: Character | null = null;
    let createdFresh = false;
    if (fetched.profile.blizzardCharacterId) {
      const byBlizzard = await this.repositories.character.findByBlizzardCharacterId(
        fetched.profile.blizzardCharacterId,
      );
      if (byBlizzard) {
        if (
          byBlizzard.blizzardCharacterId != null &&
          fetched.profile.blizzardCharacterId &&
          byBlizzard.blizzardCharacterId.toString() !== fetched.profile.blizzardCharacterId
        ) {
          return {
            statusCode: 409,
            body: {
              status: "FAILED",
              retryable: false,
              message: formatIdentityCollisionMessage({
                existingCharacterId: byBlizzard.id,
                conflictingCharacterId: byBlizzard.id,
                blizzardCharacterId: fetched.profile.blizzardCharacterId,
              }),
            },
          };
        }
        try {
          character = await this.repositories.character.reassignToCatalogIdentity(
            byBlizzard.id,
            identity,
            { displayName: fetched.profile.displayName },
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Character identity reconciliation failed.";
          return {
            statusCode: 409,
            body: { status: "FAILED", retryable: false, message },
          };
        }
      }
    }

    if (!character) {
      // Persist required bootstrap fields on the first write so a later
      // applyProviderProfile/eligibility failure cannot leave a level-null shell.
      character = await this.repositories.character.upsertCharacter(identity, {
        displayName: fetched.profile.displayName || identity.name,
        classSlug: fetched.profile.classSlug,
        specSlug: fetched.profile.specSlug,
        role: fetched.profile.role,
        level: fetched.profile.level ?? null,
        faction: fetched.profile.faction ?? null,
        blizzardCharacterId: fetched.profile.blizzardCharacterId,
      });
      createdFresh = true;
    }

    const identitySafe = await this.assertBlizzardIdentitySafe(character, fetched.profile);
    if (!identitySafe.ok) {
      await this.compensateFailedNewShell(character.id, createdFresh);
      return identitySafe;
    }

    try {
      const { authority } = await this.resolveActiveRefreshContract(character, {
        allowProviderSync: true,
        correlationId: opts.correlationId,
      });
      character = await this.persistBootstrapFromBlizzardProfile(
        character,
        identity,
        authority,
        fetched.profile,
        fetched.currentSeasonMythic,
      );

      if (fetched.currentSeasonMythic.state === "UNKNOWN") {
        this.container.logger.info(
          {
            event: CURRENT_SEASON_EVIDENCE_PROVIDER_FAILURE,
            characterId: character.id,
            providerCalls: fetched.providerCalls,
          },
          "current-season Mythic+ lookup failed on new-character resolve",
        );
        // Keep shell (profile persisted) but do not claim confirmed no-score.
        return { statusCode: 503, body: this.providerUnavailableBody() };
      }

      if (fetched.currentSeasonMythic.state === "CONFIRMED_NO_SCORE") {
        this.container.logger.info(
          {
            event: CURRENT_SEASON_CONFIRMED_NO_SCORE,
            characterId: character.id,
            providerCalls: fetched.providerCalls,
          },
          "authoritative current-season Mythic+ absence on new-character resolve",
        );
      } else {
        this.container.logger.info(
          {
            event: CURRENT_SEASON_EVIDENCE_REPAIRED,
            characterId: character.id,
            providerCalls: fetched.providerCalls,
          },
          "persisted current-season Mythic+ evidence on new-character resolve",
        );
      }

      if (characterLacksBootstrapEvidence(character)) {
        // Keep the shell (Blizzard confirmed identity) but never advertise READY/QUEUED.
        return this.profileOnlyResolve(
          character.id,
          profilePath,
          "BOOTSTRAP_INCOMPLETE",
          character,
        );
      }

      const eligibility = await this.evaluateSharedRefreshEligibility(character, authority);
      if (!eligibility.eligible) {
        // Profile-only: complete bootstrap, shell persisted, no refresh-character, no WCL budget.
        return {
          statusCode: 200,
          body: { status: "READY", characterId: character.id, profilePath },
        };
      }

      const activeAfter = await this.repositories.job.findActiveForCharacter(character.id);
      if (activeAfter) {
        if (opts.skipRefreshEnqueue) {
          return {
            statusCode: 200,
            body: { status: "READY", characterId: character.id, profilePath },
          };
        }
        return {
          statusCode: 202,
          body: {
            status: activeAfter.status === "ACTIVE" ? "PROCESSING" : "QUEUED",
            characterId: character.id,
            refreshId: activeAfter.id,
            profilePath,
            retryAfterMs: DEFAULT_RETRY_AFTER_MS,
          },
        };
      }

      if (opts.skipRefreshEnqueue) {
        return {
          statusCode: 200,
          body: { status: "READY", characterId: character.id, profilePath },
        };
      }

      const enqueueResult = await this.enqueueRefresh(identity, character, {
        forceRefresh: false,
        correlationId: opts.correlationId,
        triggerSource: "SYSTEM",
        allowProviderSync: true,
        workloadClass: opts.workloadClass ?? "OPERATION",
      });
      return {
        statusCode: 202,
        body: {
          status: "QUEUED",
          characterId: character.id,
          refreshId: enqueueResult.jobId,
          profilePath,
          retryAfterMs: DEFAULT_RETRY_AFTER_MS,
        },
      };
    } catch (error) {
      if (error instanceof SeasonAuthorityUnavailableError) {
        await this.compensateFailedNewShell(character.id, createdFresh);
        return {
          statusCode: 503,
          body: {
            status: "PROVIDER_UNAVAILABLE",
            retryable: true,
            message: "Season authority is temporarily unavailable. Please retry shortly.",
          },
        };
      }
      await this.compensateFailedNewShell(character.id, createdFresh);
      throw error;
    }
  }

  /** GET refresh-status: pure read, never enqueues, 404 for identities never resolved or negatively cached. */
  async getRefreshStatus(identity: CharacterIdentityInput): Promise<RefreshStatusResponse> {
    const character = await this.requireCharacter(identity);
    const snapshot = await this.repositories.score.getPublishedSnapshot(character.id);
    const { decision, latestJob } = await this.evaluateAndApplyRefreshPolicy({
      identity,
      character,
      snapshot,
      readOnly: true,
    });

    let missingSeasonMythicEvidence = false;
    try {
      const { authority } = await this.resolveActiveRefreshContract(character, {
        allowProviderSync: false,
      });
      const signals = await loadCharacterRefreshEligibilitySignals(
        this.container.worker.prisma,
        { characterId: character.id, authority },
      );
      missingSeasonMythicEvidence = signals.currentSeasonMythicScore === undefined;
    } catch {
      /* season authority unavailable — leave missing=false for status read */
    }

    return {
      characterId: character.id,
      refreshStatus: decision.detailedRefreshStatus,
      job: await mapJobStatusWithEta(this.container, latestJob),
      cooldownSecondsRemaining: cooldownSecondsRemaining(
        character.lastPublicRefreshAt,
        this.container.env.MANUAL_REFRESH_COOLDOWN_SECONDS,
      ),
      bootstrapRepairRequired: isBootstrapRepairRequired({
        character,
        latestJob,
        missingSeasonMythicEvidence,
      }),
    };
  }

  /**
   * POST refresh: dedupes onto any active job, otherwise enforces the manual cooldown
   * (bypassed by admin cooldown_bypass), then enqueues.
   * True provider forceRefresh requires profile.refresh.force (Agent 04 IAM contract).
   */
  async requestRefresh(
    identity: CharacterIdentityInput,
    opts: {
      bypassCooldown: boolean;
      /** Already authorized at the route boundary; do not re-check IAM here. */
      forceRefresh: boolean;
      correlationId?: string | null;
    },
  ): Promise<RefreshStatusResponse> {
    if (this.container.negativeCache.has(identity) && !opts.bypassCooldown && !opts.forceRefresh) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character is confirmed not found upstream");
    }
    if (opts.forceRefresh || opts.bypassCooldown) {
      this.container.negativeCache.clear(identity);
    }

    const character = await this.findOrCreateCharacter(identity);

    let resolvedContract: Awaited<ReturnType<CharacterService["resolveActiveRefreshContract"]>>;
    try {
      resolvedContract = await this.resolveActiveRefreshContract(character, {
        allowProviderSync: true,
        correlationId: opts.correlationId,
      });
    } catch (error) {
      if (error instanceof SeasonAuthorityUnavailableError) {
        throw HttpError.serviceUnavailable(
          "SEASON_AUTHORITY_UNAVAILABLE",
          "Season authority is temporarily unavailable. Please retry shortly.",
          { retryAfterSeconds: error.retryAfterSeconds },
        );
      }
      throw error;
    }

    // Active-job reuse only when the in-flight job matches the verified contract.
    const activeJob = await this.repositories.job.findActiveForCharacter(character.id);
    if (
      activeJob &&
      jobMatchesRefreshContract(
        activeJob,
        resolvedContract.hash,
        resolvedContract.authority.blizzardSeasonId,
      )
    ) {
      return {
        characterId: character.id,
        refreshStatus: activeJob.status === "ACTIVE" ? "IN_PROGRESS" : "QUEUED",
        job: await mapJobStatusWithEta(this.container, activeJob),
        cooldownSecondsRemaining: 0,
        bootstrapRepairRequired: false,
      };
    }

    const remaining = cooldownSecondsRemaining(
      character.lastPublicRefreshAt,
      this.container.env.MANUAL_REFRESH_COOLDOWN_SECONDS,
    );
    if (remaining > 0 && !opts.bypassCooldown && !opts.forceRefresh) {
      const lastJob = await this.repositories.job.findLatestForCharacter(character.id);
      const snapshot = await this.repositories.score.getPublishedSnapshot(character.id);
      const signals = await loadCharacterRefreshEligibilitySignals(
        this.container.worker.prisma,
        { characterId: character.id, authority: resolvedContract.authority },
      );
      const repairRequired = isBootstrapRepairRequired({
        character,
        latestJob: lastJob,
        missingSeasonMythicEvidence: signals.currentSeasonMythicScore === undefined,
      });
      const refreshStatus = snapshot
        ? "STALE"
        : lastJob?.status === "FAILED" || repairRequired
          ? "FAILED"
          : "QUEUED";
      return {
        characterId: character.id,
        refreshStatus,
        job: await mapJobStatusWithEta(this.container, lastJob),
        cooldownSecondsRemaining: remaining,
        bootstrapRepairRequired: repairRequired,
      };
    }

    const eligibility = await this.evaluateSharedRefreshEligibility(
      character,
      resolvedContract.authority,
    );
    if (!eligibility.eligible) {
      const signals = await loadCharacterRefreshEligibilitySignals(
        this.container.worker.prisma,
        { characterId: character.id, authority: resolvedContract.authority },
      );
      const repairRequired = eligibilityConflictNeedsBootstrapRepair({
        character,
        eligibilityCode: eligibility.code,
        missingSeasonMythicEvidence: signals.currentSeasonMythicScore === undefined,
      });
      throw HttpError.conflict(
        eligibility.code ?? "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
        eligibility.message ?? "Character is not eligible for refresh",
        {
          maxCharacterLevel: eligibility.maxCharacterLevel,
          policyVersion: eligibility.policyVersion,
          bootstrapRepairRequired: repairRequired,
          repairAction: repairRequired ? "resolve" : undefined,
        },
      );
    }

    let enqueueResult: EnqueueResult;
    try {
      enqueueResult = await this.enqueueRefresh(identity, character, {
        forceRefresh: opts.forceRefresh,
        correlationId: opts.correlationId,
        triggerSource: opts.forceRefresh ? "MANUAL_FORCE_REFRESH" : "MANUAL_REFRESH",
        allowProviderSync: true,
      });
    } catch (error) {
      if (error instanceof SeasonAuthorityUnavailableError) {
        throw HttpError.serviceUnavailable(
          "SEASON_AUTHORITY_UNAVAILABLE",
          "Season authority is temporarily unavailable. Please retry shortly.",
          { retryAfterSeconds: error.retryAfterSeconds },
        );
      }
      throw error;
    }
    const job = await this.repositories.job.findById(enqueueResult.jobId);
    return {
      characterId: character.id,
      refreshStatus: job?.status === "COMPLETED" ? "FRESH" : "QUEUED",
      job: await mapJobStatusWithEta(this.container, job),
      cooldownSecondsRemaining: 0,
      bootstrapRepairRequired: false,
    };
  }

  async getHistory(identity: CharacterIdentityInput, limit = 20): Promise<CharacterHistoryResponse> {
    const character = await this.requireCharacter(identity);
    const snapshots = await this.repositories.score.listHistory(character.id, limit);
    return { characterId: character.id, snapshots: snapshots.map(mapScoreSnapshot) };
  }

  async getRun(identity: CharacterIdentityInput, kind: "latest" | "highest"): Promise<RunSummaryDTO | null> {
    const character = await this.requireCharacter(identity);
    const run =
      kind === "highest"
        ? await this.repositories.run.findHighestForCharacter(character.id)
        : await this.repositories.run.findLatestForCharacter(character.id);
    return run ? mapRunSummary(run) : null;
  }

  async getLatestScore(identity: CharacterIdentityInput): Promise<ScoreSnapshotDTO> {
    const character = await this.requireCharacter(identity);
    const snapshot = await this.repositories.score.getPublishedSnapshot(character.id);
    const activeModel =
      (await this.repositories.score.getActiveModel()) ?? {
        key: "unknown",
        version: 0,
      };
    const productScore = await resolveProductScoreDto({
      prisma: this.container.worker.prisma,
      characterId: character.id,
      publishedSnapshot: snapshot,
      modelKey: activeModel.key,
      modelVersion: activeModel.version,
    });
    if (!productScore.score) {
      throw HttpError.notFound("SCORE_NOT_FOUND", "No score has been calculated for this character yet");
    }
    return productScore.score;
  }
}
