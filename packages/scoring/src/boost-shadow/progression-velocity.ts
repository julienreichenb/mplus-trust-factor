import { clamp01 } from "../math.js";
import {
  MIN_DATED_RUN_COVERAGE,
  PROGRESSION_WINDOW_DAYS,
  VELOCITY_BASELINE_MIN_RUNS,
} from "./constants.js";
import type { BoostShadowRunInput, FeatureComputeResult } from "./types.js";

/** Season-normalized key bands for intermediate coverage (evaluation schema). */
export const VELOCITY_KEY_BANDS = [
  { id: "2-4", min: 2, max: 4 },
  { id: "5-7", min: 5, max: 7 },
  { id: "8-9", min: 8, max: 9 },
  { id: "10-11", min: 10, max: 11 },
  { id: "12-14", min: 12, max: 14 },
  { id: "15+", min: 15, max: 99 },
] as const;

function bandIdForKey(keyLevel: number): string | null {
  for (const band of VELOCITY_KEY_BANDS) {
    if (keyLevel >= band.min && keyLevel <= band.max) return band.id;
  }
  return null;
}

function daysBetween(aMs: number, bMs: number): number {
  return Math.max(0, (bMs - aMs) / (24 * 60 * 60 * 1000));
}

/**
 * Progression through key difficulty over elapsed time — not run volume.
 * Missing evidence → omit (never coerce to 0).
 */
export function computeProgressionVelocity(args: {
  runs: BoostShadowRunInput[];
  seasonId: string;
  timedOnlyFirstCompletions?: boolean;
}): FeatureComputeResult {
  const timedOnly = args.timedOnlyFirstCompletions ?? false;
  const dated = args.runs
    .filter((r) => r.seasonId === args.seasonId && r.completedAt)
    .map((r) => ({
      ...r,
      completedAtMs: Date.parse(r.completedAt!),
    }))
    .filter((r) => Number.isFinite(r.completedAtMs))
    .sort((a, b) => a.completedAtMs - b.completedAtMs);

  const seasonRunCount = args.runs.filter((r) => r.seasonId === args.seasonId).length;
  const datedRunCoverage = seasonRunCount > 0 ? dated.length / seasonRunCount : 0;

  if (dated.length < VELOCITY_BASELINE_MIN_RUNS) {
    return {
      status: "omitted",
      reasonCode: "INSUFFICIENT_DATED_RUNS",
      diagnostics: { datedRunCoverage },
    };
  }

  if (datedRunCoverage < MIN_DATED_RUN_COVERAGE) {
    return {
      status: "omitted",
      reasonCode: "LOW_DATED_RUN_COVERAGE",
      diagnostics: { datedRunCoverage },
    };
  }

  const firstByKey = new Map<number, number>();
  for (const run of dated) {
    if (timedOnly && !run.timed) continue;
    if (!firstByKey.has(run.keyLevel)) {
      firstByKey.set(run.keyLevel, run.completedAtMs);
    }
  }

  if (firstByKey.size < 2) {
    return {
      status: "omitted",
      reasonCode: "NO_BASELINE",
      diagnostics: { datedRunCoverage, topKeyRunCount: 0 },
    };
  }

  const firstCompletions = [...firstByKey.entries()]
    .map(([keyLevel, at]) => ({ keyLevel, at }))
    .sort((a, b) => a.at - b.at);

  // Peak = highest key first-completion; if ties, earliest peak time among max keys.
  let endingBestKey = firstCompletions[0]!.keyLevel;
  let endingAt = firstCompletions[0]!.at;
  for (const entry of firstCompletions) {
    if (entry.keyLevel > endingBestKey) {
      endingBestKey = entry.keyLevel;
      endingAt = entry.at;
    }
  }

  // Baseline = best key first-completed strictly before the peak timestamp.
  let startingBestKey = -Infinity;
  let startingAt = -Infinity;
  for (const entry of firstCompletions) {
    if (entry.at < endingAt && entry.keyLevel >= startingBestKey) {
      startingBestKey = entry.keyLevel;
      startingAt = entry.at;
    }
  }

  if (!Number.isFinite(startingBestKey) || startingAt < 0) {
    return {
      status: "omitted",
      reasonCode: "NO_BASELINE",
      diagnostics: {
        endingBestKey,
        datedRunCoverage,
      },
    };
  }

  // Measure climb from the earliest first-completion inside the hypothesis window
  // ending at peak; if none, use the pre-peak baseline (late return / long climb).
  const windowStartMs = endingAt - PROGRESSION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let windowBaselineKey = startingBestKey;
  let windowBaselineAt = startingAt;
  let foundInWindow = false;
  for (const entry of firstCompletions) {
    if (entry.at < windowStartMs || entry.at >= endingAt) continue;
    if (!foundInWindow || entry.at < windowBaselineAt) {
      windowBaselineKey = entry.keyLevel;
      windowBaselineAt = entry.at;
      foundInWindow = true;
    }
  }

  const keyLevelDelta = endingBestKey - windowBaselineKey;
  const elapsedDays = daysBetween(windowBaselineAt, endingAt);

  const bandsObserved = new Set<string>();
  for (const key of firstByKey.keys()) {
    const id = bandIdForKey(key);
    if (id) bandsObserved.add(id);
  }

  const topKeyRunCount = dated.filter((r) => r.keyLevel === endingBestKey).length;
  const diagnostics = {
    startingBestKey: windowBaselineKey,
    endingBestKey,
    keyLevelDelta: Math.max(0, keyLevelDelta),
    elapsedDays,
    intermediateBandsObserved: bandsObserved.size,
    datedRunCoverage,
    topKeyRunCount,
  };

  if (keyLevelDelta <= 0 || elapsedDays <= 0) {
    return {
      status: "computed",
      evidence: {
        value: 0,
        confidence: clamp01(0.4 + 0.4 * datedRunCoverage),
        sampleSize: firstByKey.size,
        coverage: datedRunCoverage,
      },
      diagnostics,
    };
  }

  const keysPerDay = keyLevelDelta / Math.max(elapsedDays, 1 / 24);
  const value = clamp01(keysPerDay / 1.0);
  const confidence = clamp01(
    0.45 + 0.4 * datedRunCoverage + (bandsObserved.size >= 3 ? 0.1 : 0),
  );

  return {
    status: "computed",
    evidence: {
      value,
      confidence,
      sampleSize: firstByKey.size,
      coverage: datedRunCoverage,
    },
    diagnostics,
  };
}
