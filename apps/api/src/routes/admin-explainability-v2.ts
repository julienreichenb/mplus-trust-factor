import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { ExplainabilityV2Service } from "../services/explainability-v2-service.js";
import { ScoringV2EvidenceExportService } from "../services/scoring-v2-evidence-export-service.js";
import { buildScoringV2Overview } from "../services/scoring-v2-overview-service.js";
import {
  getConcurrencySettings,
  updateConcurrencySettings,
} from "../services/scoring-v2-runtime-settings.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { errorResponseSchema } from "./schemas.js";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";
import { OBS_EVENTS, emitScoringV2Event } from "@mplus/observability";
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
 * Scoring V2 Control Center + explainability routes.
 * Reads: score.candidate.read. Mutations: admin.scoring_v2.manage.
 * GET overview never enqueues or calls providers.
 */
export function buildAdminExplainabilityV2Routes(container: ApiContainer): FastifyPluginAsync {
  const explain = new ExplainabilityV2Service(container);
  const exports = new ScoringV2EvidenceExportService(container);
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

      readApp.get("/api/v1/admin/scoring-v2/overview", async () =>
        buildScoringV2Overview(container.worker.prisma, env),
      );

      readApp.get("/api/v1/admin/scoring-v2/concurrency", async () => {
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
        });
      });

      readApp.get("/api/v1/admin/scoring-v2/evidence-exports", async (request) => {
        const q = request.query as { page?: number; pageSize?: number };
        return exports.listExports(q.page, q.pageSize);
      });

      readApp.get("/api/v1/admin/scoring-v2/evidence-exports/:exportId", async (request) => {
        const { exportId } = request.params as { exportId: string };
        return exports.getExport(exportId);
      });

      readApp.get("/api/v1/admin/scoring-v2/history", async (request) => {
        const q = request.query as { page?: number; pageSize?: number };
        return exports.listHistory(q.page, q.pageSize);
      });

      readApp.get(
        "/api/v1/admin/scoring-v2/manifests",
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
        "/api/v1/admin/scoring-v2/characters/:characterId/explainability",
        {
          schema: {
            tags: ["admin-explainability-v2"],
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
    });

    await app.register(async (writeApp) => {
      writeApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_SCORING_V2_MANAGE, {
          auditAction: "admin.scoring_v2.manage",
          allowEmergencyAdminKey: true,
        }),
      );

      writeApp.put("/api/v1/admin/scoring-v2/concurrency", async (request) => {
        const body = updateConcurrencyBodySchema.parse(request.body);
        const actorId = await resolveActorUserId(request, container);
        const result = await updateConcurrencySettings(
          container.worker.prisma,
          body,
          actorId,
        );
        emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2AdminConcurrencyUpdated, {
          settingsVersion: result.settingsVersion,
          concurrencyCalibration: result.calibration.configured,
          concurrencyOperation: result.operation.configured,
        });
        await writeAuditEvent(container.worker.prisma, {
          userId: actorId,
          actorType: auditCtx(request).actorType,
          action: "admin.scoring_v2.concurrency.update",
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
      });

      writeApp.post("/api/v1/admin/scoring-v2/evidence-exports", async (request) => {
        const actorId = await resolveActorUserId(request, container);
        return exports.createExport(request.body, actorId, auditCtx(request));
      });

      writeApp.get("/api/v1/admin/scoring-v2/evidence-exports/:exportId/download", async (request, reply) => {
        const { exportId } = request.params as { exportId: string };
        const file = await exports.downloadArchive(exportId);
        reply.header("Content-Type", "application/zip");
        reply.header("Content-Disposition", `attachment; filename="${file.filename}"`);
        reply.header("X-Content-Hash", file.contentHash);
        return reply.send(file.bytes);
      });

      writeApp.post(
        "/api/v1/admin/scoring-v2/evidence-exports/:exportId/freeze-bundle",
        async (request) => {
          const { exportId } = request.params as { exportId: string };
          return exports.freezeBundle(exportId, request.body, auditCtx(request));
        },
      );
    });
  };
}
