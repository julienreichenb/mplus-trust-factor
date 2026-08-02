import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { ExplainabilityV2Service } from "../services/explainability-v2-service.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { errorResponseSchema } from "./schemas.js";

/**
 * Admin Scoring V2 explainability / diagnostics.
 * Permission: score.candidate.read (report codes allowed).
 * GET-only — no provider calls.
 */
export function buildAdminExplainabilityV2Routes(container: ApiContainer): FastifyPluginAsync {
  const service = new ExplainabilityV2Service(container);
  const env = container.env;

  return async (app) => {
    await app.register(async (protectedApp) => {
      protectedApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.SCORE_CANDIDATE_READ, {
          auditAction: "admin.explainability_v2.access",
          allowEmergencyAdminKey: true,
        }),
      );

      protectedApp.get(
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
          return service.listManifests(q);
        },
      );

      protectedApp.get(
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
          return service.getAdminDiagnostics({
            characterId: params.characterId,
            seasonId: q.seasonId,
            manifestId: q.manifestId,
          });
        },
      );
    });
  };
}
