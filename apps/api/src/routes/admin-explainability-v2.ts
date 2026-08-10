import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { ExplainabilityV2Service } from "../services/explainability-v2-service.js";
import { ScoringEvidenceExportService } from "../services/scoring-evidence-export-service.js";
import { ScoringEvidenceAuditService } from "../services/scoring-evidence-audit-service.js";
import { ScoringShadowCanaryService, launchShadowCanaryBodySchema } from "../services/scoring-shadow-canary-service.js";
import { buildScoringOverview } from "../services/scoring-overview-service.js";
import {
  getConcurrencySettings,
  updateConcurrencySettings,
} from "../services/scoring-runtime-settings.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { errorResponseSchema } from "./schemas.js";
import {
  authErrorResponses,
  conflictErrorResponses,
  concurrencyDtoSchema,
  createEvidenceExportBodyOpenApiSchema,
  evidenceExportDtoSchema,
  freezeBundleResponseSchema,
  freezeEvidenceBundleBodyOpenApiSchema,
  historyListSchema,
  listExportsSchema,
  overviewSchema,
  paginationQuerySchema,
  scoringControlCenterTags,
  updateConcurrencyBodyOpenApiSchema,
  zipDownloadResponseSchema,
} from "./scoring-control-center-schemas.js";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";
import { OBS_EVENTS, emitScoringEvent } from "@mplus/observability";
import { updateConcurrencyBodySchema } from "@mplus/contracts";

function auditCtx(request: {
  auth?: { user?: { id?: string } } | null;
  authActor?: string;
  ip?: string;
  headers: Record<string, unknown>;
}) {
  return {
    userId: request.auth?.user?.id ?? null,
    actorType: (request.authActor === "admin_key" ? "admin_key" : "user") as
      | "user"
      | "admin_key",
    ip: request.ip ?? null,
    userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
  };
}

async function resolveActorUserId(
  request: { auth?: { user?: { id?: string } } | null },
  container: ApiContainer,
): Promise<string> {
  if (request.auth?.user?.id) return request.auth.user.id;
  if (container.env.ADMIN_BOOTSTRAP_USER_ID) return container.env.ADMIN_BOOTSTRAP_USER_ID;
  const fallback = await container.worker.prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (fallback) return fallback.id;
  throw HttpError.badRequest(
    "ACTOR_USER_REQUIRED",
    "Mutations require an authenticated user or bootstrap user for attribution",
  );
}

/**
 * Scoring V2 Control Center + EvidenceManifest forensic explainability routes.
 *
 * LEGACY STATUS (Score Explainability chantier):
 * - This surface answers EvidenceManifest / DimensionComputation forensic questions.
 * - It is NOT the authority for current P/S/U/E CharacterScore score drivers.
 * - Authoritative score explanation is ScoreExplainabilityV1 on CharacterScore
 *   (see GET /api/v1/admin/characters/:id scoreExplainabilityAudit / product DimensionScoreDTO.explainability).
 * Reads: score.candidate.read. Mutations: admin.scoring.manage.
 * GET overview never enqueues or calls providers.
 */
export function buildAdminExplainabilityV2Routes(container: ApiContainer): FastifyPluginAsync {
  const explain = new ExplainabilityV2Service(container);
  const exports = new ScoringEvidenceExportService(container);
  const evidenceAudit = new ScoringEvidenceAuditService(container);
  const canaries = new ScoringShadowCanaryService(container);
  const env = container.env;

  return async (app) => {
    await app.register(async (readApp) => {
      readApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.SCORE_CANDIDATE_READ, {
          auditAction: "admin.explainability_v2.access",
          allowEmergencyAdminKey: true,
        }),
      );

      readApp.get(
        "/api/v1/admin/scoring/overview",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "Scoring V2 control-center overview (provider-free)",
            response: { 200: overviewSchema, ...authErrorResponses },
          },
        },
        async () => buildScoringOverview(container.worker.prisma, env, {
          redis: container.getAdmissionRedis(),
          appEnv: env.APP_ENV,
        }),
      );

      readApp.get(
        "/api/v1/admin/scoring/concurrency",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "Get distributed CALIBRATION/OPERATION concurrency settings",
            response: { 200: concurrencyDtoSchema, ...authErrorResponses },
          },
        },
        async () => {
        const [cal, op] = await Promise.all([
          container.worker.prisma.ingestionJob.groupBy({
            by: ["status"],
            where: { workloadClass: "CALIBRATION", status: { in: ["QUEUED", "ACTIVE"] } },
            _count: { _all: true },
          }),
          container.worker.prisma.ingestionJob.groupBy({
            by: ["status"],
            where: { workloadClass: "OPERATION", status: { in: ["QUEUED", "ACTIVE"] } },
            _count: { _all: true },
          }),
        ]);
        const count = (
          rows: Array<{ status: string; _count: { _all: number } }>,
          status: string,
        ) => rows.find((r) => r.status === status)?._count._all ?? 0;
        return getConcurrencySettings(container.worker.prisma, {
          calibrationActive: count(cal, "ACTIVE"),
          calibrationQueued: count(cal, "QUEUED"),
          operationActive: count(op, "ACTIVE"),
          operationQueued: count(op, "QUEUED"),
          redis: container.getAdmissionRedis(),
          appEnv: env.APP_ENV,
        });
      },
      );

      readApp.get(
        "/api/v1/admin/scoring/evidence-exports",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "List evidence exports",
            querystring: paginationQuerySchema,
            response: { 200: listExportsSchema, ...authErrorResponses },
          },
        },
        async (request) => {
          const q = request.query as { page?: number; pageSize?: number };
          return exports.listExports(q.page, q.pageSize);
        },
      );

      readApp.get(
        "/api/v1/admin/scoring/evidence-exports/:exportId",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "Get evidence export status and freeze eligibility blockers",
            params: {
              type: "object",
              properties: { exportId: { type: "string", format: "uuid" } },
              required: ["exportId"],
            },
            response: {
              200: evidenceExportDtoSchema,
              404: errorResponseSchema,
              ...authErrorResponses,
            },
          },
        },
        async (request) => {
          const { exportId } = request.params as { exportId: string };
          return exports.getExport(exportId);
        },
      );

      readApp.get(
        "/api/v1/admin/scoring/history",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "Evidence export and frozen bundle history",
            querystring: paginationQuerySchema,
            response: { 200: historyListSchema, ...authErrorResponses },
          },
        },
        async (request) => {
          const q = request.query as { page?: number; pageSize?: number };
          return exports.listHistory(q.page, q.pageSize);
        },
      );

      readApp.get(
        "/api/v1/admin/scoring/manifests",
        {
          schema: {
            tags: ["admin-explainability-v2"],
            querystring: {
              type: "object",
              properties: {
                characterId: { type: "string", format: "uuid" },
                seasonId: { type: "string", format: "uuid" },
                cursor: { type: "string" },
                limit: { type: "integer", minimum: 1, maximum: 50 },
              },
            },
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const q = request.query as {
            characterId?: string;
            seasonId?: string;
            cursor?: string;
            limit?: number;
          };
          return explain.listManifests(q);
        },
      );

      readApp.get(
        "/api/v1/admin/scoring/manifests/:manifestId/evidence-audit",
        {
          schema: {
            tags: ["admin-explainability-v2"],
            summary: "Provider-free evidence persistence and feature-lineage audit",
            params: {
              type: "object",
              properties: { manifestId: { type: "string", format: "uuid" } },
              required: ["manifestId"],
            },
            response: {
              200: { type: "object", additionalProperties: true },
              404: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const params = request.params as { manifestId: string };
          return evidenceAudit.getEvidenceAudit(params.manifestId);
        },
      );

      readApp.get(
        "/api/v1/admin/scoring/characters/:characterId/explainability",
        {
          schema: {
            tags: ["admin-explainability-v2"],
            summary:
              "LEGACY forensic EvidenceManifest explainability (NOT ScoreExplainabilityV1 authority)",
            description:
              "Returns Scoring V2 EvidenceManifest / DimensionComputation diagnostics. " +
              "For current P/S/U/E score drivers use CharacterScore dimensionDetails.explainability " +
              "via admin character detail (scoreExplainabilityAudit).",
            params: {
              type: "object",
              properties: { characterId: { type: "string", format: "uuid" } },
              required: ["characterId"],
            },
            querystring: {
              type: "object",
              properties: {
                seasonId: { type: "string", format: "uuid" },
                manifestId: { type: "string", format: "uuid" },
              },
            },
            response: {
              200: { type: "object", additionalProperties: true },
              404: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const params = request.params as { characterId: string };
          const q = request.query as { seasonId?: string; manifestId?: string };
          return explain.getAdminDiagnostics({
            characterId: params.characterId,
            seasonId: q.seasonId,
            manifestId: q.manifestId,
          });
        },
      );

      readApp.get(
        "/api/v1/admin/scoring/shadow-canaries",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "List recent Scoring V2 Shadow Canary runs",
            response: {
              200: { type: "object", additionalProperties: true },
              ...authErrorResponses,
            },
          },
        },
        async () => ({ items: await canaries.list() }),
      );

      readApp.get(
        "/api/v1/admin/scoring/shadow-canaries/:canaryId",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "Get one Shadow Canary run",
            params: {
              type: "object",
              properties: { canaryId: { type: "string", format: "uuid" } },
              required: ["canaryId"],
            },
            response: {
              200: { type: "object", additionalProperties: true },
              404: errorResponseSchema,
              ...authErrorResponses,
            },
          },
        },
        async (request) => {
          const params = request.params as { canaryId: string };
          return canaries.get(params.canaryId);
        },
      );
    });

    await app.register(async (writeApp) => {
      writeApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_SCORING_MANAGE, {
          auditAction: "admin.scoring.manage",
          allowEmergencyAdminKey: true,
        }),
      );

      writeApp.put(
        "/api/v1/admin/scoring/concurrency",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "Update CALIBRATION/OPERATION concurrency (does not kill active jobs)",
            body: updateConcurrencyBodyOpenApiSchema,
            response: {
              200: concurrencyDtoSchema,
              ...conflictErrorResponses,
            },
          },
        },
        async (request) => {
        const body = updateConcurrencyBodySchema.parse(request.body);
        const actorId = await resolveActorUserId(request, container);
        const result = await updateConcurrencySettings(
          container.worker.prisma,
          body,
          actorId,
          {
            redis: container.getAdmissionRedis(),
            appEnv: env.APP_ENV,
          },
        );
        emitScoringEvent(container.logger, OBS_EVENTS.scoringAdminConcurrencyUpdated, {
          settingsVersion: result.settingsVersion,
          concurrencyCalibration: result.calibration.configured,
          concurrencyOperation: result.operation.configured,
        });
        await writeAuditEvent(container.worker.prisma, {
          userId: actorId,
          actorType: auditCtx(request).actorType,
          action: "admin.scoring.concurrency.update",
          resourceType: "RuntimeSetting",
          resourceId: "concurrency",
          sessionSecret: env.SESSION_SECRET,
          ip: request.ip,
          userAgent:
            typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
          metadata: {
            settingsVersion: result.settingsVersion,
            concurrencyCalibration: result.calibration.configured,
            concurrencyOperation: result.operation.configured,
          },
        });
        return result;
      },
      );

      writeApp.post(
        "/api/v1/admin/scoring/shadow-canaries",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "Launch an asynchronous Scoring V2 Shadow Canary (publication blocked)",
            body: {
              type: "object",
              required: ["region", "realmSlug", "characterName"],
              properties: {
                region: { type: "string", enum: ["EU", "US", "KR", "TW"] },
                realmSlug: { type: "string", minLength: 1, maxLength: 64 },
                characterName: { type: "string", minLength: 1, maxLength: 48 },
              },
            },
            response: {
              200: { type: "object", additionalProperties: true },
              ...conflictErrorResponses,
            },
          },
        },
        async (request) => {
          const body = launchShadowCanaryBodySchema.parse(request.body);
          const actorId = await resolveActorUserId(request, container);
          const result = await canaries.launch({
            body,
            requestedByUserId: actorId,
            enqueue: async (job) => {
              if (typeof container.producers.enqueueScoringShadowCanary === "function") {
                return container.producers.enqueueScoringShadowCanary(job);
              }
              // Fallback: persist queued canary without worker enqueue in degraded mode.
              return { jobId: `local-shadow-canary-${job.canaryId}` };
            },
          });
          await writeAuditEvent(container.worker.prisma, {
            userId: actorId,
            actorType: auditCtx(request).actorType,
            action: "admin.scoring.shadow_canary.launch",
            resourceType: "ScoringShadowCanary",
            resourceId: result.id,
            sessionSecret: env.SESSION_SECRET,
            ip: request.ip,
            userAgent:
              typeof request.headers["user-agent"] === "string"
                ? request.headers["user-agent"]
                : null,
            metadata: {
              region: body.region,
              realmSlug: body.realmSlug,
              characterName: body.characterName,
              reused: result.reused,
            },
          });
          return result;
        },
      );

      writeApp.post(
        "/api/v1/admin/scoring/evidence-exports",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "Create provider-free evidence export job (no refresh enqueue)",
            body: createEvidenceExportBodyOpenApiSchema,
            response: {
              200: evidenceExportDtoSchema,
              ...conflictErrorResponses,
              404: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const actorId = await resolveActorUserId(request, container);
          return exports.createExport(request.body, actorId, auditCtx(request));
        },
      );

      writeApp.get(
        "/api/v1/admin/scoring/evidence-exports/:exportId/download",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "Download evidence export ZIP archive",
            produces: ["application/zip"],
            params: {
              type: "object",
              properties: { exportId: { type: "string", format: "uuid" } },
              required: ["exportId"],
            },
            response: {
              200: {
                description: "ZIP archive bytes",
                type: "string",
                format: "binary",
                content: {
                  "application/zip": {
                    schema: zipDownloadResponseSchema,
                  },
                },
              },
              404: errorResponseSchema,
              ...authErrorResponses,
            },
          },
        },
        async (request, reply) => {
          const { exportId } = request.params as { exportId: string };
          const file = await exports.downloadArchive(exportId);
          reply.header("Content-Type", "application/zip");
          reply.header("Content-Disposition", `attachment; filename="${file.filename}"`);
          reply.header("X-Content-Hash", file.contentHash);
          return reply.send(file.bytes);
        },
      );

      writeApp.post(
        "/api/v1/admin/scoring/evidence-exports/:exportId/freeze-bundle",
        {
          schema: {
            tags: [...scoringControlCenterTags],
            summary: "Freeze Calibration Input Bundle V2 (provider-free, no activation)",
            params: {
              type: "object",
              properties: { exportId: { type: "string", format: "uuid" } },
              required: ["exportId"],
            },
            body: freezeEvidenceBundleBodyOpenApiSchema,
            response: {
              200: freezeBundleResponseSchema,
              ...conflictErrorResponses,
              404: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { exportId } = request.params as { exportId: string };
          return exports.freezeBundle(exportId, request.body, auditCtx(request));
        },
      );
    });
  };
}
