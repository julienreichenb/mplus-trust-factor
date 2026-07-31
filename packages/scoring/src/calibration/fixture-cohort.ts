import type { MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import { calculateScore } from "../calculate.js";
import { computeInputFingerprint } from "../fingerprint.js";
import { createDefaultModelV6 } from "../model/defaults.js";
import type { AuthenticityFeatureInput, ScoreModelConfigV1, ScoringContext } from "../types.js";
import { buildCalibrationInputBundle } from "./bundle.js";
import type { CalibrationEvidencePort } from "./evaluate.js";
import type { CohortManifest, CohortManifestMember } from "./manifest.js";
import { COHORT_MANIFEST_SCHEMA_VERSION } from "./types.js";
import type {
  CalibrationInputBundleV1,
  CalibrationMemberEvidence,
  CalibrationModelRef,
  QualitativeLabel,
  CalibrationRole,
} from "./types.js";

const OBSERVED_AT = "2026-07-20T18:00:00.000Z";
const CALCULATED_AT = "2026-07-31T12:00:00.000Z";
const SEASON = "fixture-season";

/** Canonical v6 metric keys — must stay aligned with createDefaultModelV6. */
export const V6_CANONICAL_METRIC_KEYS = [
  "performance.current_season_peak",
  "performance.current_season_consistency",
  "performance.historical_best_average",
  "survival.outcome",
  "survival.defensive_response",
  "survival.emergency_recovery",
  "utility.observed_contribution",
  "experience.dungeon_breadth",
  "experience.key_band_breadth",
  "experience.participation_depth",
  "experience.historical_seasons",
  "experience.activity_recency",
] as const;

export const RETIRED_PERFORMANCE_METRIC_KEYS = [
  "performance.mythic_rating",
  "performance.consistency",
  "performance.contextual_contribution",
] as const;

type MetricSpec = {
  metricKey: string;
  dimension: MetricObservationDTO["dimension"];
  value: number | null;
  confidence?: number;
  coverageRatio?: number;
};

function obs(specs: MetricSpec[]): MetricObservationDTO[] {
  return specs.map((s) => ({
    metricKey: s.metricKey,
    dimension: s.dimension,
    rawValue: s.value,
    normalizedValue: s.value,
    confidence: s.confidence ?? (s.value == null ? 0 : 0.9),
    observedAt: OBSERVED_AT,
    sourceProvider: "fixture",
    coverage:
      s.value == null
        ? { present: 0, expected: 1, ratio: s.coverageRatio ?? 0 }
        : { present: 1, expected: 1, ratio: s.coverageRatio ?? 1 },
    context: { sampleSize: s.value == null ? 0 : 12 },
  }));
}

/** Full v6 observation pack across all four public dimensions. */
function dimPack(
  performance: number | null,
  survival: number | null,
  utility: number | null,
  experience: number | null,
  opts?: { conf?: number; omitHistoricalBest?: boolean; utilityCoverage?: number },
): MetricObservationDTO[] {
  const conf = opts?.conf;
  const specs: MetricSpec[] = [
    {
      metricKey: "performance.current_season_peak",
      dimension: "PERFORMANCE",
      value: performance,
      confidence: conf,
    },
    {
      metricKey: "performance.current_season_consistency",
      dimension: "PERFORMANCE",
      value: performance == null ? null : Math.max(0, performance - 4),
      confidence: conf,
    },
  ];
  if (!opts?.omitHistoricalBest) {
    specs.push({
      metricKey: "performance.historical_best_average",
      dimension: "PERFORMANCE",
      value: performance == null ? null : Math.max(0, performance - 6),
      confidence: conf,
    });
  }
  specs.push(
    {
      metricKey: "survival.outcome",
      dimension: "SURVIVAL",
      value: survival,
      confidence: conf,
    },
    {
      metricKey: "survival.defensive_response",
      dimension: "SURVIVAL",
      value: survival == null ? null : Math.max(0, survival - 3),
      confidence: conf,
    },
    {
      metricKey: "survival.emergency_recovery",
      dimension: "SURVIVAL",
      value: survival == null ? null : Math.max(0, survival - 5),
      confidence: conf,
    },
    {
      metricKey: "utility.observed_contribution",
      dimension: "UTILITY",
      value: utility,
      confidence: conf,
      coverageRatio: opts?.utilityCoverage,
    },
    {
      metricKey: "experience.dungeon_breadth",
      dimension: "EXPERIENCE",
      value: experience,
      confidence: conf,
    },
    {
      metricKey: "experience.key_band_breadth",
      dimension: "EXPERIENCE",
      value: experience == null ? null : Math.max(0, experience - 3),
      confidence: conf,
    },
    {
      metricKey: "experience.participation_depth",
      dimension: "EXPERIENCE",
      value: experience == null ? null : Math.max(0, experience - 2),
      confidence: conf,
    },
    {
      metricKey: "experience.historical_seasons",
      dimension: "EXPERIENCE",
      value: experience == null ? null : Math.max(0, experience - 5),
      confidence: conf,
    },
    {
      metricKey: "experience.activity_recency",
      dimension: "EXPERIENCE",
      value: experience == null ? null : Math.max(0, experience - 1),
      confidence: conf,
    },
  );
  return obs(specs);
}

interface FixtureDef {
  id: string;
  region: string;
  realm: string;
  character: string;
  role: CalibrationRole;
  classSlug: string;
  specSlug: string;
  expectedLabel: QualitativeLabel;
  meta: boolean;
  suspectedBoost: boolean;
  source: "user-selected" | "stratified-auto";
  rationale: string;
  observations: MetricObservationDTO[];
  authenticity?: AuthenticityFeatureInput;
  freshness: number;
  selectedRunCoverage: number;
  analyzedRunCoverage?: number;
  utilityEvidenceCoverage?: number;
  utilityBaseline?: number;
  utilityFallback?: number;
  fallbackTriggered?: boolean;
}

/**
 * Synthetic fixture cohort — not live characters.
 * Uses canonical v6 metric keys and explicit scoring context (no hidden defaults).
 */
const FIXTURE_DEFS: FixtureDef[] = [
  {
    id: "fx-dps-excellent-nonmeta",
    region: "EU",
    realm: "fixture-realm",
    character: "ExcellentNonMeta",
    role: "DPS",
    classSlug: "hunter",
    specSlug: "survival",
    expectedLabel: "excellent",
    meta: false,
    suspectedBoost: false,
    source: "stratified-auto",
    rationale: "Strong logs across dimensions on a non-meta spec",
    observations: dimPack(92, 88, 85, 90),
    freshness: 0.92,
    selectedRunCoverage: 0.95,
    analyzedRunCoverage: 0.9,
    utilityEvidenceCoverage: 0.9,
    utilityBaseline: 8,
  },
  {
    id: "fx-dps-meta-mediocre",
    region: "EU",
    realm: "fixture-realm",
    character: "MetaMediocre",
    role: "DPS",
    classSlug: "evoker",
    specSlug: "augmentation",
    expectedLabel: "average",
    meta: true,
    suspectedBoost: false,
    source: "stratified-auto",
    rationale: "Meta spec with mediocre contribution across dimensions",
    observations: dimPack(52, 50, 48, 55),
    freshness: 0.8,
    selectedRunCoverage: 0.7,
    utilityBaseline: 8,
  },
  {
    id: "fx-dps-good-meta",
    region: "EU",
    realm: "fixture-realm",
    character: "GoodMeta",
    role: "DPS",
    classSlug: "evoker",
    specSlug: "augmentation",
    expectedLabel: "good",
    meta: true,
    suspectedBoost: false,
    source: "stratified-auto",
    rationale: "Solid meta performer",
    observations: dimPack(78, 74, 70, 72),
    freshness: 0.85,
    selectedRunCoverage: 0.8,
    utilityBaseline: 8,
  },
  {
    id: "fx-dps-average",
    region: "EU",
    realm: "fixture-realm",
    character: "AverageComplete",
    role: "DPS",
    classSlug: "warlock",
    specSlug: "affliction",
    expectedLabel: "average",
    meta: false,
    suspectedBoost: false,
    source: "user-selected",
    rationale: "Complete average profile",
    observations: dimPack(55, 52, 50, 58),
    freshness: 0.8,
    selectedRunCoverage: 0.75,
    utilityBaseline: 8,
  },
  {
    id: "fx-dps-weak-overrated",
    region: "EU",
    realm: "fixture-realm",
    character: "WeakOverrated",
    role: "DPS",
    classSlug: "warrior",
    specSlug: "arms",
    expectedLabel: "overrated",
    meta: true,
    suspectedBoost: true,
    source: "user-selected",
    rationale: "Weak contribution; boost marker in manifest (does not alter score)",
    observations: dimPack(32, 28, 22, 40),
    authenticity: {
      progressionKeyJump: 0.9,
      lowVolumeForScore: 0.9,
      repeatedStrongerTeammates: 0.9,
    },
    freshness: 0.7,
    selectedRunCoverage: 0.55,
    utilityBaseline: 8,
    utilityFallback: 2,
    fallbackTriggered: true,
  },
  {
    id: "fx-dps-sparse-u",
    region: "EU",
    realm: "fixture-realm",
    character: "SparseNew",
    role: "DPS",
    classSlug: "demonhunter",
    specSlug: "havoc",
    expectedLabel: "weak",
    meta: false,
    suspectedBoost: false,
    source: "stratified-auto",
    rationale: "Sparse evidence retained as U / low-confidence case",
    observations: dimPack(60, null, null, 20, { conf: 0.25 }),
    freshness: 0.4,
    selectedRunCoverage: 0.15,
    analyzedRunCoverage: 0.1,
    utilityBaseline: 2,
  },
  {
    id: "fx-utility-zero-complete",
    region: "EU",
    realm: "fixture-realm",
    character: "UtilityZeroComplete",
    role: "DPS",
    classSlug: "mage",
    specSlug: "frost",
    expectedLabel: "average",
    meta: false,
    suspectedBoost: false,
    source: "stratified-auto",
    rationale: "Complete Utility evidence with zero contribution (not missing)",
    observations: dimPack(60, 58, 0, 55, { utilityCoverage: 1 }),
    freshness: 0.85,
    selectedRunCoverage: 0.8,
    utilityEvidenceCoverage: 1,
    utilityBaseline: 8,
  },
  {
    id: "fx-utility-insufficient",
    region: "EU",
    realm: "fixture-realm",
    character: "UtilityInsufficient",
    role: "DPS",
    classSlug: "rogue",
    specSlug: "assassination",
    expectedLabel: "average",
    meta: false,
    suspectedBoost: false,
    source: "user-selected",
    rationale: "Insufficient Utility evidence (null contribution)",
    observations: dimPack(62, 60, null, 58, { utilityCoverage: 0.1 }),
    freshness: 0.75,
    selectedRunCoverage: 0.65,
    utilityEvidenceCoverage: 0.1,
    utilityBaseline: 3,
  },
  {
    id: "fx-tank-excellent",
    region: "EU",
    realm: "fixture-realm",
    character: "TankExcellent",
    role: "TANK",
    classSlug: "paladin",
    specSlug: "protection",
    expectedLabel: "excellent",
    meta: true,
    suspectedBoost: false,
    source: "stratified-auto",
    rationale: "Excellent tank fixture",
    observations: dimPack(88, 92, 80, 85),
    freshness: 0.9,
    selectedRunCoverage: 0.9,
    utilityBaseline: 8,
  },
  {
    id: "fx-tank-average",
    region: "EU",
    realm: "fixture-realm",
    character: "TankAverage",
    role: "TANK",
    classSlug: "warrior",
    specSlug: "protection",
    expectedLabel: "average",
    meta: false,
    suspectedBoost: false,
    source: "stratified-auto",
    rationale: "Average tank fixture",
    observations: dimPack(58, 60, 55, 50),
    freshness: 0.8,
    selectedRunCoverage: 0.7,
    utilityBaseline: 8,
  },
  {
    id: "fx-healer-good",
    region: "EU",
    realm: "fixture-realm",
    character: "HealerGood",
    role: "HEALER",
    classSlug: "priest",
    specSlug: "discipline",
    expectedLabel: "good",
    meta: false,
    suspectedBoost: false,
    source: "stratified-auto",
    rationale: "Good healer non-meta fixture",
    observations: dimPack(74, 70, 82, 68),
    freshness: 0.85,
    selectedRunCoverage: 0.8,
    utilityBaseline: 8,
  },
  {
    id: "fx-healer-weak",
    region: "EU",
    realm: "fixture-realm",
    character: "HealerWeak",
    role: "HEALER",
    classSlug: "shaman",
    specSlug: "restoration",
    expectedLabel: "weak",
    meta: true,
    suspectedBoost: false,
    source: "user-selected",
    rationale: "Weak healer meta fixture",
    observations: dimPack(40, 38, 42, 45),
    freshness: 0.7,
    selectedRunCoverage: 0.6,
    utilityBaseline: 8,
  },
  {
    id: "fx-healer-low-conf",
    region: "US",
    realm: "fixture-realm-us",
    character: "HealerHidden",
    role: "HEALER",
    classSlug: "monk",
    specSlug: "mistweaver",
    expectedLabel: "good",
    meta: false,
    suspectedBoost: false,
    source: "stratified-auto",
    rationale: "Low-confidence healer retained (partial coverage)",
    observations: dimPack(80, null, null, 75, { conf: 0.3 }),
    freshness: 0.35,
    selectedRunCoverage: 0.2,
    analyzedRunCoverage: 0.15,
    utilityBaseline: 3,
  },
];

function buildContext(def: FixtureDef): ScoringContext {
  return {
    role: def.role,
    classSlug: def.classSlug,
    specSlug: def.specSlug,
    freshness: def.freshness,
    selectedRunCoverage: def.selectedRunCoverage,
    authenticity: def.authenticity,
  };
}

function scoreFixture(
  def: FixtureDef,
  model: ScoreModelConfigV1,
): { snapshot: ScoreSnapshotDTO; context: ScoringContext; fingerprint: string } {
  const context = buildContext(def);
  const fingerprint = computeInputFingerprint({
    characterId: def.id,
    seasonSlug: SEASON,
    model,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations: def.observations,
    context,
  });
  const snapshot = calculateScore({
    characterId: def.id,
    seasonSlug: SEASON,
    model,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations: def.observations,
    calculatedAt: CALCULATED_AT,
    inputFingerprint: fingerprint,
    context,
  });
  return { snapshot, context, fingerprint };
}

export function buildSyntheticFixtureCohort(model: ScoreModelConfigV1 = createDefaultModelV6()): {
  manifest: CohortManifest;
  evidenceById: Map<string, CalibrationMemberEvidence>;
  modelRef: CalibrationModelRef;
} {
  const modelRef: CalibrationModelRef = {
    id: "fixture-model-default-v6",
    key: model.key,
    version: model.version,
    status: "FIXTURE",
    config: model,
    isActive: false,
  };

  const members: CohortManifestMember[] = [];
  const evidenceById = new Map<string, CalibrationMemberEvidence>();

  for (const def of FIXTURE_DEFS) {
    const { snapshot, context, fingerprint } = scoreFixture(def, model);
    const snapshotId = `snap-${def.id}`;
    members.push({
      id: def.id,
      region: def.region,
      realm: def.realm,
      character: def.character,
      role: def.role,
      classSlug: def.classSlug,
      specSlug: def.specSlug,
      expectedLabel: def.expectedLabel,
      meta: def.meta,
      rationale: def.rationale,
      suspectedBoost: def.suspectedBoost,
      source: def.source,
      snapshotIds: [snapshotId],
      seasonSlug: SEASON,
    });
    evidenceById.set(def.id, {
      memberId: def.id,
      characterId: def.id,
      snapshotId,
      snapshot,
      observations: def.observations,
      scoringContext: context,
      calculatedAt: CALCULATED_AT,
      inputFingerprint: fingerprint,
      boost: def.suspectedBoost
        ? {
            suspected: true,
            confidence: 0.7,
            evidenceKeys: ["fixture.manifest"],
            source: "persisted-public",
          }
        : null,
      coverageRefresh: {
        coverageState: snapshot.overallState ?? "UNKNOWN",
        publicationStatus: "PUBLIC",
        refreshState: "idle",
        providerDataAsOf: OBSERVED_AT,
        scoreFreshness: "fresh",
      },
      evidenceCoverage: {
        selectedRunCoverage: def.selectedRunCoverage,
        analyzedRunCoverage: def.analyzedRunCoverage ?? null,
        modelCoverageRatio: snapshot.modelCoverageRatio ?? null,
        availableModelWeight: snapshot.availableModelWeight ?? null,
        totalModelWeight: snapshot.totalModelWeight ?? null,
        utilityEvidenceCoverage: def.utilityEvidenceCoverage ?? null,
        dimensionAvailabilityRatio: null,
      },
      utilityCost: {
        baselineRequestCost: def.utilityBaseline ?? 0,
        fallbackRequestCost: def.utilityFallback ?? 0,
        fallbackTriggered: def.fallbackTriggered ?? false,
        fallbackStopReason: def.fallbackTriggered ? "publication_criteria_met" : null,
      },
      seasonSlug: SEASON,
    });
  }

  return {
    manifest: {
      schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
      cohortId: "synthetic-fixture-cohort-v1",
      description:
        "Synthetic anonymizable fixture cohort for deterministic calibration harness tests. Not live characters.",
      createdAt: CALCULATED_AT,
      members,
      notes: "No live cohort until user provides/approves characters.",
    },
    evidenceById,
    modelRef,
  };
}

export function buildSyntheticFixtureBundle(
  model: ScoreModelConfigV1 = createDefaultModelV6(),
): CalibrationInputBundleV1 {
  const fixture = buildSyntheticFixtureCohort(model);
  return buildCalibrationInputBundle({
    manifest: fixture.manifest,
    evidenceByMemberId: fixture.evidenceById,
    activeModel: {
      ...fixture.modelRef,
      status: "ACTIVE",
      isActive: true,
    },
    evaluationModel: fixture.modelRef,
    generatedAt: CALCULATED_AT,
    source: "fixture",
    mode: "persisted-snapshot-only",
  });
}

export function createFixtureEvidencePort(
  evidenceById: Map<string, CalibrationMemberEvidence>,
): CalibrationEvidencePort {
  return {
    loadMemberEvidence(member) {
      const evidence = evidenceById.get(member.id);
      if (!evidence) {
        throw new Error(`No fixture evidence for member ${member.id}`);
      }
      return evidence;
    },
  };
}
