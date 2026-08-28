import { describe, expect, it } from "vitest";
import {
  BUNDLED_LINUX_SIMC_PATH,
  resolveCatalogSimcBinary,
  SimcNotConfiguredError,
} from "./simc-path.js";
import { deriveSimcRevisionIdentity } from "./simc-revision.js";
import { assertLiveSimcIdentity, parseSimcBinaryBanner } from "./simc-identity.js";
import { importSimcSpellQuerySnapshot } from "../sources/simc.js";
import { GOLDEN_SIMC_SNAPSHOT } from "../fixtures/golden-retail.js";
import { runAdminPinnedCatalogRefresh, AdminCatalogRefreshError } from "../admin-refresh.js";

describe("resolveCatalogSimcBinary", () => {
  it("prefers explicit override when present", () => {
    const resolved = resolveCatalogSimcBinary({
      overridePath: "C:\\Tools\\SimulationCraft\\simc.exe",
      platform: "win32",
      existsSync: (p) => p === "C:\\Tools\\SimulationCraft\\simc.exe",
    });
    expect(resolved).toEqual({
      path: "C:\\Tools\\SimulationCraft\\simc.exe",
      source: "OVERRIDE",
    });
  });

  it("uses bundled Linux default when no override", () => {
    const resolved = resolveCatalogSimcBinary({
      platform: "linux",
      existsSync: (p) => p === BUNDLED_LINUX_SIMC_PATH,
    });
    expect(resolved).toEqual({ path: BUNDLED_LINUX_SIMC_PATH, source: "BUNDLED_DEFAULT" });
  });

  it("fails SIMC_NOT_CONFIGURED on Windows without override", () => {
    expect(() =>
      resolveCatalogSimcBinary({
        platform: "win32",
        existsSync: () => false,
      }),
    ).toThrow(SimcNotConfiguredError);
    try {
      resolveCatalogSimcBinary({ platform: "win32", existsSync: () => false });
    } catch (error) {
      expect(error).toMatchObject({ code: "SIMC_NOT_CONFIGURED" });
      expect(String((error as Error).message)).not.toMatch(/REVISION/i);
    }
  });

  it("does not invent a Windows filesystem scan", () => {
    expect(() =>
      resolveCatalogSimcBinary({
        platform: "win32",
        existsSync: (p) => p === "C:\\Program Files\\SimulationCraft\\simc.exe",
      }),
    ).toThrow(/not available for catalog refresh/i);
  });
});

describe("SimC revision identity", () => {
  it("keeps short binary revision honest without fabricating full SHA", () => {
    const id = deriveSimcRevisionIdentity({ binaryReportedRevision: "a060a35" });
    expect(id.revisionPrecision).toBe("PREFIX");
    expect(id.resolvedFullRevision).toBeNull();
    expect(id.canonicalRevision).toBe("a060a35");
  });

  it("expands prefix when expected full SHA matches", () => {
    const full = "a060a356e16fdf266cb8b93fa4a9c892f3e26af3";
    const id = deriveSimcRevisionIdentity({
      binaryReportedRevision: "a060a35",
      expectedRevision: full,
    });
    expect(id.revisionPrecision).toBe("FULL_SHA");
    expect(id.resolvedFullRevision).toBe(full);
    expect(id.canonicalRevision).toBe(full);
  });

  it("still parses historical full-SHA golden snapshots", () => {
    const imported = importSimcSpellQuerySnapshot(GOLDEN_SIMC_SNAPSHOT);
    expect(imported.identity.sourceRevision).toHaveLength(40);
    expect(imported.simulationCraft?.gitCommitSha).toHaveLength(40);
  });
});

describe("admin refresh SimC configuration", () => {
  it("fails with SIMC_NOT_CONFIGURED when no binary is available", async () => {
    const missing = "C:\\definitely-missing-simc-for-test\\simc.exe";
    try {
      await runAdminPinnedCatalogRefresh({
        simcBin: missing,
        blizzardGetter: async () => {
          throw new Error("unused");
        },
        blizzardRegion: "eu",
        blizzardLocale: "en_US",
        blizzardNamespace: "static-eu",
      });
      expect.fail("expected SIMC_NOT_CONFIGURED");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminCatalogRefreshError);
      expect(error).toMatchObject({ code: "SIMC_NOT_CONFIGURED" });
      expect(String((error as Error).message)).toMatch(/ABILITY_CATALOG_SIMC_BIN|not found|bundled/i);
      expect(String((error as Error).message)).not.toMatch(/SIMC_REVISION/);
    }
  });
});

describe("assertLiveSimcIdentity fail-closed", () => {
  it("rejects unreported data mode without requiring env SHA", () => {
    const identity = parseSimcBinaryBanner(
      "SimulationCraft 1200-01 for World of Warcraft 12.0.0 (git build midnight aaaaaaa)\n",
      "simc",
    );
    expect(() => assertLiveSimcIdentity(identity)).toThrow(/DATA_MODE|Live\/PTR/i);
  });
});
