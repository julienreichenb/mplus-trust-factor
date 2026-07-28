import { createHash } from "node:crypto";
import type { AbilityCatalog } from "@mplus/abilities";
import type { WclGraphQlClient } from "../client/graphql-client.js";
import { fetchAllEventPages } from "./event-fetcher.js";
import type { SurvivalCalibrationRun } from "../probe/survival-calibration-types.js";
import { collectExplicitHealthSnapshots } from "../probe/survival-v1_1-health.js";
import type { ExplicitHealthSnapshot } from "../probe/survival-v1_1-types.js";
import {
  SURVIVAL_STANDALONE_V1_1_1_CONFIG,
} from "../probe/survival-v1_1_1-config.js";
import {
  scoreSurvivalV1_1_1Run,
  type SurvivalV1_1_1RunScore,
} from "../probe/survival-v1_1_1-logic.js";
import type { HardenedMaxHpResolution } from "../probe/survival-v1_1_1-maxhp.js";

export const SURVIVAL_ANALYSIS_VERSION =
  SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion;

export interface SurvivalCompatibilityKeyInput {
  characterId: string | number;
  reportCode: string;
  fightId: number;
  reportRevision: number | string;
  adapterVersion: string;
  scoringConfigVersion: string;
  abilityCatalogVersion: string;
}

/** Stable hash for survival analysis cache / persistence identity. */
export function buildSurvivalCompatibilityKey(
  input: SurvivalCompatibilityKeyInput,
): string {
  const material = [
    String(input.characterId),
    input.reportCode,
    String(input.fightId),
    String(input.reportRevision),
    input.adapterVersion,
    input.scoringConfigVersion,
    input.abilityCatalogVersion,
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export interface FetchDamageTakenWithResourcesInput {
  reportCode: string;
  fightId: number;
  sourceId: number;
  eventLimit?: number;
  maxEventPages?: number;
  maxEventsPerCategory?: number;
}

/** DamageTaken pages with includeResources for explicit HP snapshots. */
export async function fetchDamageTakenWithResources(
  client: WclGraphQlClient,
  input: FetchDamageTakenWithResourcesInput,
): Promise<{
  events: Array<Record<string, unknown>>;
  truncated: boolean;
  snapshots: ExplicitHealthSnapshot[];
}> {
  const { events, truncated } = await fetchAllEventPages(client, {
    reportCode: input.reportCode,
    fightId: input.fightId,
    dataType: "DamageTaken",
    sourceId: input.sourceId,
    eventLimit: input.eventLimit,
    maxEventPages: input.maxEventPages,
    maxEventsPerCategory: input.maxEventsPerCategory,
    includeResources: true,
  });
  const snapshots = collectExplicitHealthSnapshots(
    events,
    "DamageTaken",
    input.sourceId,
  );
  return { events, truncated, snapshots };
}

export interface AnalyzeSurvivalRunInput {
  characterId: string | number;
  reportRevision: number | string;
  run: SurvivalCalibrationRun;
  snapshots: ExplicitHealthSnapshot[];
  catalog: AbilityCatalog;
  classSlug: string | null;
  eventPagesComplete?: boolean;
  darkPactActiveIntervals?: Array<{ start: number; end: number }>;
  adapterVersion?: string;
  scoringConfigVersion?: string;
  abilityCatalogVersion?: string;
}

/** Compact persisted summary — no raw event arrays. */
export interface SurvivalRunAnalysisSummary {
  compatibilityKey: string;
  configVersion: string;
  analysisVersion: string;
  adapterVersion: string;
  runId: string;
  dungeonSlug: string;
  reportCode: string;
  fightId: number;
  keyLevel: number | null;
  deathCount: number;
  behavioralSurvivalScore: number | null;
  outcomeOnlyScore: number;
  pressureClusterCount: number;
  maxHpResolution: {
    baselineMaxHp: number | null;
    baselineConfidence: HardenedMaxHpResolution["baselineConfidence"];
    baselineSourcePath: string | null;
    invalidOutlierCount: number;
    temporaryIntervalCount: number;
    rejectionReasons: Record<string, number>;
    resolutionFailureReason: string | null;
  };
  componentScores: {
    outcome: SurvivalV1_1_1RunScore["outcome"];
    defensiveResponse: SurvivalV1_1_1RunScore["defensiveResponse"];
    emergencyRecovery: SurvivalV1_1_1RunScore["emergencyRecovery"];
    weightsApplied: SurvivalV1_1_1RunScore["weightsApplied"];
  };
  defensiveCounts: SurvivalV1_1_1RunScore["defensiveCounts"];
  recoveryCounts: SurvivalV1_1_1RunScore["recoveryCounts"];
  diagnostics: {
    scoreMode: SurvivalV1_1_1RunScore["scoreMode"];
    invalidOutlierCount: number;
    healthTimelineComplete: boolean;
    preClusterDangerWindowCount: number;
    nonFatalWindowCount: number;
    fatalWindowCount: number;
    deathOnlyWindowCount: number;
    eventPagesComplete: boolean;
  };
}

/**
 * Produce a persistence-ready Survival V1.1.1 summary for one run.
 */
export function analyzeSurvivalRun(
  input: AnalyzeSurvivalRunInput,
): SurvivalRunAnalysisSummary {
  const config = SURVIVAL_STANDALONE_V1_1_1_CONFIG;
  const adapterVersion = input.adapterVersion ?? config.adapterVersion;
  const scoringConfigVersion = input.scoringConfigVersion ?? config.version;
  const abilityCatalogVersion =
    input.abilityCatalogVersion ??
    input.catalog.catalogVersion ??
    input.run.normalized.abilityCatalog.catalogVersion ??
    "unknown";

  const compatibilityKey = buildSurvivalCompatibilityKey({
    characterId: input.characterId,
    reportCode: input.run.reportCode,
    fightId: input.run.fightId,
    reportRevision: input.reportRevision,
    adapterVersion,
    scoringConfigVersion,
    abilityCatalogVersion,
  });

  const { runScore, maxHpResolution } = scoreSurvivalV1_1_1Run({
    run: input.run,
    catalog: input.catalog,
    classSlug: input.classSlug,
    snapshots: input.snapshots,
    eventPagesComplete: input.eventPagesComplete ?? true,
    darkPactActiveIntervals: input.darkPactActiveIntervals,
  });

  return {
    compatibilityKey,
    configVersion: scoringConfigVersion,
    analysisVersion: SURVIVAL_ANALYSIS_VERSION,
    adapterVersion,
    runId: runScore.runId,
    dungeonSlug: runScore.dungeonSlug,
    reportCode: runScore.reportCode,
    fightId: runScore.fightId,
    keyLevel: runScore.keyLevel,
    deathCount: runScore.deathCount,
    behavioralSurvivalScore: runScore.behavioralSurvivalScore,
    outcomeOnlyScore: runScore.outcomeOnlyScore,
    pressureClusterCount: runScore.pressureClusterCount,
    maxHpResolution: {
      baselineMaxHp: maxHpResolution.baselineMaxHp,
      baselineConfidence: maxHpResolution.baselineConfidence,
      baselineSourcePath: maxHpResolution.baselineSourcePath,
      invalidOutlierCount: maxHpResolution.invalidOutlierCount,
      temporaryIntervalCount: maxHpResolution.temporaryIntervals.length,
      rejectionReasons: maxHpResolution.rejectionReasons,
      resolutionFailureReason: maxHpResolution.resolutionFailureReason,
    },
    componentScores: {
      outcome: runScore.outcome,
      defensiveResponse: runScore.defensiveResponse,
      emergencyRecovery: runScore.emergencyRecovery,
      weightsApplied: runScore.weightsApplied,
    },
    defensiveCounts: runScore.defensiveCounts,
    recoveryCounts: runScore.recoveryCounts,
    diagnostics: {
      scoreMode: runScore.scoreMode,
      invalidOutlierCount: runScore.invalidOutlierCount,
      healthTimelineComplete: runScore.healthTimelineComplete,
      preClusterDangerWindowCount: runScore.preClusterDangerWindowCount,
      nonFatalWindowCount: runScore.nonFatalWindowCount,
      fatalWindowCount: runScore.fatalWindowCount,
      deathOnlyWindowCount: runScore.deathOnlyWindowCount,
      eventPagesComplete: input.eventPagesComplete ?? true,
    },
  };
}
