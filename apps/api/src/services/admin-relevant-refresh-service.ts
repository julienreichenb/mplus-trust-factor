/**
 * Admin Misc: relevant-character refresh RuntimeSettings + manual enqueue.
 */
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import {
  CONCURRENCY_MAX,
  RUNTIME_SETTING_KEYS,
  updateRelevantRefreshSettingsBodySchema,
  type AdminRelevantDiscoveryEnqueueDTO,
  type AdminRelevantRefreshSettingsDTO,
  type RunRelevantDiscoveryBody,
  type UpdateRelevantRefreshSettingsBody,
} from "@mplus/contracts";
import { shouldRegisterAutomaticBackgroundSchedulers, loadRelevantRefreshSettings } from "@mplus/worker";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";

export function percentileBpsToTopPercent(bps: number): number {
  return (10_000 - bps) / 100;
}

export function topPercentToPercentileBps(topPercent: number): number {
  return Math.round(10_000 - topPercent * 100);
}

async function settingsVersion(prisma: PrismaClient): Promise<{
  version: number;
  updatedAt: Date | null;
}> {
  const rows = await prisma.runtimeSetting.findMany({
    where: {
      key: {
        in: [
          RUNTIME_SETTING_KEYS.relevantRefreshEnabled,
          RUNTIME_SETTING_KEYS.refreshConcurrencyEnabled,
          RUNTIME_SETTING_KEYS.concurrencyOperation,
          RUNTIME_SETTING_KEYS.relevantCandidateTarget,
          RUNTIME_SETTING_KEYS.relevantCandidatePercentileBps,
          RUNTIME_SETTING_KEYS.wclPreResetDrainSeconds,
        ],
      },
    },
    select: { version: true, updatedAt: true },
  });
  if (rows.length === 0) return { version: 1, updatedAt: null };
  return {
    version: Math.max(...rows.map((r) => r.version), 1),
    updatedAt: rows.reduce<Date | null>((latest, row) => {
      if (!latest || row.updatedAt > latest) return row.updatedAt;
      return latest;
    }, null),
  };
}

export async function getRelevantRefreshSettings(
  prisma: PrismaClient,
  env: AppEnv,
): Promise<AdminRelevantRefreshSettingsDTO> {
  const effective = await loadRelevantRefreshSettings(prisma, env);
  const { version, updatedAt } = await settingsVersion(prisma);
  return {
    relevantRefreshEnabled: effective.runtimeEnabled,
    refreshConcurrencyEnabled: effective.refreshConcurrencyEnabled,
    concurrencyOperation: effective.concurrencyOperation,
    concurrencyHardMax: CONCURRENCY_MAX,
    relevantCandidateTarget: effective.candidateTarget,
    relevantCandidatePercentileBps: effective.candidatePercentileBps,
    relevantPopulationTopPercent: percentileBpsToTopPercent(effective.candidatePercentileBps),
    wclPreResetDrainSeconds: effective.wclPreResetDrainSeconds,
    killSwitchActive: effective.killSwitchActive,
    appEnv: env.APP_ENV,
    automaticSchedulingActive: shouldRegisterAutomaticBackgroundSchedulers(env.APP_ENV),
    settingsVersion: version,
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

export async function updateRelevantRefreshSettings(
  prisma: PrismaClient,
  env: AppEnv,
  body: UpdateRelevantRefreshSettingsBody,
  updatedByUserId: string | null,
): Promise<AdminRelevantRefreshSettingsDTO> {
  let parsed: UpdateRelevantRefreshSettingsBody;
  try {
    parsed = updateRelevantRefreshSettingsBodySchema.parse(body);
  } catch (error) {
    throw HttpError.badRequest(
      "INVALID_RELEVANT_REFRESH_SETTINGS",
      error instanceof Error ? error.message : "Invalid relevant refresh settings",
    );
  }
  const { version: currentVersion } = await settingsVersion(prisma);
  if (currentVersion !== parsed.expectedVersion) {
    throw HttpError.conflict(
      "RELEVANT_REFRESH_VERSION_CONFLICT",
      "Relevant refresh settings were updated elsewhere",
    );
  }
  const nextVersion = currentVersion + 1;

  await prisma.$transaction(async (tx) => {
    const upsert = async (key: string, value: unknown) => {
      await tx.runtimeSetting.upsert({
        where: { key },
        create: { key, value: value as never, version: nextVersion, updatedByUserId },
        update: { value: value as never, version: nextVersion, updatedByUserId },
      });
    };

    if (parsed.relevantRefreshEnabled != null) {
      await upsert(RUNTIME_SETTING_KEYS.relevantRefreshEnabled, parsed.relevantRefreshEnabled);
    }
    if (parsed.refreshConcurrencyEnabled != null) {
      await upsert(RUNTIME_SETTING_KEYS.refreshConcurrencyEnabled, parsed.refreshConcurrencyEnabled);
    }
    if (parsed.concurrencyOperation != null) {
      await upsert(RUNTIME_SETTING_KEYS.concurrencyOperation, parsed.concurrencyOperation);
    }
    if (parsed.relevantCandidateTarget != null) {
      await upsert(RUNTIME_SETTING_KEYS.relevantCandidateTarget, parsed.relevantCandidateTarget);
    }
    if (parsed.relevantCandidatePercentileBps != null) {
      await upsert(
        RUNTIME_SETTING_KEYS.relevantCandidatePercentileBps,
        parsed.relevantCandidatePercentileBps,
      );
    }
    if (parsed.wclPreResetDrainSeconds != null) {
      await upsert(RUNTIME_SETTING_KEYS.wclPreResetDrainSeconds, parsed.wclPreResetDrainSeconds);
    }

    // Bump version on untouched sibling keys so optimistic locking stays coherent.
    const touched = new Set(
      [
        parsed.relevantRefreshEnabled != null
          ? RUNTIME_SETTING_KEYS.relevantRefreshEnabled
          : null,
        parsed.refreshConcurrencyEnabled != null
          ? RUNTIME_SETTING_KEYS.refreshConcurrencyEnabled
          : null,
        parsed.concurrencyOperation != null ? RUNTIME_SETTING_KEYS.concurrencyOperation : null,
        parsed.relevantCandidateTarget != null
          ? RUNTIME_SETTING_KEYS.relevantCandidateTarget
          : null,
        parsed.relevantCandidatePercentileBps != null
          ? RUNTIME_SETTING_KEYS.relevantCandidatePercentileBps
          : null,
        parsed.wclPreResetDrainSeconds != null
          ? RUNTIME_SETTING_KEYS.wclPreResetDrainSeconds
          : null,
      ].filter(Boolean) as string[],
    );
    const existing = await tx.runtimeSetting.findMany({
      where: {
        key: {
          in: [
            RUNTIME_SETTING_KEYS.relevantRefreshEnabled,
            RUNTIME_SETTING_KEYS.refreshConcurrencyEnabled,
            RUNTIME_SETTING_KEYS.concurrencyOperation,
            RUNTIME_SETTING_KEYS.relevantCandidateTarget,
            RUNTIME_SETTING_KEYS.relevantCandidatePercentileBps,
            RUNTIME_SETTING_KEYS.wclPreResetDrainSeconds,
          ],
        },
      },
      select: { key: true },
    });
    for (const row of existing) {
      if (touched.has(row.key)) continue;
      await tx.runtimeSetting.update({
        where: { key: row.key },
        data: { version: nextVersion, updatedByUserId },
      });
    }
  });

  return getRelevantRefreshSettings(prisma, env);
}

export class AdminRelevantRefreshService {
  constructor(private readonly container: ApiContainer) {}

  getSettings() {
    return getRelevantRefreshSettings(this.container.worker.prisma, this.container.env);
  }

  async updateSettings(
    body: UpdateRelevantRefreshSettingsBody,
    actor: { userId: string | null; actorType: string; ip?: string; userAgent?: string | null },
  ) {
    const prisma = this.container.worker.prisma;
    const updated = await updateRelevantRefreshSettings(
      prisma,
      this.container.env,
      body,
      actor.userId,
    );
    await writeAuditEvent(prisma, {
      userId: actor.userId ?? undefined,
      actorType: actor.actorType as "user" | "admin_key" | "system" | "anonymous",
      action: "admin.misc.relevant_refresh.update",
      resourceType: "runtime_setting",
      resourceId: "relevant_refresh",
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionSecret: this.container.env.SESSION_SECRET,
      metadata: {
        settingsVersion: updated.settingsVersion,
        relevantRefreshEnabled: updated.relevantRefreshEnabled,
        concurrencyOperation: updated.concurrencyOperation,
      },
    });
    return updated;
  }

  async runDiscovery(
    body: RunRelevantDiscoveryBody,
    actor: { userId: string | null; actorType: string; ip?: string; userAgent?: string | null },
  ): Promise<AdminRelevantDiscoveryEnqueueDTO> {
    const settings = await loadRelevantRefreshSettings(
      this.container.worker.prisma,
      this.container.env,
    );
    if (settings.killSwitchActive) {
      throw HttpError.conflict(
        "RELEVANT_REFRESH_KILL_SWITCH",
        "Infrastructure kill switch is active — relevant discovery cannot run",
      );
    }

    const mode = body.mode ?? "daily_discovery";
    const regionCode = body.regionCode ?? "EU";
    const result = await this.container.producers.enqueueRelevantCharacterDiscovery({
      mode,
      regionCode,
      trigger: "admin",
    });

    await writeAuditEvent(this.container.worker.prisma, {
      userId: actor.userId ?? undefined,
      actorType: actor.actorType as "user" | "admin_key" | "system" | "anonymous",
      action: "admin.misc.relevant_refresh.run",
      resourceType: "job",
      resourceId: result.jobId,
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionSecret: this.container.env.SESSION_SECRET,
      metadata: { mode, regionCode, dedupeKey: result.dedupeKey, enqueued: result.enqueued },
    });

    return {
      jobId: result.jobId,
      dedupeKey: result.dedupeKey,
      reused: result.reused,
      enqueued: result.enqueued ?? true,
      mode,
      regionCode,
      trigger: "admin",
    };
  }
}
