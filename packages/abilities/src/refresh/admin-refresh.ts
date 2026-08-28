/**
 * Server-side pinned catalog refresh — composes extract + shadow diff + import plan inputs.
 * Used by admin API; not part of worker scoring runtime.
 */

import type { CatalogRefreshReport } from "./types.js";
import type { TopologyClassificationLike } from "./review/import-plan.js";
import { runShadowCatalogRefresh } from "./pipeline.js";
import {
  extractBlizzardRefreshSnapshot,
  type BlizzardStaticGetter,
} from "./extract/blizzard-collector.js";
import {
  extractSimcSpellQuerySnapshot,
  SimcExtractionError,
} from "./extract/simc-runner.js";
import {
  resolveCatalogSimcBinary,
  SimcNotConfiguredError,
} from "./extract/simc-path.js";
import { importBlizzardRefreshSnapshot } from "./sources/blizzard.js";
import { importSimcSpellQuerySnapshot, type SimcSpellQueryExport } from "./sources/simc.js";

export type AdminCatalogRefreshPhase =
  | "IDLE"
  | "REFRESHING"
  | "REVIEW_REQUIRED"
  | "READY_TO_ACTIVATE"
  | "ACTIVE"
  | "FAILED";

export class AdminCatalogRefreshError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AdminCatalogRefreshError";
    this.code = code;
  }
}

export interface RunAdminPinnedCatalogRefreshInput {
  /** Explicit SimC path override (ABILITY_CATALOG_SIMC_BIN). Optional when bundled default exists. */
  simcBin?: string | null;
  /**
   * @deprecated No longer required. Kept only as optional expected-revision assertion.
   */
  simcRevision?: string | null;
  /** Optional CI/assertion pin compared against binary-reported revision. */
  expectedSimcRevision?: string | null;
  blizzardGetter: BlizzardStaticGetter;
  blizzardRegion: string;
  blizzardLocale: string;
  blizzardNamespace: string;
  /** Previous SimC snapshot JSON for temporal diff (optional). */
  previousSimc?: SimcSpellQueryExport | null;
}

export interface RunAdminPinnedCatalogRefreshResult {
  report: CatalogRefreshReport;
  topologyClassification: TopologyClassificationLike;
  reportBytes: Buffer;
  simcBytes: Buffer;
  blizzardBytes: Buffer;
  simcFile: SimcSpellQueryExport;
  reviewRequired: boolean;
  summary: string;
}

export async function runAdminPinnedCatalogRefresh(
  input: RunAdminPinnedCatalogRefreshInput,
): Promise<RunAdminPinnedCatalogRefreshResult> {
  let simcBin: string;
  try {
    simcBin = resolveCatalogSimcBinary({ overridePath: input.simcBin }).path;
  } catch (error) {
    if (error instanceof SimcNotConfiguredError) {
      throw new AdminCatalogRefreshError(error.code, error.message);
    }
    throw error;
  }

  const expectedSimcRevision =
    input.expectedSimcRevision?.trim() || input.simcRevision?.trim() || null;

  let simcFile: SimcSpellQueryExport;
  try {
    simcFile = await extractSimcSpellQuerySnapshot({
      simcBin,
      expectedSimcRevision: expectedSimcRevision ?? undefined,
    });
  } catch (error) {
    if (error instanceof SimcExtractionError) {
      throw new AdminCatalogRefreshError(error.code, error.message);
    }
    throw error;
  }

  const blizzardFile = await extractBlizzardRefreshSnapshot({
    getter: input.blizzardGetter,
    region: input.blizzardRegion,
    locale: input.blizzardLocale,
    namespace: input.blizzardNamespace,
    spellIds: (simcFile.spells ?? [])
      .map((s) => s.spellId)
      .filter((id): id is number => Number.isInteger(id) && id > 0),
    wowBuild: simcFile.binaryIdentity?.wowBuild ?? undefined,
  });

  const snapshots = [
    importBlizzardRefreshSnapshot(blizzardFile),
    importSimcSpellQuerySnapshot(simcFile),
  ];

  const { report, topologyClassification } = runShadowCatalogRefresh({
    snapshots,
    previousSimc: input.previousSimc ?? undefined,
    currentSimc: simcFile,
  });

  if (report.datasetKind !== "PINNED") {
    throw new AdminCatalogRefreshError(
      "REPORT_NOT_PINNED",
      `Refresh report must be PINNED (got ${report.datasetKind})`,
    );
  }

  const payload = { ...report, topologyClassification };
  const reportBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const simcBytes = Buffer.from(JSON.stringify(simcFile), "utf8");
  const blizzardBytes = Buffer.from(JSON.stringify(blizzardFile), "utf8");

  const actionableCount =
    (report.review?.strongNewCandidates.length ?? 0) +
    (report.review?.bindingReview.length ?? 0) +
    (report.review?.removalReview.length ?? 0);
  const reviewRequired = actionableCount > 0;

  return {
    report,
    topologyClassification,
    reportBytes,
    simcBytes,
    blizzardBytes,
    simcFile,
    reviewRequired,
    summary: [
      `changes=${report.diff.length}`,
      `actionable=${actionableCount}`,
      `reviewRequired=${reviewRequired}`,
      `valid=${report.validation.valid}`,
      `simcRev=${simcFile.simcCommitSha}`,
      `simcApp=${simcFile.binaryIdentity?.applicationVersion ?? "?"}`,
      `wowBuild=${simcFile.binaryIdentity?.wowBuild ?? "?"}`,
      `dataMode=${simcFile.binaryIdentity?.dataMode ?? "?"}`,
    ].join(" "),
  };
}
