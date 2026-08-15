import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { FaqService } from "../services/faq-service.js";
import { errorResponseSchema } from "./schemas.js";

const publicFaqEntrySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    position: { type: "integer" },
    embedType: {
      type: ["string", "null"],
      enum: [
        "META_TIER_TABLE",
        "KEY_PERCENTILE_TABLE",
        "SCORE_FLOW",
        "SCORING_DIMENSIONS",
        "TRUST_GRADE_LADDER",
        null,
      ],
    },
  },
  required: ["id", "title", "description", "position", "embedType"],
} as const;

export function buildFaqRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new FaqService(container.worker.prisma);

  return async (app) => {
    app.get(
      "/api/v1/faq",
      {
        schema: {
          tags: ["faq"],
          response: {
            200: {
              type: "object",
              additionalProperties: false,
              properties: {
                entries: { type: "array", items: publicFaqEntrySchema },
              },
              required: ["entries"],
            },
            500: errorResponseSchema,
          },
        },
      },
      async () => service.listPublished(),
    );
  };
}
