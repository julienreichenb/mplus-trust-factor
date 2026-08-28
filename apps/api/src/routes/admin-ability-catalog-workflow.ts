import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { AbilityCatalogWorkflowService } from "../services/ability-catalog-workflow-service.js";
import {
  AbilityCatalogRefreshOrchestrationService,
} from "../services/ability-catalog-refresh-orchestration-service.js";
import type { AbilityCatalogReviewAuditContext } from "../services/ability-catalog-review-service.js";
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

export function buildAdminAbilityCatalogWorkflowRoutes(container: ApiContainer): FastifyPluginAsync {
  const env = container.env;
  const workflow = new AbilityCatalogWorkflowService(container.worker.prisma);

  return async (app) => {
    await app.register(async (readApp) => {
      readApp.addHook(
        "preHandler",
        createPermissionPreHandler(
          env,
          [PERMISSIONS.ADMIN_ABILITY_CATALOG_READ, PERMISSIONS.ADMIN_ABILITY_CATALOG_MANAGE],
          {
            match: "any",
            auditAction: "admin.ability_catalog.workflow.read",
            allowEmergencyAdminKey: true,
          },
        ),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/workflow",
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
        async () => workflow.getStatus(false),
      );
    });

    await app.register(async (manageApp) => {
      manageApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, [PERMISSIONS.ADMIN_ABILITY_CATALOG_MANAGE], {
          match: "any",
          auditAction: "admin.ability_catalog.refresh",
          allowEmergencyAdminKey: true,
        }),
      );

      manageApp.post(
        "/api/v1/admin/ability-catalog/refresh",
        {
          schema: {
            tags: ["admin"],
            response: {
              200: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const refresh = new AbilityCatalogRefreshOrchestrationService(
            container.worker.prisma,
            env,
          );
          const result = await refresh.runRefresh(auditCtx(request, env.SESSION_SECRET));
          const status = await workflow.getStatus(false);
          return {
            ...result,
            workflow: status,
            notice:
              "Refresh imported review batch. ACTIVE release unchanged until explicit activation.",
          };
        },
      );
    });
  };
}
