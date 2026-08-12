import type { IngestionJob, PrismaClient } from "@mplus/database";
import { QUEUE_NAMES, type RefreshEtaFields, type RefreshTriggerSource } from "@mplus/contracts";
import { presentWowClass, WOW_CLASS_COLORS } from "@mplus/config";
import {
  cancelRefreshJob,
  killAllRefreshJobs,
  prioritizeRefreshJob,
  resolveEffectiveScoringSeason,
  tryGetActiveMplusCatalogDiscoverer,
  resolveActiveRefreshContract,
  runRefreshEligibilityGate,
  RefreshEligibilityError,
  type CancelRefreshJobResult,
  type KillAllRefreshJobsResult,
  type PrioritizeRefreshJobResult,
} from "@mplus/worker";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";
import { extractJobErrorCode } from "@mplus/config";
import {
  characterLacksBootstrapEvidence,
  latestJobIsEligibilityUnknown,
} from "./character-bootstrap-repair.js";
import { CharacterService } from "./character-service.js";
import { createAdminEtaApplier } from "./refresh-eta-service.js";

function payloadOf(job: IngestionJob): Record<string, unknown> {
  if (job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)) {
    return job.payload as Record<string, unknown>;
  }
  return {};
}

function readAvatar(rawSummary: unknown): string | null {
  if (!rawSummary || typeof rawSummary !== "object") return null;
  const media = (rawSummary as { media?: { avatarUrl?: unknown } }).media;
  return typeof media?.avatarUrl === "string" ? media.avatarUrl : null;
}

export interface AdminRefreshJobRow {
  /** Durable IngestionJob UUID (logical job id). */
  ingestionJobId: string;
  /** Alias of ingestionJobId for UI compatibility. */
  id: string;
  /** BullMQ queue job identifier when persisted; null for legacy/inline. */
  queueJobId: string | null;
  characterId: string | null;
  region: string | null;
  realmSlug: string | null;
  name: string | null;
  classSlug: string | null;
  classColor: string | null;
  avatarUrl: string | null;
  classIconUrl: string | null;
  mythicPlusScore: number | null;
  /**
   * Admin-only (requires admin.users.read). Null when unlinked, ambiguous, or
   * caller lacks user-read permission.
   */
  battleTag: string | null;
  /**
   * Admin-only (requires admin.users.read). Null when unlinked, ambiguous, or
   * caller lacks user-read permission.
   */
  battleNetEmail: string | null;
  /**
   * Exact scoring model key persisted on the job payload. Never inferred from
   * the currently active model. Null when unavailable.
   */
  scoringModelKey: string | null;
  /**
   * Exact scoring model version persisted on the job payload. Never inferred.
   * Null when unavailable.
   */
  scoringModelVersion: number | null;
  databaseStatus: string;
  queueState: string;
  triggerSource: string | null;
  fromBulk: boolean;
  priority: number;
  retryable: boolean;
  latestError: { code: string | null; message: string | null } | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  actions: { rerun: boolean; repairBootstrap: boolean; prioritize: boolean; cancel: boolean };
  /** Stage 4 additive ETA fields — null/omitted when REFRESH_ETA_ENABLED=false. */
  activeRefreshCount?: number | null;
  effectiveWorkerCapacity?: number | null;
  observedThroughput?: number | null;
  queuePosition?: number | null;
  estimatedWaitSeconds?: number | null;
  estimateConfidence?: RefreshEtaFields["estimateConfidence"];
  schedulingState?: RefreshEtaFields["schedulingState"];
}

export interface AdminCharacterSearchRow {
  id: string;
  region: string;
  realmSlug: string;
  name: string;
  classSlug: string | null;
  classColor: string | null;
  avatarUrl: string | null;
  classIconUrl: string | null;
  mythicPlusScore: number | null;
  refreshStatus: string | null;
  refreshJobId: string | null;
}

function readScoringModelFromPayload(payload: Record<string, unknown>): {
  scoringModelKey: string | null;
  scoringModelVersion: number | null;
} {
  const key =
    typeof payload.scoringModelKey === "string" && payload.scoringModelKey.trim()
      ? payload.scoringModelKey.trim()
      : null;
  const versionRaw = payload.scoringModelVersion;
  const version =
    typeof versionRaw === "number" && Number.isFinite(versionRaw)
      ? versionRaw
      : typeof versionRaw === "string" && versionRaw.trim() && Number.isFinite(Number(versionRaw))
        ? Number(versionRaw)
        : null;
  return { scoringModelKey: key, scoringModelVersion: version };
}

function mapJobRow(
  job: IngestionJob,
  extras: {
    classSlug?: string | null;
    avatarUrl?: string | null;
    mythicPlusScore?: number | null;
    battleTag?: string | null;
    battleNetEmail?: string | null;
    eta?: RefreshEtaFields | null;
  } = {},
): AdminRefreshJobRow {
  const payload = payloadOf(job);
  const region = typeof payload.region === "string" ? payload.region : null;
  const realmSlug = typeof payload.realmSlug === "string" ? payload.realmSlug : null;
  const name = typeof payload.name === "string" ? payload.name : null;
  const triggerSource = typeof payload.triggerSource === "string" ? payload.triggerSource : null;
  const fromBulk = triggerSource === "BULK_REFRESH";
  const errorCode = extractJobErrorCode(job.error);
  const errorMessage =
    job.error && typeof job.error === "object" && typeof (job.error as { message?: unknown }).message === "string"
      ? (job.error as { message: string }).message
      : null;
  const classSlug = extras.classSlug ?? null;
  const presented = classSlug ? presentWowClass({ classSlug }) : null;
  const terminal = job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED";
  const queued = job.status === "QUEUED";
  const active = job.status === "ACTIVE";
  const nonRetryableEligibility =
    errorCode === "CHARACTER_BELOW_MAX_LEVEL" ||
    errorCode === "CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE" ||
    errorCode === "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN";
  const retryable = terminal && job.status === "FAILED" && !nonRetryableEligibility;
  const scoring = readScoringModelFromPayload(payload);
  const bootstrapRepair =
    terminal &&
    (errorCode === "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN" ||
      latestJobIsEligibilityUnknown(job));
  const eta = extras.eta ?? null;

  return {
    ingestionJobId: job.id,
    id: job.id,
    queueJobId: job.queueJobId,
    characterId: job.characterId,
    region,
    realmSlug,
    name,
    classSlug,
    classColor: presented?.color ?? (classSlug ? WOW_CLASS_COLORS[classSlug] ?? null : null),
    avatarUrl: extras.avatarUrl ?? null,
    classIconUrl: presented?.iconUrl ?? null,
    mythicPlusScore: extras.mythicPlusScore ?? null,
    battleTag: extras.battleTag ?? null,
    battleNetEmail: extras.battleNetEmail ?? null,
    scoringModelKey: scoring.scoringModelKey,
    scoringModelVersion: scoring.scoringModelVersion,
    databaseStatus: job.status,
    queueState: job.status === "QUEUED" ? "queued" : job.status === "ACTIVE" ? "active" : job.status.toLowerCase(),
    triggerSource,
    fromBulk,
    priority: job.priority,
    retryable,
    latestError: errorCode || errorMessage ? { code: errorCode, message: errorMessage } : null,
    cancelRequested: Boolean(job.cancelRequestedAt),
    createdAt: job.scheduledAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.completedAt?.toISOString() ?? null,
    actions: {
      // Generic rerun stays provider-free; UNKNOWN / incomplete shells use repairBootstrap.
      rerun: terminal && !bootstrapRepair,
      repairBootstrap: bootstrapRepair,
      prioritize: queued && !job.cancelRequestedAt,
      cancel: (queued || active) && job.status !== "CANCELLED",
    },
    ...(eta
      ? {
          activeRefreshCount: eta.activeRefreshCount,
          effectiveWorkerCapacity: eta.effectiveWorkerCapacity,
          observedThroughput: eta.observedThroughput,
          queuePosition: eta.queuePosition,
          estimatedWaitSeconds: eta.estimatedWaitSeconds,
          estimateConfidence: eta.estimateConfidence,
          schedulingState: eta.schedulingState,
        }
      : {}),
  };
}

export class AdminRefreshJobsService {
  constructor(private readonly container: ApiContainer) {}

  private controlDeps() {
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
      jobRepository: this.container.worker.repositories.job,
      refreshQueue: this.container.producers.getRefreshCharacterQueue(),
      logger: this.container.logger,
      releaseAdmission,
    };
  }

  private prisma(): PrismaClient {
    return this.container.worker.prisma;
  }

  async countInFlight(): Promise<{ count: number }> {
    const count = await this.container.worker.repositories.job.countInFlightRefreshJobs();
    return { count };
  }

  async list(input: {
    status?: string | null;
    region?: string | null;
    characterName?: string | null;
    realmSlug?: string | null;
    characterId?: string | null;
    triggerSource?: string | null;
    fromBulk?: boolean | null;
    showHistoricalFailures?: boolean;
    page?: number;
    pageSize?: number;
    /** When true, include BattleTag/email for unambiguously linked characters. */
    includeAccountIdentity?: boolean;
  }): Promise<{ jobs: AdminRefreshJobRow[]; total: number; page: number; pageSize: number }> {
    const result = await this.container.worker.repositories.job.listRefreshJobs({
      status: (input.status as never) ?? null,
      region: input.region ?? null,
      characterName: input.characterName ?? null,
      realmSlug: input.realmSlug ?? null,
      characterId: input.characterId ?? null,
      triggerSource: input.triggerSource ?? null,
      fromBulk: input.fromBulk ?? null,
      showHistoricalFailures: input.showHistoricalFailures ?? false,
      page: input.page,
      pageSize: input.pageSize,
    });

    const characterIds = [
      ...new Set(result.jobs.map((j) => j.characterId).filter((id): id is string => Boolean(id))),
    ];
    const characters =
      characterIds.length === 0
        ? []
        : await this.prisma().character.findMany({
            where: { id: { in: characterIds } },
            include: {
              gameClass: true,
              snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
            },
          });
    const byId = new Map(characters.map((c) => [c.id, c]));

    const accountByCharacterId = new Map<
      string,
      { battleTag: string | null; battleNetEmail: string | null }
    >();
    if (input.includeAccountIdentity && characterIds.length > 0) {
      const ownerships = await this.prisma().verifiedCharacterOwnership.findMany({
        where: {
          characterId: { in: characterIds },
          status: "CURRENT",
          revokedAt: null,
        },
        include: {
          user: { select: { id: true, email: true } },
          battleNetAccount: {
            select: {
              id: true,
              battletagDisplay: true,
              unlinkedAt: true,
            },
          },
        },
      });

      const grouped = new Map<string, typeof ownerships>();
      for (const row of ownerships) {
        if (!row.characterId) continue;
        const list = grouped.get(row.characterId) ?? [];
        list.push(row);
        grouped.set(row.characterId, list);
      }

      for (const [characterId, rows] of grouped) {
        const linked = rows.filter((r) => r.battleNetAccount.unlinkedAt == null);
        const distinctUsers = new Set(linked.map((r) => r.userId));
        const distinctAccounts = new Set(linked.map((r) => r.battleNetAccountId));
        // Ambiguous ownership → omit identity rather than guessing.
        if (distinctUsers.size !== 1 || distinctAccounts.size !== 1 || linked.length === 0) {
          accountByCharacterId.set(characterId, { battleTag: null, battleNetEmail: null });
          continue;
        }
        const owner = linked[0]!;
        accountByCharacterId.set(characterId, {
          battleTag: owner.battleNetAccount.battletagDisplay,
          battleNetEmail: owner.user.email ?? null,
        });
      }
    }

    const etaApply = await createAdminEtaApplier(this.container);

    return {
      jobs: result.jobs.map((job) => {
        const character = job.characterId ? byId.get(job.characterId) : null;
        const account = job.characterId ? accountByCharacterId.get(job.characterId) : undefined;
        return mapJobRow(job, {
          classSlug: character?.gameClass?.slug ?? null,
          avatarUrl: readAvatar(character?.snapshots[0]?.rawSummary),
          mythicPlusScore: character?.snapshots[0]?.mythicRating ?? null,
          battleTag: account?.battleTag ?? null,
          battleNetEmail: account?.battleNetEmail ?? null,
          eta: etaApply ? etaApply(job) : null,
        });
      }),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async searchCharacters(input: {
    region?: string | null;
    nickname?: string | null;
    realm?: string | null;
    limit?: number;
  }): Promise<{ characters: AdminCharacterSearchRow[] }> {
    const limit = Math.min(50, Math.max(1, input.limit ?? 20));
    const regionCode = input.region?.trim().toUpperCase() || null;
    const nickname = input.nickname?.trim() || null;
    const realm = input.realm?.trim() || null;

    if (!nickname || nickname.length < 2) {
      throw HttpError.badRequest("INVALID_QUERY", "Nickname must be at least 2 characters");
    }

    const region = regionCode
      ? await this.prisma().region.findUnique({ where: { code: regionCode } })
      : null;
    if (regionCode && !region) {
      return { characters: [] };
    }

    const characters = await this.prisma().character.findMany({
      where: {
        ...(region ? { regionId: region.id } : {}),
        OR: [
          { displayName: { contains: nickname, mode: "insensitive" } },
          { normalizedName: { contains: nickname.toLowerCase(), mode: "insensitive" } },
        ],
        ...(realm
          ? { realm: { OR: [{ slug: { contains: realm, mode: "insensitive" } }, { name: { contains: realm, mode: "insensitive" } }] } }
          : {}),
      },
      include: {
        region: true,
        realm: true,
        gameClass: true,
        snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
        ingestionJobs: {
          where: { jobType: QUEUE_NAMES.refreshCharacter },
          orderBy: { scheduledAt: "desc" },
          take: 1,
        },
      },
      take: limit,
      orderBy: [{ lastSeenAt: "desc" }, { displayName: "asc" }],
    });

    return {
      characters: characters.map((c) => {
        const presented = c.gameClass?.slug ? presentWowClass({ classSlug: c.gameClass.slug }) : null;
        const latestJob = c.ingestionJobs[0] ?? null;
        return {
          id: c.id,
          region: c.region.code,
          realmSlug: c.realm.slug,
          name: c.displayName,
          classSlug: c.gameClass?.slug ?? null,
          classColor: presented?.color ?? null,
          avatarUrl: readAvatar(c.snapshots[0]?.rawSummary),
          classIconUrl: presented?.iconUrl ?? null,
          mythicPlusScore: c.snapshots[0]?.mythicRating ?? null,
          refreshStatus: latestJob?.status ?? null,
          refreshJobId: latestJob?.id ?? null,
        };
      }),
    };
  }

  async cancel(
    jobId: string,
    actor: { userId?: string | null; actorType: "user" | "admin_key"; ip?: string; userAgent?: string },
  ): Promise<CancelRefreshJobResult> {
    const result = await cancelRefreshJob(this.controlDeps(), jobId, "admin_cancel");
    await writeAuditEvent(this.prisma(), {
      userId: actor.userId ?? undefined,
      actorType: actor.actorType,
      action: "admin.refresh_jobs.cancel",
      resourceType: "ingestion_job",
      resourceId: jobId,
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionSecret: this.container.env.SESSION_SECRET,
      metadata: {
        ingestionJobId: result.ingestionJobId,
        queueJobId: result.queueJobId,
        characterId: null,
        previousStatus: result.previousStatus,
        resultingStatus: result.databaseStatus,
        outcome: result.outcome,
        reason: "admin_cancel",
        queueRemoved: result.queueRemoved,
      },
    });
    return result;
  }

  async prioritize(
    jobId: string,
    actor: { userId?: string | null; actorType: "user" | "admin_key"; ip?: string; userAgent?: string },
  ): Promise<PrioritizeRefreshJobResult> {
    try {
      const result = await prioritizeRefreshJob(this.controlDeps(), jobId);
      await writeAuditEvent(this.prisma(), {
        userId: actor.userId ?? undefined,
        actorType: actor.actorType,
        action: "admin.refresh_jobs.prioritize",
        resourceType: "ingestion_job",
        resourceId: jobId,
        ip: actor.ip,
        userAgent: actor.userAgent,
        sessionSecret: this.container.env.SESSION_SECRET,
        metadata: { ...result },
      });
      return result;
    } catch (error) {
      throw HttpError.conflict("REFRESH_JOB_NOT_PRIORITIZABLE", (error as Error).message);
    }
  }

  async rerun(
    jobId: string,
    actor: { userId?: string | null; actorType: "user" | "admin_key"; ip?: string; userAgent?: string },
  ): Promise<{
    jobId: string;
    reused: boolean;
    enqueued: boolean;
    refreshContractHash: string;
    bootstrapRepaired?: boolean;
    resolveStatus?: string;
    characterId?: string | null;
    historicalJobId?: string;
  }> {
    const existing = await this.container.worker.repositories.job.findById(jobId);
    if (!existing || existing.jobType !== QUEUE_NAMES.refreshCharacter) {
      throw HttpError.notFound("REFRESH_JOB_NOT_FOUND", `Refresh job ${jobId} was not found`);
    }
    if (existing.status !== "COMPLETED" && existing.status !== "FAILED" && existing.status !== "CANCELLED") {
      throw HttpError.conflict("REFRESH_JOB_NOT_TERMINAL", "Re-run is only available for terminal jobs");
    }

    const payload = payloadOf(existing);
    const region = typeof payload.region === "string" ? payload.region : null;
    const realmSlug = typeof payload.realmSlug === "string" ? payload.realmSlug : null;
    const name = typeof payload.name === "string" ? payload.name : null;
    if (!region || !realmSlug || !name) {
      throw HttpError.badRequest("REFRESH_JOB_PAYLOAD_INVALID", "Job payload lacks character identity");
    }

    const characterId = existing.characterId;
    if (!characterId) {
      throw HttpError.badRequest("REFRESH_JOB_NO_CHARACTER", "Job has no linked character");
    }
    const character = await this.prisma().character.findUniqueOrThrow({
      where: { id: characterId },
      include: { region: true },
    });

    const discoverActiveMplusCatalog = tryGetActiveMplusCatalogDiscoverer(
      this.container.worker.providers.warcraftlogs,
    );
    const effective = await resolveEffectiveScoringSeason({
      prisma: this.prisma(),
      blizzard: this.container.worker.providers.blizzard,
      logger: this.container.logger,
      regionCode: character.region.code,
      regionId: character.regionId,
      allowProviderSync: true,
      correlationId: null,
      discoverActiveMplusCatalog,
    });
    const authority = {
      regionCode: effective.detected.regionCode,
      regionId: effective.detected.regionId,
      seasonRowId: effective.applicationSeasonId,
      blizzardSeasonId: effective.blizzardSeasonId,
      slug: effective.seasonSlug,
      authoritySource: effective.detected.authoritySource,
      authorityVerifiedAt: effective.detected.authorityVerifiedAt,
      resolution: effective.detected.resolution,
    };

    // Re-evaluate eligibility from persisted evidence only (no Blizzard level/rating fetch).
    // Incomplete / UNKNOWN shells cannot be fixed here — route through exact resolve repair.
    const needsBootstrapRepair =
      characterLacksBootstrapEvidence(character) || latestJobIsEligibilityUnknown(existing);
    if (needsBootstrapRepair) {
      if (!region || !realmSlug || !name) {
        throw HttpError.badRequest(
          "REFRESH_JOB_PAYLOAD_INVALID",
          "Job payload lacks character identity required for bootstrap repair",
        );
      }
      const characterService = new CharacterService(this.container);
      const repair = await characterService.resolveCharacter(
        { region, realmSlug, name },
        { correlationId: null, forceRetry: true },
      );
      await writeAuditEvent(this.prisma(), {
        userId: actor.userId ?? undefined,
        actorType: actor.actorType,
        action: "admin.refresh_jobs.repair_bootstrap",
        resourceType: "ingestion_job",
        resourceId: jobId,
        ip: actor.ip,
        userAgent: actor.userAgent,
        sessionSecret: this.container.env.SESSION_SECRET,
        metadata: {
          characterId,
          resolveStatus: repair.body.status,
          statusCode: repair.statusCode,
          historicalJobId: existing.id,
        },
      });
      if (repair.statusCode >= 400) {
        const body = repair.body as { message?: string; status?: string };
        throw HttpError.conflict(
          body.status === "PROVIDER_UNAVAILABLE"
            ? "PROVIDER_UNAVAILABLE"
            : "CHARACTER_BOOTSTRAP_REPAIR_FAILED",
          body.message ?? "Bootstrap repair failed",
          {
            bootstrapRepairRequired: true,
            repairAction: "resolve_force_retry",
            resolve: repair.body,
          },
        );
      }
      const refreshId =
        "refreshId" in repair.body && typeof repair.body.refreshId === "string"
          ? repair.body.refreshId
          : null;
      return {
        jobId: refreshId ?? existing.id,
        reused: false,
        enqueued: repair.statusCode === 202,
        refreshContractHash: "",
        bootstrapRepaired: true,
        resolveStatus: repair.body.status,
        characterId,
        historicalJobId: existing.id,
      };
    }

    try {
      await runRefreshEligibilityGate(
        {
          prisma: this.prisma(),
          logger: this.container.logger,
          maxCharacterLevel: this.container.env.MAX_CHARACTER_LEVEL,
        },
        {
          characterId: character.id,
          authority,
          jobId: existing.id,
          triggerSource: "SYSTEM",
        },
      );
    } catch (error) {
      if (error instanceof RefreshEligibilityError) {
        throw HttpError.conflict(
          error.result.code ?? error.code,
          error.result.message ?? error.message,
          {
            bootstrapRepairRequired: false,
          },
        );
      }
      throw error;
    }

    const activeModel =
      (await this.container.worker.repositories.score.getActiveModel()) ?? {
        key: this.container.env.ACTIVE_SCORE_MODEL_KEY,
        version: this.container.env.ACTIVE_SCORE_MODEL_VERSION,
      };

    const { hash } = resolveActiveRefreshContract({
      scoringModelKey: activeModel.key,
      scoringModelVersion: activeModel.version,
      activeSeasonId: authority.slug,
      providerMode: this.container.env.PROVIDER_MODE,
      zoneId: effective.wclZoneId,
    });

    const result = await this.container.producers.enqueueRefreshCharacter({
      characterId: character.id,
      region,
      realmSlug,
      name,
      priority: "high",
      forceRefresh: true,
      refreshContractHash: hash,
      scoringModelKey: activeModel.key,
      scoringModelVersion: activeModel.version,
      triggerSource: "SYSTEM" as RefreshTriggerSource,
      authoritativeSeasonId: authority.blizzardSeasonId,
      authoritativeSeasonSlug: authority.slug,
      authoritySource: authority.authoritySource,
      correlationId: null,
    });

    await writeAuditEvent(this.prisma(), {
      userId: actor.userId ?? undefined,
      actorType: actor.actorType,
      action: "admin.refresh_jobs.rerun",
      resourceType: "ingestion_job",
      resourceId: jobId,
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionSecret: this.container.env.SESSION_SECRET,
      metadata: {
        previousJobId: jobId,
        newJobId: result.jobId,
        previousIngestionJobId: jobId,
        newIngestionJobId: result.jobId,
        refreshContractHash: hash,
        reused: result.reused,
        enqueued: result.enqueued ?? false,
        characterId,
        reason: "admin_rerun",
      },
    });

    return {
      jobId: result.jobId,
      reused: result.reused,
      enqueued: result.enqueued ?? false,
      refreshContractHash: hash,
    };
  }

  async killAll(
    actor: { userId?: string | null; actorType: "user" | "admin_key"; ip?: string; userAgent?: string },
    confirm: boolean,
  ): Promise<KillAllRefreshJobsResult & { countBefore: number }> {
    if (!confirm) {
      throw HttpError.badRequest("KILL_ALL_CONFIRM_REQUIRED", "confirm=true is required");
    }
    const countBefore = await this.container.worker.repositories.job.countInFlightRefreshJobs();
    const result = await killAllRefreshJobs(this.controlDeps(), "admin_kill_all");
    await writeAuditEvent(this.prisma(), {
      userId: actor.userId ?? undefined,
      actorType: actor.actorType,
      action: "admin.refresh_jobs.kill_all",
      resourceType: "ingestion_job",
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionSecret: this.container.env.SESSION_SECRET,
      metadata: {
        countBefore,
        queuedCancelled: result.queuedCancelled,
        delayedCancelled: result.delayedCancelled,
        activeCancellationRequested: result.activeCancellationRequested,
        activeForceCancelled: result.activeForceCancelled,
        alreadyCancellationRequested: result.alreadyCancellationRequested,
        alreadyTerminal: result.alreadyTerminal,
        cancellationFailed: result.cancellationFailed,
        resultCount: result.results.length,
        reason: "admin_kill_all",
        pointInTime: true,
      },
    });
    return { ...result, countBefore };
  }
}
