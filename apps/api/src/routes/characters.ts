import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { CharacterIdentityInput } from "@mplus/contracts";
import type { ApiContainer } from "../container.js";
import { isAdminRequest } from "../plugins/admin-auth.js";
import { CharacterService } from "../services/character-service.js";
import {
  characterProfileResponseSchema,
  errorResponseSchema,
  historyResponseSchema,
  identityParamsSchema,
  refreshStatusResponseSchema,
  runSummarySchema,
  scoreSnapshotSchema,
  searchCharacterResponseSchema,
  characterAutocompleteResponseSchema,
} from "./schemas.js";

interface IdentityParams {
  region: string;
  realm: string;
  name: string;
}

function toIdentity(params: IdentityParams): CharacterIdentityInput {
  return { region: params.region, realmSlug: params.realm, name: params.name };
}

/** Search-heavy route rate limit; generous in test env to avoid flaking inject-based test suites. */
function rateLimitConfig(container: ApiContainer, max: number) {
  return { rateLimit: { max: container.env.NODE_ENV === "test" ? 10_000 : max, timeWindow: "1 minute" } };
}

export function buildCharacterRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new CharacterService(container);

  return async (app) => {
    app.get(
      "/api/v1/characters/autocomplete",
      {
        config: rateLimitConfig(container, 120),
        schema: {
          tags: ["characters"],
          querystring: {
            type: "object",
            properties: {
              region: { type: "string", minLength: 1, maxLength: 8 },
              query: { type: "string", minLength: 3, maxLength: 96 },
              q: { type: "string", minLength: 3, maxLength: 96 },
            },
            required: ["region"],
          },
          response: {
            200: characterAutocompleteResponseSchema,
            400: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const { region, query, q } = request.query as { region: string; query?: string; q?: string };
        const search = (query ?? q ?? "").trim();
        if (search.length < 3) {
          return { suggestions: [] };
        }
        const suggestions = await container.worker.repositories.character.searchSuggestions(
          region,
          search,
        );
        return { suggestions };
      },
    );

    app.get(
      "/api/v1/characters/search",
      {
        config: rateLimitConfig(container, 60),
        schema: {
          tags: ["characters"],
          querystring: {
            type: "object",
            properties: {
              region: { type: "string", minLength: 1, maxLength: 8 },
              realm: { type: "string", minLength: 1, maxLength: 64 },
              name: { type: "string", minLength: 1, maxLength: 48 },
            },
            required: ["region", "realm", "name"],
          },
          response: {
            200: searchCharacterResponseSchema,
            400: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const { region, realm, name } = request.query as { region: string; realm: string; name: string };
        return service.searchCharacter(
          { region, realmSlug: realm, name },
          { correlationId: request.id },
        );
      },
    );

    app.get(
      "/api/v1/characters/:region/:realm/:name",
      {
        schema: {
          tags: ["characters"],
          params: identityParamsSchema,
          response: {
            200: characterProfileResponseSchema,
            202: characterProfileResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const identity = toIdentity(request.params as IdentityParams);
        const { statusCode, body } = await service.getProfile(identity, {
          correlationId: request.id,
        });
        return reply.status(statusCode).send(body);
      },
    );

    app.post(
      "/api/v1/characters/:region/:realm/:name/refresh",
      {
        config: rateLimitConfig(container, 12),
        schema: {
          tags: ["characters"],
          params: identityParamsSchema,
          response: {
            200: refreshStatusResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const identity = toIdentity(request.params as IdentityParams);
        const isAdmin = isAdminRequest(container.env, request as FastifyRequest);
        return service.requestRefresh(identity, { isAdmin, correlationId: request.id });
      },
    );

    app.get(
      "/api/v1/characters/:region/:realm/:name/refresh-status",
      {
        schema: {
          tags: ["characters"],
          params: identityParamsSchema,
          response: {
            200: refreshStatusResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const identity = toIdentity(request.params as IdentityParams);
        return service.getRefreshStatus(identity);
      },
    );

    app.get(
      "/api/v1/characters/:region/:realm/:name/history",
      {
        schema: {
          tags: ["characters"],
          params: identityParamsSchema,
          querystring: {
            type: "object",
            properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
          },
          response: {
            200: historyResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const identity = toIdentity(request.params as IdentityParams);
        const { limit } = request.query as { limit?: number };
        return service.getHistory(identity, limit);
      },
    );

    app.get(
      "/api/v1/characters/:region/:realm/:name/runs",
      {
        schema: {
          tags: ["characters"],
          params: identityParamsSchema,
          querystring: {
            type: "object",
            properties: { kind: { type: "string", enum: ["latest", "highest"] } },
          },
          response: {
            200: { anyOf: [runSummarySchema, { type: "null" }] },
            404: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const identity = toIdentity(request.params as IdentityParams);
        const { kind } = request.query as { kind?: "latest" | "highest" };
        return service.getRun(identity, kind ?? "latest");
      },
    );

    app.get(
      "/api/v1/characters/:region/:realm/:name/scores",
      {
        schema: {
          tags: ["characters"],
          params: identityParamsSchema,
          response: {
            200: scoreSnapshotSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const identity = toIdentity(request.params as IdentityParams);
        return service.getLatestScore(identity);
      },
    );
  };
}
