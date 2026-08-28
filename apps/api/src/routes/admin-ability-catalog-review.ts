import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import {
  AbilityCatalogReviewService,
  type AbilityCatalogReviewAuditContext,
} from "../services/ability-catalog-review-service.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { errorResponseSchema } from "./schemas.js";

const idParamsSchema = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" } },
  required: ["id"],
} as const;

function auditCtx(
  request: {
    auth?: { user?: { id?: string } } | null;
    authActor?: string;
    ip?: string;
    headers: Record<string, unknown>;
  },
  sessionSecret: string,
): AbilityCatalogReviewAuditContext {
  return {
    userId: request.auth?.user?.id ?? null,
    actorType: request.authActor === "admin_key" ? "admin_key" : "user",
    ip: request.ip ?? null,
    userAgent:
      typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
    sessionSecret,
  };
}

export function buildAdminAbilityCatalogReviewRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new AbilityCatalogReviewService(container.worker.prisma);
  const env = container.env;

  return async (app) => {
    await app.register(async (readApp) => {
      readApp.addHook(
        "preHandler",
        createPermissionPreHandler(
          env,
          [PERMISSIONS.ADMIN_ABILITY_CATALOG_READ, PERMISSIONS.ADMIN_ABILITY_CATALOG_MANAGE],
          {
            match: "any",
            auditAction: "admin.ability_catalog.review.read",
            allowEmergencyAdminKey: true,
          },
        ),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/review/batches",
        {
          schema: {
            tags: ["admin"],
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async () => service.listBatches(),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/review/batches/:id",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request) => service.getBatch((request.params as { id: string }).id),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/review/batches/:id/items",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            querystring: {
              type: "object",
              properties: {
                kind: { type: "string" },
                classSlug: { type: "string" },
                specSlug: { type: "string" },
                raceSlug: { type: "string" },
                category: { type: "string" },
                draftStatus: {
                  type: "string",
                  enum: ["NEEDS_METADATA", "READY_FOR_PUBLISH_REVIEW"],
                },
                decisionState: {
                  type: "string",
                  enum: ["pending", "decided", "accepted", "rejected", "deferred"],
                },
                eligibilityState: { type: "string" },
                spellId: { type: "integer" },
                search: { type: "string" },
                page: { type: "integer", minimum: 1 },
                pageSize: { type: "integer", minimum: 1, maximum: 200 },
              },
            },
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const params = request.params as { id: string };
          const q = request.query as Record<string, string | number | undefined>;
          return service.listItems(params.id, {
            kind: typeof q.kind === "string" ? q.kind : null,
            classSlug: typeof q.classSlug === "string" ? q.classSlug : null,
            specSlug: typeof q.specSlug === "string" ? q.specSlug : null,
            raceSlug: typeof q.raceSlug === "string" ? q.raceSlug : null,
            category: typeof q.category === "string" ? q.category : null,
            draftStatus:
              typeof q.draftStatus === "string"
                ? (q.draftStatus as "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW")
                : null,
            decisionState:
              typeof q.decisionState === "string"
                ? (q.decisionState as
                    | "pending"
                    | "decided"
                    | "accepted"
                    | "rejected"
                    | "deferred")
                : null,
            eligibilityState: typeof q.eligibilityState === "string" ? q.eligibilityState : null,
            spellId:
              typeof q.spellId === "number"
                ? q.spellId
                : q.spellId != null
                  ? Number(q.spellId)
                  : null,
            search: typeof q.search === "string" ? q.search : null,
            page: typeof q.page === "number" ? q.page : q.page != null ? Number(q.page) : 1,
            pageSize:
              typeof q.pageSize === "number"
                ? q.pageSize
                : q.pageSize != null
                  ? Number(q.pageSize)
                  : 100,
          });
        },
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/review/items/:id",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request) => service.getItem((request.params as { id: string }).id),
      );

      readApp.post(
        "/api/v1/admin/ability-catalog/review/items/:id/draft/validate",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: { type: "object", additionalProperties: true },
            response: {
              200: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request) =>
          service.validateDraft((request.params as { id: string }).id, request.body ?? {}),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/baselines/active",
        {
          schema: {
            tags: ["admin"],
            querystring: {
              type: "object",
              properties: {
                source: { type: "string", enum: ["SIMULATIONCRAFT", "BLIZZARD"] },
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
          const q = request.query as { source?: string };
          const baseline = await service.getActiveBaseline(q.source ?? "SIMULATIONCRAFT");
          return { baseline };
        },
      );
      readApp.get(
        "/api/v1/admin/ability-catalog/exclusions",
        {
          schema: {
            tags: ["admin"],
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async () => {
          const exclusions = await service.listExclusions();
          return { exclusions };
        },
      );
    });

    await app.register(async (writeApp) => {
      writeApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_ABILITY_CATALOG_MANAGE, {
          auditAction: "admin.ability_catalog.review.manage",
          allowEmergencyAdminKey: true,
        }),
      );

      writeApp.post(
        "/api/v1/admin/ability-catalog/review/items/:id/draft/ensure",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: { type: "object", additionalProperties: true },
            response: {
              200: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request) =>
          service.ensureDraft(
            (request.params as { id: string }).id,
            request.body ?? {},
            auditCtx(request, env.SESSION_SECRET),
          ),
      );

      writeApp.post(
        "/api/v1/admin/ability-catalog/review/items/:id/decide",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: { type: "object", additionalProperties: true },
            response: {
              200: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request) =>
          service.decideItem(
            (request.params as { id: string }).id,
            request.body,
            auditCtx(request, env.SESSION_SECRET),
          ),
      );

      writeApp.patch(
        "/api/v1/admin/ability-catalog/review/items/:id/draft",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: { type: "object", additionalProperties: true },
            response: {
              200: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request) =>
          service.updateDraft(
            (request.params as { id: string }).id,
            request.body,
            auditCtx(request, env.SESSION_SECRET),
          ),
      );

      writeApp.post(
        "/api/v1/admin/ability-catalog/exclusions",
        {
          schema: {
            tags: ["admin"],
            body: { type: "object", additionalProperties: true },
            response: {
              201: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const created = await service.createExclusion(
            request.body,
            auditCtx(request, env.SESSION_SECRET),
          );
          return reply.code(201).send(created);
        },
      );

      writeApp.delete(
        "/api/v1/admin/ability-catalog/exclusions",
        {
          schema: {
            tags: ["admin"],
            body: { type: "object", additionalProperties: true },
            response: {
              200: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) =>
          service.clearExclusion(request.body, auditCtx(request, env.SESSION_SECRET)),
      );

      writeApp.post(
        "/api/v1/admin/ability-catalog/baselines",
        {
          schema: {
            tags: ["admin"],
            body: { type: "object", additionalProperties: true },
            response: {
              201: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const created = await service.designateBaseline(
            request.body,
            auditCtx(request, env.SESSION_SECRET),
          );
          return reply.code(201).send(created);
        },
      );
    });
  };
}
