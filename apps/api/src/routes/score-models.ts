import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { AdminService } from "../services/admin-service.js";
import { adminScoreModelSchema } from "./schemas.js";

/** GET /api/v1/score-models/public — active, publicly visible score models. */
export function buildPublicScoreModelRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new AdminService(container);

  return async (app) => {
    app.get(
      "/api/v1/score-models/public",
      {
        schema: {
          tags: ["score-models"],
          response: {
            200: { type: "object", properties: { models: { type: "array", items: adminScoreModelSchema } } },
          },
        },
      },
      async () => ({ models: await service.listPublicScoreModels() }),
    );
  };
}
