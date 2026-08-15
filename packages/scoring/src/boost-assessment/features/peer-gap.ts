import { clamp01 } from "../../math.js";
import { isExceptionalOperatingLevel } from "../character-context.js";
import { analysableRuns } from "../dungeon-filter.js";
import {
  BOOST_ASSESSMENT_POLICY,
  classifyPeerGap,
  dungeonRunSlotRole,
  dungeonRunSlotWeight,
  isExtremeRedPeerClass,
  isGreenPeerClass,
  isRedPeerClass,
  normalizeRate,
  performanceDelta,
  signedDeltaSeverity,
  type DungeonRunSlotRole,
  type PeerGapClass,
} from "../policy.js";
import { peerMedianKeyParse, subjectKeyParse } from "../sample.js";
import type {
  BoostDungeonContext,
  BoostFeatureComputeResult,
  BoostRunInput,
  SeasonHighKeyContext,
} from "../types.js";

export interface PeerGapRunInspection {
  run: BoostRunInput;
  slotIndex: number | null;
  role: DungeonRunSlotRole;
  weight: number;
  subjectKeyParse: number;
  peerMedianKeyParse: number;
  performanceDelta: number;
  classification: PeerGapClass;
  redSeverity: number;
  greenSeverity: number;
}

export function inspectComparablePeerGapRuns(
  sampleRuns: BoostRunInput[],
  contexts?: BoostDungeonContext[],
): PeerGapRunInspection[] {
  const rows: PeerGapRunInspection[] = [];
  for (const run of analysableRuns(sampleRuns, contexts)) {
    const subject = subjectKeyParse(run);
    const peerMed = peerMedianKeyParse(run);
    if (subject == null || peerMed == null) continue;
    const delta = performanceDelta(subject, peerMed);
    const classification = classifyPeerGap({
      subjectKeyParse: subject,
      peerMedianKeyParse: peerMed,
    });
    const slotIndex = typeof run.slotIndex === "number" ? run.slotIndex : null;
    const sev = signedDeltaSeverity(Math.abs(delta));
    rows.push({
      run,
      slotIndex,
      role: dungeonRunSlotRole(slotIndex),
      weight: dungeonRunSlotWeight(slotIndex),
      subjectKeyParse: subject,
      peerMedianKeyParse: peerMed,
      performanceDelta: delta,
      classification,
      redSeverity: delta < 0 ? sev : 0,
      greenSeverity: delta > 0 ? sev : 0,
    });
  }
  return rows;
}

export function peerGapWeightedContribution(
  row: PeerGapRunInspection,
  comparableWeight: number,
): number {
  if (!(comparableWeight > 0)) return 0;
  return (row.weight / comparableWeight) * (row.redSeverity - row.greenSeverity);
}

export function computeStrongPeerPerformanceGap(args: {
  sampleRuns: BoostRunInput[];
  context: SeasonHighKeyContext;
  dungeonContexts?: BoostDungeonContext[];
}): BoostFeatureComputeResult {
  const n = args.sampleRuns.length;
  if (n < BOOST_ASSESSMENT_POLICY.minUsableSampleRuns) {
    return {
      status: "unavailable",
      reasonCode: "INSUFFICIENT_SAMPLE",
      summary: "Not enough timed runs to assess same-run peer performance gaps.",
      publicEvidence: { boostSampleSize: n },
    };
  }
  if (!isExceptionalOperatingLevel(args.context)) {
    return {
      status: "unavailable",
      reasonCode: "SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL",
      summary: "Peer-gap scoring requires an exceptional character-level median key context.",
      publicEvidence: { boostSampleSize: n },
    };
  }

  const comparable = inspectComparablePeerGapRuns(args.sampleRuns, args.dungeonContexts);
  const peerCoverage = comparable.length / Math.max(1, n);
  if (
    comparable.length < BOOST_ASSESSMENT_POLICY.minPeerComparableRuns ||
    peerCoverage < BOOST_ASSESSMENT_POLICY.minPeerCoverageForComputed
  ) {
    return {
      status: "unavailable",
      reasonCode: "MISSING_PEER_PARSE_DATA",
      summary:
        "Same-run teammate Key % is missing or too sparse. Unavailable top runs are not treated as zero gap.",
      publicEvidence: {
        boostSampleSize: n,
        peerComparableRunCount: comparable.length,
        peerCoverage: Number(peerCoverage.toFixed(4)),
      },
      confidence: clamp01(peerCoverage),
    };
  }

  const comparableWeight = comparable.reduce((s, r) => s + r.weight, 0);
  let redMass = 0;
  let greenMass = 0;
  let materialWeight = 0;
  let extremeWeight = 0;
  let redPrimaryCount = 0;
  let extremePrimaryCount = 0;
  let greenPrimaryCount = 0;
  const extremePrimaryDungeons = new Set<string>();
  let comparablePrimary = 0;
  let comparableSecondary = 0;

  for (const row of comparable) {
    redMass += row.redSeverity * row.weight;
    greenMass += row.greenSeverity * row.weight;
    if (row.role === "PRIMARY") comparablePrimary += 1;
    else comparableSecondary += 1;
    if (isRedPeerClass(row.classification)) materialWeight += row.weight;
    if (isExtremeRedPeerClass(row.classification)) extremeWeight += row.weight;
    if (row.role === "PRIMARY" && isRedPeerClass(row.classification)) redPrimaryCount += 1;
    if (row.role === "PRIMARY" && isGreenPeerClass(row.classification)) greenPrimaryCount += 1;
    if (row.role === "PRIMARY" && isExtremeRedPeerClass(row.classification)) {
      extremePrimaryCount += 1;
      if (row.run.dungeonSlug) extremePrimaryDungeons.add(row.run.dungeonSlug);
    }
  }

  const weightedRedSeverity = comparableWeight > 0 ? redMass / comparableWeight : 0;
  const weightedGreenSeverity = comparableWeight > 0 ? greenMass / comparableWeight : 0;
  const weightedMaterialRate = comparableWeight > 0 ? materialWeight / comparableWeight : 0;
  const weightedExtremeRate = comparableWeight > 0 ? extremeWeight / comparableWeight : 0;
  const recurrence = Math.max(
    normalizeRate(
      weightedMaterialRate,
      BOOST_ASSESSMENT_POLICY.materialGapRateOnset,
      BOOST_ASSESSMENT_POLICY.materialGapRateSaturation,
    ),
    normalizeRate(
      weightedExtremeRate,
      BOOST_ASSESSMENT_POLICY.extremeGapRateOnset,
      BOOST_ASSESSMENT_POLICY.extremeGapRateSaturation,
    ),
  );
  let redValue = clamp01(weightedRedSeverity * Math.max(recurrence, weightedRedSeverity > 0.8 ? 1 : recurrence));
  const greenValue = weightedGreenSeverity;
  let value = clamp01(redValue - BOOST_ASSESSMENT_POLICY.greenCounterEvidenceGain * greenValue);
  const extremeDungeonCount = extremePrimaryDungeons.size;
  if (extremeDungeonCount >= BOOST_ASSESSMENT_POLICY.extremePrimaryDungeonFloor) {
    value = Math.max(value, BOOST_ASSESSMENT_POLICY.extremePrimaryValueFloor);
    redValue = Math.max(redValue, BOOST_ASSESSMENT_POLICY.extremePrimaryValueFloor);
  }

  return {
    status: "computed",
    evidence: { value, confidence: clamp01(0.4 + 0.6 * peerCoverage), sampleSize: comparable.length, coverage: peerCoverage },
    summary:
      value >= 0.7
        ? `Subject is repeatedly far below teammates on highest analysed keys (${extremePrimaryCount} extreme PRIMARY gaps across ${extremeDungeonCount} dungeons).`
        : value >= 0.35
          ? `Material same-run underperformance versus teammates on highest analysed keys.`
          : greenValue > redValue
            ? `Subject generally outperforms teammates on highest analysed keys (green counter-evidence).`
            : `Same-run Key % versus teammates is not a strong carry pattern.`,
    publicEvidence: {
      boostSampleSize: n,
      peerComparableRunCount: comparable.length,
      peerCoverage: Number(peerCoverage.toFixed(4)),
      comparablePrimaryRunCount: comparablePrimary,
      comparableSecondaryRunCount: comparableSecondary,
      comparableWeight: Number(comparableWeight.toFixed(4)),
      redPrimaryCount,
      extremePrimaryCount,
      extremePrimaryDungeonCount: extremeDungeonCount,
      greenPrimaryCount,
      weightedRedSeverity: Number(weightedRedSeverity.toFixed(4)),
      weightedGreenSeverity: Number(weightedGreenSeverity.toFixed(4)),
      weightedMaterialRate: Number(weightedMaterialRate.toFixed(4)),
      weightedExtremeRate: Number(weightedExtremeRate.toFixed(4)),
      weightedMaterialGapWeight: Number(materialWeight.toFixed(4)),
      materialPeerGapRunCount: comparable.filter((r) => isRedPeerClass(r.classification)).length,
      extremePeerGapRunCount: comparable.filter((r) => isExtremeRedPeerClass(r.classification)).length,
      greenPeerGapRunCount: comparable.filter((r) => isGreenPeerClass(r.classification)).length,
      redPeerEvidence: Number(redValue.toFixed(4)),
      greenPeerEvidence: Number(greenValue.toFixed(4)),
      performanceDeltaSign: "subject_minus_peer_median",
    },
  };
}
