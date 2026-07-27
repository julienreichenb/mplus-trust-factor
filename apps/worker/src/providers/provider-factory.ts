import type { AppEnv } from "@mplus/config";
import { createBlizzardProvider, type BlizzardClientOptions } from "@mplus/provider-blizzard";
import type { BlizzardProvider, ProviderName, RaiderIoProvider, WarcraftLogsProvider } from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerProviders } from "../container.js";
import {
  createDisabledProvider,
  createFixtureBlizzardProvider,
  createFixtureRaiderIoProvider,
  createFixtureWarcraftLogsProvider,
} from "./fixture-providers.js";

const fixtureRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../tools/fixtures/blizzard");

function blizzardClientOptions(env: AppEnv): BlizzardClientOptions {
  return {
    clientId: env.BLIZZARD_CLIENT_ID,
    clientSecret: env.BLIZZARD_CLIENT_SECRET,
    defaultRegion: env.BLIZZARD_DEFAULT_REGION as BlizzardClientOptions["defaultRegion"],
    defaultLocale: env.BLIZZARD_DEFAULT_LOCALE,
    concurrency: env.BLIZZARD_REQUEST_CONCURRENCY,
    characterTtlSeconds: env.BLIZZARD_CHARACTER_TTL_SECONDS,
    fixtureDir: fixtureRoot,
  };
}

/**
 * Composite Blizzard provider: tries the Agent-01 file-fixture package first, then falls back to
 * worker-local seeded fixtures so arbitrary test identities keep working.
 */
function createCompositeFixtureBlizzardProvider(env: AppEnv): BlizzardProvider {
  const packageProvider = createBlizzardProvider("fixture", blizzardClientOptions(env));
  const workerProvider = createFixtureBlizzardProvider();

  const handler: ProxyHandler<BlizzardProvider> = {
    get(target, prop, receiver) {
      if (prop === "name") return "blizzard";
      const packageValue = Reflect.get(packageProvider, prop, receiver);
      const workerValue = Reflect.get(workerProvider, prop, receiver);
      if (typeof packageValue !== "function") return packageValue ?? workerValue;

      return async (...args: unknown[]) => {
        try {
          return await (packageValue as (...a: unknown[]) => Promise<unknown>).apply(packageProvider, args);
        } catch (error) {
          if (error instanceof ExternalApiError && error.code === "NOT_FOUND") {
            return (workerValue as (...a: unknown[]) => Promise<unknown>).apply(workerProvider, args);
          }
          throw error;
        }
      };
    },
  };

  return new Proxy(packageProvider, handler);
}

function resolveBlizzardProvider(env: AppEnv): BlizzardProvider {
  if (env.PROVIDER_MODE === "live") {
    return createBlizzardProvider("live", blizzardClientOptions(env));
  }
  return createCompositeFixtureBlizzardProvider(env);
}

/** Builds provider ports from env, honouring disabled-provider flags and test overrides. */
export function resolveWorkerProviders(
  env: AppEnv,
  disabledProviders: Set<ProviderName>,
  overrides: Partial<WorkerProviders> = {},
): WorkerProviders {
  return {
    blizzard:
      overrides.blizzard ??
      (disabledProviders.has("blizzard")
        ? createDisabledProvider("blizzard")
        : resolveBlizzardProvider(env)),
    warcraftlogs:
      overrides.warcraftlogs ??
      (disabledProviders.has("warcraftlogs")
        ? createDisabledProvider("warcraftlogs")
        : createFixtureWarcraftLogsProvider()),
    raiderio:
      overrides.raiderio ??
      (disabledProviders.has("raiderio")
        ? createDisabledProvider("raiderio")
        : createFixtureRaiderIoProvider()),
  };
}
