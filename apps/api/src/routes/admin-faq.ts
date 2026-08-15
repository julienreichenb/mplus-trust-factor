import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { FaqService, type FaqAuditContext } from "../services/faq-service.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { errorResponseSchema } from "./schemas.js";

const idParamsSchema = {
  type: "object",
  properties: { id: { type: "string", minLength: 1 } },
  required: ["id"],
} as const;

const adminFaqEntrySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    position: { type: "integer" },
    isPublished: { type: "boolean" },
    embedType: {
      type: ["string", "null"],
      enum: [
        "META_TIER_TABLE",
        "KEY_PERCENTILE_TABLE",
        "SCORE_FLOW",
        "SCORING_DIMENSIONS",
        "TRUST_GRADE_LADDER",
        null,
      ],
    },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
  required: [
    "id",
    "title",
    "description",
    "position",
    "isPublished",
    "embedType",
    "createdAt",
    "updatedAt",
  ],
} as const;

function auditCtx(
  request: {
    auth?: { user?: { id?: string } } | null;
    authActor?: string;
    ip?: string;
    headers: Record<string, unknown>;
  },
  sessionSecret: string,
): FaqAuditContext {
  return {
    userId: request.auth?.user?.id ?? null,
    actorType: request.authActor === "admin_key" ? "admin_key" : "user",
    ip: request.ip ?? null,
    userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
    sessionSecret,
  };
}

export function buildAdminFaqRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new FaqService(container.worker.prisma);
  const env = container.env;

  return async (app) => {
    await app.register(async (protectedApp) => {
      protectedApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_SETTINGS_MANAGE, {
          auditAction: "admin.faq.access",
          allowEmergencyAdminKey: true,
        }),
      );

      protectedApp.get(
        "/api/v1/admin/faq",
        {
          schema: {
            tags: ["admin"],
            response: {
              200: {
                type: "object",
                additionalProperties: false,
                properties: {
                  entries: { type: "array", items: adminFaqEntrySchema },
                },
                required: ["entries"],
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async () => service.listAll(),
      );

      protectedApp.post(
        "/api/v1/admin/faq",
        {
          schema: {
            tags: ["admin"],
            body: { type: "object", additionalProperties: true },
            response: {
              201: adminFaqEntrySchema,
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const created = await service.create(request.body, auditCtx(request, env.SESSION_SECRET));
          return reply.code(201).send(created);
        },
      );

      protectedApp.patch(
        "/api/v1/admin/faq/:id",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: { type: "object", additionalProperties: true },
            response: {
              200: adminFaqEntrySchema,
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.update(id, request.body, auditCtx(request, env.SESSION_SECRET));
        },
      );

      protectedApp.post(
        "/api/v1/admin/faq/:id/move",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: {
              type: "object",
              additionalProperties: false,
              properties: { direction: { type: "string", enum: ["up", "down"] } },
              required: ["direction"],
            },
            response: {
              200: adminFaqEntrySchema,
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.move(id, request.body, auditCtx(request, env.SESSION_SECRET));
        },
      );

      protectedApp.delete(
        "/api/v1/admin/faq/:id",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            response: {
              200: {
                type: "object",
                additionalProperties: false,
                properties: { id: { type: "string" } },
                required: ["id"],
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.delete(id, auditCtx(request, env.SESSION_SECRET));
        },
      );
    });
  };
}
