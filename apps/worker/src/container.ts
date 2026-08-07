import { Redis, type RedisOptions } from "ioredis";
import type { AppEnv } from "@mplus/config";
import { createPrismaClient, type PrismaClient } from "@mplus/database";
import { createLogger, type Logger } from "@mplus/observability";
import type { BlizzardProvider, ProviderName, RaiderIoProvider, WarcraftLogsProvider } from "@mplus/contracts";
import { resolveWorkerProviders } from "./providers/provider-factory.js";
import { createRepositories, type WorkerRepositories } from "./persistence/index.js";

export interface WorkerProviders {
  blizzard: BlizzardProvider;
  warcraftlogs: WarcraftLogsProvider;
  raiderio: RaiderIoProvider;
}

export interface WorkerContainer {
  env: AppEnv;
  prisma: PrismaClient;
  logger: Logger;
  /** Factory so tests/producers can open independent Redis connections. */
  createRedisConnection: (options?: RedisOptions) => Redis;
  providers: WorkerProviders;
  disabledProviders: Set<ProviderName>;
  repositories: WorkerRepositories;
}

export interface WorkerContainerOverrides {
  prisma?: PrismaClient;
  logger?: Logger;
  providers?: Partial<WorkerProviders>;
  disabledProviders?: Set<ProviderName>;
  repositories?: Partial<WorkerRepositories>;
}

/**
 * Wires the worker's dependency graph: database, cache/queue connections,
 * provider adapters (fixture/live via PROVIDER_MODE), and repositories.
 * Scoring goes through scoreCharacter / runAuthoritativeScoring — not calculateScore.
 */
export function createWorkerContainer(
  env: AppEnv,
  overrides: WorkerContainerOverrides = {},
): WorkerContainer {
  const prisma = overrides.prisma ?? createPrismaClient(env.DATABASE_URL);
  const logger = overrides.logger ?? createLogger({ level: env.LOG_LEVEL, name: "worker" });
  const disabledProviders = new Set<ProviderName>(overrides.disabledProviders ?? []);
  if (!env.BLIZZARD_ENABLED) disabledProviders.add("blizzard");
  if (!env.WCL_ENABLED) disabledProviders.add("warcraftlogs");
  if (!env.RAIDERIO_ENABLED) disabledProviders.add("raiderio");
  const providers = resolveWorkerProviders(env, disabledProviders, overrides.providers);
  const repositories = {
    ...createRepositories(prisma, { rawArtifactsDir: env.RAW_ARTIFACTS_DIR }),
    ...overrides.repositories,
  };

  return {
    env,
    prisma,
    logger,
    createRedisConnection: (options?: RedisOptions) =>
      new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, ...options }),
    providers,
    disabledProviders,
    repositories,
  };
}
