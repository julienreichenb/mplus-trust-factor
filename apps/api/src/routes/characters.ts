import type { FastifyPluginAsync } from "fastify";
import type { CharacterIdentityInput } from "@mplus/contracts";
import type { ApiContainer } from "../container.js";
import { CharacterService } from "../services/character-service.js";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";
import { buildActiveRerollsView } from "../iam/active-rerolls-view.js";
import { requireAuth, resolveRefreshPrivileges } from "../iam/session.js";
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
  characterResolveResponseSchema,
} from "./schemas.js";
import { PUBLIC_CHARACTER_AUTOCOMPLETE_LIMIT } from "@mplus/worker";

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
              query: { type: "string", minLength: 2, maxLength: 96 },
              q: { type: "string", minLength: 2, maxLength: 96 },
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
        if (search.length < 2) {
          return { suggestions: [] };
        }
        const suggestions = await container.worker.repositories.character.searchSuggestions(
          region,
          search,
          PUBLIC_CHARACTER_AUTOCOMPLETE_LIMIT,
        );
        return { suggestions };
      },
    );

    app.post(
      "/api/v1/characters/resolve",
      {
        config: rateLimitConfig(container, 60),
        schema: {
          tags: ["characters"],
          body: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, maxLength: 48 },
              realmSlug: { type: "string", minLength: 1, maxLength: 64 },
              region: { type: "string", minLength: 1, maxLength: 8 },
              forceRetry: { type: "boolean" },
            },
            required: ["name", "realmSlug", "region"],
          },
          response: {
            200: characterResolveResponseSchema,
            202: characterResolveResponseSchema,
            400: characterResolveResponseSchema,
            404: characterResolveResponseSchema,
            409: characterResolveResponseSchema,
            502: characterResolveResponseSchema,
            503: characterResolveResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body as {
          name: string;
          realmSlug: string;
          region: string;
          forceRetry?: boolean;
        };
        const result = await service.resolveCharacter(
          { name: body.name, realmSlug: body.realmSlug, region: body.region },
          { correlationId: request.id, forceRetry: body.forceRetry === true },
        );
        const statusCode = result.statusCode as 200 | 202 | 400 | 404 | 409 | 502 | 503;
        return reply.status(statusCode).send(result.body);
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
          querystring: {
            type: "object",
            properties: {
              force: { type: "boolean" },
            },
          },
          response: {
            200: refreshStatusResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const identity = toIdentity(request.params as IdentityParams);
        const query = request.query as { force?: boolean };
        const wantForce = query.force === true;
        // Resolve privileges after we know the character id (findOrCreate inside requestRefresh).
        // Pre-check using identity-scoped lookup for ownership / admin.
        const preview = await service.getRefreshStatus(identity).catch(() => null);
        const privileges = await resolveRefreshPrivileges(
          request,
          container.env,
          container.authService,
          preview?.characterId ?? "",
        );
        if (wantForce && !privileges.forceRefresh) {
          if (!request.auth && !request.headers["x-admin-api-key"]) {
            throw HttpError.unauthorized("UNAUTHORIZED", "Authentication required");
          }
          throw HttpError.forbidden("FORBIDDEN", "Force refresh requires admin permission");
        }
        const forceRefresh = wantForce && privileges.forceRefresh;
        const bypassCooldown = privileges.bypassCooldown || forceRefresh;
        if (bypassCooldown || forceRefresh) {
          await writeAuditEvent(container.worker.prisma, {
            userId: request.auth?.user.id,
            actorType:
              privileges.actor === "admin_key"
                ? "admin_key"
                : privileges.actor === "session_admin"
                  ? "user"
                  : privileges.actor === "owner"
                    ? "user"
                    : "anonymous",
            action: forceRefresh ? "profile.refresh.force" : "profile.refresh.cooldown_bypass",
            resourceType: "character",
            resourceId: preview?.characterId ?? `${identity.region}/${identity.realmSlug}/${identity.name}`,
            ip: request.ip,
            userAgent: request.headers["user-agent"],
            sessionSecret: container.env.SESSION_SECRET,
            metadata: { actor: privileges.actor, forceRefresh, bypassCooldown },
          });
        }
        return service.requestRefresh(identity, {
          // Authorization boundary: force only when ?force=true AND permitted.
          // Cooldown bypass alone must not imply provider forceRefresh.
          bypassCooldown,
          forceRefresh,
          correlationId: request.id,
        });
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
      "/api/v1/characters/:region/:realm/:name/active-rerolls",
      {
        config: rateLimitConfig(container, 60),
        schema: {
          tags: ["characters"],
          params: identityParamsSchema,
          response: {
            200: {
              type: "object",
              properties: {
                displayedCharacterIsMain: { type: "boolean" },
                rerolls: {
                  type: "array",
                  maxItems: 24,
                  items: {
                    type: "object",
                    properties: {
                      characterId: { type: "string", format: "uuid" },
                      region: { type: "string" },
                      realmSlug: { type: "string" },
                      realmName: { type: ["string", "null"] },
                      name: { type: "string" },
                      classSlug: { type: ["string", "null"] },
                      className: { type: ["string", "null"] },
                      classColor: { type: ["string", "null"] },
                      portraitUrl: { type: ["string", "null"] },
                      mythicPlusScore: { type: ["number", "null"] },
                      grade: {
                        anyOf: [
                          { type: "string", enum: ["S", "A", "B", "C", "D", "U"] },
                          { type: "null" },
                        ],
                      },
                      isMain: { type: "boolean" },
                    },
                    required: [
                      "characterId",
                      "region",
                      "realmSlug",
                      "realmName",
                      "name",
                      "classSlug",
                      "className",
                      "classColor",
                      "portraitUrl",
                      "mythicPlusScore",
                      "grade",
                      "isMain",
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: ["displayedCharacterIsMain", "rerolls"],
              additionalProperties: false,
            },
            401: errorResponseSchema,
          },
        },
      },
      async (request) => {
        requireAuth(request);
        const identity = toIdentity(request.params as IdentityParams);
        return buildActiveRerollsView({
          prisma: container.worker.prisma,
          env: container.env,
          region: identity.region,
          realmSlug: identity.realmSlug,
          name: identity.name,
          logger: container.logger,
        });
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
