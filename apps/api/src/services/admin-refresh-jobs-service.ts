import type { IngestionJob, PrismaClient } from "@mplus/database";
import { QUEUE_NAMES, type RefreshTriggerSource } from "@mplus/contracts";
import { presentWowClass, WOW_CLASS_COLORS } from "@mplus/config";
import {
  cancelRefreshJob,
  killAllRefreshJobs,
  prioritizeRefreshJob,
  requireVerifiedSeasonAuthority,
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
  actions: { rerun: boolean; prioritize: boolean; cancel: boolean };
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
      rerun: terminal,
      prioritize: queued && !job.cancelRequestedAt,
      cancel: (queued || active) && job.status !== "CANCELLED",
    },
  };
}

export class AdminRefreshJobsService {
  constructor(private readonly container: ApiContainer) {}

  private controlDeps() {
    return {
      jobRepository: this.container.worker.repositories.job,
      refreshQueue: this.container.producers.getRefreshCharacterQueue(),
      logger: this.container.logger,
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
  ): Promise<{ jobId: string; reused: boolean; enqueued: boolean; refreshContractHash: string }> {
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

    const authority = await requireVerifiedSeasonAuthority(
      {
        prisma: this.prisma(),
        blizzard: this.container.worker.providers.blizzard,
        logger: this.container.logger,
      },
      character.region.code,
      character.regionId,
      { allowProviderSync: true, correlationId: null },
    );

    // Re-evaluate eligibility from persisted evidence only (no Blizzard level/rating fetch).
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
      env: process.env,
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
