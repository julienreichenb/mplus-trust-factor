/**
 * Typed RuntimeSetting accessors for Scoring V2 control-center concurrency.
 */
import { z } from "zod";
import type { PrismaClient } from "@mplus/database";
import {
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  DEFAULT_CONCURRENCY_CALIBRATION,
  DEFAULT_CONCURRENCY_OPERATION,
  RUNTIME_SETTING_KEYS,
  concurrencyValueSchema,
  type ScoringConcurrencyDTO,
  type UpdateConcurrencyBody,
} from "@mplus/contracts";
import {
  deriveConcurrencySyncState,
  listConcurrencyObservations,
  type ConcurrencyObserveRedis,
} from "@mplus/worker";
import { HttpError } from "../errors.js";

const concurrencySettingSchema = concurrencyValueSchema;

export function validateConcurrencyValue(value: unknown): number {
  return concurrencySettingSchema.parse(value);
}

async function ensureDefaults(prisma: PrismaClient): Promise<void> {
  await prisma.runtimeSetting.upsert({
    where: { key: RUNTIME_SETTING_KEYS.concurrencyCalibration },
    create: {
      key: RUNTIME_SETTING_KEYS.concurrencyCalibration,
      value: DEFAULT_CONCURRENCY_CALIBRATION,
      version: 1,
    },
    update: {},
  });
  await prisma.runtimeSetting.upsert({
    where: { key: RUNTIME_SETTING_KEYS.concurrencyOperation },
    create: {
      key: RUNTIME_SETTING_KEYS.concurrencyOperation,
      value: DEFAULT_CONCURRENCY_OPERATION,
      version: 1,
    },
    update: {},
  });
}

function readConcurrency(value: unknown, fallback: number): number {
  const parsed = concurrencySettingSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export type GetConcurrencySettingsOptions = {
  calibrationActive?: number;
  calibrationQueued?: number;
  operationActive?: number;
  operationQueued?: number;
  /** When null/undefined, syncState is UNKNOWN (Redis unavailable). */
  redis?: ConcurrencyObserveRedis | null;
  appEnv?: string;
  nowMs?: number;
};

export async function getConcurrencySettings(
  prisma: PrismaClient,
  options: GetConcurrencySettingsOptions = {},
): Promise<ScoringConcurrencyDTO> {
  await ensureDefaults(prisma);
  const rows = await prisma.runtimeSetting.findMany({
    where: {
      key: {
        in: [
          RUNTIME_SETTING_KEYS.concurrencyCalibration,
          RUNTIME_SETTING_KEYS.concurrencyOperation,
        ],
      },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const cal = byKey.get(RUNTIME_SETTING_KEYS.concurrencyCalibration)!;
  const op = byKey.get(RUNTIME_SETTING_KEYS.concurrencyOperation)!;
  const calConfigured = readConcurrency(cal.value, DEFAULT_CONCURRENCY_CALIBRATION);
  const opConfigured = readConcurrency(op.value, DEFAULT_CONCURRENCY_OPERATION);
  const settingsVersion = Math.max(cal.version, op.version);

  const redis = options.redis ?? null;
  const appEnv = options.appEnv ?? "development";
  let redisAvailable = false;
  let observations: Awaited<ReturnType<typeof listConcurrencyObservations>> = [];

  if (redis != null) {
    const listed = await listConcurrencyObservations({ redis, appEnv });
    if (listed == null) {
      redisAvailable = false;
      observations = [];
    } else {
      redisAvailable = true;
      observations = listed;
    }
  }

  const sync = deriveConcurrencySyncState({
    redisAvailable,
    observations: observations ?? [],
    settingsVersion,
    configuredCalibration: calConfigured,
    configuredOperation: opConfigured,
    nowMs: options.nowMs,
  });

  return {
    calibration: {
      workloadClass: "CALIBRATION",
      configured: calConfigured,
      effective: sync.effectiveCalibration,
      active: options.calibrationActive ?? 0,
      queued: options.calibrationQueued ?? 0,
      version: cal.version,
      updatedAt: cal.updatedAt.toISOString(),
      updatedByUserId: cal.updatedByUserId,
    },
    operation: {
      workloadClass: "OPERATION",
      configured: opConfigured,
      effective: sync.effectiveOperation,
      active: options.operationActive ?? 0,
      queued: options.operationQueued ?? 0,
      version: op.version,
      updatedAt: op.updatedAt.toISOString(),
      updatedByUserId: op.updatedByUserId,
    },
    workerClaimHardMax: CONCURRENCY_MAX,
    syncState: sync.syncState,
    synchronized: sync.synchronized,
    settingsVersion,
    observedReplicaCount: sync.observedReplicaCount,
    oldestObservationAt: sync.oldestObservationAt,
    newestObservationAt: sync.newestObservationAt,
  };
}

export async function updateConcurrencySettings(
  prisma: PrismaClient,
  body: UpdateConcurrencyBody,
  updatedByUserId: string | null,
  options: Pick<GetConcurrencySettingsOptions, "redis" | "appEnv" | "nowMs"> = {},
): Promise<ScoringConcurrencyDTO> {
  const parsed = z
    .object({
      concurrencyCalibration: concurrencyValueSchema.optional(),
      concurrencyOperation: concurrencyValueSchema.optional(),
      expectedVersion: z.number().int().positive(),
    })
    .refine((v) => v.concurrencyCalibration != null || v.concurrencyOperation != null, {
      message: "At least one concurrency value is required",
    })
    .parse(body);

  await ensureDefaults(prisma);

  await prisma.$transaction(async (tx) => {
    const rows = await tx.runtimeSetting.findMany({
      where: {
        key: {
          in: [
            RUNTIME_SETTING_KEYS.concurrencyCalibration,
            RUNTIME_SETTING_KEYS.concurrencyOperation,
          ],
        },
      },
    });
    const currentVersion = Math.max(...rows.map((r) => r.version), 1);
    if (currentVersion !== parsed.expectedVersion) {
      throw HttpError.conflict("CONCURRENCY_VERSION_CONFLICT", "Concurrency settings were updated elsewhere");
    }
    const nextVersion = currentVersion + 1;
    if (parsed.concurrencyCalibration != null) {
      if (
        parsed.concurrencyCalibration < CONCURRENCY_MIN ||
        parsed.concurrencyCalibration > CONCURRENCY_MAX
      ) {
        throw HttpError.badRequest("CONCURRENCY_OUT_OF_RANGE", "concurrency_calibration out of range");
      }
      await tx.runtimeSetting.update({
        where: { key: RUNTIME_SETTING_KEYS.concurrencyCalibration },
        data: {
          value: parsed.concurrencyCalibration,
          version: nextVersion,
          updatedByUserId,
        },
      });
    } else {
      await tx.runtimeSetting.update({
        where: { key: RUNTIME_SETTING_KEYS.concurrencyCalibration },
        data: { version: nextVersion, updatedByUserId },
      });
    }
    if (parsed.concurrencyOperation != null) {
      await tx.runtimeSetting.update({
        where: { key: RUNTIME_SETTING_KEYS.concurrencyOperation },
        data: {
          value: parsed.concurrencyOperation,
          version: nextVersion,
          updatedByUserId,
        },
      });
    } else {
      await tx.runtimeSetting.update({
        where: { key: RUNTIME_SETTING_KEYS.concurrencyOperation },
        data: { version: nextVersion, updatedByUserId },
      });
    }
  });

  return getConcurrencySettings(prisma, options);
}

export async function loadLaneLimits(prisma: PrismaClient): Promise<{
  calibration: number;
  operation: number;
}> {
  const dto = await getConcurrencySettings(prisma);
  return {
    calibration: dto.calibration.configured,
    operation: dto.operation.configured,
  };
}
