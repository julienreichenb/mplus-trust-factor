import { createServer, type Server } from "node:http";
import { getConfigSummary, loadEnv } from "@mplus/config";
import { QUEUE_NAMES } from "@mplus/contracts";
import { createWorkerContainer } from "./container.js";
import { closeWorkers, createWorkers } from "./processors.js";
import { createQueueProducers } from "./queues.js";

function startHealthServer(
  port: number,
  checkReady: () => Promise<{ ok: boolean; detail?: string }>,
): Server {
  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "/";
      if (req.method === "GET" && url.startsWith("/health/live")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (req.method === "GET" && url.startsWith("/health/ready")) {
        const ready = await checkReady();
        res.writeHead(ready.ok ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: ready.ok ? "ok" : "not_ready", detail: ready.detail }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    })();
  });
  server.listen(port, "0.0.0.0");
  return server;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const container = createWorkerContainer(env);
  const connection = container.createRedisConnection();

  const producers = createQueueProducers(connection, container);
  const workers = createWorkers(connection, container);

  // `run()` resolves only once the worker is closed, so it must not be awaited here.
  for (const worker of workers) {
    void worker.run().catch((error) => {
      container.logger.error({ queue: worker.name, err: error }, "worker run loop crashed");
    });
  }

  let healthServer: Server | null = null;
  if (env.WORKER_HEALTH_PORT > 0) {
    healthServer = startHealthServer(env.WORKER_HEALTH_PORT, async () => {
      try {
        const pong = await connection.ping();
        if (pong !== "PONG") {
          return { ok: false, detail: "redis_ping_failed" };
        }
        await container.prisma.$queryRaw`SELECT 1`;
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "readiness_check_failed",
        };
      }
    });
    container.logger.info({ port: env.WORKER_HEALTH_PORT }, "worker health server listening");
  }

  container.logger.info(
    {
      queues: Object.values(QUEUE_NAMES),
      status: "ready",
      config: getConfigSummary(env),
    },
    "worker started",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    container.logger.info({ signal }, "worker shutting down");
    if (healthServer) {
      await new Promise<void>((resolve) => healthServer!.close(() => resolve()));
    }
    await closeWorkers(workers);
    await producers.close();
    await connection.quit();
    await container.prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
