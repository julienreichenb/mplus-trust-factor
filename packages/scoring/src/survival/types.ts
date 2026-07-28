import type { IsoDateTime, MetricAvailability, SurvivalRawFacts } from "@mplus/contracts";

/** Internal Survival v3 contributor weights (renormalized when unavailable). */
export const SURVIVAL_V3_WEIGHTS = {
  deaths: 0.35,
  avoidableDamage: 0.3,
  personalDefensives: 0.2,
  selfHealAndPotion: 0.15,
} as const;

export const SURVIVAL_V3_FORMULA_VERSION = "survival-v3-formula-v1";

export const SURVIVAL_V3_METRIC_KEYS = {
  deaths: "survival.v3.deaths",
  avoidableDamage: "survival.v3.avoidable_damage",
  personalDefensives: "survival.v3.personal_defensives",
  selfHealAndPotion: "survival.v3.self_heal_and_potion",
} as const;

/** Cap credited defensive uses so spam cannot create a perfect score. */
export const DEFENSIVE_CREDIT_CAP_RATIO = 1;

/** Soft death curve: 0 deaths → 100; 5+ deaths → 0. Aggregate Survival still mixes contributors. */
export const DEATH_SOFT_CAP = 5;

export type SurvivalContributorKey =
  | "deaths"
  | "avoidableDamage"
  | "personalDefensives"
  | "selfHealAndPotion";

export interface SurvivalContributorScore {
  key: SurvivalContributorKey;
  metricKey: string;
  weight: number;
  /** Renormalized weight among available contributors. */
  effectiveWeight: number;
  score: number | null;
  availability: MetricAvailability;
  reason: string | null;
}

export interface SurvivalRunInput {
  dungeonSlug: string;
  dungeonName?: string;
  canonicalRunId: string;
  keyLevel: number;
  durationMs: number | null;
  detailAvailable: boolean;
  survival: SurvivalRawFacts;
  /** Estimated available personal-defensive uses for this run (catalog × duration). */
  availableDefensiveUses: number | null;
  /** True when the active class/spec has at least one personal_defensive rule. */
  hasPersonalDefensiveCapability: boolean;
  /** True when the active class/spec has self_heal or health_potion rules. */
  hasSelfHealOrPotionCapability: boolean;
  /** Optional cohort percentile for avoidable damage rate (0–100, higher = worse). */
  avoidableDamageCohortPercentile?: number | null;
}

export interface SurvivalRunExplanation {
  dungeonSlug: string;
  dungeonName: string;
  canonicalRunId: string;
  keyLevel: number;
  durationMs: number | null;
  detailAvailable: boolean;
  deaths: number | null;
  deathScore: number | null;
  totalDamageTaken: number | null;
  avoidableDamageTaken: number | null;
  avoidableDamageCoverageRatio: number | null;
  maxHealth: number | null;
  avoidableDamageRatePerMaxHpMinute: number | null;
  avoidableDamageScore: number | null;
  personalDefensiveCasts: number | null;
  availableDefensiveUses: number | null;
  creditedDefensiveUses: number | null;
  personalDefensiveScore: number | null;
  selfHealEffective: number | null;
  selfHealOverheal: number | null;
  healthPotionCasts: number | null;
  selfHealAndPotionScore: number | null;
  runSurvivalScore: number | null;
  contributors: SurvivalContributorScore[];
  missingReasons: string[];
  formulaVersion: string;
  abilityCatalogVersion: string | null;
  mechanicCatalogVersion: string | null;
}

export interface SurvivalSummaryDTO {
  formulaVersion: string;
  score: number | null;
  confidence: number;
  availableRunCount: number;
  expectedDungeonCount: number;
  contributorWeights: Array<{ key: SurvivalContributorKey; weight: number; effectiveWeight: number }>;
  runs: SurvivalRunExplanation[];
  latestObservedAt: IsoDateTime | null;
}

export interface ComputeSurvivalInput {
  runs: SurvivalRunInput[];
  expectedDungeonCount: number;
  /** Fraction of selected runs with usable WCL combat detail (0–1). */
  selectedRunWclCoverage: number;
  hasResolvedSpecAndRole: boolean;
  logFreshness?: number;
}

export interface ComputeSurvivalResult {
  summary: SurvivalSummaryDTO;
  survivalScore: number | null;
  confidence: number;
  observations: {
    deaths: number | null;
    avoidableDamage: number | null;
    personalDefensives: number | null;
    selfHealAndPotion: number | null;
  };
  /** Which contributors participated after capability/missing-data renormalization. */
  activeContributors: SurvivalContributorKey[];
}
