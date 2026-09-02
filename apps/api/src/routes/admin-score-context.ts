import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { HttpError } from "../errors.js";
import { errorResponseSchema } from "./schemas.js";
import { AdminScoreContextService } from "../services/admin-score-context-service.js";

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

const uuidParams = {
  type: "object",
  required: ["seasonId"],
  properties: { seasonId: { type: "string", format: "uuid" } },
} as const;

const revisionParams = {
  type: "object",
  required: ["revisionId"],
  properties: { revisionId: { type: "string", format: "uuid" } },
} as const;

/**
 * Season key+meta context admin API.
 * Reads: score.candidate.read. Mutations: admin.scoring.manage.
 * Never calls scoring providers.
 */
export function buildAdminScoreContextRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new AdminScoreContextService(container);
  return async (app) => {
    app.addHook(
      "preHandler",
      createPermissionPreHandler(container.env, PERMISSIONS.SCORE_CANDIDATE_READ, {
        allowEmergencyAdminKey: true,
        auditAction: "admin.score_context.access",
      }),
    );

    app.get(
      "/api/v1/admin/score-context/specializations",
      {
        schema: {
          tags: ["admin"],
          summary: "Canonical class/spec matrix for meta assignment",
        },
      },
      async () => service.canonicalSpecializations(),
    );

    app.get(
      "/api/v1/admin/seasons/:seasonId/score-context",
      {
        schema: {
          tags: ["admin"],
          params: uuidParams,
          response: { 404: errorResponseSchema },
        },
      },
      async (request) => {
        const { seasonId } = request.params as { seasonId: string };
        return service.getSeasonState(seasonId);
      },
    );

    app.post(
      "/api/v1/admin/seasons/:seasonId/score-context/draft",
      {
        preHandler: createPermissionPreHandler(container.env, PERMISSIONS.ADMIN_SCORING_MANAGE, {
          allowEmergencyAdminKey: true,
          auditAction: "admin.scoring.manage",
        }),
        schema: { tags: ["admin"], params: uuidParams },
      },
      async (request) => {
        const { seasonId } = request.params as { seasonId: string };
        return service.createOrGetDraft(seasonId, auditCtx(request), request.auth?.user?.id ?? null);
      },
    );

    app.patch(
      "/api/v1/admin/score-context/revisions/:revisionId",
      {
        preHandler: createPermissionPreHandler(container.env, PERMISSIONS.ADMIN_SCORING_MANAGE, {
          allowEmergencyAdminKey: true,
          auditAction: "admin.scoring.manage",
        }),
        schema: { tags: ["admin"], params: revisionParams },
      },
      async (request) => {
        const { revisionId } = request.params as { revisionId: string };
        return service.updateDraft(revisionId, request.body as Record<string, unknown>, auditCtx(request));
      },
    );

    /**
     * Developer-only immutable snapshot ingest. Not part of the normal admin UX.
     * Do not treat Raider.IO Mythic+ *score* cutoffs as median-key thresholds.
     */
    app.post(
      "/api/v1/admin/seasons/:seasonId/score-context/distributions",
      {
        preHandler: createPermissionPreHandler(container.env, PERMISSIONS.ADMIN_SCORING_MANAGE, {
          allowEmergencyAdminKey: true,
          auditAction: "admin.scoring.manage",
        }),
        schema: { tags: ["admin"], params: uuidParams },
      },
      async (request) => {
        const { seasonId } = request.params as { seasonId: string };
        const body = request.body as {
          source?: string;
          provenance?: Record<string, unknown>;
          sourceVersion?: string | null;
          collectedAt?: string;
          effectiveAt?: string | null;
          points?: unknown;
        };
        if (!body.source || !body.collectedAt) {
          throw HttpError.badRequest("INVALID_DISTRIBUTION_IMPORT", "source and collectedAt are required");
        }
        return service.importDistribution(
          {
            seasonId,
            source: body.source,
            provenance: body.provenance,
            sourceVersion: body.sourceVersion,
            collectedAt: body.collectedAt,
            effectiveAt: body.effectiveAt,
            points: body.points,
          },
          auditCtx(request),
        );
      },
    );

    app.post(
      "/api/v1/admin/seasons/:seasonId/score-context/key-distribution/refresh",
      {
        preHandler: createPermissionPreHandler(container.env, PERMISSIONS.ADMIN_SCORING_MANAGE, {
          allowEmergencyAdminKey: true,
          auditAction: "admin.scoring.manage",
        }),
        schema: { tags: ["admin"], params: uuidParams },
      },
      async (request) => {
        const { seasonId } = request.params as { seasonId: string };
        return service.enqueueKeyDistributionRefresh(seasonId, auditCtx(request), request.auth?.user?.id ?? null);
      },
    );

    app.get(
      "/api/v1/admin/seasons/:seasonId/score-context/key-distribution/status",
      {
        schema: { tags: ["admin"], params: uuidParams },
      },
      async (request) => {
        const { seasonId } = request.params as { seasonId: string };
        return service.getKeyDistributionStatus(seasonId);
      },
    );

    app.post(
      "/api/v1/admin/score-context/revisions/:revisionId/use-latest-distribution",
      {
        preHandler: createPermissionPreHandler(container.env, PERMISSIONS.ADMIN_SCORING_MANAGE, {
          allowEmergencyAdminKey: true,
          auditAction: "admin.scoring.manage",
        }),
        schema: { tags: ["admin"], params: revisionParams },
      },
      async (request) => {
        const { revisionId } = request.params as { revisionId: string };
        return service.useLatestDistribution(revisionId, auditCtx(request));
      },
    );

    app.post(
      "/api/v1/admin/score-context/revisions/:revisionId/publish",
      {
        preHandler: createPermissionPreHandler(container.env, PERMISSIONS.ADMIN_SCORING_MANAGE, {
          allowEmergencyAdminKey: true,
          auditAction: "admin.scoring.manage",
        }),
        schema: { tags: ["admin"], params: revisionParams },
      },
      async (request) => {
        const { revisionId } = request.params as { revisionId: string };
        return service.publish(revisionId, auditCtx(request), request.auth?.user?.id ?? null);
      },
    );

  };
}
