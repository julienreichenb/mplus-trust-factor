import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { JobService } from "../services/job-service.js";
import { errorResponseSchema, jobStatusSchema } from "./schemas.js";

/** GET /api/v1/jobs/:id */
export function buildJobRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new JobService(container);

  return async (app) => {
    app.get(
      "/api/v1/jobs/:id",
      {
        schema: {
          tags: ["jobs"],
          params: {
            type: "object",
            properties: { id: { type: "string", minLength: 1 } },
            required: ["id"],
          },
          response: {
            200: jobStatusSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const { id } = request.params as { id: string };
        return service.getJob(id);
      },
    );
  };
}
