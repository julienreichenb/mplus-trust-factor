import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { errorResponseSchema, realmSchema } from "./schemas.js";

/** GET /api/v1/realms?region=&query= */
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
            },
            required: ["region"],
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
        const { region, query, q } = request.query as { region: string; query?: string; q?: string };
        const search = query ?? q ?? "";
        const realms = await container.worker.repositories.realm.search(region, search);
        return { realms };
      },
    );
  };
}
