import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { AdminRefreshJobsService } from "../services/admin-refresh-jobs-service.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { errorResponseSchema } from "./schemas.js";

const jobRowSchema = {
  type: "object",
  additionalProperties: true,
} as const;

/**
 * Admin refresh-job control center routes.
 * Permission: admin.jobs.manage (emergency admin key allowed).
 */
export function buildAdminRefreshJobRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new AdminRefreshJobsService(container);
  const env = container.env;

  return async (app) => {
    await app.register(async (protectedApp) => {
      protectedApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_JOBS_MANAGE, {
          auditAction: "admin.refresh_jobs.access",
          allowEmergencyAdminKey: true,
        }),
      );

      protectedApp.get(
        "/api/v1/admin/refresh-jobs",
        {
          schema: {
            tags: ["admin"],
            querystring: {
              type: "object",
              properties: {
                status: { type: "string" },
                region: { type: "string" },
                characterName: { type: "string" },
                realmSlug: { type: "string" },
                characterId: { type: "string" },
                triggerSource: { type: "string" },
                fromBulk: { type: "string", enum: ["true", "false"] },
                showHistoricalFailures: { type: "string", enum: ["true", "false"] },
                page: { type: "integer", minimum: 1 },
                pageSize: { type: "integer", minimum: 1, maximum: 100 },
              },
            },
            response: {
              200: {
                type: "object",
                properties: {
                  jobs: { type: "array", items: jobRowSchema },
                  total: { type: "integer" },
                  page: { type: "integer" },
                  pageSize: { type: "integer" },
                },
              },
            },
          },
        },
        async (request) => {
          const q = request.query as Record<string, string | undefined>;
          return service.list({
            status: q.status ?? null,
            region: q.region ?? null,
            characterName: q.characterName ?? null,
            realmSlug: q.realmSlug ?? null,
            characterId: q.characterId ?? null,
            triggerSource: q.triggerSource ?? null,
            fromBulk: q.fromBulk === "true" ? true : q.fromBulk === "false" ? false : null,
            showHistoricalFailures: q.showHistoricalFailures === "true",
            page: q.page ? Number(q.page) : 1,
            pageSize: q.pageSize ? Number(q.pageSize) : 25,
          });
        },
      );

      protectedApp.get(
        "/api/v1/admin/refresh-jobs/count",
        {
          schema: {
            tags: ["admin"],
            response: {
              200: {
                type: "object",
                properties: { count: { type: "integer" } },
                required: ["count"],
              },
            },
          },
        },
        async () => service.countInFlight(),
      );

      protectedApp.get(
        "/api/v1/admin/refresh-jobs/characters/search",
        {
          schema: {
            tags: ["admin"],
            querystring: {
              type: "object",
              properties: {
                region: { type: "string" },
                nickname: { type: "string" },
                realm: { type: "string" },
                limit: { type: "integer", minimum: 1, maximum: 50 },
              },
              required: ["nickname"],
            },
            response: {
              200: {
                type: "object",
                properties: {
                  characters: { type: "array", items: { type: "object", additionalProperties: true } },
                },
              },
              400: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const q = request.query as {
            region?: string;
            nickname: string;
            realm?: string;
            limit?: number;
          };
          return service.searchCharacters(q);
        },
      );

      protectedApp.post(
        "/api/v1/admin/refresh-jobs/:id/cancel",
        {
          schema: {
            tags: ["admin"],
            params: {
              type: "object",
              properties: { id: { type: "string", minLength: 1 } },
              required: ["id"],
            },
            response: {
              200: { type: "object", additionalProperties: true },
              404: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.cancel(id, {
            userId: request.auth?.user.id,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
          });
        },
      );

      protectedApp.post(
        "/api/v1/admin/refresh-jobs/:id/prioritize",
        {
          schema: {
            tags: ["admin"],
            params: {
              type: "object",
              properties: { id: { type: "string", minLength: 1 } },
              required: ["id"],
            },
            response: {
              200: { type: "object", additionalProperties: true },
              404: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.prioritize(id, {
            userId: request.auth?.user.id,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
          });
        },
      );

      protectedApp.post(
        "/api/v1/admin/refresh-jobs/:id/rerun",
        {
          schema: {
            tags: ["admin"],
            params: {
              type: "object",
              properties: { id: { type: "string", minLength: 1 } },
              required: ["id"],
            },
            response: {
              200: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.rerun(id, {
            userId: request.auth?.user.id,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
          });
        },
      );

      protectedApp.post(
        "/api/v1/admin/refresh-jobs/kill-all",
        {
          config: {
            rateLimit: {
              max: 5,
              timeWindow: "1 minute",
            },
          },
          schema: {
            tags: ["admin"],
            body: {
              type: "object",
              properties: {
                confirm: { type: "boolean" },
              },
              required: ["confirm"],
            },
            response: {
              200: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const body = request.body as { confirm: boolean };
          return service.killAll(
            {
              userId: request.auth?.user.id,
              actorType: request.authActor === "admin_key" ? "admin_key" : "user",
              ip: request.ip,
              userAgent: request.headers["user-agent"],
            },
            body.confirm,
          );
        },
      );
    });
  };
}
