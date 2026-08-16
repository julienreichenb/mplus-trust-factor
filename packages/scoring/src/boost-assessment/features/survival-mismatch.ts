import { computeTrueMedian } from "../../context/median.js";
import { clamp01 } from "../../math.js";
import { primaryAnalysableRuns } from "../dungeon-filter.js";
import {
  BOOST_ASSESSMENT_POLICY,
  exceptionalSignalScale,
  normalizeRate,
} from "../policy.js";
import type { BoostDungeonContext, BoostFeatureComputeResult, BoostRunInput, SeasonHighKeyContext } from "../types.js";

export function computeSurvivalMismatch(args: {
  sampleRuns: BoostRunInput[];
  dungeonContexts?: BoostDungeonContext[];
  context?: SeasonHighKeyContext;
}): BoostFeatureComputeResult {
  const primaries = primaryAnalysableRuns(args.sampleRuns, args.dungeonContexts);
  const n = primaries.length;
  if (n < 2) {
    return {
      status: "unavailable",
      reasonCode: "MISSING_SURVIVAL_EVIDENCE",
      summary: "Not enough verified PRIMARY runs with public evidence to assess deaths.",
      publicEvidence: { verifiedPrimaryRunCount: n },
    };
  }

  const withSurvival = primaries.filter(
    (r) => r.survivalAvailable === true && r.deathCount != null && Number.isFinite(r.deathCount),
  );
  if (withSurvival.length === 0) {
    return {
      status: "unavailable",
      reasonCode: "MISSING_SURVIVAL_EVIDENCE",
      summary: "Persisted subject-only death evidence is not available for verified PRIMARY runs.",
      publicEvidence: { verifiedPrimaryRunCount: n, deathCoveredRunCount: 0 },
    };
  }

  const deaths = withSurvival.map((r) => r.deathCount ?? 0);
  const totalDeaths = deaths.reduce((a, b) => a + b, 0);
  const medianDeaths = computeTrueMedian(deaths)!;
  const zero = deaths.filter((d) => d === 0).length;
  const ge1 = deaths.filter((d) => d >= 1).length;
  const ge2 = deaths.filter((d) => d >= 2).length;
  const ge3 = deaths.filter((d) => d >= 3).length;
  const twoDeathRate = ge2 / withSurvival.length;
  const threeDeathRate = ge3 / withSurvival.length;
  const zeroRate = zero / withSurvival.length;
  const recurrence = Math.max(
    normalizeRate(twoDeathRate, BOOST_ASSESSMENT_POLICY.twoDeathRunRateOnset, BOOST_ASSESSMENT_POLICY.twoDeathRunRateSaturation),
    normalizeRate(threeDeathRate, 0.2, 0.5),
  );
  const severity = clamp01(
    (medianDeaths - BOOST_ASSESSMENT_POLICY.survivalMedianDeathsOnset) /
      (BOOST_ASSESSMENT_POLICY.survivalMedianDeathsSaturation - BOOST_ASSESSMENT_POLICY.survivalMedianDeathsOnset),
  );
  const green = normalizeRate(
    zeroRate,
    BOOST_ASSESSMENT_POLICY.zeroDeathGreenOnset,
    BOOST_ASSESSMENT_POLICY.zeroDeathGreenSaturation,
  );
  const scale = exceptionalSignalScale(args.context?.subjectMedianKeyPercentileBps);
  let value = clamp01(recurrence * Math.max(severity, recurrence > 0 ? 0.4 : 0) * Math.max(scale, 0.35));
  value = clamp01(value * (1 - 0.7 * green));

  return {
    status: "computed",
    evidence: { value, confidence: clamp01(0.35 + 0.6 * (withSurvival.length / n)), sampleSize: withSurvival.length, coverage: withSurvival.length / n },
    summary:
      value >= 0.4
        ? `Repeated deaths on verified highest keys (${ge2}/${withSurvival.length} PRIMARY runs with ≥2 deaths).`
        : green >= 0.5
          ? `Repeated zero-death verified PRIMARY keys reduce Survival suspicion.`
          : "Deaths on verified highest keys are not a repeated pattern.",
    publicEvidence: {
      verifiedPrimaryRunCount: n,
      deathCoveredRunCount: withSurvival.length,
      totalDeaths,
      medianDeathsPerRun: Number(medianDeaths.toFixed(2)),
      runsWithZeroDeaths: zero,
      runsWithAtLeastOneDeath: ge1,
      runsWithAtLeastTwoDeaths: ge2,
      runsWithAtLeastThreeDeaths: ge3,
      twoDeathRate: Number(twoDeathRate.toFixed(4)),
      zeroDeathRate: Number(zeroRate.toFixed(4)),
      survivalGreenEvidence: Number(green.toFixed(4)),
    },
  };
}
