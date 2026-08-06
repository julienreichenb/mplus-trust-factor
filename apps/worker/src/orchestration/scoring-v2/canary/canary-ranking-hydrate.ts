/**
 * Guarded ranking-only metadata hydrate for selected manifest fights missing
 * ranking evidence. Zero capability event pages. Zero package acquisitions.
 * Zero digest creation. Does not publish. Does not run discovery.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@mplus/database";
import type { WorkerContainer } from "../../../container.js";
import { rankingParseCompatibilityKey } from "../run-orchestration/ranking-hydrate.js";
import { RANKING_PARSE_DATASET_KEY } from "./canary-ranking-lineage.js";
import { loadCompatibleFrozenManifest } from "./canary-live.js";
import type { CanarySeasonResolution } from "./canary-season.js";

export const CANARY_RANKING_HYDRATE_SCHEMA =
  "scoring-v2-canary-ranking-hydrate-v1" as const;

export type FetchRankingMetadataOnly = (input: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  characterName: string;
  region: string;
  realm: string;
}) => Promise<{
  artifactBytes: Buffer;
  payloadFingerprint: string;
  parsePercentile: number | null;
  parseSemantic: string;
} | null>;

export interface CanaryRankingHydrateReport {
  schemaVersion: typeof CANARY_RANKING_HYDRATE_SCHEMA;
  manifestId: string;
  selectedMissingBefore: number;
  rankingPersisted: number;
  rankingSkippedAlreadyReady: number;
  rankingStillMissing: number;
  capabilityEventPageRequests: 0;
  packageAcquisitions: 0;
  digestsCreated: 0;
  providerCalls: number;
  publicationEnabled: false;
  fights: Array<{
    slotId: string;
    reportCode: string;
    fightId: number;
    reportRevision: number;
    lookupKey: string;
    outcome: "READY" | "ALREADY_READY" | "ABSENT" | "FETCH_NULL";
  }>;
}

/**
 * Persist ranking/parse metadata for selected slots that lack READY evidence.
 * `fetchRanking` is injected; production wires a rankings-only WCL client.
 * Callers that must stay provider-free should not invoke this with a live fetch.
 */
export async function runScoringV2CanaryRankingHydrate(input: {
  prisma: PrismaClient;
  container: WorkerContainer;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  season: CanarySeasonResolution;
  confirmRankingHydrate: boolean;
  fetchRanking?: FetchRankingMetadataOnly;
  outputDir?: string;
}): Promise<{ report: CanaryRankingHydrateReport; reportPath: string }> {
  if (!input.confirmRankingHydrate) {
    throw Object.assign(
      new Error("ranking_hydrate_requires_--confirm-ranking-hydrate"),
      { code: "RANKING_HYDRATE_CONFIRM_REQUIRED" },
    );
  }
  if (!input.season.seasonId || !input.season.dungeonPoolHash) {
    throw Object.assign(new Error("ranking_hydrate_season_invalid"), {
      code: "SEASON_CATALOG_MISMATCH",
    });
  }

  const frozen = await loadCompatibleFrozenManifest({
    prisma: input.prisma,
    characterId: input.characterId,
    seasonId: input.season.seasonId,
    expectedDungeonSlugs: input.season.activeDungeonSlugs,
    dungeonPoolHash: input.season.dungeonPoolHash,
  });
  if (!frozen) {
    throw Object.assign(new Error("ranking_hydrate_manifest_missing"), {
      code: "MANIFEST_NOT_FOUND",
    });
  }

  const slots = await input.prisma.evidenceManifestSlot.findMany({
    where: { manifestId: frozen.rowId, state: "SELECTED" },
    include: {
      dungeon: { select: { slug: true } },
      datasets: { where: { datasetKey: RANKING_PARSE_DATASET_KEY } },
    },
  });

  const fights: CanaryRankingHydrateReport["fights"] = [];
  let rankingPersisted = 0;
  let rankingSkippedAlreadyReady = 0;
  let rankingStillMissing = 0;
  let providerCalls = 0;
  let selectedMissingBefore = 0;

  for (const slot of slots) {
    if (
      slot.reportCode == null ||
      slot.fightId == null ||
      slot.reportRevision == null
    ) {
      continue;
    }
    const lookupKey = rankingParseCompatibilityKey({
      reportCode: slot.reportCode,
      fightId: slot.fightId,
      reportRevision: slot.reportRevision,
    });
    const slotId = `${slot.dungeon.slug}:${slot.slotIndex}`;
    const existingReady =
      slot.datasets.find((d) => d.state === "READY" && d.artifactId) ??
      (await input.container.repositories.evidence.findDatasetByCompatibilityKey(
        lookupKey,
      ));

    if (
      existingReady &&
      existingReady.state === "READY" &&
      existingReady.artifactId
    ) {
      rankingSkippedAlreadyReady += 1;
      fights.push({
        slotId,
        reportCode: slot.reportCode,
        fightId: slot.fightId,
        reportRevision: slot.reportRevision,
        lookupKey,
        outcome: "ALREADY_READY",
      });
      continue;
    }

    selectedMissingBefore += 1;
    if (!input.fetchRanking) {
      rankingStillMissing += 1;
      fights.push({
        slotId,
        reportCode: slot.reportCode,
        fightId: slot.fightId,
        reportRevision: slot.reportRevision,
        lookupKey,
        outcome: "ABSENT",
      });
      continue;
    }

    const fetched = await input.fetchRanking({
      reportCode: slot.reportCode,
      fightId: slot.fightId,
      reportRevision: slot.reportRevision,
      characterName: input.characterName,
      region: input.region,
      realm: input.realm,
    });
    providerCalls += 1;
    if (!fetched) {
      rankingStillMissing += 1;
      fights.push({
        slotId,
        reportCode: slot.reportCode,
        fightId: slot.fightId,
        reportRevision: slot.reportRevision,
        lookupKey,
        outcome: "FETCH_NULL",
      });
      continue;
    }

    // Persist via evidence repository (idempotent create).
    const artifact = await input.container.repositories.artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes: fetched.artifactBytes,
      compression: "GZIP",
      artifactClass: "ranking_parse_evidence_v1",
      owner: {
        ownerType: "EvidenceDataset",
        ownerId: slot.id,
      },
    });
    await input.container.repositories.evidence.createDataset({
      manifestSlotId: slot.id,
      datasetKey: RANKING_PARSE_DATASET_KEY,
      compatibilityKey: lookupKey,
      artifactId: artifact.artifactId,
      schemaVersion: "1.0.0",
      providerContractVersion: "wcl-ranking-parse-v1",
      state: "READY",
      eventCount: 0,
      pageCount: 0,
      truncated: false,
      pointsConsumed: null,
      costSource: "ranking_hydrate_metadata_only",
      payloadFingerprint: fetched.payloadFingerprint,
      fetchedAt: new Date(),
    });
    rankingPersisted += 1;
    fights.push({
      slotId,
      reportCode: slot.reportCode,
      fightId: slot.fightId,
      reportRevision: slot.reportRevision,
      lookupKey,
      outcome: "READY",
    });
  }

  const report: CanaryRankingHydrateReport = {
    schemaVersion: CANARY_RANKING_HYDRATE_SCHEMA,
    manifestId: frozen.rowId,
    selectedMissingBefore,
    rankingPersisted,
    rankingSkippedAlreadyReady,
    rankingStillMissing,
    capabilityEventPageRequests: 0,
    packageAcquisitions: 0,
    digestsCreated: 0,
    providerCalls,
    publicationEnabled: false,
    fights,
  };

  const outDir =
    input.outputDir ?? join(process.cwd(), "artifacts", "scoring-v2-canary");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "ranking-hydrate-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { report, reportPath };
}
