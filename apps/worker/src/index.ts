import { loadEnv } from "@mplus/config";
import { QUEUE_NAMES } from "@mplus/contracts";
import { createWorkerContainer } from "./container.js";
import { closeWorkers, createWorkers } from "./processors.js";
import { createQueueProducers } from "./queues.js";

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

  container.logger.info(
    { queues: Object.values(QUEUE_NAMES), status: "ready", providerMode: env.PROVIDER_MODE },
    "worker started",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    container.logger.info({ signal }, "worker shutting down");
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
