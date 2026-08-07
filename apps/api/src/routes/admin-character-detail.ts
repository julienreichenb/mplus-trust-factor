import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { AdminCharacterDetailService } from "../services/admin-character-detail-service.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { errorResponseSchema } from "./schemas.js";

/**
 * Admin character inspection — digests, WCL raw metadata, score history.
 * Reachable from Admin Users → Characters. Permission: users.read OR jobs.manage OR score candidate read.
 */
export function buildAdminCharacterDetailRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new AdminCharacterDetailService(container);
  const env = container.env;

  return async (app) => {
    await app.register(async (protectedApp) => {
      protectedApp.addHook(
        "preHandler",
        createPermissionPreHandler(
          env,
          [
            PERMISSIONS.ADMIN_USERS_READ,
            PERMISSIONS.ADMIN_JOBS_MANAGE,
            PERMISSIONS.SCORE_CANDIDATE_READ,
          ],
          {
            match: "any",
            auditAction: "admin.character_detail.access",
            allowEmergencyAdminKey: true,
          },
        ),
      );

      protectedApp.get(
        "/api/v1/admin/characters/:id",
        {
          schema: {
            tags: ["admin"],
            params: {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string", format: "uuid" } },
            },
            response: {
              200: { type: "object", additionalProperties: true },
              404: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.getDetail(id);
        },
      );

      protectedApp.get(
        "/api/v1/admin/characters/:id/wcl-raw/:rawRunId",
        {
          schema: {
            tags: ["admin"],
            params: {
              type: "object",
              required: ["id", "rawRunId"],
              properties: {
                id: { type: "string", format: "uuid" },
                rawRunId: { type: "string", format: "uuid" },
              },
            },
            response: {
              200: { type: "object", additionalProperties: true },
              404: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id, rawRunId } = request.params as { id: string; rawRunId: string };
          return service.getRawPayload(id, rawRunId);
        },
      );
    });
  };
}
