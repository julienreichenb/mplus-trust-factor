/**
 * Admin API service for Scoring V2 Shadow Canary launch + status.
 * Enqueues async work — never runs long provider acquisition in the HTTP request.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { resolveShadowCanaryIdentity } from "./scoring-v2-shadow-canary-identity.js";

export const launchShadowCanaryBodySchema = z.object({
  region: z.enum(["EU", "US", "KR", "TW"]),
  realmSlug: z.string().min(1).max(64),
  characterName: z.string().min(1).max(48),
});
export type LaunchShadowCanaryBody = z.infer<typeof launchShadowCanaryBodySchema>;

export function buildShadowCanaryIdempotencyKey(input: {
  regionCode: string;
  realmSlug: string;
  characterName: string;
  seasonId: string;
}): string {
  return createHash("sha256")
    .update(
      [
        "shadow-canary-v1",
        input.regionCode.toUpperCase(),
        input.realmSlug.toLowerCase(),
        input.characterName.trim().toLowerCase(),
        input.seasonId,
      ].join("|"),
      "utf8",
    )
    .digest("hex");
}

export class ScoringV2ShadowCanaryService {
  constructor(private readonly container: ApiContainer) {}

  async launch(input: {
    body: LaunchShadowCanaryBody;
    requestedByUserId: string;
    enqueue: (job: {
      canaryId: string;
      region: "EU" | "US" | "KR" | "TW";
      realmSlug: string;
      characterName: string;
      requestedAt: string;
      correlationId: string;
    }) => Promise<{ jobId: string }>;
  }) {
    const season = await this.container.worker.prisma.season.findFirst({
      where: { isCurrent: true },
      orderBy: { createdAt: "desc" },
    });
    if (!season) {
      throw HttpError.badRequest("SEASON_REQUIRED", "No current season configured");
    }

    const identity = await resolveShadowCanaryIdentity({
      prisma: this.container.worker.prisma,
      regionCode: input.body.region,
      realmSlug: input.body.realmSlug,
      characterName: input.body.characterName,
    });
    if ("error" in identity) {
      throw HttpError.badRequest(identity.error, identity.detail);
    }

    const idempotencyKey = buildShadowCanaryIdempotencyKey({
      regionCode: identity.regionCode,
      realmSlug: identity.realmSlug,
      characterName: identity.characterName,
      seasonId: season.id,
    });

    const existing = await this.container.worker.prisma.scoringV2ShadowCanary.findUnique({
      where: { idempotencyKey },
    });
    if (existing && (existing.status === "QUEUED" || existing.status === "RUNNING")) {
      return { ...(await this.get(existing.id)), reused: true as const };
    }

    const launchKey =
      existing != null ? `${idempotencyKey}:relaunch:${randomUUID()}` : idempotencyKey;

    const row = await this.container.worker.prisma.scoringV2ShadowCanary.create({
      data: {
        characterId: identity.characterId,
        regionCode: identity.regionCode,
        realmSlug: identity.realmSlug,
        characterName: identity.characterName,
        seasonId: season.id,
        status: "QUEUED",
        lifecycle: "SHADOW",
        classSlug: identity.identity.classSlug,
        specSlug: identity.identity.specSlug,
        role: identity.identity.role,
        specializationId: identity.specializationId,
        catalogVersion: identity.catalogVersion,
        catalogSupportState: identity.catalogSupportState,
        requestedByUserId: input.requestedByUserId,
        idempotencyKey: launchKey,
        progress: {},
        diagnostics: {
          catalogDependentFailClosed: identity.catalogDependentFailClosed,
          identityState: identity.identity.state,
          limitations: identity.identity.limitations,
        },
      },
    });

    const enqueued = await input.enqueue({
      canaryId: row.id,
      region: input.body.region,
      realmSlug: input.body.realmSlug.toLowerCase(),
      characterName: input.body.characterName,
      requestedAt: new Date().toISOString(),
      correlationId: `shadow-canary-${row.id}`,
    });

    await this.container.worker.prisma.scoringV2ShadowCanary.update({
      where: { id: row.id },
      data: { bullmqJobId: enqueued.jobId },
    });

    return { ...(await this.get(row.id)), reused: false as const };
  }

  async get(canaryId: string) {
    const row = await this.container.worker.prisma.scoringV2ShadowCanary.findUnique({
      where: { id: canaryId },
    });
    if (!row) {
      throw HttpError.notFound("CANARY_NOT_FOUND", "Shadow canary not found");
    }

    let batchDiagnostics: Record<string, unknown> | null = null;
    if (row.analysisBatchId) {
      const batch = await this.container.worker.repositories.evidenceV2Batch.getById(
        row.analysisBatchId,
      );
      if (batch) {
        const slots = (batch.meta.slots ?? []).map((s) => ({
          slotId: s.slotId,
          dungeonSlug: s.dungeonSlug,
          slotIndex: s.slotIndex,
          status: s.status,
          terminalReason: s.terminalReason ?? null,
          reportCode: s.acquisitionResult?.discoveryIdentity.reportCode ?? null,
          fightId: s.acquisitionResult?.discoveryIdentity.fightId ?? null,
          reportRevision: s.acquisitionResult?.reportRevision ?? null,
          keyLevel: s.acquisitionResult?.keyLevel ?? null,
          timed: s.acquisitionResult?.timed ?? null,
          rejectionReason: s.acquisitionResult?.rejectionReason ?? null,
          dimensionValidity: s.acquisitionResult?.dimensionValidity ?? null,
          providerAccounting: s.providerAccounting ?? null,
        }));
        batchDiagnostics = {
          analysisBatchId: batch.batch.id,
          finalizationStatus: batch.batch.finalizationStatus,
          enabledConsumers: batch.meta.enabledConsumers,
          adminShadowCanary: batch.meta.adminShadowCanary === true,
          expectedSlotCount: batch.meta.acquisitionPlan.expectedSlotCount,
          slots,
          // Never include raw event arrays.
        };

        const dims = await this.container.worker.prisma.dimensionComputation.findMany({
          where: {
            characterId: row.characterId,
            ...(row.seasonId ? { seasonId: row.seasonId } : {}),
          },
          orderBy: { computedAt: "desc" },
          take: 8,
          select: {
            dimension: true,
            state: true,
            score: true,
            confidence: true,
            computedAt: true,
            explanation: true,
          },
        });
        batchDiagnostics.dimensions = dims.map((d) => ({
          dimension: d.dimension,
          state: d.state,
          score: d.score != null ? Number(d.score) : null,
          confidence: Number(d.confidence),
          computedAt: d.computedAt.toISOString(),
          // Sanitized explanation summary only — no raw events.
          blocker:
            d.explanation != null &&
            typeof d.explanation === "object" &&
            !Array.isArray(d.explanation) &&
            typeof (d.explanation as { blocker?: unknown }).blocker === "string"
              ? (d.explanation as { blocker: string }).blocker
              : null,
        }));
      }
    }

    return {
      id: row.id,
      characterId: row.characterId,
      regionCode: row.regionCode,
      realmSlug: row.realmSlug,
      characterName: row.characterName,
      seasonId: row.seasonId,
      analysisBatchId: row.analysisBatchId,
      status: row.status,
      lifecycle: row.lifecycle,
      classSlug: row.classSlug,
      specSlug: row.specSlug,
      role: row.role,
      specializationId: row.specializationId,
      catalogVersion: row.catalogVersion,
      catalogSupportState: row.catalogSupportState,
      progress: row.progress,
      diagnostics: row.diagnostics,
      batchDiagnostics,
      bullmqJobId: row.bullmqJobId,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      idempotencyKey: row.idempotencyKey,
    };
  }

  async list(limit = 20) {
    const rows = await this.container.worker.prisma.scoringV2ShadowCanary.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(100, Math.max(1, limit)),
    });
    return rows.map((row) => ({
      id: row.id,
      characterId: row.characterId,
      regionCode: row.regionCode,
      realmSlug: row.realmSlug,
      characterName: row.characterName,
      status: row.status,
      lifecycle: row.lifecycle,
      classSlug: row.classSlug,
      specSlug: row.specSlug,
      role: row.role,
      catalogVersion: row.catalogVersion,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      errorCode: row.errorCode,
    }));
  }
}
