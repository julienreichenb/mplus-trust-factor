import { describe, expect, it } from "vitest";
import { loadEnv } from "@mplus/config";
import { createWarcraftLogsProvider } from "@mplus/provider-warcraftlogs";
import { createRaiderIoProvider } from "@mplus/provider-raiderio";
import { resolveWorkerProviders } from "../providers/provider-factory.js";

describe("resolveWorkerProviders", () => {
  it("wires package WCL and Raider.IO providers in fixture mode", () => {
    const env = loadEnv();
    const providers = resolveWorkerProviders(env, new Set());

    expect(providers.warcraftlogs.name).toBe("warcraftlogs");
    expect(providers.raiderio.name).toBe("raiderio");
    expect(providers.blizzard.name).toBe("blizzard");

    expect(createWarcraftLogsProvider("fixture", env).name).toBe("warcraftlogs");
    expect(createRaiderIoProvider("fixture").enabled).toBe(true);
  });

  it("honours disabled provider flags", () => {
    const env = loadEnv();
    const providers = resolveWorkerProviders(env, new Set(["warcraftlogs", "raiderio"]));
    expect(providers.warcraftlogs.name).toBe("warcraftlogs");
    expect(providers.raiderio.name).toBe("raiderio");
  });
});
