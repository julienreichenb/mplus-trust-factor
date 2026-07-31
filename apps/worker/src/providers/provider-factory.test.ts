import { describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createWarcraftLogsProvider } from "@mplus/provider-warcraftlogs";
import { createRaiderIoProvider } from "@mplus/provider-raiderio";
import { resolveWorkerProviders } from "../providers/provider-factory.js";
import { ProviderDisabledError } from "../providers/fixture-providers.js";

/** Disposable-looking URL for env parsing only — this suite does not open Prisma. */
const baseEnv = {
  DATABASE_URL: "postgresql://mplus:mplus@localhost:5433/mplus_itest_fixture0001?schema=public",
  REDIS_URL: "redis://localhost:6379",
  ADMIN_API_KEY: "test-admin-key",
  SESSION_SECRET: "test-session-secret-at-least-32-chars",
  PROVIDER_MODE: "fixture",
  WEB_ORIGIN: "http://localhost:5173",
  PUBLIC_BASE_URL: "http://localhost:3000",
} as const;

describe("resolveWorkerProviders", () => {
  it("wires package WCL and Raider.IO providers in fixture mode", () => {
    resetEnvCache();
    const env = loadEnv({ ...process.env, ...baseEnv });
    const providers = resolveWorkerProviders(env, new Set());

    expect(providers.warcraftlogs.name).toBe("warcraftlogs");
    expect(providers.raiderio.name).toBe("raiderio");
    expect(providers.blizzard.name).toBe("blizzard");

    expect(createWarcraftLogsProvider("fixture", env).name).toBe("warcraftlogs");
    expect(createRaiderIoProvider("fixture").enabled).toBe(true);
  });

  it("honours disabled provider flags", () => {
    resetEnvCache();
    const env = loadEnv({ ...process.env, ...baseEnv });
    const providers = resolveWorkerProviders(env, new Set(["warcraftlogs", "raiderio"]));
    expect(providers.warcraftlogs.name).toBe("warcraftlogs");
    expect(providers.raiderio.name).toBe("raiderio");
  });

  it("honours env enable flags without requiring live credentials in fixture mode", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...process.env,
      ...baseEnv,
      BLIZZARD_ENABLED: "false",
      WCL_ENABLED: "false",
      RAIDERIO_ENABLED: "false",
    });
    const providers = resolveWorkerProviders(env, new Set());
    await expect(
      providers.blizzard.getRealm("tarren-mill", {
        region: "EU",
        requestId: "t",
        correlationId: null,
        forceRefresh: false,
        now: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(ProviderDisabledError);
  });
});
