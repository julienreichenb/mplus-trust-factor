import type { Character, IngestionJob } from "@mplus/database";
import type {
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
import { ExternalApiError, deriveWclContributionTypes, normalizeWclProvenance } from "@mplus/contracts";
import { normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import {
  decideScoreRefresh,
  extractJobErrorCode,
  type ScoreRefreshDecision,
} from "@mplus/config";
import type { EnqueueResult } from "@mplus/worker";
import { randomUUID } from "node:crypto";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { cooldownSecondsRemaining } from "../lib/freshness.js";
import {
  mapCharacterProfile,
  mapJobStatus,
  mapRunSummary,
  mapScoreSnapshot,
  type CharacterSourceAttribution,
  type RunSummaryDTO,
} from "../lib/mappers.js";
import { applyProfileWarnings, appendRefreshContractWarnings, buildProfileEnrichments, isScoreStaleVersusProviders, resolveWclUrlFromSources, scoreSnapshotContractStaleReasons, toPublicProviderKey } from "../lib/profile-enrichment.js";
import { characterCacheKey } from "../lib/response-cache.js";
import { scheduleProfileViewRecording } from "../lib/profile-view-recorder.js";
import {
  resolveActiveRefreshContract,
  SeasonAuthorityUnavailableError,
  requireVerifiedSeasonAuthority,
  persistRefreshEligibilityEvidence,
  type VerifiedSeasonAuthority,
} from "@mplus/worker";

const ALL_PROVIDERS: ProviderName[] = ["blizzard", "raiderio", "warcraftlogs"];
const DEFAULT_RETRY_AFTER_MS = 2_000;
const PROFILE_PATH_PREFIX = "/character";

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
      (await this.repositories.score.getActiveModel(this.container.env.ACTIVE_SCORE_MODEL_KEY)) ?? {
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
    });
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
        reused: result.reused,
        enqueued: result.enqueued ?? false,
        jobId: result.jobId,
      },
      "refresh enqueue",
    );
    return result;
  }

  /**
   * Persist cheap season-scoped eligibility evidence from an already-fetched
   * Blizzard resolve/discovery response. Provider-free at the worker gate.
   *
   * Allowed only on resolve/discovery paths — never call Blizzard from admin
   * rerun, bulk FULL_REFRESH, profile auto-enqueue, or scheduled refresh merely
   * to decide eligibility. Insufficient persisted evidence → UNKNOWN → fail closed.
   */
  private async persistEligibilityEvidenceFromResolvedProfile(
    character: Character,
    identity: CharacterIdentityInput,
    authority: VerifiedSeasonAuthority,
    opts: {
      correlationId?: string | null;
      level: number | null;
      mythicRating: number | null;
    },
  ): Promise<void> {
    await persistRefreshEligibilityEvidence(this.container.worker.prisma, {
      characterId: character.id,
      level: opts.level,
      mythicRating: opts.mythicRating,
      authoritativeSeasonRowId: authority.seasonRowId,
    });
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
  }): Promise<{
    decision: ScoreRefreshDecision;
    activeJob: IngestionJob | null;
    latestJob: IngestionJob | null;
    enqueueResult: EnqueueResult | null;
  }> {
    const { identity, character, snapshot, correlationId, readOnly = false } = params;
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

    const decisionBase = decideScoreRefresh({
      hasPublishedScore: Boolean(snapshot),
      scoreCalculatedAt: snapshot?.calculatedAt ?? null,
      gradeIsU: snapshot?.grade === "U",
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
      (c) => c !== "SCORE_STALE_VS_PROVIDERS" && c !== "REFRESH_FAILED" && c !== "STALE_CONTRACT",
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
      }
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

    return { ...base, ...enrichments };
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

    const { decision } = await this.evaluateAndApplyRefreshPolicy({
      identity,
      character,
      snapshot,
      correlationId: opts.correlationId,
    });

    if (!snapshot) {
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
      return { statusCode: 202, body };
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
      this.buildSources(character, readScoreObservationProviders(snapshot.explanation), {
        WARCRAFT_LOGS: deriveWclContributionTypes(readScoreObservations(snapshot.explanation)),
      }),
      decision.profileRefreshStatus,
    );

    // Provider-newer-than-score is diagnostic only — never an enqueue trigger.
    if (isScoreStaleVersusProviders(body.score?.calculatedAt, body.providerStates)) {
      decision.warningCodes = [...new Set([...decision.warningCodes, "SCORE_STALE_VS_PROVIDERS"])];
    }
    this.applyDecisionWarnings(body, decision);

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

    const { decision, enqueueResult, latestJob, activeJob } = await this.evaluateAndApplyRefreshPolicy({
      identity,
      character,
      snapshot,
      correlationId: opts.correlationId,
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
      job: jobRow ? mapJobStatus(jobRow) : null,
      score: snapshot ? mapScoreSnapshot(snapshot) : null,
    };
  }

  /**
   * Exact character+realm resolution for the dual-field search UI.
   * Verifies unknown characters against Blizzard before creating a stable profile resource.
   */
  async resolveCharacter(
    input: CharacterIdentityInput,
    opts: { correlationId?: string | null; forceRetry?: boolean } = {},
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

    const existing = await this.repositories.character.findByIdentity(identity);
    if (existing) {
      const snapshot = await this.repositories.score.getPublishedSnapshot(existing.id);
      const activeJob = await this.repositories.job.findActiveForCharacter(existing.id);
      const latestJob = activeJob ?? (await this.repositories.job.findLatestForCharacter(existing.id));
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

      if (snapshot && !activeJob) {
        return {
          statusCode: 200,
          body: { status: "READY", characterId: existing.id, profilePath },
        };
      }

      if (activeJob) {
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

      if (latestJob?.status === "FAILED" || opts.forceRetry || !snapshot) {
        try {
          const enqueueResult = await this.enqueueRefresh(identity, existing, {
            forceRefresh: Boolean(opts.forceRetry),
            correlationId: opts.correlationId,
            triggerSource: "SYSTEM",
            allowProviderSync: true,
          });
          return {
            statusCode: 202,
            body: {
              status: "QUEUED",
              characterId: existing.id,
              refreshId: enqueueResult.jobId,
              profilePath,
              retryAfterMs: DEFAULT_RETRY_AFTER_MS,
            },
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

      return {
        statusCode: 200,
        body: { status: "READY", characterId: existing.id, profilePath },
      };
    }

    // New character: verify against Blizzard before creating a stable DB row.
    // Resolve may fetch identity/level/current-season rating and persist evidence
    // before enqueue — the worker gate remains provider-free.
    let resolvedLevel: number | null = null;
    let resolvedMythicRating: number | null = null;
    try {
      const ctx = {
        region: identity.region,
        requestId: opts.correlationId ?? randomUUID(),
        correlationId: opts.correlationId ?? null,
        forceRefresh: true,
        now: new Date().toISOString(),
      };
      const profile = await this.container.worker.providers.blizzard.getCharacterProfile(
        identity,
        ctx,
      );
      resolvedLevel = profile.data.level ?? null;
      try {
        const keystone = await this.container.worker.providers.blizzard.getMythicKeystoneProfile(
          identity,
          ctx,
        );
        resolvedMythicRating = keystone.data.currentMythicRating ?? null;
      } catch {
        resolvedMythicRating = null;
      }
    } catch (error) {
      if (error instanceof ExternalApiError && error.code === "NOT_FOUND") {
        this.container.negativeCache.set(identity);
        return {
          statusCode: 404,
          body: {
            status: "NOT_FOUND",
            message: `Character not found on ${realm.name} — ${identity.region}.`,
          },
        };
      }
      if (error instanceof ExternalApiError && error.retryable) {
        return {
          statusCode: 503,
          body: {
            status: "PROVIDER_UNAVAILABLE",
            retryable: true,
            message: "Blizzard is temporarily unavailable. Please retry shortly.",
          },
        };
      }
      if (error instanceof ExternalApiError && !error.retryable) {
        return {
          statusCode: 502,
          body: {
            status: "FAILED",
            retryable: false,
            message: error.message || "Character verification failed.",
          },
        };
      }
      return {
        statusCode: 503,
        body: {
          status: "PROVIDER_UNAVAILABLE",
          retryable: true,
          message: "Unable to verify character with Blizzard right now.",
        },
      };
    }

    const character = await this.repositories.character.upsertCharacter(identity, {
      displayName: identity.name,
    });
    try {
      const { authority } = await this.resolveActiveRefreshContract(character, {
        allowProviderSync: true,
        correlationId: opts.correlationId,
      });
      await this.persistEligibilityEvidenceFromResolvedProfile(character, identity, authority, {
        correlationId: opts.correlationId,
        level: resolvedLevel,
        mythicRating: resolvedMythicRating,
      });
      const enqueueResult = await this.enqueueRefresh(identity, character, {
        forceRefresh: false,
        correlationId: opts.correlationId,
        triggerSource: "SYSTEM",
        allowProviderSync: true,
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

    return {
      characterId: character.id,
      refreshStatus: decision.detailedRefreshStatus,
      job: latestJob ? mapJobStatus(latestJob) : null,
      cooldownSecondsRemaining: cooldownSecondsRemaining(
        character.lastPublicRefreshAt,
        this.container.env.MANUAL_REFRESH_COOLDOWN_SECONDS,
      ),
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
        job: mapJobStatus(activeJob),
        cooldownSecondsRemaining: 0,
      };
    }

    const remaining = cooldownSecondsRemaining(
      character.lastPublicRefreshAt,
      this.container.env.MANUAL_REFRESH_COOLDOWN_SECONDS,
    );
    if (remaining > 0 && !opts.bypassCooldown && !opts.forceRefresh) {
      const lastJob = await this.repositories.job.findLatestForCharacter(character.id);
      const snapshot = await this.repositories.score.getPublishedSnapshot(character.id);
      return {
        characterId: character.id,
        refreshStatus: snapshot ? "STALE" : "QUEUED",
        job: lastJob ? mapJobStatus(lastJob) : null,
        cooldownSecondsRemaining: remaining,
      };
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
      job: job ? mapJobStatus(job) : null,
      cooldownSecondsRemaining: 0,
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
    if (!snapshot) {
      throw HttpError.notFound("SCORE_NOT_FOUND", "No score has been calculated for this character yet");
    }
    return mapScoreSnapshot(snapshot);
  }
}
