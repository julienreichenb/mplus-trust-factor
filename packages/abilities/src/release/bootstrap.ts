import { getAllRegisteredRules } from "../registry.js";
import {
  CATALOG_GAME_VERSION,
  CATALOG_SEASON_SLUG,
  CATALOG_SOURCE_SNAPSHOT,
  CURRENT_CATALOG_VERSION_ID,
} from "../version.js";
import { compileAbilityCatalogRelease } from "./compile.js";
import {
  compareStaticCatalogToReleaseArtifact,
  formatParityReportHuman,
  type AbilityCatalogParityReport,
} from "./parity.js";
import { currentStaticReleaseTopology, topologyCounts } from "./topology.js";
import { validateAbilityCatalogReleaseArtifact } from "./validate-artifact.js";
import type { AbilityCatalogReleaseArtifact } from "./types.js";
import {
  BOOTSTRAP_MANIFEST_ORIGIN,
  BOOTSTRAP_WOW_BUILD,
} from "./types.js";

export interface BootstrapRelease0Result {
  artifact: AbilityCatalogReleaseArtifact;
  serializedJson: string;
  byteSize: number;
  validation: ReturnType<typeof validateAbilityCatalogReleaseArtifact>;
  parity: AbilityCatalogParityReport;
  topology: ReturnType<typeof topologyCounts>;
}

/**
 * Compile Bootstrap Release 0 from the current static production catalog.
 * Curated changes = NONE. Does not activate or publish.
 */
export function compileBootstrapRelease0(options?: {
  generatedAt?: string;
}): BootstrapRelease0Result {
  const rules = getAllRegisteredRules();
  const topology = currentStaticReleaseTopology();

  const artifact = compileAbilityCatalogRelease({
    baseRules: rules,
    baseTopology: topology,
    changes: [],
    gameVersion: CATALOG_GAME_VERSION,
    wowBuild: BOOTSTRAP_WOW_BUILD,
    seasonSlug: CATALOG_SEASON_SLUG,
    previousReleaseId: null,
    manifest: {
      origin: BOOTSTRAP_MANIFEST_ORIGIN,
      staticCatalogVersionId: CURRENT_CATALOG_VERSION_ID,
      sourceSnapshot: CATALOG_SOURCE_SNAPSHOT,
      curatedChangeIds: [],
      notes:
        "Bootstrap Release 0 from RETAIL_ABILITY_CATALOG. Does not claim SimC validation, Blizzard provenance for every rule, Phase 3A review approval, publication, or ACTIVE status.",
    },
    generatedAt: options?.generatedAt,
  });

  // Pretty JSON for --out readability (contentDigest hashes semantic content, not envelope formatting)
  const serializedJson = `${JSON.stringify(artifact, null, 2)}\n`;
  const byteSize = Buffer.byteLength(serializedJson, "utf8");

  const validation = validateAbilityCatalogReleaseArtifact(artifact);
  const parity = compareStaticCatalogToReleaseArtifact(artifact, {
    serializedByteSize: byteSize,
  });

  return {
    artifact,
    serializedJson,
    byteSize,
    validation,
    parity,
    topology: topologyCounts(artifact.topology),
  };
}

export function formatBootstrapSummary(result: BootstrapRelease0Result): string {
  return [
    "Ability catalog Bootstrap Release 0",
    "THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.",
    `schemaVersion=${result.artifact.schemaVersion}`,
    `releaseKey=${result.artifact.releaseKey}`,
    `contentDigest=${result.artifact.contentDigest}`,
    `topologyDigest=${result.artifact.topologyDigest}`,
    `wowBuild=${result.artifact.wowBuild} (identity limitation: no trustworthy exact historical build)`,
    `gameVersion=${result.artifact.gameVersion}`,
    `seasonSlug=${result.artifact.seasonSlug}`,
    `staticCatalogVersionId=${result.artifact.manifest.staticCatalogVersionId}`,
    `ruleCount=${result.artifact.rules.length}`,
    `topology classes=${result.topology.classCount} specs=${result.topology.specCount} races=${result.topology.raceCount}`,
    `serializedByteSize=${result.byteSize}`,
    `artifactValid=${result.validation.valid}`,
    formatParityReportHuman(result.parity),
  ].join("\n");
}
