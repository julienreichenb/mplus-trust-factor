/**
 * Admin catalog refresh orchestration — existing extract/diff/import building blocks.
 */

import { getRegionConfig, BlizzardTokenManager, resolveRegionKey } from "@mplus/provider-blizzard";
import {
  runAdminPinnedCatalogRefresh,
  AdminCatalogRefreshError,
  type RunAdminPinnedCatalogRefreshResult,
} from "@mplus/abilities/refresh/admin";
import type { SimcSpellQueryExport } from "@mplus/abilities";
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import { createPostgresArtifactStore } from "@mplus/database";
import { HttpError } from "../errors.js";
import {
  AbilityCatalogReviewService,
  type AbilityCatalogReviewAuditContext,
} from "./ability-catalog-review-service.js";

export class AbilityCatalogRefreshOrchestrationService {
  private readonly review: AbilityCatalogReviewService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
  ) {
    this.review = new AbilityCatalogReviewService(prisma);
  }

  async runRefresh(
    audit: AbilityCatalogReviewAuditContext,
  ): Promise<{
    result: RunAdminPinnedCatalogRefreshResult;
    batchId: string;
    created: boolean;
    reviewRequired: boolean;
    activeUnchanged: true;
  }> {
    const previousSimc = await this.loadPreviousSimcSnapshot();
    let result: RunAdminPinnedCatalogRefreshResult;
    try {
      result = await runAdminPinnedCatalogRefresh({
        simcBin: this.env.ABILITY_CATALOG_SIMC_BIN,
        blizzardGetter: this.buildBlizzardGetter(),
        blizzardRegion: resolveRegionKey("eu"),
        blizzardLocale: getRegionConfig(resolveRegionKey("eu")).defaultLocale,
        blizzardNamespace: getRegionConfig(resolveRegionKey("eu")).staticNamespace,
        previousSimc,
      });
    } catch (error: unknown) {
      if (error instanceof AdminCatalogRefreshError) {
        throw HttpError.badRequest(error.code, error.message);
      }
      throw error;
    }

    const imported = await this.review.importPinnedReport(
      {
        report: result.report,
        reportBytes: result.reportBytes,
        topologyClassification: result.topologyClassification,
        simcBytes: result.simcBytes,
        blizzardBytes: result.blizzardBytes,
        designateBaseline: result.report.validation.valid,
      },
      audit,
    );

    return {
      result,
      batchId: imported.batch.id,
      created: imported.created,
      reviewRequired: result.reviewRequired,
      activeUnchanged: true,
    };
  }

  private buildBlizzardGetter() {
    const clientId = this.env.BLIZZARD_CLIENT_ID ?? "";
    const clientSecret = this.env.BLIZZARD_CLIENT_SECRET ?? "";
    if (!clientId || !clientSecret) {
      throw HttpError.badRequest(
        "BLIZZARD_NOT_CONFIGURED",
        "BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET are required for catalog refresh",
      );
    }
    const regionKey = resolveRegionKey("eu");
    const region = getRegionConfig(regionKey);
    const tokens = new BlizzardTokenManager({ clientId, clientSecret });
    return async ({ path }: { path: string }) => {
      const token = await tokens.getAccessToken();
      const url = new URL(path.replace(/^\//, ""), `${region.apiHost}/`);
      url.searchParams.set("namespace", region.staticNamespace);
      url.searchParams.set("locale", region.defaultLocale);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      let data: unknown = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }
      return { statusCode: response.status, data };
    };
  }

  private async loadPreviousSimcSnapshot(): Promise<SimcSpellQueryExport | null> {
    const baseline = await this.review.getActiveBaseline("SIMULATIONCRAFT");
    if (!baseline?.artifactId) return null;
    const artifact = await this.prisma.rawArtifact.findUnique({
      where: { id: baseline.artifactId },
    });
    if (!artifact) return null;
    const store = createPostgresArtifactStore(this.prisma);
    const read = await store.read(artifact.storageUri, artifact.contentHash);
    return JSON.parse(read.bytes.toString("utf8")) as SimcSpellQueryExport;
  }
}
