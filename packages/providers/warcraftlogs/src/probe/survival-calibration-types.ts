import type { AbilityAvailability, AbilityCategory } from "@mplus/abilities";
import type {
  SurvivalCandidateRejection,
  SurvivalEventDataType,
  SurvivalMatchedAbilityUsage,
  SurvivalNormalizedDataset,
  SurvivalProbeIdentity,
  SurvivalRunCandidate,
} from "./survival-probe-types.js";
import type { GraphQlErrorRecord, ProbeCharacterRecord, ProbeZoneRecord } from "./types.js";
import type { WclRateLimitSnapshot } from "../types.js";
import type { ProbeRateLimitRecord } from "./types.js";

/** Per-run calibration observation (normalized Survival facts + derived rates). */
export interface SurvivalCalibrationRun {
  runId: string;
  dungeonSlug: string;
  reportCode: string;
  fightId: number;
  keyLevel: number | null;
  /** Timed when known; null when timer comparison is unavailable from WCL. */
  timed: boolean | null;
  /** Depleted when known; null when timer comparison is unavailable. */
  depleted: boolean | null;
  /** WCL fight.kill — completed keystone fight when true. */
  completed: boolean | null;
  durationMs: number;
  playerActorId: number;
  ownedPetActorIds: number[];
  specialization: string | null;
  specId: number | null;
  itemLevel: number | null;
  score: number | null;
  encounterId: number | null;
  encounterName: string | null;

  deaths: {
    deathCount: number;
    deathTimestamps: number[];
    deathsPerRun: number;
    deathsPer10Minutes: number | null;
    deaths: SurvivalNormalizedDataset["deaths"]["deaths"];
  };

  damageTaken: {
    totalDamageTaken: number;
    damageTakenPerMinute: number | null;
    absorbedAmount: number;
    unabsorbedDamage: number;
    unabsorbedDamagePerMinute: number | null;
    absorbedRatio: number | null;
    byAbility: SurvivalNormalizedDataset["damageTaken"]["byAbility"];
    bySource: SurvivalNormalizedDataset["damageTaken"]["bySource"];
    playerMaxHp: number | null;
    damageNormalizedByMaxHp: number | null;
    avoidableClassification: null;
  };

  defensives: SurvivalDefensiveCalibrationUsage[];

  consumablesAndSelfHealing: {
    healthstoneUses: number;
    healingPotionUses: number;
    selfHealingAmount: number;
    selfHealingPerMinute: number | null;
    selfHealingPercentOfIncomingDamage: number | null;
    healingBySpell: SurvivalNormalizedDataset["selfHealingAndConsumables"]["healing"];
    matchedCasts: SurvivalMatchedAbilityUsage[];
  };

  /** Full probe-normalized payload retained for raw artifact parity. */
  normalized: SurvivalNormalizedDataset;
  missingDatasets: SurvivalEventDataType[];
  unmatchedSpellIds: number[];
  ambiguousSpellIds: number[];
}

export interface SurvivalDefensiveCalibrationUsage {
  canonicalKey: string;
  category: AbilityCategory;
  spellId: number;
  name: string;
  availability: AbilityAvailability;
  talentDependentOrUncertain: boolean;
  castCount: number;
  activeDurationMs: number | null;
  cooldownSeconds: number | null;
  /** floor(duration / cooldown) + 1 when cooldown known — not an opportunity score. */
  theoreticalMaxUses: number | null;
  /** castCount / theoreticalMaxUses — diagnostic only, not a valid opportunity score. */
  observedUsageRatio: number | null;
  note: string;
}

export interface SurvivalDungeonCalibrationAggregate {
  dungeonSlug: string;
  runCount: number;
  runIds: string[];
  deathRateMedian: number | null;
  deathRateMaximum: number | null;
  damageTakenPerMinuteMedian: number | null;
  unabsorbedDamagePerMinuteMedian: number | null;
  absorbedRatioMedian: number | null;
  defensiveUsageSummary: {
    abilityCount: number;
    totalCasts: number;
    baselineCasts: number;
    talentDependentOrUncertainCasts: number;
    medianObservedUsageRatio: number | null;
  };
  consumableUsageFrequency: {
    runsWithHealthstone: number;
    runsWithHealingPotion: number;
    healthstoneUsesTotal: number;
    healingPotionUsesTotal: number;
    medianSelfHealingPerMinute: number | null;
  };
}

export interface SurvivalGlobalCalibrationSummary {
  dungeonCount: number;
  totalRuns: number;
  /** Equal-weight mean across dungeons that have ≥1 run — not weighted by run count. */
  equalWeightAverages: {
    deathRateMedian: number | null;
    damageTakenPerMinuteMedian: number | null;
    unabsorbedDamagePerMinuteMedian: number | null;
    absorbedRatioMedian: number | null;
  };
  coverage: {
    expectedDungeonCount: number;
    dungeonsWithRuns: number;
    dungeonsMissingRuns: string[];
    sampleSizeByDungeon: Record<string, number>;
  };
  note: string;
}

export interface SurvivalCalibrationCostDiagnostics {
  totalWclRequests: number;
  estimatedQueryCostUnits: number | null;
  cache: {
    reportMasterDataHits: number;
    reportMasterDataMisses: number;
    eventDatasetHits: number;
    eventDatasetMisses: number;
  };
  perOperationRequestCounts: Record<string, number>;
  paginationPageCountTotal: Record<SurvivalEventDataType, number>;
  maxRunsPerDungeon: number;
  maxReportsInspectedPerDungeon: number;
}

export interface SurvivalCalibrationDiagnostics {
  candidateRunsInspected: number;
  reportsInspected: string[];
  fightsInspected: Array<{ reportCode: string; fightId: number }>;
  runsRejected: SurvivalCandidateRejection[];
  queryPageCounts: Record<SurvivalEventDataType, number>;
  totalWclRequests: number;
  cacheReuse: SurvivalCalibrationCostDiagnostics["cache"];
  unmatchedSpellIds: number[];
  ambiguousSpellIds: number[];
  incompleteDatasets: Array<{ runId: string; missing: SurvivalEventDataType[] }>;
  graphqlErrors: GraphQlErrorRecord[];
  schemaWarnings: string[];
  cost: SurvivalCalibrationCostDiagnostics;
  activeDungeonPool: string[];
  note: string;
}

export interface SurvivalCalibrationDataset {
  probeVersion: "calibration-1";
  probedAt: string;
  identity: SurvivalProbeIdentity;
  state: "OK" | "PARTIAL" | "ERROR";
  character: ProbeCharacterRecord | null;
  zone: ProbeZoneRecord;
  runs: SurvivalCalibrationRun[];
  perDungeon: SurvivalDungeonCalibrationAggregate[];
  global: SurvivalGlobalCalibrationSummary;
  diagnostics: SurvivalCalibrationDiagnostics;
  graphqlErrors: GraphQlErrorRecord[];
  rateLimit: {
    initial: WclRateLimitSnapshot | null;
    final: WclRateLimitSnapshot | null;
    perOperation: ProbeRateLimitRecord[];
  };
  candidatesByDungeon: Record<string, SurvivalRunCandidate[]>;
}
