import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { createAdminAuthPreHandler } from "../plugins/admin-auth.js";
import type { ScoreModelConfig } from "@mplus/contracts";
import { AdminService, type CreateScoreModelInput, type MechanicRuleInput } from "../services/admin-service.js";
import { adminScoreModelSchema, errorResponseSchema, jobStatusSchema, mechanicRuleSchema, scoreModelConfigSchema } from "./schemas.js";

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
 * All routes in this plugin require `x-admin-api-key` (MVP-only auth, see `plugins/admin-auth.ts`).
 * Never expose `ADMIN_API_KEY` to public frontend bundles.
 */
export function buildAdminRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new AdminService(container);

  return async (app) => {
    app.addHook("preHandler", createAdminAuthPreHandler(container.env));

    app.get(
      "/api/v1/admin/score-models",
      {
        schema: {
          tags: ["admin"],
          response: { 200: { type: "object", properties: { models: { type: "array", items: adminScoreModelSchema } } } },
        },
      },
      async () => ({ models: await service.listScoreModels() }),
    );

    app.post(
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

    app.post(
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

    app.put(
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

    app.post(
      "/api/v1/admin/score-models/:id/validate",
      {
        schema: { tags: ["admin"], params: idParamsSchema, response: { 200: validateResponseSchema, 404: errorResponseSchema } },
      },
      async (request) => {
        const { id } = request.params as { id: string };
        return service.validateScoreModel(id);
      },
    );

    app.post(
      "/api/v1/admin/score-models/:id/backtest",
      {
        schema: { tags: ["admin"], params: idParamsSchema, response: { 200: backtestResponseSchema, 404: errorResponseSchema } },
      },
      async (request) => {
        const { id } = request.params as { id: string };
        return service.backtestScoreModel(id);
      },
    );

    app.post(
      "/api/v1/admin/score-models/:id/activate",
      {
        schema: {
          tags: ["admin"],
          params: idParamsSchema,
          body: {
            type: "object",
            properties: { characterId: { type: "string" } },
          },
          response: { 200: adminScoreModelSchema, 404: errorResponseSchema },
        },
      },
      async (request) => {
        const { id } = request.params as { id: string };
        const body = (request.body as { characterId?: string } | undefined) ?? {};
        return service.activateScoreModel(id, { characterId: body.characterId });
      },
    );

    app.post(
      "/api/v1/admin/characters/:id/recalculate",
      {
        schema: { tags: ["admin"], params: idParamsSchema, response: { 200: jobStatusSchema, 404: errorResponseSchema } },
      },
      async (request) => {
        const { id } = request.params as { id: string };
        return service.recalculateCharacter(id);
      },
    );

    app.get(
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

    app.post(
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

    app.get(
      "/api/v1/admin/mechanic-rules/:id",
      {
        schema: { tags: ["admin"], params: idParamsSchema, response: { 200: mechanicRuleSchema, 404: errorResponseSchema } },
      },
      async (request) => {
        const { id } = request.params as { id: string };
        return service.getMechanicRule(id);
      },
    );

    app.patch(
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

    app.delete(
      "/api/v1/admin/mechanic-rules/:id",
      {
        schema: { tags: ["admin"], params: idParamsSchema, response: { 200: mechanicRuleSchema, 404: errorResponseSchema } },
      },
      async (request) => {
        const { id } = request.params as { id: string };
        return service.deleteMechanicRule(id);
      },
    );
  };
}
