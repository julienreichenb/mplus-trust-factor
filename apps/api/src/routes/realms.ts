import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { errorResponseSchema, realmSchema } from "./schemas.js";

/** GET /api/v1/realms?query=&region=&limit= */
export function buildRealmRoutes(container: ApiContainer): FastifyPluginAsync {
  return async (app) => {
    app.get(
      "/api/v1/realms",
      {
        schema: {
          tags: ["realms"],
          querystring: {
            type: "object",
            properties: {
              region: { type: "string", minLength: 1 },
              query: { type: "string" },
              q: { type: "string" },
              limit: { type: "integer", minimum: 1, maximum: 500 },
            },
          },
          response: {
            200: {
              type: "object",
              properties: { realms: { type: "array", items: realmSchema } },
              required: ["realms"],
            },
            400: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const { region, query, q, limit } = request.query as {
          region?: string;
          query?: string;
          q?: string;
          limit?: number;
        };
        const search = query ?? q ?? "";
        const rows = await container.worker.repositories.realm.search({
          query: search,
          region: region ?? null,
          limit: limit ?? 25,
        });
        return {
          realms: rows.map((row) => container.worker.repositories.realm.toCatalogOption(row)),
        };
      },
    );
  };
}
