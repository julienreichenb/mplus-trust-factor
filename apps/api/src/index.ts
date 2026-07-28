import { getConfigSummary, loadEnv } from "@mplus/config";
import { validateActiveScoreModelAtStartup } from "@mplus/worker";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ env });
  await validateActiveScoreModelAtStartup(env, app.container.worker.prisma, app.container.logger);
  app.log.info({ config: getConfigSummary(env) }, "api configuration summary");
  await app.listen({ host: env.API_HOST, port: env.API_PORT });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "api shutting down");
    // `app.close()` runs the `onClose` hook registered in `buildApp`, which closes the container.
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
