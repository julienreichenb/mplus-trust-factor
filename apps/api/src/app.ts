import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
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
import { checkRedisHealth } from "./lib/redis-health.js";
import { buildAuthRoutes } from "./iam/routes-auth.js";
import { createSessionPreHandler } from "./iam/session.js";
import { ensureIamSeed } from "./iam/seed.js";

declare module "fastify" {
  interface FastifyInstance {
    container: ApiContainer;
  }
}

export interface BuildAppOptions {
  env?: AppEnv;
  container?: ApiContainer;
  /** Skip IAM role/permission seed (unit tests that do not need DB roles). */
  skipIamSeed?: boolean;
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
    credentials: true,
  });

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.NODE_ENV === "test" ? 10_000 : 120,
    timeWindow: "1 minute",
  });

  if (!options.skipIamSeed) {
    try {
      await ensureIamSeed(container.worker.prisma);
    } catch (error) {
      container.logger.warn({ err: error }, "IAM seed skipped or failed");
    }
  }

  app.addHook("preHandler", createSessionPreHandler(container.authService, env));

  await app.register(swagger, {
    openapi: {
      info: {
        title: "M+ Trust Factor API",
        version: env.APP_VERSION,
        description:
          "Public character/comparison routes with SWR refresh, Battle.net OAuth IAM, " +
          "and permission-protected admin routes (shared admin key retained as emergency fallback).",
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
            additionalProperties: true,
            properties: {
              status: { type: "string" },
            },
          },
          503: {
            type: "object",
            additionalProperties: true,
            properties: {
              status: { type: "string" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const database = await checkDatabaseHealth(container.worker.prisma);
      const providers = {
        blizzard: {
          enabled: env.BLIZZARD_ENABLED,
          configured:
            env.PROVIDER_MODE === "fixture" ||
            Boolean(env.BLIZZARD_CLIENT_ID && env.BLIZZARD_CLIENT_SECRET),
        },
        raiderio: {
          enabled: env.RAIDERIO_ENABLED,
          // App key is optional; fixture mode always counts as configured.
          configured: env.PROVIDER_MODE === "fixture" || env.RAIDERIO_ENABLED,
        },
        warcraftlogs: {
          enabled: env.WCL_ENABLED,
          configured:
            env.PROVIDER_MODE === "fixture" || Boolean(env.WCL_CLIENT_ID && env.WCL_CLIENT_SECRET),
        },
      };

      let redis: { ok: boolean; latencyMs: number; skipped?: boolean; error?: string };
      if (container.queueMode === "inline") {
        redis = { ok: true, latencyMs: 0, skipped: true };
      } else {
        redis = await checkRedisHealth(() =>
          container.worker.createRedisConnection({
            connectTimeout: 2_000,
            maxRetriesPerRequest: 1,
            enableReadyCheck: true,
            lazyConnect: true,
          }),
        );
      }

      const ready = database.ok && redis.ok;
      const body = {
        status: ready ? "ready" : "not_ready",
        database: {
          ok: database.ok,
          latencyMs: database.latencyMs,
          ...(database.ok ? {} : { error: "database unreachable" }),
        },
        redis: {
          ok: redis.ok,
          latencyMs: redis.latencyMs,
          ...(redis.skipped ? { skipped: true } : {}),
          ...(redis.ok ? {} : { error: "redis unreachable" }),
        },
        queueMode: container.queueMode,
        providers,
      };
      if (!ready) {
        return reply.status(503).send(body);
      }
      return body;
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
  await app.register(buildAuthRoutes(env, container.authService));

  return app;
}
