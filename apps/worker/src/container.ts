import { Redis, type RedisOptions } from "ioredis";
import type { AppEnv } from "@mplus/config";
import { createPrismaClient, type PrismaClient } from "@mplus/database";
import { createLogger, type Logger } from "@mplus/observability";
import type { BlizzardProvider, ProviderName, RaiderIoProvider, WarcraftLogsProvider } from "@mplus/contracts";
import { calculateScore } from "@mplus/scoring";
import { createFixtureBlizzardProvider } from "./providers/fixture-providers.js";
import { createFixtureWarcraftLogsProvider } from "./providers/fixture-providers.js";
import { createFixtureRaiderIoProvider } from "./providers/fixture-providers.js";
import { createDisabledProvider } from "./providers/fixture-providers.js";
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
  calculateScore: typeof calculateScore;
  repositories: WorkerRepositories;
}

export interface WorkerContainerOverrides {
  prisma?: PrismaClient;
  logger?: Logger;
  providers?: Partial<WorkerProviders>;
  disabledProviders?: Set<ProviderName>;
  calculateScore?: typeof calculateScore;
  repositories?: Partial<WorkerRepositories>;
}

function buildProviders(
  disabledProviders: Set<ProviderName>,
  overrides?: Partial<WorkerProviders>,
): WorkerProviders {
  return {
    blizzard:
      overrides?.blizzard ??
      (disabledProviders.has("blizzard")
        ? createDisabledProvider("blizzard")
        : createFixtureBlizzardProvider()),
    warcraftlogs:
      overrides?.warcraftlogs ??
      (disabledProviders.has("warcraftlogs")
        ? createDisabledProvider("warcraftlogs")
        : createFixtureWarcraftLogsProvider()),
    raiderio:
      overrides?.raiderio ??
      (disabledProviders.has("raiderio")
        ? createDisabledProvider("raiderio")
        : createFixtureRaiderIoProvider()),
  };
}

/**
 * Wires the worker's dependency graph: database, cache/queue connections,
 * fixture provider adapters, scoring, and repositories.
 */
export function createWorkerContainer(
  env: AppEnv,
  overrides: WorkerContainerOverrides = {},
): WorkerContainer {
  const prisma = overrides.prisma ?? createPrismaClient(env.DATABASE_URL);
  const logger = overrides.logger ?? createLogger({ level: env.LOG_LEVEL, name: "worker" });
  const disabledProviders = overrides.disabledProviders ?? new Set<ProviderName>();
  const providers = buildProviders(disabledProviders, overrides.providers);
  const repositories = {
    ...createRepositories(prisma),
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
    calculateScore: overrides.calculateScore ?? calculateScore,
    repositories,
  };
}
