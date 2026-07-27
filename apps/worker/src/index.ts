import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "@mplus/config";
import { QUEUE_NAMES } from "@mplus/contracts";
import { createLogger } from "@mplus/observability";
import { createWorkers } from "./processors.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, name: "worker" });
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  // Ensure named queues exist for observability even before producers enqueue.
  const queues = Object.values(QUEUE_NAMES).map(
    (name) => new Queue(name, { connection }),
  );

  const workers = createWorkers(connection, logger);
  for (const worker of workers) {
    worker.on("failed", (job, error) => {
      logger.error({ jobId: job?.id, queue: worker.name, err: error }, "job failed");
    });
    await worker.run();
  }

  logger.info(
    {
      queues: Object.values(QUEUE_NAMES),
      status: "ready",
      note: "Processors explicitly NotImplemented until Agent 5 orchestration",
    },
    "worker started",
  );

  const shutdown = async () => {
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all(queues.map((queue) => queue.close()));
    await connection.quit();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
