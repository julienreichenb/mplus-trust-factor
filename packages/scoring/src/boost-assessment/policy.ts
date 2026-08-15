/**
 * Centralized Boost Suspicion V2 policy.
 * Calibrate here only — never scatter thresholds in feature files.
 */

import { PERCENTILE_BPS_P99, PERCENTILE_BPS_P99_9 } from "@mplus/contracts";

export const BOOST_DETECTOR_VERSION = "boost-assessment-v2.0.0";
export const BOOST_POLICY_VERSION = "boost-policy-v2.0.0";
export const BOOST_ASSESSMENT_SCHEMA_VERSION = 3 as const;

export const PRIMARY_DUNGEON_RUN_WEIGHT = 1.0;
export const SECONDARY_DUNGEON_RUN_WEIGHT = 0.25;

export const BOOST_ASSESSMENT_POLICY = Object.freeze({
  weights: Object.freeze({
    strongPeerPerformanceGap: 45,
    recurrentStrongPeerCohort: 22,
    survivalMismatch: 14,
    topRunPublicEvidenceUnavailable: 10,
    highestRunTemporalCluster: 9,
  }),
  bands: Object.freeze({
    elevatedMin: 40,
    highMin: 70,
  }),
  boostSampleCap: 16,
  minUsableSampleRuns: 3,
  minParseCoveredRuns: 3,
  minParseCoverageForComputed: 0.35,
  minPeerComparableRuns: 3,
  minPeerCoverageForComputed: 0.35,
  exceptionalPercentileBpsMin: PERCENTILE_BPS_P99,
  extremePercentileBps: PERCENTILE_BPS_P99_9,
  highKeyPercentileBps: PERCENTILE_BPS_P99,
  extremeKeyPercentileBps: PERCENTILE_BPS_P99_9,
  /** |performanceDelta| below this is treated as zero severity. */
  signedDeadZone: 15,
  /** |delta| at/above this is a material red or green gap. */
  materialAbsDelta: 25,
  extremeAbsDelta: 50,
  extremeGapRequiresSubjectMax: 20,
  extremeGapRequiresPeerMin: 80,
  gapSeveritySaturation: 70,
  severityExponent: 1.35,
  greenCounterEvidenceGain: 0.5,
  /** Distinct-dungeon EXTREME PRIMARY red gaps that floor peer-gap to near-conclusive. */
  extremePrimaryDungeonFloor: 4,
  extremePrimaryValueFloor: 0.9,
  extremePrimarySuspicionFloor: 72,
  extremePrimaryFiveSuspicionFloor: 82,
  materialGapRateOnset: 0.2,
  materialGapRateSaturation: 0.65,
  extremeGapRateOnset: 0.2,
  extremeGapRateSaturation: 0.5,
  minSharedGapRunsForCohort: 3,
  minCohortDistinctDungeons: 2,
  cohortRateOnset: 0.35,
  cohortRateSaturation: 0.75,
  deathRunRateOnset: 0.25,
  deathRunRateSaturation: 0.7,
  twoDeathRunRateOnset: 0.3,
  twoDeathRunRateSaturation: 0.65,
  survivalMedianDeathsOnset: 1,
  survivalMedianDeathsSaturation: 3,
  zeroDeathGreenOnset: 0.5,
  zeroDeathGreenSaturation: 0.85,
  unavailableRateOnset: 0.25,
  unavailableRateSaturation: 0.5,
  temporalDistinct48hOnset: 3,
  temporalDistinct48hSaturation: 5,
  temporalDistinct24hBonus: 5,
  cohortAloneSuspicionCap: 22,
  contextOnlySuspicionCap: 28,
  temporalAloneSuspicionCap: 15,
  unavailableAloneSuspicionCap: 22,
  rankingVersion: "ranking-parse-v1",
  primaryDungeonRunWeight: PRIMARY_DUNGEON_RUN_WEIGHT,
  secondaryDungeonRunWeight: SECONDARY_DUNGEON_RUN_WEIGHT,
});

export type BoostAssessmentPolicy = typeof BOOST_ASSESSMENT_POLICY;

export type DungeonRunSlotRole = "PRIMARY" | "SECONDARY";

export function dungeonRunSlotRole(slotIndex: number | null | undefined): DungeonRunSlotRole {
  return slotIndex === 1 ? "SECONDARY" : "PRIMARY";
}

export function dungeonRunSlotWeight(slotIndex: number | null | undefined): number {
  return slotIndex === 1
    ? BOOST_ASSESSMENT_POLICY.secondaryDungeonRunWeight
    : BOOST_ASSESSMENT_POLICY.primaryDungeonRunWeight;
}

/** Signed: subject Key % minus peer median. Positive = subject better. */
export function performanceDelta(subjectKeyParse: number, peerMedianKeyParse: number): number {
  return subjectKeyParse - peerMedianKeyParse;
}

export function signedDeltaSeverity(absDelta: number): number {
  const policy = BOOST_ASSESSMENT_POLICY;
  if (!Number.isFinite(absDelta) || absDelta < policy.signedDeadZone) return 0;
  const t =
    (absDelta - policy.signedDeadZone) / (policy.gapSeveritySaturation - policy.signedDeadZone);
  const clamped = Math.max(0, Math.min(1, t));
  return clamped ** policy.severityExponent;
}

/** @deprecated Use signedDeltaSeverity on |performanceDelta|. Kept for call-site migration. */
export function peerGapSeverityFromRawGap(legacyPeerMinusSubject: number): number {
  return signedDeltaSeverity(Math.abs(legacyPeerMinusSubject));
}

export type PeerGapClass =
  | "NEUTRAL"
  | "RED_MATERIAL"
  | "RED_EXTREME"
  | "GREEN_MATERIAL"
  | "GREEN_EXTREME"
  | "UNAVAILABLE"
  | "NORMAL"
  | "MATERIAL_GAP"
  | "EXTREME_GAP";

export function classifyPeerGap(input: {
  subjectKeyParse: number | null;
  peerMedianKeyParse: number | null;
}): PeerGapClass {
  const policy = BOOST_ASSESSMENT_POLICY;
  if (
    input.subjectKeyParse == null ||
    !Number.isFinite(input.subjectKeyParse) ||
    input.peerMedianKeyParse == null ||
    !Number.isFinite(input.peerMedianKeyParse)
  ) {
    return "UNAVAILABLE";
  }
  const delta = performanceDelta(input.subjectKeyParse, input.peerMedianKeyParse);
  if (
    delta <= -policy.extremeAbsDelta &&
    input.subjectKeyParse <= policy.extremeGapRequiresSubjectMax &&
    input.peerMedianKeyParse >= policy.extremeGapRequiresPeerMin
  ) {
    return "RED_EXTREME";
  }
  if (delta <= -policy.materialAbsDelta) return "RED_MATERIAL";
  if (delta >= policy.extremeAbsDelta) return "GREEN_EXTREME";
  if (delta >= policy.materialAbsDelta) return "GREEN_MATERIAL";
  return "NEUTRAL";
}

export function isRedPeerClass(cls: PeerGapClass): boolean {
  return cls === "RED_MATERIAL" || cls === "RED_EXTREME" || cls === "MATERIAL_GAP" || cls === "EXTREME_GAP";
}

export function isExtremeRedPeerClass(cls: PeerGapClass): boolean {
  return cls === "RED_EXTREME" || cls === "EXTREME_GAP";
}

export function isGreenPeerClass(cls: PeerGapClass): boolean {
  return cls === "GREEN_MATERIAL" || cls === "GREEN_EXTREME";
}

export function normalizeRate(rate: number, onset: number, saturation: number): number {
  if (!Number.isFinite(rate) || saturation <= onset) return 0;
  if (rate <= onset) return 0;
  if (rate >= saturation) return 1;
  return (rate - onset) / (saturation - onset);
}

export function exceptionalSignalScale(percentileBps: number | null | undefined): number {
  if (percentileBps == null || !Number.isFinite(percentileBps)) return 0.2;
  if (percentileBps >= PERCENTILE_BPS_P99_9) return 1;
  if (percentileBps >= PERCENTILE_BPS_P99) return 0.85;
  return 0.2;
}
