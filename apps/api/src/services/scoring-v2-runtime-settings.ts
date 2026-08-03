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
  type ScoringV2ConcurrencyDTO,
  type UpdateConcurrencyBody,
} from "@mplus/contracts";
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

export async function getConcurrencySettings(
  prisma: PrismaClient,
  counts?: {
    calibrationActive: number;
    calibrationQueued: number;
    operationActive: number;
    operationQueued: number;
  },
): Promise<ScoringV2ConcurrencyDTO> {
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

  return {
    calibration: {
      workloadClass: "CALIBRATION",
      configured: calConfigured,
      effective: calConfigured,
      active: counts?.calibrationActive ?? 0,
      queued: counts?.calibrationQueued ?? 0,
      version: cal.version,
      updatedAt: cal.updatedAt.toISOString(),
      updatedByUserId: cal.updatedByUserId,
    },
    operation: {
      workloadClass: "OPERATION",
      configured: opConfigured,
      effective: opConfigured,
      active: counts?.operationActive ?? 0,
      queued: counts?.operationQueued ?? 0,
      version: op.version,
      updatedAt: op.updatedAt.toISOString(),
      updatedByUserId: op.updatedByUserId,
    },
    workerClaimHardMax: CONCURRENCY_MAX,
    synchronized: true,
    settingsVersion,
  };
}

export async function updateConcurrencySettings(
  prisma: PrismaClient,
  body: UpdateConcurrencyBody,
  updatedByUserId: string | null,
): Promise<ScoringV2ConcurrencyDTO> {
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
      throw new HttpError(409, "CONCURRENCY_VERSION_CONFLICT", "Concurrency settings were updated elsewhere");
    }
    const nextVersion = currentVersion + 1;
    if (parsed.concurrencyCalibration != null) {
      if (
        parsed.concurrencyCalibration < CONCURRENCY_MIN ||
        parsed.concurrencyCalibration > CONCURRENCY_MAX
      ) {
        throw new HttpError(400, "CONCURRENCY_OUT_OF_RANGE", "concurrency_calibration out of range");
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

  return getConcurrencySettings(prisma);
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
