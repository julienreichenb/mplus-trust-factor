import type { FastifyPluginAsync } from "fastify";
import type { CharacterComparisonRequest } from "@mplus/contracts";
import type { ApiContainer } from "../container.js";
import { ComparisonService } from "../services/comparison-service.js";
import { comparisonResponseSchema, errorResponseSchema, identitySchema } from "./schemas.js";

/** POST /api/v1/comparisons — compare 2–10 character identities on a shared score model/season. */
export function buildComparisonRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new ComparisonService(container);

  return async (app) => {
    app.post(
      "/api/v1/comparisons",
      {
        schema: {
          tags: ["comparisons"],
          body: {
            type: "object",
            properties: {
              characters: { type: "array", items: identitySchema, minItems: 2, maxItems: 10 },
              seasonSlug: { type: "string" },
              modelKey: { type: "string" },
              modelVersion: { type: "integer", minimum: 1 },
            },
            required: ["characters"],
          },
          response: {
            200: comparisonResponseSchema,
            400: errorResponseSchema,
            409: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const body = request.body as CharacterComparisonRequest;
        return service.compare(body);
      },
    );
  };
}
