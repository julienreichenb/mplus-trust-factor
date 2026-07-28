import type { UtilityCapability } from "@mplus/mechanics";
import { availableWindows } from "@mplus/mechanics";
import { clamp, clamp01, safeDivide } from "../math.js";
import type {
  ComputeUtilityInput,
  ComputeUtilityResult,
  UtilityContributorScore,
  UtilityRunFactsInput,
  UtilityRunScore,
  UtilitySummaryDTO,
} from "./types.js";

/** Provisional Utility v3 contributor weights (Agent 27 may recalibrate). */
export const UTILITY_INTERRUPT_WEIGHT = 0.4;
export const UTILITY_CROWD_CONTROL_WEIGHT = 0.25;
export const UTILITY_GROUP_SUPPORT_WEIGHT = 0.2;
export const UTILITY_DISPELS_WEIGHT = 0.15;

/** Interrupt blend: activity vs success quality. */
export const KICK_ACTIVITY_WEIGHT = 0.7;
export const KICK_SUCCESS_WEIGHT = 0.3;

export const UTILITY_V3_FORMULA_VERSION = "utility-v3-1";

export const UTILITY_V3_METRIC_KEYS = {
  interrupts: "utility.v3.interrupts",
  crowdControl: "utility.v3.crowd_control",
  groupSupport: "utility.v3.group_support",
  dispels: "utility.v3.dispels",
} as const;

/** Soft activity caps when no cooldown-based window estimate exists. */
const CC_SOFT_TARGET_CAP = 8;
const DISPEL_SOFT_CAP = 6;
const GROUP_SUPPORT_SOFT_CAP = 3;

function meanOfValid(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

function score01To100(value: number): number {
  return clamp(value * 100);
}

/**
 * Drop unsupported contributors and renormalize remaining weights to sum 1.
 */
export function resolveUtilityContributorWeights(capability: UtilityCapability): Array<{
  key: "interrupts" | "crowd_control" | "group_support" | "dispels";
  weight: number;
}> {
  const candidates: Array<{
    key: "interrupts" | "crowd_control" | "group_support" | "dispels";
    weight: number;
    enabled: boolean;
  }> = [
    { key: "interrupts", weight: UTILITY_INTERRUPT_WEIGHT, enabled: capability.interrupts },
    {
      key: "crowd_control",
      weight: UTILITY_CROWD_CONTROL_WEIGHT,
      enabled: capability.crowdControl,
    },
    {
      key: "group_support",
      weight: UTILITY_GROUP_SUPPORT_WEIGHT,
      enabled: capability.groupSupport,
    },
    { key: "dispels", weight: UTILITY_DISPELS_WEIGHT, enabled: capability.dispels },
  ];
  const enabled = candidates.filter((c) => c.enabled);
  const sum = enabled.reduce((s, c) => s + c.weight, 0);
  if (sum <= 0) return [];
  return enabled.map((c) => ({ key: c.key, weight: c.weight / sum }));
}

/**
 * Model metric weights for UTILITY v3. Capability-aware renormalization.
 * Does not mutate global dimension weights or compose default@3.
 */
export function resolveUtilityMetricWeights(capability: UtilityCapability): Array<{
  metricKey: string;
  weight: number;
}> {
  return resolveUtilityContributorWeights(capability).map((c) => ({
    metricKey: UTILITY_V3_METRIC_KEYS[
      c.key === "crowd_control"
        ? "crowdControl"
        : c.key === "group_support"
          ? "groupSupport"
          : c.key
    ],
    weight: c.weight,
  }));
}

export function computeKickActivityScore(
  kickCasts: number,
  availableKickWindows: number | null,
): number | null {
  if (!Number.isFinite(kickCasts) || kickCasts < 0) return null;
  if (availableKickWindows == null || availableKickWindows <= 0) {
    // Without cooldown/duration, treat casts as weak activity signal (soft cap ~12).
    return score01To100(clamp01(kickCasts / 12));
  }
  return score01To100(clamp01(kickCasts / availableKickWindows));
}

export function computeKickSuccessScore(
  successfulInterrupts: number,
  kickCasts: number,
): number | null {
  if (!Number.isFinite(successfulInterrupts) || successfulInterrupts < 0) return null;
  if (!Number.isFinite(kickCasts) || kickCasts < 0) return null;
  return score01To100(clamp01(successfulInterrupts / Math.max(kickCasts, 1)));
}

export function computeInterruptScore(
  kickCasts: number | null,
  successfulInterrupts: number | null,
  effectiveKickCooldownMs: number | null,
  durationMs: number | null,
): { score: number | null; evidence: Record<string, number | string | boolean | null> } {
  if (kickCasts == null || successfulInterrupts == null) {
    return {
      score: null,
      evidence: {
        kickCasts,
        successfulInterrupts,
        availableKickWindows: null,
        kickActivityScore: null,
        kickSuccessScore: null,
      },
    };
  }
  const availableKickWindows = availableWindows(durationMs, effectiveKickCooldownMs);
  const kickActivityScore = computeKickActivityScore(kickCasts, availableKickWindows);
  const kickSuccessScore = computeKickSuccessScore(successfulInterrupts, kickCasts);
  if (kickActivityScore == null || kickSuccessScore == null) {
    return {
      score: null,
      evidence: {
        kickCasts,
        successfulInterrupts,
        availableKickWindows,
        kickActivityScore,
        kickSuccessScore,
      },
    };
  }
  const score =
    KICK_ACTIVITY_WEIGHT * kickActivityScore + KICK_SUCCESS_WEIGHT * kickSuccessScore;
  return {
    score,
    evidence: {
      kickCasts,
      successfulInterrupts,
      effectiveKickCooldownMs,
      availableKickWindows,
      kickActivityScore,
      kickSuccessScore,
      interruptScore: score,
    },
  };
}

export function computeCrowdControlScore(
  distinctCcTargets: number | null,
  durationMs: number | null,
  medianCcCooldownMs: number | null = 45_000,
): { score: number | null; evidence: Record<string, number | string | boolean | null> } {
  if (distinctCcTargets == null) {
    return { score: null, evidence: { distinctCcTargets: null } };
  }
  const windows = availableWindows(durationMs, medianCcCooldownMs);
  const denominator = windows != null ? Math.min(CC_SOFT_TARGET_CAP, windows) : CC_SOFT_TARGET_CAP;
  const score = score01To100(clamp01(distinctCcTargets / Math.max(1, denominator)));
  return {
    score,
    evidence: {
      distinctCcTargets,
      availableCcWindows: windows,
      softCap: denominator,
      note: "unique_hostile_targets_reapplications_do_not_inflate",
    },
  };
}

export function computeGroupSupportScore(
  groupSupportCasts: number | null,
  durationMs: number | null,
  groupSupportCooldownMs: number | null = 10_000,
  evidenceMode: string | null = null,
  confirmedUsages: number | null = null,
): { score: number | null; evidence: Record<string, number | string | boolean | null> } {
  if (groupSupportCasts == null) {
    return { score: null, evidence: { groupSupportCasts: null } };
  }
  const windows = availableWindows(durationMs, groupSupportCooldownMs);
  const denominator =
    windows != null ? Math.min(GROUP_SUPPORT_SOFT_CAP * 4, windows) : GROUP_SUPPORT_SOFT_CAP;
  const score = score01To100(clamp01(groupSupportCasts / Math.max(1, denominator)));
  return {
    score,
    evidence: {
      groupSupportCasts,
      groupSupportConfirmedUsages: confirmedUsages,
      evidenceMode: evidenceMode ?? (groupSupportCasts > 0 ? "cast_only" : "none"),
      availableUses: windows,
      note:
        evidenceMode === "confirmed_party_usage"
          ? "party_usage_confirmed_via_aura"
          : "cast_or_summon_only_party_usage_may_be_unconfirmed",
    },
  };
}

export function computeDispelScore(
  defensiveDispels: number | null,
  offensiveDispels: number | null,
  capability: UtilityCapability,
  durationMs: number | null,
  defensiveCooldownMs: number | null = 15_000,
): { score: number | null; evidence: Record<string, number | string | boolean | null> } {
  if (!capability.dispels) {
    return { score: null, evidence: { reason: "no_dispel_capability" } };
  }
  const def = capability.defensiveDispels ? (defensiveDispels ?? 0) : 0;
  const off = capability.offensiveDispels ? (offensiveDispels ?? 0) : 0;
  if (defensiveDispels == null && offensiveDispels == null) {
    return { score: null, evidence: { defensiveDispels, offensiveDispels } };
  }
  const total = def + off;
  const windows = availableWindows(durationMs, defensiveCooldownMs);
  const denominator = windows != null ? Math.min(DISPEL_SOFT_CAP * 2, windows) : DISPEL_SOFT_CAP;
  const score = score01To100(clamp01(total / Math.max(1, denominator)));
  return {
    score,
    evidence: {
      defensiveDispels: def,
      offensiveDispels: off,
      offensiveCapable: capability.offensiveDispels,
      availableUses: windows,
    },
  };
}

function scoreRunContributors(
  run: UtilityRunFactsInput,
  capability: UtilityCapability,
  weights: Array<{ key: UtilityContributorScore["key"]; weight: number }>,
): UtilityContributorScore[] {
  const out: UtilityContributorScore[] = [];
  for (const { key, weight } of weights) {
    if (key === "interrupts") {
      const { score, evidence } = computeInterruptScore(
        run.kickCasts,
        run.successfulInterrupts,
        run.effectiveKickCooldownMs,
        run.durationMs,
      );
      out.push({
        key,
        weight,
        score,
        available: score != null && run.detailAvailable,
        evidence,
      });
    } else if (key === "crowd_control") {
      const { score, evidence } = computeCrowdControlScore(
        run.distinctCcTargets,
        run.durationMs,
      );
      out.push({
        key,
        weight,
        score,
        available: score != null && run.detailAvailable,
        evidence,
      });
    } else if (key === "group_support") {
      const { score, evidence } = computeGroupSupportScore(
        run.groupSupportCasts,
        run.durationMs,
        10_000,
        run.groupSupportEvidenceMode ?? null,
        run.groupSupportConfirmedUsages ?? null,
      );
      out.push({
        key,
        weight,
        score,
        available: score != null && run.detailAvailable,
        evidence,
      });
    } else {
      const { score, evidence } = computeDispelScore(
        run.defensiveDispels,
        run.offensiveDispels,
        capability,
        run.durationMs,
      );
      out.push({
        key,
        weight,
        score,
        available: score != null && run.detailAvailable,
        evidence,
      });
    }
  }
  return out;
}

function combineRunScore(contributors: UtilityContributorScore[]): number | null {
  const available = contributors.filter((c) => c.available && c.score != null);
  if (available.length === 0) return null;
  const weightSum = available.reduce((s, c) => s + c.weight, 0);
  if (weightSum <= 0) return null;
  return available.reduce((s, c) => s + c.score! * safeDivide(c.weight, weightSum, 0), 0);
}

/**
 * Independent UTILITY confidence. Missing detail lowers confidence — never invents zeros.
 */
export function computeUtilityConfidence(input: {
  dungeonCount: number;
  expectedDungeonCount: number;
  detailAvailableCount: number;
  selectedRunWclCoverage: number;
  hasResolvedSpecAndRole: boolean;
  logFreshness: number;
  contributorCoverage: number;
}): number {
  if (input.detailAvailableCount === 0) return 0;

  const expected = Math.max(1, input.expectedDungeonCount);
  const coverage = clamp01(input.dungeonCount / expected);
  const detailRatio = clamp01(input.detailAvailableCount / Math.max(1, input.dungeonCount));
  const breadth =
    input.detailAvailableCount <= 1
      ? 0.25
      : input.detailAvailableCount <= 2
        ? 0.45
        : input.detailAvailableCount <= 4
          ? 0.7
          : clamp01(
              0.7 +
                0.3 *
                  ((input.detailAvailableCount - 4) / Math.max(1, expected - 4)),
            );

  const freshness = clamp01(input.logFreshness);
  const wclCoverage = clamp01(input.selectedRunWclCoverage);
  const identity = input.hasResolvedSpecAndRole ? 1 : 0.7;
  const contributorCoverage = clamp01(input.contributorCoverage);

  const base =
    0.28 * coverage +
    0.22 * breadth +
    0.18 * detailRatio +
    0.12 * contributorCoverage +
    0.1 * freshness +
    0.1 * wclCoverage;

  return clamp01(base * identity);
}

export function computeUtilityDimension(input: ComputeUtilityInput): ComputeUtilityResult {
  const weights = resolveUtilityContributorWeights(input.capability);
  const allKeys: Array<UtilityContributorScore["key"]> = [
    "interrupts",
    "crowd_control",
    "group_support",
    "dispels",
  ];
  const droppedContributors = allKeys
    .filter((k) => !weights.some((w) => w.key === k))
    .map(String);

  const detailedRuns = input.runs.filter((r) => r.detailAvailable);
  const runScores: UtilityRunScore[] = input.runs.map((run) => {
    if (!run.detailAvailable) {
      return {
        dungeonSlug: run.dungeonSlug,
        dungeonName: run.dungeonName ?? run.dungeonSlug,
        canonicalRunId: run.canonicalRunId,
        keyLevel: run.keyLevel,
        detailAvailable: false,
        runUtilityScore: null,
        contributors: weights.map((w) => ({
          key: w.key,
          weight: w.weight,
          score: null,
          available: false,
          evidence: { reason: "wcl_detail_unavailable" },
        })),
        confidence: 0,
        missingContributors: weights.map((w) => w.key),
        catalogCoverage: input.capability.catalogCoverage,
      };
    }
    const contributors = scoreRunContributors(run, input.capability, weights);
    const runUtilityScore = combineRunScore(contributors);
    const missingContributors = contributors
      .filter((c) => !c.available)
      .map((c) => c.key);
    const availRatio =
      contributors.length === 0
        ? 0
        : contributors.filter((c) => c.available).length / contributors.length;
    return {
      dungeonSlug: run.dungeonSlug,
      dungeonName: run.dungeonName ?? run.dungeonSlug,
      canonicalRunId: run.canonicalRunId,
      keyLevel: run.keyLevel,
      detailAvailable: true,
      runUtilityScore,
      contributors,
      confidence: clamp01(
        0.55 * availRatio + 0.45 * clamp01(run.wclCoverageRatio ?? input.selectedRunWclCoverage),
      ),
      missingContributors,
      catalogCoverage: input.capability.catalogCoverage,
    };
  });

  const scored = runScores.filter((r) => r.runUtilityScore != null);
  const utilityScore = meanOfValid(scored.map((r) => r.runUtilityScore));

  const contributorCoverage =
    weights.length === 0
      ? 0
      : meanOfValid(
          scored.map((r) => {
            const avail = r.contributors.filter((c) => c.available).length;
            return avail / weights.length;
          }),
        ) ?? 0;

  const confidence = computeUtilityConfidence({
    dungeonCount: scored.length,
    expectedDungeonCount: input.expectedDungeonCount,
    detailAvailableCount: detailedRuns.length,
    selectedRunWclCoverage: input.selectedRunWclCoverage,
    hasResolvedSpecAndRole: input.hasResolvedSpecAndRole,
    logFreshness: input.logFreshness ?? (detailedRuns.length > 0 ? 0.75 : 0),
    contributorCoverage,
  });

  const meanContributor = (
    key: UtilityContributorScore["key"],
  ): number | null =>
    meanOfValid(
      scored.flatMap((r) => {
        const c = r.contributors.find((x) => x.key === key);
        return c?.available && c.score != null ? [c.score] : [];
      }),
    );

  const summary: UtilitySummaryDTO = {
    score: utilityScore,
    confidence,
    dungeonCount: scored.length,
    expectedDungeonCount: input.expectedDungeonCount,
    formulaVersion: UTILITY_V3_FORMULA_VERSION,
    weights: {
      interrupts: UTILITY_INTERRUPT_WEIGHT,
      crowdControl: UTILITY_CROWD_CONTROL_WEIGHT,
      groupSupport: UTILITY_GROUP_SUPPORT_WEIGHT,
      dispels: UTILITY_DISPELS_WEIGHT,
    },
    appliedWeights: weights,
    droppedContributors,
    runs: runScores,
    latestObservedAt: input.observedAt ?? null,
  };

  return {
    summary,
    utilityScore,
    confidence,
    observations: {
      interrupts: meanContributor("interrupts"),
      crowdControl: meanContributor("crowd_control"),
      groupSupport: meanContributor("group_support"),
      dispels: meanContributor("dispels"),
    },
  };
}

/** Build explanation lines for a scored run (public-safe, no report codes). */
export function explainUtilityRun(run: UtilityRunScore): string[] {
  const lines: string[] = [];
  if (!run.detailAvailable) {
    lines.push(`${run.dungeonSlug}: combat detail unavailable — contributor omitted (not zero).`);
    return lines;
  }
  if (run.runUtilityScore == null) {
    lines.push(`${run.dungeonSlug}: no utility contributors available.`);
    return lines;
  }
  lines.push(
    `${run.dungeonSlug} (+${run.keyLevel}): utility ${run.runUtilityScore.toFixed(1)} (conf ${(run.confidence * 100).toFixed(0)}%).`,
  );
  for (const c of run.contributors) {
    if (!c.available || c.score == null) {
      lines.push(`  ${c.key}: unavailable`);
      continue;
    }
    const bits = Object.entries(c.evidence)
      .filter(([, v]) => typeof v === "number" || typeof v === "string")
      .slice(0, 4)
      .map(([k, v]) => `${k}=${typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed?.(2) ?? v) : v}`)
      .join(", ");
    lines.push(`  ${c.key}: ${c.score.toFixed(1)} (w=${c.weight.toFixed(2)}; ${bits})`);
  }
  if (run.catalogCoverage) {
    lines.push(
      `  catalog: kicks=[${run.catalogCoverage.interruptSpellIds.join(",")}] cc=[${run.catalogCoverage.crowdControlSpellIds.join(",")}] support=[${run.catalogCoverage.groupSupportSpellIds.join(",")}] dispels=[${[...run.catalogCoverage.defensiveDispelSpellIds, ...run.catalogCoverage.offensiveDispelSpellIds].join(",")}]`,
    );
  }
  return lines;
}
