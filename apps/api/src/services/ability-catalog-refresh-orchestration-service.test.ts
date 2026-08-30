import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAdminPinnedCatalogRefresh, AdminCatalogRefreshError } = vi.hoisted(() => {
  class AdminCatalogRefreshError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    runAdminPinnedCatalogRefresh: vi.fn(),
    AdminCatalogRefreshError,
  };
});

vi.mock("@mplus/abilities/refresh/admin", () => ({
  runAdminPinnedCatalogRefresh,
  AdminCatalogRefreshError,
}));

vi.mock("@mplus/provider-blizzard", () => ({
  getRegionConfig: () => ({
    apiHost: "https://eu.api.blizzard.com",
    staticNamespace: "static-eu",
    defaultLocale: "en_GB",
  }),
  BlizzardTokenManager: class {
    async getAccessToken() {
      return "token";
    }
  },
  resolveRegionKey: () => "eu",
}));

vi.mock("@mplus/database", () => ({
  createPostgresArtifactStore: () => ({
    read: async () => ({ bytes: Buffer.from("{}") }),
  }),
}));

import { AbilityCatalogRefreshOrchestrationService } from "./ability-catalog-refresh-orchestration-service.js";

describe("AbilityCatalogRefreshOrchestrationService sync path", () => {
  const importPinnedReport = vi.fn();
  const getActiveBaseline = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getActiveBaseline.mockResolvedValue(null);
    importPinnedReport.mockResolvedValue({
      batch: { id: "batch-1" },
      created: true,
    });
    runAdminPinnedCatalogRefresh.mockResolvedValue({
      report: {
        datasetKind: "PINNED",
        validation: { valid: true },
        snapshots: [],
        wowBuild: "11.0.0",
      },
      reportBytes: Buffer.from("{}"),
      topologyClassification: {},
      simcBytes: Buffer.from("{}"),
      blizzardBytes: Buffer.from("{}"),
      reviewRequired: true,
      summary: "ok",
    });
  });

  it("runs SimC+Blizzard refresh then import and never activates", async () => {
    const prisma = {
      rawArtifact: { findUnique: vi.fn() },
    } as never;
    const env = {
      ABILITY_CATALOG_SIMC_BIN: "/usr/local/bin/simc",
      BLIZZARD_CLIENT_ID: "id",
      BLIZZARD_CLIENT_SECRET: "secret",
    } as never;

    const svc = new AbilityCatalogRefreshOrchestrationService(prisma, env);
    (
      svc as unknown as {
        review: {
          getActiveBaseline: typeof getActiveBaseline;
          importPinnedReport: typeof importPinnedReport;
        };
      }
    ).review = {
      getActiveBaseline,
      importPinnedReport,
    };

    const result = await svc.runRefresh({
      userId: null,
      actorType: "system",
      sessionSecret: "x".repeat(32),
    });

    expect(runAdminPinnedCatalogRefresh).toHaveBeenCalledOnce();
    expect(importPinnedReport).toHaveBeenCalledOnce();
    expect(result.activeUnchanged).toBe(true);
    expect(result.batchId).toBe("batch-1");
    expect(result.created).toBe(true);
  });

  it("propagates SimC failure without importing", async () => {
    runAdminPinnedCatalogRefresh.mockRejectedValue(
      new AdminCatalogRefreshError("SIMC_EXTRACT_FAILED", "simc failed"),
    );
    const prisma = { rawArtifact: { findUnique: vi.fn() } } as never;
    const env = {
      ABILITY_CATALOG_SIMC_BIN: "/usr/local/bin/simc",
      BLIZZARD_CLIENT_ID: "id",
      BLIZZARD_CLIENT_SECRET: "secret",
    } as never;
    const svc = new AbilityCatalogRefreshOrchestrationService(prisma, env);
    (
      svc as unknown as {
        review: {
          getActiveBaseline: typeof getActiveBaseline;
          importPinnedReport: typeof importPinnedReport;
        };
      }
    ).review = {
      getActiveBaseline,
      importPinnedReport,
    };

    await expect(
      svc.runRefresh({ userId: null, actorType: "system", sessionSecret: "x".repeat(32) }),
    ).rejects.toMatchObject({ code: "SIMC_EXTRACT_FAILED" });
    expect(importPinnedReport).not.toHaveBeenCalled();
  });
});
