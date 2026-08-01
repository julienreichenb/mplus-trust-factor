import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { AdminCalibrationService } from "../services/admin-calibration-service.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { errorResponseSchema } from "./schemas.js";
import { HttpError } from "../errors.js";

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
    "Calibration mutations require an authenticated user or at least one provisioned user for admin-key attribution",
  );
}

/**
 * Admin calibration platform routes (Phase 1).
 * Fail closed when ADMIN_CALIBRATION_ENABLED=false (service throws NOT_FOUND).
 * Permission: admin.calibration.manage.
 */
export function buildAdminCalibrationRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new AdminCalibrationService(container);
  const env = container.env;

  return async (app) => {
    await app.register(async (protectedApp) => {
      protectedApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_CALIBRATION_MANAGE, {
          auditAction: "admin.calibration.access",
          allowEmergencyAdminKey: true,
        }),
      );

      protectedApp.get(
        "/api/v1/admin/calibration/cohorts",
        {
          schema: {
            tags: ["admin-calibration"],
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async () => service.listCohorts(),
      );

      protectedApp.post(
        "/api/v1/admin/calibration/cohorts",
        {
          schema: {
            tags: ["admin-calibration"],
            body: { type: "object", additionalProperties: true },
            response: {
              201: { type: "object", additionalProperties: true },
              404: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const userId = await resolveActorUserId(request, container);
          const cohort = await service.createCohort(request.body, userId, auditCtx(request));
          return reply.code(201).send(cohort);
        },
      );

      protectedApp.get(
        "/api/v1/admin/calibration/cohorts/:cohortId",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: { cohortId: { type: "string", format: "uuid" } },
              required: ["cohortId"],
            },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { cohortId } = request.params as { cohortId: string };
          return service.getCohort(cohortId);
        },
      );

      protectedApp.patch(
        "/api/v1/admin/calibration/cohorts/:cohortId",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: { cohortId: { type: "string", format: "uuid" } },
              required: ["cohortId"],
            },
            body: { type: "object", additionalProperties: true },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { cohortId } = request.params as { cohortId: string };
          return service.patchCohort(cohortId, request.body, auditCtx(request));
        },
      );

      protectedApp.post(
        "/api/v1/admin/calibration/cohorts/:cohortId/archive",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: { cohortId: { type: "string", format: "uuid" } },
              required: ["cohortId"],
            },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { cohortId } = request.params as { cohortId: string };
          return service.archiveCohort(cohortId, auditCtx(request));
        },
      );

      protectedApp.post(
        "/api/v1/admin/calibration/cohorts/:cohortId/members",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: { cohortId: { type: "string", format: "uuid" } },
              required: ["cohortId"],
            },
            body: { type: "object", additionalProperties: true },
            response: { 201: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request, reply) => {
          const { cohortId } = request.params as { cohortId: string };
          const member = await service.addMember(cohortId, request.body, auditCtx(request));
          return reply.code(201).send(member);
        },
      );

      protectedApp.post(
        "/api/v1/admin/calibration/cohorts/:cohortId/members/bulk",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: { cohortId: { type: "string", format: "uuid" } },
              required: ["cohortId"],
            },
            body: { type: "object", additionalProperties: true },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { cohortId } = request.params as { cohortId: string };
          return service.bulkMembers(cohortId, request.body, auditCtx(request));
        },
      );

      protectedApp.patch(
        "/api/v1/admin/calibration/cohorts/:cohortId/members/:memberId",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: {
                cohortId: { type: "string", format: "uuid" },
                memberId: { type: "string", format: "uuid" },
              },
              required: ["cohortId", "memberId"],
            },
            body: { type: "object", additionalProperties: true },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { cohortId, memberId } = request.params as { cohortId: string; memberId: string };
          return service.patchMember(cohortId, memberId, request.body, auditCtx(request));
        },
      );

      protectedApp.delete(
        "/api/v1/admin/calibration/cohorts/:cohortId/members/:memberId",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: {
                cohortId: { type: "string", format: "uuid" },
                memberId: { type: "string", format: "uuid" },
              },
              required: ["cohortId", "memberId"],
            },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { cohortId, memberId } = request.params as { cohortId: string; memberId: string };
          return service.deleteMember(cohortId, memberId, auditCtx(request));
        },
      );

      protectedApp.post(
        "/api/v1/admin/calibration/cohorts/:cohortId/preflight",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: { cohortId: { type: "string", format: "uuid" } },
              required: ["cohortId"],
            },
            body: { type: "object", additionalProperties: true },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { cohortId } = request.params as { cohortId: string };
          return service.preflight(cohortId, request.body ?? {});
        },
      );

      protectedApp.post(
        "/api/v1/admin/calibration/cohorts/:cohortId/runs",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: { cohortId: { type: "string", format: "uuid" } },
              required: ["cohortId"],
            },
            body: { type: "object", additionalProperties: true },
            response: { 201: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request, reply) => {
          const { cohortId } = request.params as { cohortId: string };
          const userId = await resolveActorUserId(request, container);
          const run = await service.createRun(cohortId, request.body ?? {}, userId, auditCtx(request));
          return reply.code(201).send(run);
        },
      );

      protectedApp.get(
        "/api/v1/admin/calibration/runs",
        {
          schema: {
            tags: ["admin-calibration"],
            querystring: {
              type: "object",
              properties: { cohortId: { type: "string", format: "uuid" } },
            },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const q = request.query as { cohortId?: string };
          return service.listRuns(q.cohortId);
        },
      );

      protectedApp.get(
        "/api/v1/admin/calibration/runs/:runId",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: { runId: { type: "string", format: "uuid" } },
              required: ["runId"],
            },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { runId } = request.params as { runId: string };
          return service.getRun(runId);
        },
      );

      protectedApp.post(
        "/api/v1/admin/calibration/runs/:runId/cancel",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: { runId: { type: "string", format: "uuid" } },
              required: ["runId"],
            },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { runId } = request.params as { runId: string };
          return service.cancelRun(runId, auditCtx(request));
        },
      );

      protectedApp.get(
        "/api/v1/admin/calibration/runs/:runId/report",
        {
          schema: {
            tags: ["admin-calibration"],
            params: {
              type: "object",
              properties: { runId: { type: "string", format: "uuid" } },
              required: ["runId"],
            },
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { runId } = request.params as { runId: string };
          return service.getReport(runId);
        },
      );
    });
  };
}
