/**
 * Guarded ranking-only metadata hydrate for selected manifest fights missing
 * ranking evidence. Zero capability event pages. Zero package acquisitions.
 * Zero digest creation. Does not publish. Does not run discovery.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import {
  RANKING_PARSE_PROVIDER_CONTRACT,
  RANKING_PARSE_SCHEMA_VERSION,
  type RankingParseEvidenceV2,
} from "@mplus/provider-warcraftlogs";
import type { WorkerContainer } from "../../../container.js";
import { assertPublicationBlocked } from "../acquisition.js";
import {
  assertOperatorRepositoryMode,
  assertNotSentinelCharacterId,
  type CanaryCharacterResolution,
} from "./canary-deps.js";
import { rankingParseCompatibilityKey } from "../run-orchestration/ranking-hydrate.js";
import { RANKING_PARSE_DATASET_KEY } from "./canary-ranking-lineage.js";
import { loadCompatibleFrozenManifest } from "./canary-live.js";
import type { CanarySeasonResolution } from "./canary-season.js";
import { evaluateLiveCapabilityPermission } from "../run-orchestration/live-capability-adapter.js";

export const CANARY_RANKING_HYDRATE_SCHEMA =
  "scoring-v2-canary-ranking-hydrate-v1" as const;

export type FetchRankingMetadataOnly = (input: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  dungeonSlug: string;
  keyLevel: number | null;
  characterName: string;
  region: string;
  realm: string;
}) => Promise<{
  evidence: RankingParseEvidenceV2;
  artifactBytes: Buffer;
  payloadFingerprint: string;
  providerCalls: number;
  estimatedPoints: number | null;
} | null>;

export interface CanaryRankingHydrateReport {
  schemaVersion: typeof CANARY_RANKING_HYDRATE_SCHEMA;
  manifestId: string;
  selectedSlotCount: number;
  rankingFactsAlreadyReady: number;
  rankingFactsMissingBefore: number;
  requestsAttempted: number;
  requestsSucceeded: number;
  requestsFailed: number;
  factsCreated: number;
  factsReused: number;
  rankingStillMissing: number;
  capabilityAcquisitions: 0;
  capabilityEventPageRequests: 0;
  digestsCreated: 0;
  providerCalls: number;
  estimatedPoints: number | null;
  measuredPoints: number | null;
  publicationEnabled: false;
  publicScorePointerMutated: false;
  discoveryRun: false;
  fights: Array<{
    slotId: string;
    reportCode: string;
    fightId: number;
    reportRevision: number;
    lookupKey: string;
    outcome:
      | "READY"
      | "ALREADY_READY"
      | "ABSENT"
      | "FETCH_NULL"
      | "REUSED";
  }>;
}

export function evaluateRankingHydrateGates(input: {
  env: Pick<
    AppEnv,
    | "PROVIDER_MODE"
    | "WCL_ENABLED"
    | "ALLOW_LIVE_PROVIDER_CALLS"
    | "SCORING_V2_PUBLICATION_ENABLED"
    | "WCL_CLIENT_ID"
    | "WCL_CLIENT_SECRET"
  >;
  confirmRankingHydrate: boolean;
  repositoryMode: CanaryCharacterResolution["repositoryMode"];
  hasWclCredentials: boolean;
  /** Inventory-only mode skips live provider credential requirements. */
  inventoryOnly: boolean;
}): { allowed: true } | { allowed: false; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.confirmRankingHydrate) {
    reasons.push("MISSING_CONFIRM_RANKING_HYDRATE");
  }
  if (input.repositoryMode !== "PRODUCTION") {
    reasons.push("REPOSITORY_MODE_FORBIDDEN");
  }
  try {
    assertPublicationBlocked(input.env as never);
  } catch {
    reasons.push("PUBLICATION_ENABLED");
  }
  if (!input.inventoryOnly) {
    const live = evaluateLiveCapabilityPermission({
      providerMode: input.env.PROVIDER_MODE,
      wclEnabled: input.env.WCL_ENABLED,
      allowLiveProviderCalls: input.env.ALLOW_LIVE_PROVIDER_CALLS,
      liveProviderPermissionGranted: true,
      scoringV2PublicationEnabled: input.env.SCORING_V2_PUBLICATION_ENABLED,
      hasWclCredentials: input.hasWclCredentials,
    });
    if (!live.allowed) reasons.push(...live.reasons);
  }
  if (reasons.length > 0) return { allowed: false, reasons };
  return { allowed: true };
}

/**
 * Persist ranking/parse metadata for selected slots that lack READY evidence.
 * `fetchRanking` is injected; production wires a rankings-only WCL client.
 * Callers that must stay provider-free should omit fetchRanking (inventory).
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
  repositoryMode: CanaryCharacterResolution["repositoryMode"];
  env: AppEnv;
  fetchRanking?: FetchRankingMetadataOnly;
  outputDir?: string;
}): Promise<{ report: CanaryRankingHydrateReport; reportPath: string }> {
  assertNotSentinelCharacterId(input.characterId);
  assertOperatorRepositoryMode(input.repositoryMode);

  const inventoryOnly = input.fetchRanking == null;
  const gate = evaluateRankingHydrateGates({
    env: input.env,
    confirmRankingHydrate: input.confirmRankingHydrate,
    repositoryMode: input.repositoryMode,
    hasWclCredentials: Boolean(
      input.env.WCL_CLIENT_ID && input.env.WCL_CLIENT_SECRET,
    ),
    inventoryOnly,
  });
  if (!gate.allowed) {
    throw Object.assign(
      new Error(`ranking_hydrate_refused:${gate.reasons.join(",")}`),
      { code: "RANKING_HYDRATE_REFUSED", reasons: gate.reasons },
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
  let rankingFactsAlreadyReady = 0;
  let rankingFactsMissingBefore = 0;
  let requestsAttempted = 0;
  let requestsSucceeded = 0;
  let requestsFailed = 0;
  let factsCreated = 0;
  let factsReused = 0;
  let rankingStillMissing = 0;
  let providerCalls = 0;
  let estimatedPoints = 0;

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
      rankingFactsAlreadyReady += 1;
      factsReused += 1;
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

    rankingFactsMissingBefore += 1;
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

    requestsAttempted += 1;
    const fetched = await input.fetchRanking({
      reportCode: slot.reportCode,
      fightId: slot.fightId,
      reportRevision: slot.reportRevision,
      dungeonSlug: slot.dungeon.slug,
      keyLevel: slot.keyLevel,
      characterName: input.characterName,
      region: input.region,
      realm: input.realm,
    });
    if (!fetched) {
      requestsFailed += 1;
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

    providerCalls += fetched.providerCalls;
    if (fetched.estimatedPoints != null) {
      estimatedPoints += fetched.estimatedPoints;
    }
    requestsSucceeded += 1;

    // Idempotent: another writer may have created READY while we fetched.
    const raced =
      await input.container.repositories.evidence.findDatasetByCompatibilityKey(
        lookupKey,
      );
    if (raced && raced.state === "READY" && raced.artifactId) {
      factsReused += 1;
      fights.push({
        slotId,
        reportCode: slot.reportCode,
        fightId: slot.fightId,
        reportRevision: slot.reportRevision,
        lookupKey,
        outcome: "REUSED",
      });
      continue;
    }

    const artifact = await input.container.repositories.artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes: fetched.artifactBytes,
      compression: "GZIP",
      artifactClass: "ranking_parse_evidence_v2",
      owner: {
        ownerType: "EvidenceDataset",
        ownerId: slot.id,
      },
    });
    try {
      await input.container.repositories.evidence.createDataset({
        manifestSlotId: slot.id,
        datasetKey: RANKING_PARSE_DATASET_KEY,
        compatibilityKey: lookupKey,
        artifactId: artifact.artifactId,
        schemaVersion: RANKING_PARSE_SCHEMA_VERSION,
        providerContractVersion: RANKING_PARSE_PROVIDER_CONTRACT,
        state: "READY",
        eventCount: 0,
        pageCount: 0,
        truncated: false,
        pointsConsumed: null,
        costSource: "ranking_hydrate_metadata_only",
        payloadFingerprint: fetched.payloadFingerprint,
        fetchedAt: new Date(),
      });
      factsCreated += 1;
      fights.push({
        slotId,
        reportCode: slot.reportCode,
        fightId: slot.fightId,
        reportRevision: slot.reportRevision,
        lookupKey,
        outcome: "READY",
      });
    } catch {
      factsReused += 1;
      fights.push({
        slotId,
        reportCode: slot.reportCode,
        fightId: slot.fightId,
        reportRevision: slot.reportRevision,
        lookupKey,
        outcome: "REUSED",
      });
    }
  }

  const report: CanaryRankingHydrateReport = {
    schemaVersion: CANARY_RANKING_HYDRATE_SCHEMA,
    manifestId: frozen.rowId,
    selectedSlotCount: slots.length,
    rankingFactsAlreadyReady,
    rankingFactsMissingBefore,
    requestsAttempted,
    requestsSucceeded,
    requestsFailed,
    factsCreated,
    factsReused,
    rankingStillMissing,
    capabilityAcquisitions: 0,
    capabilityEventPageRequests: 0,
    digestsCreated: 0,
    providerCalls,
    estimatedPoints: estimatedPoints > 0 ? estimatedPoints : null,
    measuredPoints: null,
    publicationEnabled: false,
    publicScorePointerMutated: false,
    discoveryRun: false,
    fights,
  };

  const outDir =
    input.outputDir ?? join(process.cwd(), "artifacts", "scoring-v2-canary");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "ranking-hydrate-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { report, reportPath };
}

/** Build artifact bytes + fingerprint from RankingParseEvidenceV2. */
export function rankingEvidenceArtifactBytes(
  evidence: RankingParseEvidenceV2,
): { bytes: Buffer; payloadFingerprint: string } {
  const bytes = Buffer.from(JSON.stringify(evidence), "utf8");
  return {
    bytes,
    payloadFingerprint: createHash("sha256").update(bytes).digest("hex"),
  };
}
