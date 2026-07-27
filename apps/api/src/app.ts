import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { type AppEnv, loadEnv } from "@mplus/config";
import { checkDatabaseHealth } from "@mplus/database";
import { SECRET_REDACT_PATHS, createRequestId, getMetricsRegistry } from "@mplus/observability";
import type { ApiErrorEnvelope, MetaResponse } from "@mplus/contracts";
import { createApiContainer, type ApiContainer } from "./container.js";
import { isHttpError } from "./errors.js";
import { buildAdminRoutes } from "./routes/admin.js";
import { buildCharacterRoutes } from "./routes/characters.js";
import { buildComparisonRoutes } from "./routes/comparisons.js";
import { buildJobRoutes } from "./routes/jobs.js";
import { buildRealmRoutes } from "./routes/realms.js";
import { buildPublicScoreModelRoutes } from "./routes/score-models.js";

declare module "fastify" {
  interface FastifyInstance {
    container: ApiContainer;
  }
}

export interface BuildAppOptions {
  env?: AppEnv;
  container?: ApiContainer;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();
  const container = options.container ?? createApiContainer(env);

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

  app.decorate("container", container);
  app.addHook("onClose", async () => {
    await container.close();
  });

  app.addHook("onResponse", async (request, reply) => {
    getMetricsRegistry().recordHttpRequest(
      request.routeOptions.url ?? request.url,
      request.method,
      reply.statusCode,
      reply.elapsedTime,
    );
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.NODE_ENV === "test" ? 10_000 : 120,
    timeWindow: "1 minute",
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "M+ Trust Factor API",
        version: env.APP_VERSION,
        description:
          "Agent 5 backend surface: public character/comparison/score-model routes with " +
          "stale-while-revalidate refresh semantics, plus MVP-protected admin routes for score " +
          "model and mechanic-rule administration.",
      },
      servers: [{ url: env.PUBLIC_BASE_URL }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  app.setErrorHandler((error, request, reply) => {
    if (isHttpError(error)) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, "request failed");
      } else {
        request.log.warn({ err: error }, "request rejected");
      }
      void reply.status(error.statusCode).send(error.toEnvelope(request.id));
      return;
    }

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
        retryable: statusCode >= 500 || statusCode === 429,
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
      const database = await checkDatabaseHealth(container.worker.prisma);
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

  app.get(
    "/metrics",
    {
      schema: {
        tags: ["observability"],
        response: {
          200: { type: "string", contentMediaType: "text/plain" },
        },
      },
    },
    async (_request, reply) => {
      return reply.type("text/plain").send(getMetricsRegistry().toPrometheusText());
    },
  );

  await app.register(buildRealmRoutes(container));
  await app.register(buildCharacterRoutes(container));
  await app.register(buildComparisonRoutes(container));
  await app.register(buildPublicScoreModelRoutes(container));
  await app.register(buildJobRoutes(container));
  await app.register(buildAdminRoutes(container));

  return app;
}
