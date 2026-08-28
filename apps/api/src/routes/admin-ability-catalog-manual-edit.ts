import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { AbilityCatalogManualEditService } from "../services/ability-catalog-manual-edit-service.js";
import type { ManualCatalogEditAuditContext } from "../services/ability-catalog-manual-edit-service.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { errorResponseSchema } from "./schemas.js";

function auditCtx(
  request: {
    auth?: { user?: { id?: string } } | null;
    authActor?: string;
    ip?: string;
    headers: Record<string, unknown>;
  },
  sessionSecret: string,
): ManualCatalogEditAuditContext {
  return {
    userId: request.auth?.user?.id ?? null,
    actorType: request.authActor === "admin_key" ? "admin_key" : "user",
    ip: request.ip ?? null,
    userAgent:
      typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
    sessionSecret,
  };
}

const canonicalKeyParamsSchema = {
  type: "object",
  required: ["canonicalKey"],
  properties: {
    canonicalKey: { type: "string", minLength: 1, maxLength: 200 },
  },
};

export function buildAdminAbilityCatalogManualEditRoutes(
  container: ApiContainer,
): FastifyPluginAsync {
  const env = container.env;
  const service = new AbilityCatalogManualEditService(container.worker.prisma);

  return async (app) => {
    await app.register(async (readApp) => {
      readApp.addHook(
        "preHandler",
        createPermissionPreHandler(
          env,
          [PERMISSIONS.ADMIN_ABILITY_CATALOG_READ, PERMISSIONS.ADMIN_ABILITY_CATALOG_MANAGE],
          {
            match: "any",
            auditAction: "admin.ability_catalog.manual_edit.read",
            allowEmergencyAdminKey: true,
          },
        ),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/manual-edits",
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
        async () => service.listPendingEdits(),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/rules/:canonicalKey/manual-edit",
        {
          schema: {
            tags: ["admin"],
            params: canonicalKeyParamsSchema,
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { canonicalKey } = request.params as { canonicalKey: string };
          return service.getEdit(canonicalKey);
        },
      );
    });

    await app.register(async (manageApp) => {
      manageApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, [PERMISSIONS.ADMIN_ABILITY_CATALOG_MANAGE], {
          match: "any",
          auditAction: "admin.ability_catalog.manual_edit.manage",
          allowEmergencyAdminKey: true,
        }),
      );

      manageApp.put(
        "/api/v1/admin/ability-catalog/rules/:canonicalKey/manual-edit",
        {
          schema: {
            tags: ["admin"],
            params: canonicalKeyParamsSchema,
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
        async (request) => {
          const { canonicalKey } = request.params as { canonicalKey: string };
          return service.saveEdit(
            canonicalKey,
            request.body,
            auditCtx(request, env.SESSION_SECRET),
          );
        },
      );

      manageApp.delete(
        "/api/v1/admin/ability-catalog/rules/:canonicalKey/manual-edit",
        {
          schema: {
            tags: ["admin"],
            params: canonicalKeyParamsSchema,
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { canonicalKey } = request.params as { canonicalKey: string };
          return service.discardEdit(canonicalKey, auditCtx(request, env.SESSION_SECRET));
        },
      );
    });
  };
}
