/**
 * Pipeline integration helpers for refresh admission (Stage 3 enforce @ concurrency 1).
 */

import {
  buildRefreshAdmissionConfig,
  type AppEnv,
} from "@mplus/config";
import type { Logger } from "@mplus/observability";
import { OBS_EVENTS } from "@mplus/observability";
import type { PrismaClient } from "@mplus/database";
import type { Redis } from "ioredis";
import { createRefreshAdmissionGate, type RefreshAdmissionGate } from "./gate.js";
import {
  createRefreshAdmissionRepository,
  type RefreshAdmissionRepository,
} from "./repository.js";
import { estimateRefreshAdmissionWclPoints } from "./estimate.js";
import { startAdmissionLeaseHeartbeat, type AdmissionLeaseHeartbeat } from "./lease-heartbeat.js";
import { RefreshAdmissionError } from "./errors.js";
import type { RefreshAdmissionLiveResult } from "./types.js";

export interface PipelineAdmissionSession {
  gate: RefreshAdmissionGate;
  repository: RefreshAdmissionRepository | null;
  result: RefreshAdmissionLiveResult | null;
  heartbeat: AdmissionLeaseHeartbeat | null;
  /** True when enforce admitted (or mode off/shadow allowing proceed). */
  mayProceed: boolean;
}

export function createPipelineAdmissionGate(input: {
  env: AppEnv;
  redis: Redis | null;
  prisma: PrismaClient;
  logger: Logger;
}): { gate: RefreshAdmissionGate; repository: RefreshAdmissionRepository } {
  const repository = createRefreshAdmissionRepository(input.prisma);
  const gate = createRefreshAdmissionGate({
    env: input.env,
    redis: input.redis,
    appEnv: input.env.APP_ENV,
    repository,
    logger: input.logger,
  });
  return { gate, repository };
}

/**
 * Run admission after eligibility / before providers.
 * mode=off → proceed; shadow → proceed after predict; enforce → admit or throw.
 */
export async function runPipelineAdmission(input: {
  env: AppEnv;
  gate: RefreshAdmissionGate;
  repository?: RefreshAdmissionRepository | null;
  ingestionJobId: string;
  characterId: string | null;
  wclEnabled: boolean;
  emergencyOverride?: boolean;
  logger: Logger;
  correlationId?: string | null;
}): Promise<PipelineAdmissionSession> {
  const config = input.gate.config;

  if (config.mode === "off") {
    return {
      gate: input.gate,
      repository: input.repository ?? null,
      result: null,
      heartbeat: null,
      mayProceed: true,
    };
  }

  const wclRequired = input.wclEnabled;
  const estimatedWclPoints = estimateRefreshAdmissionWclPoints({ wclRequired });

  let predictInput;
  try {
    predictInput = await input.gate.loadPredictContext({
      ingestionJobId: input.ingestionJobId,
      characterId: input.characterId,
      estimatedWclPoints,
      wclRequired,
      emergencyOverride: Boolean(input.emergencyOverride),
    });
  } catch {
    if (config.mode === "enforce") {
      throw new RefreshAdmissionError({ reason: "REDIS_UNAVAILABLE" });
    }
    predictInput = {
      ingestionJobId: input.ingestionJobId,
      characterId: input.characterId,
      estimatedWclPoints,
      wclRequired,
      emergencyOverride: Boolean(input.emergencyOverride),
      snapshot: null,
      activeReservedPoints: 0,
      activeGlobalSlots: 0,
    };
  }

  const result = await input.gate.tryAdmit(predictInput);

  if (config.mode === "shadow") {
    return {
      gate: input.gate,
      repository: input.repository ?? null,
      result,
      heartbeat: null,
      mayProceed: true,
    };
  }

  if (result.outcome !== "admitted") {
    const reason = result.prediction.reason;
    input.logger.info(
      {
        event:
          result.outcome === "deferred"
            ? OBS_EVENTS.refreshAdmissionDeferred
            : OBS_EVENTS.refreshAdmissionDenied,
        jobId: input.ingestionJobId,
        admissionReason: reason,
        estimatedPoints: estimatedWclPoints,
        reservedPoints: 0,
        providerCallsAvoided: true,
        correlationId: input.correlationId ?? null,
      },
      result.outcome === "deferred"
        ? OBS_EVENTS.refreshAdmissionDeferred
        : OBS_EVENTS.refreshAdmissionDenied,
    );
    throw new RefreshAdmissionError({ reason });
  }

  const heartbeat = startAdmissionLeaseHeartbeat({
    gate: input.gate,
    ingestionJobId: input.ingestionJobId,
    windowId: result.windowId,
  });

  return {
    gate: input.gate,
    repository: input.repository ?? null,
    result,
    heartbeat,
    mayProceed: true,
  };
}

/**
 * Release Redis holds and record measured cost on Postgres.
 * Measured cost is never subtracted again from the live WCL snapshot.
 */
export async function settlePipelineAdmission(input: {
  session: PipelineAdmissionSession | null;
  ingestionJobId: string;
  measuredWclPoints: number | null;
  status: "SETTLED" | "RELEASED" | "CANCELLED" | "EXPIRED";
  logger: Logger;
}): Promise<void> {
  if (!input.session) return;
  input.session.heartbeat?.stop();

  if (input.session.gate.config.mode !== "enforce") return;
  if (!input.session.result || input.session.result.outcome !== "admitted") return;

  const release = await input.session.gate.tryRelease(input.ingestionJobId, {
    windowId: input.session.result.windowId,
    status: input.status,
  });

  if (input.session.repository && input.measuredWclPoints != null) {
    await input.session.repository
      .settle({
        jobId: input.ingestionJobId,
        status: input.status,
        measuredWclPoints: input.measuredWclPoints,
        metadata: {
          releasedPoints: release.releasedPoints,
          liveSnapshotDebited: false,
        },
      })
      .catch(() => undefined);
  }

  input.logger.info(
    {
      event: OBS_EVENTS.refreshAdmissionSettled,
      jobId: input.ingestionJobId,
      status: input.status,
      reservedPoints: input.session.result.reservedPoints,
      measuredWclPoints: input.measuredWclPoints,
      releasedPoints: release.releasedPoints,
      liveSnapshotDebited: false,
    },
    OBS_EVENTS.refreshAdmissionSettled,
  );
}

/** Sum measured WCL points from cost accumulator records (ledger units). */
export function sumMeasuredWclPoints(
  records: Array<{ provider: string; measuredCost: number | null }>,
): number | null {
  let sum = 0;
  let any = false;
  for (const r of records) {
    if (r.provider !== "WARCRAFT_LOGS" && r.provider !== "warcraftlogs") continue;
    if (r.measuredCost == null || !Number.isFinite(r.measuredCost)) continue;
    sum += r.measuredCost;
    any = true;
  }
  return any ? Math.max(0, Math.floor(sum)) : null;
}

export function buildAdmissionConfigFromEnv(env: AppEnv) {
  return buildRefreshAdmissionConfig(env);
}
