import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import {
  AbilityCatalogReleaseService,
  type AbilityCatalogReleaseAuditContext,
} from "../services/ability-catalog-release-service.js";
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

export function buildAdminAbilityCatalogReleaseRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new AbilityCatalogReleaseService(container.worker.prisma);
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
            auditAction: "admin.ability_catalog.release.read",
            allowEmergencyAdminKey: true,
          },
        ),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/releases",
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
        async () => service.listReleases(),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/releases/active",
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
          const { AbilityCatalogReleaseActivationService } = await import(
            "../services/ability-catalog-release-activation-service.js"
          );
          const activation = new AbilityCatalogReleaseActivationService(
            container.worker.prisma,
          );
          const active = await activation.getActiveRelease();
          return {
            active,
            limitations: {
              racialReplayCoverage: "INCOMPLETE",
              trustReplay: "TRUST_REPLAY_UNAVAILABLE",
            },
            notice:
              "New analyses always pin the ACTIVE release. Activation affects future jobs immediately — no env change or restart.",
          };
        },
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/releases/activations",
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
          const { AbilityCatalogReleaseActivationService } = await import(
            "../services/ability-catalog-release-activation-service.js"
          );
          return new AbilityCatalogReleaseActivationService(
            container.worker.prisma,
          ).listActivations();
        },
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/releases/:id",
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
        async (request) => service.getRelease((request.params as { id: string }).id),
      );

      readApp.get(
        "/api/v1/admin/ability-catalog/releases/:id/artifact-summary",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            response: {
              200: { type: "object", additionalProperties: true },
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request) => service.getArtifactSummary((request.params as { id: string }).id),
      );
    });

    await app.register(async (manageApp) => {
      manageApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, [PERMISSIONS.ADMIN_ABILITY_CATALOG_MANAGE], {
          match: "any",
          auditAction: "admin.ability_catalog.release.manage",
          allowEmergencyAdminKey: true,
        }),
      );

      manageApp.post(
        "/api/v1/admin/ability-catalog/releases/candidates",
        {
          schema: {
            tags: ["admin"],
            body: {
              type: "object",
              required: ["baseReleaseId"],
              additionalProperties: false,
              properties: {
                baseReleaseId: { type: "string", format: "uuid" },
                includedDraftRuleIds: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["draftRuleId", "draftVersion"],
                    properties: {
                      draftRuleId: { type: "string", format: "uuid" },
                      draftVersion: { type: "integer" },
                    },
                  },
                },
                includedDraftTopologyIds: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["draftTopologyId", "draftVersion"],
                    properties: {
                      draftTopologyId: { type: "string", format: "uuid" },
                      draftVersion: { type: "integer" },
                    },
                  },
                },
                includedRemovalItemIds: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["reviewItemId", "validToBuild"],
                    properties: {
                      reviewItemId: { type: "string", format: "uuid" },
                      validToBuild: { type: "string" },
                      draftVersion: { type: "integer" },
                      decisionEventId: { type: "string", format: "uuid" },
                    },
                  },
                },
                wowBuild: { type: "string" },
                notes: { type: "string" },
              },
            },
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
          const body = request.body as {
            baseReleaseId: string;
            includedDraftRuleIds?: Array<{ draftRuleId: string; draftVersion: number }>;
            includedDraftTopologyIds?: Array<{ draftTopologyId: string; draftVersion: number }>;
            includedRemovalItemIds?: Array<{
              reviewItemId: string;
              validToBuild: string;
              draftVersion?: number;
              decisionEventId?: string;
            }>;
            wowBuild?: string;
            notes?: string;
          };
          const result = await service.createReleaseCandidate(body, auditCtx(request, env.SESSION_SECRET));
          return result;
        },
      );

      manageApp.post(
        "/api/v1/admin/ability-catalog/releases/:id/validate",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
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
          const id = (request.params as { id: string }).id;
          const result = await service.revalidateRelease(id, auditCtx(request, env.SESSION_SECRET));
          return {
            release: result.release,
            validation: result.validation,
            validatorVersion: result.validatorVersion,
          };
        },
      );

      manageApp.post(
        "/api/v1/admin/ability-catalog/releases/:id/test-run",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: {
              type: "object",
              additionalProperties: false,
              properties: {
                characterId: { type: "string", format: "uuid" },
                region: { type: "string" },
                realmSlug: { type: "string" },
                name: { type: "string" },
                forceRefresh: { type: "boolean" },
              },
            },
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
          const id = (request.params as { id: string }).id;
          const body = (request.body ?? {}) as {
            characterId?: string;
            region?: string;
            realmSlug?: string;
            name?: string;
            forceRefresh?: boolean;
          };
          const { AbilityCatalogReleaseTestRunService } = await import(
            "../services/ability-catalog-release-test-run.js"
          );
          const testRun = new AbilityCatalogReleaseTestRunService(container);
          return testRun.enqueueExplicitReleaseRefresh(
            { releaseId: id, ...body },
            auditCtx(request, env.SESSION_SECRET),
          );
        },
      );
    });

    await app.register(async (publishApp) => {
      publishApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, [PERMISSIONS.ADMIN_ABILITY_CATALOG_PUBLISH], {
          match: "any",
          auditAction: "admin.ability_catalog.release.publish_attempt",
          allowEmergencyAdminKey: true,
        }),
      );

      const activateBodySchema = {
        type: "object",
        additionalProperties: false,
        required: ["confirmationDigest", "confirm"],
        properties: {
          confirmationDigest: { type: "string", minLength: 64, maxLength: 64 },
          confirm: { type: "boolean", const: true },
          reason: { type: "string" },
          notes: { type: "string" },
          expectedPreviousActiveId: {
            anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
          },
        },
      } as const;

      publishApp.post(
        "/api/v1/admin/ability-catalog/releases/:id/activate",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: activateBodySchema,
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
          const id = (request.params as { id: string }).id;
          const body = request.body as {
            confirmationDigest: string;
            confirm: true;
            reason?: string;
            notes?: string;
            expectedPreviousActiveId?: string | null;
          };
          const { AbilityCatalogReleaseActivationService } = await import(
            "../services/ability-catalog-release-activation-service.js"
          );
          return new AbilityCatalogReleaseActivationService(
            container.worker.prisma,
          ).activate({ releaseId: id, ...body }, auditCtx(request, env.SESSION_SECRET), {
            type: "PUBLISH",
          });
        },
      );

      publishApp.post(
        "/api/v1/admin/ability-catalog/releases/:id/rollback",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: {
              ...activateBodySchema,
              required: ["confirmationDigest", "confirm", "reason"],
            },
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
          const id = (request.params as { id: string }).id;
          const body = request.body as {
            confirmationDigest: string;
            confirm: true;
            reason: string;
            notes?: string;
            expectedPreviousActiveId?: string | null;
          };
          const { AbilityCatalogReleaseActivationService } = await import(
            "../services/ability-catalog-release-activation-service.js"
          );
          return new AbilityCatalogReleaseActivationService(
            container.worker.prisma,
          ).activate({ releaseId: id, ...body }, auditCtx(request, env.SESSION_SECRET), {
            type: "ROLLBACK",
          });
        },
      );
    });
  };
}
