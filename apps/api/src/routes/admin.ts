import type { FastifyPluginAsync } from "fastify";
import { queryAdminAbilityCatalog } from "@mplus/abilities";
import type { ApiContainer } from "../container.js";
import type { BulkCharacterProcessingInput, ScoreModelConfig } from "@mplus/contracts";
import { AdminService, type CreateScoreModelInput, type MechanicRuleInput } from "../services/admin-service.js";
import { AdminUsersService } from "../services/admin-users-service.js";
import { AdminMiscService } from "../services/admin-misc-service.js";
import { AdminRelevantRefreshService } from "../services/admin-relevant-refresh-service.js";
import { BulkCharacterProcessingService } from "../services/bulk-character-processing-service.js";
import { adminRealmSyncResponseSchema, adminScoreModelSchema, errorResponseSchema, jobStatusSchema, mechanicRuleSchema, scoreModelConfigSchema } from "./schemas.js";
import { createPermissionPreHandler } from "../iam/session.js";
import { PERMISSIONS } from "../iam/permissions.js";
import { writeAuditEvent } from "../iam/audit.js";
import { HttpError } from "../errors.js";

const backtestResponseSchema = {
  type: "object",
  properties: {
    scoreModelId: { type: "string" },
    sampleSize: { type: "number" },
    gradeDistribution: { type: "object", additionalProperties: true },
    meanScore: { type: "number" },
    generatedAt: { type: "string" },
    note: { type: "string" },
  },
  additionalProperties: true,
} as const;

const validateResponseSchema = {
  type: "object",
  properties: {
    valid: { type: "boolean" },
    errors: { type: "array", items: { type: "string" } },
  },
} as const;

const deleteScoreModelResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    key: { type: "string" },
    version: { type: "number" },
    name: { type: "string" },
    status: { type: "string" },
  },
  required: ["id", "key", "version", "name", "status"],
  additionalProperties: false,
} as const;

const idParamsSchema = {
  type: "object",
  properties: { id: { type: "string", minLength: 1 } },
  required: ["id"],
} as const;

const mechanicRuleBodySchema = {
  type: "object",
  properties: {
    seasonId: { type: "string" },
    dungeonId: { type: "string" },
    npcId: { type: ["integer", "null"] },
    spellId: { type: "integer" },
    ruleType: {
      type: "string",
      enum: [
        "AVOIDABLE_DAMAGE",
        "MANDATORY_DAMAGE",
        "PRIORITY_INTERRUPT",
        "CROWD_CONTROL",
        "DISPEL",
        "PURGE",
        "DEFENSIVE_WINDOW",
        "EXTERNAL_WINDOW",
      ],
    },
    severity: { type: "number", minimum: 0 },
    applicableRoles: { type: "array", items: { type: "string", enum: ["DPS", "TANK", "HEALER"] } },
    responseSpellIds: { type: "array", items: { type: "integer" } },
    notes: { type: ["string", "null"] },
    source: { type: "string" },
    version: { type: "string" },
    active: { type: "boolean" },
  },
} as const;

/**
 * Admin routes — RBAC permissions with documented emergency `x-admin-api-key` fallback.
 */
export function buildAdminRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new AdminService(container);
  const usersService = new AdminUsersService(container.worker.prisma, container.env.SESSION_SECRET);
  const bulkService = new BulkCharacterProcessingService(container);
  const miscService = new AdminMiscService(container);
  const relevantRefreshService = new AdminRelevantRefreshService(container);
  const env = container.env;

  return async (app) => {
    app.get(
      "/api/v1/admin/ability-catalog",
      {
        preHandler: createPermissionPreHandler(env, PERMISSIONS.ADMIN_ABILITY_CATALOG_READ, {
          auditAction: "admin.ability_catalog.read",
        }),
        schema: {
          tags: ["admin"],
          querystring: {
            type: "object",
            properties: {
              query: { type: "string" },
              classSlug: { type: "string" },
              specSlug: { type: "string" },
              role: { type: "string", enum: ["DPS", "TANK", "HEALER"] },
              category: { type: "string" },
              ownership: { type: "string" },
              availability: { type: "string" },
              version: { type: "string" },
              validationState: { type: "string" },
              page: { type: "integer", minimum: 1 },
              limit: { type: "integer", minimum: 1, maximum: 200 },
            },
          },
          response: {
            200: { type: "object", additionalProperties: true },
          },
        },
      },
      async (request) => {
        const q = request.query as Record<string, string | number | undefined>;
        return queryAdminAbilityCatalog({
          query: typeof q.query === "string" ? q.query : undefined,
          classSlug: typeof q.classSlug === "string" ? q.classSlug : undefined,
          specSlug: typeof q.specSlug === "string" ? q.specSlug : undefined,
          role: q.role as "DPS" | "TANK" | "HEALER" | undefined,
          category: q.category as never,
          ownership: q.ownership as never,
          availability: q.availability as never,
          version: typeof q.version === "string" ? q.version : undefined,
          validationState: q.validationState as never,
          page: typeof q.page === "number" ? q.page : q.page != null ? Number(q.page) : undefined,
          limit: typeof q.limit === "number" ? q.limit : q.limit != null ? Number(q.limit) : undefined,
        });
      },
    );

    await app.register(async (usersApp) => {
      usersApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_USERS_READ, {
          auditAction: "admin.users.access",
        }),
      );

      usersApp.get(
        "/api/v1/admin/users",
        {
          schema: {
            tags: ["admin"],
            querystring: {
              type: "object",
              properties: {
                q: { type: "string", minLength: 2 },
                limit: { type: "integer", minimum: 1, maximum: 50 },
              },
              required: ["q"],
            },
            response: {
              200: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const query = request.query as { q: string; limit?: number };
          return usersService.searchUsers(query.q, query.limit);
        },
      );

      usersApp.get(
        "/api/v1/admin/users/:id",
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
        async (request) => {
          const { id } = request.params as { id: string };
          return usersService.getUser(id);
        },
      );

      usersApp.get(
        "/api/v1/admin/roles",
        {
          schema: {
            tags: ["admin"],
            response: {
              200: {
                type: "object",
                properties: {
                  roles: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        key: { type: "string" },
                        name: { type: "string" },
                        description: { type: ["string", "null"] },
                      },
                    },
                  },
                },
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async () => ({ roles: await usersService.listManageableRoles() }),
      );
    });

    await app.register(async (manageUsersApp) => {
      manageUsersApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_USERS_MANAGE, {
          auditAction: "admin.users.manage",
        }),
      );

      manageUsersApp.post(
        "/api/v1/admin/users/:id/roles",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: {
              type: "object",
              properties: { roleKey: { type: "string", minLength: 1 } },
              required: ["roleKey"],
            },
            response: {
              200: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          const body = request.body as { roleKey: string };
          return usersService.grantRole({
            actorUserId: request.auth?.user.id ?? null,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            targetUserId: id,
            roleKey: body.roleKey,
            ip: request.ip,
            userAgent: request.headers["user-agent"],
          });
        },
      );

      manageUsersApp.delete(
        "/api/v1/admin/users/:id/roles/:roleKey",
        {
          schema: {
            tags: ["admin"],
            params: {
              type: "object",
              properties: {
                id: { type: "string", minLength: 1 },
                roleKey: { type: "string", minLength: 1 },
              },
              required: ["id", "roleKey"],
            },
            querystring: {
              type: "object",
              properties: {
                allowLastAdminRemoval: { type: "boolean" },
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
          const { id, roleKey } = request.params as { id: string; roleKey: string };
          const query = request.query as { allowLastAdminRemoval?: boolean };
          return usersService.revokeRole({
            actorUserId: request.auth?.user.id ?? null,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            targetUserId: id,
            roleKey,
            allowLastAdminRemoval: query.allowLastAdminRemoval === true,
            ip: request.ip,
            userAgent: request.headers["user-agent"],
          });
        },
      );
    });

    await app.register(async (protectedApp) => {
      protectedApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_SCORE_MODELS_MANAGE, {
          auditAction: "admin.score_models.access",
        }),
      );

      protectedApp.addHook("onResponse", async (request, reply) => {
        if (reply.statusCode < 400 && request.method !== "GET") {
          await writeAuditEvent(container.worker.prisma, {
            userId: request.auth?.user.id,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            action: `admin.${request.method.toLowerCase()}.${request.routeOptions.url ?? request.url}`,
            ip: request.ip,
            userAgent: request.headers["user-agent"],
            sessionSecret: env.SESSION_SECRET,
            metadata: { statusCode: reply.statusCode },
          });
        }
      });

      protectedApp.get(
        "/api/v1/admin/score-models",
        {
          schema: {
            tags: ["admin"],
            response: { 200: { type: "object", properties: { models: { type: "array", items: adminScoreModelSchema } } } },
          },
        },
        async () => ({ models: await service.listScoreModels() }),
      );

      protectedApp.post(
        "/api/v1/admin/score-models",
        {
          schema: {
            tags: ["admin"],
            body: {
              type: "object",
              properties: {
                key: { type: "string", minLength: 1 },
                name: { type: "string", minLength: 1 },
                description: { type: "string" },
                config: scoreModelConfigSchema,
              },
              required: ["key", "name", "config"],
            },
            response: { 201: adminScoreModelSchema, 400: errorResponseSchema },
          },
        },
        async (request, reply) => {
          const body = request.body as CreateScoreModelInput;
          const model = await service.createScoreModel(body);
          return reply.status(201).send(model);
        },
      );

      protectedApp.post(
        "/api/v1/admin/score-models/:id/clone",
        {
          schema: { tags: ["admin"], params: idParamsSchema, response: { 201: adminScoreModelSchema, 404: errorResponseSchema } },
        },
        async (request, reply) => {
          const { id } = request.params as { id: string };
          const model = await service.cloneScoreModel(id);
          return reply.status(201).send(model);
        },
      );

      protectedApp.put(
        "/api/v1/admin/score-models/:id",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: { type: "object", properties: { config: scoreModelConfigSchema }, required: ["config"] },
            response: { 200: adminScoreModelSchema, 400: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          const body = request.body as { config: ScoreModelConfig };
          return service.updateScoreModel(id, body.config);
        },
      );

      protectedApp.delete(
        "/api/v1/admin/score-models/:id",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            response: {
              200: deleteScoreModelResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.deleteScoreModel(id, {
            actorUserId: request.auth?.user.id ?? null,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
          });
        },
      );

      protectedApp.post(
        "/api/v1/admin/score-models/:id/validate",
        {
          schema: { tags: ["admin"], params: idParamsSchema, response: { 200: validateResponseSchema, 404: errorResponseSchema } },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.validateScoreModel(id);
        },
      );

      protectedApp.post(
        "/api/v1/admin/score-models/:id/backtest",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            response: { 200: backtestResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          const body =
            request.body && typeof request.body === "object"
              ? (request.body as { characterIds?: string[]; limit?: number })
              : {};
          return service.backtestScoreModel(id, {
            characterIds: body.characterIds ?? null,
            limit: body.limit,
          });
        },
      );

      protectedApp.post(
        "/api/v1/admin/score-models/:id/activate",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: {
              type: "object",
              properties: {
                characterId: { type: "string" },
                expectedPreviousActiveId: { type: ["string", "null"] },
                confirm: { type: "boolean" },
              },
            },
            response: {
              200: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  key: { type: "string" },
                  version: { type: "number" },
                  name: { type: "string" },
                  status: { type: "string" },
                  config: { type: "object", additionalProperties: true },
                  createdAt: { type: "string" },
                  activatedAt: { type: ["string", "null"] },
                  previousActiveId: { type: ["string", "null"] },
                  previousActiveVersion: { type: ["integer", "null"] },
                  bulkOperationId: { type: ["string", "null"] },
                  bulkEnqueueError: { type: ["string", "null"] },
                },
                additionalProperties: true,
              },
              400: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          const body =
            (request.body as {
              characterId?: string;
              expectedPreviousActiveId?: string | null;
              confirm?: boolean;
            } | undefined) ?? {};
          return service.activateScoreModel(id, {
            characterId: body.characterId,
            expectedPreviousActiveId: body.expectedPreviousActiveId,
            confirm: body.confirm ?? true,
            actorUserId: request.auth?.user.id ?? null,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
          });
        },
      );

      protectedApp.post(
        "/api/v1/admin/characters/:id/recalculate",
        {
          schema: { tags: ["admin"], params: idParamsSchema, response: { 200: jobStatusSchema, 404: errorResponseSchema } },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.recalculateCharacter(id);
        },
      );

      protectedApp.get(
        "/api/v1/admin/mechanic-rules",
        {
          schema: {
            tags: ["admin"],
            querystring: {
              type: "object",
              properties: {
                seasonId: { type: "string" },
                dungeonId: { type: "string" },
                active: { type: "boolean" },
              },
            },
            response: { 200: { type: "object", properties: { rules: { type: "array", items: mechanicRuleSchema } } } },
          },
        },
        async (request) => {
          const filter = request.query as { seasonId?: string; dungeonId?: string; active?: boolean };
          return { rules: await service.listMechanicRules(filter) };
        },
      );

      protectedApp.post(
        "/api/v1/admin/mechanic-rules",
        {
          schema: {
            tags: ["admin"],
            body: {
              ...mechanicRuleBodySchema,
              required: ["seasonId", "dungeonId", "spellId", "ruleType", "severity", "applicableRoles", "source", "version"],
            },
            response: { 201: mechanicRuleSchema, 400: errorResponseSchema },
          },
        },
        async (request, reply) => {
          const body = request.body as MechanicRuleInput;
          const rule = await service.createMechanicRule(body);
          return reply.status(201).send(rule);
        },
      );

      protectedApp.get(
        "/api/v1/admin/mechanic-rules/:id",
        {
          schema: { tags: ["admin"], params: idParamsSchema, response: { 200: mechanicRuleSchema, 404: errorResponseSchema } },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.getMechanicRule(id);
        },
      );

      protectedApp.patch(
        "/api/v1/admin/mechanic-rules/:id",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            body: mechanicRuleBodySchema,
            response: { 200: mechanicRuleSchema, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          const patch = request.body as Partial<MechanicRuleInput>;
          return service.updateMechanicRule(id, patch);
        },
      );

      protectedApp.delete(
        "/api/v1/admin/mechanic-rules/:id",
        {
          schema: { tags: ["admin"], params: idParamsSchema, response: { 200: mechanicRuleSchema, 404: errorResponseSchema } },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return service.deleteMechanicRule(id);
        },
      );
    });

    await app.register(async (protectedApp) => {
      protectedApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_JOBS_MANAGE, {
          auditAction: "admin.jobs.access",
          allowEmergencyAdminKey: true,
        }),
      );

      protectedApp.addHook("onResponse", async (request, reply) => {
        if (reply.statusCode < 400 && request.method !== "GET") {
          await writeAuditEvent(container.worker.prisma, {
            userId: request.auth?.user.id,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            action: `admin.bulk_operations.${request.method.toLowerCase()}`,
            resourceType: "bulk_operation",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
            sessionSecret: env.SESSION_SECRET,
            metadata: { statusCode: reply.statusCode, url: request.url },
          });
        }
      });

      protectedApp.get(
        "/api/v1/admin/bulk-operations",
        {
          schema: {
            tags: ["admin"],
            response: {
              200: {
                type: "object",
                properties: { operations: { type: "array", items: { type: "object", additionalProperties: true } } },
              },
            },
          },
        },
        async () => ({ operations: await bulkService.list() }),
      );

      protectedApp.get(
        "/api/v1/admin/characters/search",
        {
          schema: {
            tags: ["admin"],
            querystring: {
              type: "object",
              properties: {
                query: { type: "string", minLength: 3, maxLength: 96 },
                q: { type: "string", minLength: 3, maxLength: 96 },
                region: { type: "string", minLength: 1, maxLength: 8 },
                limit: { type: "integer", minimum: 1, maximum: 8 },
              },
            },
            response: {
              200: {
                type: "object",
                properties: {
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        characterId: { type: "string" },
                        name: { type: "string" },
                        realmSlug: { type: "string" },
                        realmName: { type: "string" },
                        region: { type: "string" },
                        classSlug: { type: ["string", "null"] },
                        avatarUrl: { type: ["string", "null"] },
                        classIconUrl: { type: ["string", "null"] },
                        mythicPlusScore: { type: ["number", "null"] },
                      },
                      required: [
                        "characterId",
                        "name",
                        "realmSlug",
                        "realmName",
                        "region",
                        "classSlug",
                        "avatarUrl",
                        "classIconUrl",
                        "mythicPlusScore",
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["suggestions"],
                additionalProperties: false,
              },
              400: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const { query, q, region, limit } = request.query as {
            query?: string;
            q?: string;
            region?: string;
            limit?: number;
          };
          const search = (query ?? q ?? "").trim();
          if (search.length < 3) {
            return { suggestions: [] };
          }
          const suggestions = await container.worker.repositories.character.searchPersistedForAdmin(search, {
            region: region ?? null,
            limit: limit ?? 8,
          });
          return { suggestions };
        },
      );

      protectedApp.post(
        "/api/v1/admin/bulk-operations",
        {
          schema: {
            tags: ["admin"],
            body: {
              type: "object",
              properties: {
                mode: { type: "string", enum: ["FULL_REFRESH", "RECALCULATE_ONLY"] },
                minMythicPlusScore: { type: ["number", "null"] },
                scoreModelId: { type: ["string", "null"] },
                batchSize: { type: "integer", minimum: 1, maximum: 500 },
                maxCharacters: { type: ["integer", "null"] },
                maxWclCalls: { type: ["integer", "null"] },
                dryRun: { type: "boolean" },
                allowFullRefreshOnIncompatible: { type: "boolean" },
                logicalKey: { type: "string" },
                characterIds: {
                  type: ["array", "null"],
                  items: { type: "string", format: "uuid" },
                  maxItems: 500,
                },
              },
              required: ["mode", "minMythicPlusScore"],
            },
            response: {
              201: { type: "object", additionalProperties: true },
              400: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const body = request.body as BulkCharacterProcessingInput;
          const operation = await bulkService.create(body, {
            createdByUserId: request.auth?.user.id ?? null,
          });
          return reply.status(201).send(operation);
        },
      );

      protectedApp.get(
        "/api/v1/admin/bulk-operations/:id",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return bulkService.get(id);
        },
      );

      protectedApp.post(
        "/api/v1/admin/bulk-operations/:id/pause",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema, 409: errorResponseSchema },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return bulkService.pause(id);
        },
      );

      protectedApp.post(
        "/api/v1/admin/bulk-operations/:id/resume",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema, 409: errorResponseSchema },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return bulkService.resume(id);
        },
      );

      protectedApp.post(
        "/api/v1/admin/bulk-operations/:id/cancel",
        {
          schema: {
            tags: ["admin"],
            params: idParamsSchema,
            response: { 200: { type: "object", additionalProperties: true }, 404: errorResponseSchema, 409: errorResponseSchema },
          },
        },
        async (request) => {
          const { id } = request.params as { id: string };
          return bulkService.cancel(id);
        },
      );
    });

    await app.register(async (protectedApp) => {
      protectedApp.addHook(
        "preHandler",
        createPermissionPreHandler(env, PERMISSIONS.ADMIN_SETTINGS_MANAGE, {
          auditAction: "admin.settings.access",
          allowEmergencyAdminKey: true,
        }),
      );

      protectedApp.addHook("onResponse", async (request, reply) => {
        if (reply.statusCode < 400 && request.method !== "GET") {
          await writeAuditEvent(container.worker.prisma, {
            userId: request.auth?.user.id,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            action: `admin.misc.${request.method.toLowerCase()}`,
            resourceType: "admin_misc",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
            sessionSecret: env.SESSION_SECRET,
            metadata: { statusCode: reply.statusCode, url: request.url },
          });
        }
      });

      protectedApp.post(
        "/api/v1/admin/misc/realms/sync",
        {
          schema: {
            tags: ["admin"],
            body: {
              type: "object",
              additionalProperties: false,
              properties: {
                regions: {
                  type: "array",
                  items: { type: "string", enum: ["EU", "US", "KR", "TW"] },
                  minItems: 1,
                  maxItems: 4,
                },
                forceDetails: { type: "boolean" },
              },
            },
            response: {
              200: adminRealmSyncResponseSchema,
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const body = (request.body ?? {}) as {
            regions?: Array<"EU" | "US" | "KR" | "TW">;
            forceDetails?: boolean;
          };
          return miscService.syncRealmCatalog({
            regions: body.regions,
            forceDetails: body.forceDetails,
          });
        },
      );

      protectedApp.post(
        "/api/v1/admin/misc/season/sync-authority",
        {
          schema: {
            tags: ["admin"],
            body: {
              type: "object",
              additionalProperties: false,
              properties: {
                regions: {
                  type: "array",
                  items: { type: "string", enum: ["EU", "US", "KR", "TW"] },
                  minItems: 1,
                  maxItems: 4,
                },
              },
            },
            response: {
              200: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        region: { type: "string" },
                        previous: {
                          type: "object",
                          properties: {
                            blizzardSeasonId: { type: ["integer", "null"] },
                            slug: { type: ["string", "null"] },
                          },
                          required: ["blizzardSeasonId", "slug"],
                          additionalProperties: false,
                        },
                        current: {
                          type: "object",
                          properties: {
                            blizzardSeasonId: { type: "integer" },
                            slug: { type: "string" },
                            authoritySource: { type: "string" },
                            authorityVerifiedAt: { type: "string" },
                          },
                          required: [
                            "blizzardSeasonId",
                            "slug",
                            "authoritySource",
                            "authorityVerifiedAt",
                          ],
                          additionalProperties: false,
                        },
                        changed: { type: "boolean" },
                      },
                      required: ["region", "previous", "current", "changed"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["ok", "results"],
                additionalProperties: false,
              },
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const body = (request.body ?? {}) as {
            regions?: Array<"EU" | "US" | "KR" | "TW">;
          };
          return miscService.syncSeasonAuthority({ regions: body.regions });
        },
      );

      protectedApp.get(
        "/api/v1/admin/misc/scoring-season",
        {
          schema: {
            tags: ["admin"],
            querystring: {
              type: "object",
              additionalProperties: false,
              properties: {
                region: { type: "string", enum: ["EU", "US", "KR", "TW"] },
              },
            },
          },
        },
        async (request) => {
          const query = request.query as { region?: string };
          return miscService.getScoringSeasonSelectionStatus({
            regionCode: query.region ?? "EU",
          });
        },
      );

      protectedApp.put(
        "/api/v1/admin/misc/scoring-season",
        {
          schema: {
            tags: ["admin"],
            body: {
              type: "object",
              additionalProperties: false,
              required: ["mode", "expectedVersion"],
              properties: {
                mode: { type: "string", enum: ["AUTO", "PINNED"] },
                blizzardSeasonId: { type: "integer", minimum: 1 },
                expectedVersion: { type: "integer", minimum: 1 },
                region: { type: "string", enum: ["EU", "US", "KR", "TW"] },
              },
            },
          },
        },
        async (request) => {
          const body = request.body as {
            mode: "AUTO" | "PINNED";
            blizzardSeasonId?: number;
            expectedVersion: number;
            region?: string;
          };
          const actorId = request.auth?.user?.id ?? null;
          if (body.mode === "PINNED") {
            if (body.blizzardSeasonId == null) {
              throw HttpError.badRequest(
                "SCORING_SEASON_PIN_REQUIRED",
                "PINNED mode requires blizzardSeasonId",
              );
            }
            return miscService.setScoringSeasonSelection({
              body: {
                mode: "PINNED",
                blizzardSeasonId: body.blizzardSeasonId,
                expectedVersion: body.expectedVersion,
              },
              actor: {
                userId: actorId,
                actorType: "user",
                ip: request.ip,
                userAgent: request.headers["user-agent"] ?? null,
              },
              regionCode: body.region ?? "EU",
            });
          }
          return miscService.setScoringSeasonSelection({
            body: { mode: "AUTO", expectedVersion: body.expectedVersion },
            actor: {
              userId: actorId,
              actorType: "user",
              ip: request.ip,
              userAgent: request.headers["user-agent"] ?? null,
            },
            regionCode: body.region ?? "EU",
          });
        },
      );

      protectedApp.post(
        "/api/v1/admin/misc/scoring-season/synchronize-data",
        {
          schema: {
            tags: ["admin"],
            body: {
              type: "object",
              additionalProperties: false,
              properties: {
                region: { type: "string", enum: ["EU", "US", "KR", "TW"] },
              },
            },
          },
        },
        async (request) => {
          const body = (request.body ?? {}) as { region?: string };
          return miscService.synchronizeSeasonData({
            regionCode: body.region ?? "EU",
          });
        },
      );

      protectedApp.get(
        "/api/v1/admin/misc/relevant-refresh",
        {
          schema: { tags: ["admin"] },
        },
        async () => relevantRefreshService.getSettings(),
      );

      protectedApp.put(
        "/api/v1/admin/misc/relevant-refresh",
        {
          schema: {
            tags: ["admin"],
            body: {
              type: "object",
              additionalProperties: false,
              required: ["expectedVersion"],
              properties: {
                relevantRefreshEnabled: { type: "boolean" },
                refreshConcurrencyEnabled: { type: "boolean" },
                concurrencyOperation: { type: "integer", minimum: 1, maximum: 8 },
                relevantCandidateTarget: { type: "integer", minimum: 1, maximum: 10000 },
                relevantCandidatePercentileBps: { type: "integer", minimum: 1, maximum: 10000 },
                wclPreResetDrainSeconds: { type: "integer", minimum: 0, maximum: 3600 },
                expectedVersion: { type: "integer", minimum: 1 },
              },
            },
          },
        },
        async (request) => {
          const body = request.body as {
            relevantRefreshEnabled?: boolean;
            refreshConcurrencyEnabled?: boolean;
            concurrencyOperation?: number;
            relevantCandidateTarget?: number;
            relevantCandidatePercentileBps?: number;
            wclPreResetDrainSeconds?: number;
            expectedVersion: number;
          };
          return relevantRefreshService.updateSettings(body, {
            userId: request.auth?.user.id ?? null,
            actorType: request.authActor === "admin_key" ? "admin_key" : "user",
            ip: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          });
        },
      );

      protectedApp.post(
        "/api/v1/admin/misc/relevant-refresh/run",
        {
          schema: {
            tags: ["admin"],
            body: {
              type: "object",
              additionalProperties: false,
              properties: {
                regionCode: { type: "string", enum: ["EU", "US", "KR", "TW"] },
                mode: { type: "string", enum: ["daily_discovery", "drain_feed"] },
              },
            },
          },
        },
        async (request) => {
          const body = (request.body ?? {}) as {
            regionCode?: "EU" | "US" | "KR" | "TW";
            mode?: "daily_discovery" | "drain_feed";
          };
          return relevantRefreshService.runDiscovery(
            {
              regionCode: body.regionCode ?? "EU",
              mode: body.mode ?? "daily_discovery",
            },
            {
              userId: request.auth?.user.id ?? null,
              actorType: request.authActor === "admin_key" ? "admin_key" : "user",
              ip: request.ip,
              userAgent: request.headers["user-agent"] ?? null,
            },
          );
        },
      );
    });
  };
}
