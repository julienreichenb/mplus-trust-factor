import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { type AppEnv, loadEnv } from "@mplus/config";
import { checkDatabaseHealth, prisma } from "@mplus/database";
import { SECRET_REDACT_PATHS, createRequestId } from "@mplus/observability";
import type { ApiErrorEnvelope, MetaResponse } from "@mplus/contracts";

export interface BuildAppOptions {
  env?: AppEnv;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [...SECRET_REDACT_PATHS],
        censor: "[Redacted]",
      },
    },
    genReqId: (req) => createRequestId(req.headers["x-request-id"] as string | undefined),
    requestIdHeader: "x-request-id",
    trustProxy: env.TRUST_PROXY,
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "M+ Trust Factor API",
        version: env.APP_VERSION,
        description: "Foundation OpenAPI surface — domain routes owned by Agent 5",
      },
      servers: [{ url: env.PUBLIC_BASE_URL }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    const err = error as {
      statusCode?: number;
      code?: string;
      message: string;
      validation?: unknown;
    };
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    const body: ApiErrorEnvelope = {
      error: {
        code: err.code ?? "INTERNAL_ERROR",
        message: statusCode >= 500 ? "Internal server error" : err.message,
        requestId: request.id,
        details: statusCode >= 500 ? undefined : (err.validation ?? undefined),
      },
    };
    void reply.status(statusCode).send(body);
  });

  app.get(
    "/health/live",
    {
      schema: {
        tags: ["health"],
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
            },
            required: ["status"],
          },
        },
      },
    },
    async () => ({ status: "ok" }),
  );

  app.get(
    "/health/ready",
    {
      schema: {
        tags: ["health"],
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              database: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  latencyMs: { type: "number" },
                },
              },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              database: { type: "object" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const database = await checkDatabaseHealth(prisma);
      if (!database.ok) {
        return reply.status(503).send({ status: "not_ready", database });
      }
      return { status: "ready", database };
    },
  );

  app.get(
    "/api/v1/meta",
    {
      schema: {
        tags: ["meta"],
        response: {
          200: {
            type: "object",
            properties: {
              name: { type: "string" },
              version: { type: "string" },
              environment: { type: "string" },
              providerMode: { type: "string" },
              activeScoreModel: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  version: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    async (): Promise<MetaResponse> => ({
      name: "M+ Trust Factor",
      version: env.APP_VERSION,
      environment: env.APP_ENV,
      providerMode: env.PROVIDER_MODE,
      activeScoreModel: {
        key: env.ACTIVE_SCORE_MODEL_KEY,
        version: env.ACTIVE_SCORE_MODEL_VERSION,
      },
    }),
  );

  return app;
}
