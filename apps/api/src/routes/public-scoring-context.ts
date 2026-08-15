import type { FastifyPluginAsync } from "fastify";
import type { ApiContainer } from "../container.js";
import { PublicScoringContextService } from "../services/public-scoring-context-service.js";
import { errorResponseSchema } from "./schemas.js";

const jsonObject = { type: "object", additionalProperties: true } as const;
const jsonArray = { type: "array", items: jsonObject } as const;

const regionSnapshotSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: {
    collectedAt: { type: "string" },
    source: { type: "string" },
    sourceVersion: { type: ["string", "null"] },
  },
} as const;

const tierFactorsSchema = {
  type: "object",
  additionalProperties: { type: "number" },
  properties: {
    "1": { type: "number" },
    "2": { type: "number" },
    "3": { type: "number" },
    "4": { type: "number" },
    "5": { type: "number" },
  },
} as const;

export function buildPublicScoringContextRoutes(container: ApiContainer): FastifyPluginAsync {
  const service = new PublicScoringContextService(container.worker.prisma);

  return async (app) => {
    app.get(
      "/api/v1/scoring/context",
      {
        schema: {
          tags: ["scoring"],
          response: {
            200: {
              type: "object",
              additionalProperties: false,
              properties: {
                available: { type: "boolean" },
                unavailableReason: { type: ["string", "null"] },
                scoringSeason: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    slug: { type: "string" },
                    name: { type: "string" },
                    blizzardSeasonId: { type: ["integer", "null"] },
                  },
                },
                revision: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    version: { type: "integer" },
                    publishedAt: { type: ["string", "null"] },
                  },
                },
                meta: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: {
                    classes: jsonArray,
                    assignments: jsonArray,
                    tierFactors: tierFactorsSchema,
                  },
                },
                key: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: {
                    rows: jsonArray,
                    unavailable: { type: "boolean" },
                    regionalSnapshots: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        EU: regionSnapshotSchema,
                        US: regionSnapshotSchema,
                        KR: regionSnapshotSchema,
                        TW: regionSnapshotSchema,
                      },
                    },
                  },
                },
              },
              required: ["available", "unavailableReason", "scoringSeason", "revision", "meta", "key"],
            },
            500: errorResponseSchema,
          },
        },
      },
      async () => service.getPublished(),
    );
  };
}
