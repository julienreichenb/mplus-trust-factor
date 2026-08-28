import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import {
  AbilityCatalogReplayService,
} from "../services/ability-catalog-replay-service.js";
import type { AbilityCatalogReleaseAuditContext } from "../services/ability-catalog-release-service.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { errorResponseSchema } from "./schemas.js";

const idParamsSchema = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" } },
  required: ["id"],
} as const;

const candidateParamsSchema = {
  type: "object",
  properties: { candidateId: { type: "string", format: "uuid" } },
  required: ["candidateId"],
} as const;

function auditCtx(
  request: {
    auth?: { user?: { id?: string } } | null;
    authActor?: string;
    ip?: string;
    headers: Record<string, unknown>;
  },
  sessionSecret: string,
): AbilityCatalogReleaseAuditContext {
  return {
    userId: request.auth?.user?.id ?? null,
    actorType: request.authActor === "admin_key" ? "admin_key" : "user",
    ip: request.ip ?? null,
    userAgent:
      typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
    sessionSecret,
  };
}

export function buildAdminAbilityCatalogReplayRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new AbilityCatalogReplayService(container.worker.prisma);
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
            auditAction: "admin.ability_catalog.release.replay.read",
            allowEmergencyAdminKey: true,
          },
        ),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/releases/:candidateId/replays",
        {
          schema: {
            tags: ["admin"],
            params: candidateParamsSchema,
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) =>
          service.listReplaysForCandidate(
            (request.params as { candidateId: string }).candidateId,
          ),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/releases/:candidateId/replay-gate",
        {
          schema: {
            tags: ["admin"],
            params: candidateParamsSchema,
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) =>
          service.latestReplayGate((request.params as { candidateId: string }).candidateId),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/replays/:id",
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
        async (request) => service.getReplay((request.params as { id: string }).id),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/replays/:id/report-summary",
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
        async (request) =>
          service.getReplayReportSummary((request.params as { id: string }).id),
      );
    });

    await app.register(async (writeApp) => {
      writeApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, [PERMISSIONS.ADMIN_ABILITY_CATALOG_MANAGE], {
          match: "all",
          auditAction: "admin.ability_catalog.release.replay.manage",
          allowEmergencyAdminKey: true,
        }),
      );

      writeApp.post(
        "/api/v1/admin/ability-catalog/releases/:candidateId/replay",
        {
          schema: {
            tags: ["admin"],
            params: candidateParamsSchema,
            body: {
              type: "object",
              additionalProperties: false,
              properties: {
                baseReleaseId: { type: "string", format: "uuid" },
                baseKind: { type: "string", enum: ["STATIC", "RELEASE"] },
                maxPerSpec: { type: "integer", minimum: 1, maximum: 50 },
                maxTotal: { type: "integer", minimum: 1, maximum: 500 },
                force: { type: "boolean" },
                expectZeroImpact: { type: "boolean" },
              },
            },
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
          const candidateId = (request.params as { candidateId: string }).candidateId;
          const body = (request.body ?? {}) as {
            baseReleaseId?: string;
            baseKind?: "STATIC" | "RELEASE";
            maxPerSpec?: number;
            maxTotal?: number;
            force?: boolean;
            expectZeroImpact?: boolean;
          };
          const result = await service.runReplay(
            {
              candidateReleaseId: candidateId,
              baseReleaseId: body.baseReleaseId,
              baseKind: body.baseKind,
              maxPerSpec: body.maxPerSpec,
              maxTotal: body.maxTotal,
              force: body.force,
              expectZeroImpact: body.expectZeroImpact,
            },
            auditCtx(request, env.SESSION_SECRET),
          );
          return {
            notice: "THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.",
            reused: result.reused,
            replay: result.replay,
            reportSummary: result.report.summary,
            timing: result.report.timing,
            status: result.report.status,
          };
        },
      );
    });
  };
}
