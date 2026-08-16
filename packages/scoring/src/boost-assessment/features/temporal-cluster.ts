import { clamp01 } from "../../math.js";
import { exceptionalSignalScale, normalizeRate, BOOST_ASSESSMENT_POLICY } from "../policy.js";
import type { BoostDungeonContext, BoostFeatureComputeResult, SeasonHighKeyContext } from "../types.js";

function hoursBetween(a: number, b: number): number {
  return Math.abs(a - b) / 3_600_000;
}

function maxDistinctInWindow(times: number[], windowHours: number): number {
  if (times.length === 0) return 0;
  const sorted = [...times].sort((x, y) => x - y);
  let best = 1;
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (j < sorted.length && hoursBetween(sorted[j]!, sorted[i]!) <= windowHours) j += 1;
    best = Math.max(best, j - i);
  }
  return best;
}

export function computeHighestRunTemporalCluster(args: {
  dungeonContexts: BoostDungeonContext[] | undefined;
  context: SeasonHighKeyContext;
}): BoostFeatureComputeResult {
  const contexts = args.dungeonContexts ?? [];
  const times = contexts
    .map((c) => (c.blizzardBestCompletedAt ? Date.parse(c.blizzardBestCompletedAt) : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length < 3) {
    return {
      status: "unavailable",
      reasonCode: "INSUFFICIENT_SAMPLE",
      summary: "Not enough Blizzard highest-run timestamps to assess clustering.",
      publicEvidence: { datedDungeonBests: times.length },
    };
  }
  const in24 = maxDistinctInWindow(times, 24);
  const in48 = maxDistinctInWindow(times, 48);
  const in72 = maxDistinctInWindow(times, 72);
  const recurrence = Math.max(
    normalizeRate(
      in48,
      BOOST_ASSESSMENT_POLICY.temporalDistinct48hOnset,
      BOOST_ASSESSMENT_POLICY.temporalDistinct48hSaturation,
    ),
    in24 >= BOOST_ASSESSMENT_POLICY.temporalDistinct24hBonus ? 1 : 0,
  );
  const scale = exceptionalSignalScale(args.context.subjectMedianKeyPercentileBps);
  const value = clamp01(recurrence * scale);
  return {
    status: "computed",
    evidence: { value, confidence: 0.8, sampleSize: times.length, coverage: times.length / Math.max(1, contexts.length) },
    summary:
      in48 >= 5
        ? `${in48} distinct dungeon-best timed runs fall within 48 hours.`
        : in48 >= 4
          ? `${in48} dungeon-best timed runs cluster within 48 hours.`
          : "Highest dungeon records are not tightly clustered.",
    publicEvidence: {
      datedDungeonBests: times.length,
      maxDistinctDungeons24h: in24,
      maxDistinctDungeons48h: in48,
      maxDistinctDungeons72h: in72,
      bestRunDates: contexts.map((c) => ({
        dungeonSlug: c.dungeonSlug,
        blizzardBestCompletedAt: c.blizzardBestCompletedAt,
        blizzardBestKeyLevel: c.blizzardBestKeyLevel,
      })),
    },
  };
}
