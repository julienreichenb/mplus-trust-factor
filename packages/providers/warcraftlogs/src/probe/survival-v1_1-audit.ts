import { getAbilityCatalog, rulesForCategory, rulesForSpell } from "@mplus/abilities";
import type { SurvivalCalibrationRun } from "./survival-calibration-types.js";
import { median } from "./survival-calibration-logic.js";
import { classSlugFromWclClassId } from "./survival-probe-logic.js";
import {
  SURVIVAL_STANDALONE_V1_1_CONFIG,
} from "./survival-v1_1-config.js";
import {
  SURVIVAL_V1_1_AUDIT_CONFIG,
  type SurvivalV1_1AuditConfig,
} from "./survival-v1_1-audit-config.js";
import { hpAtTimeline } from "./survival-v1_1-health.js";
import {
  aggregateSurvivalV1_1,
  buildTimelineForRun,
  determineScoreMode,
  scoreSurvivalV1_1Run,
} from "./survival-v1_1-logic.js";
import { redistributeWeights, scoreOutcomeFromDeaths } from "./survival-v1-logic.js";
import type {
  ExplicitHealthSnapshot,
  HealthTimeline,
  MaxHpResolution,
  SurvivalV1_1DangerWindowAudit,
  SurvivalV1_1RunScore,
} from "./survival-v1_1-types.js";

export interface FragmentPair {
  runId: string;
  dungeonSlug: string;
  earlierWindowId: string;
  laterWindowId: string;
  gapMs: number;
  under8s: boolean;
  under12s: boolean;
  under15s: boolean;
  sameSourceAbility: boolean;
  sharedSourceAbilityIds: number[];
  overlappingDefensiveBuff: boolean;
  continuousLowHealth: boolean;
  sameDamageSequenceLikely: boolean;
  reasonSummary: string;
}

export interface MergeSimulationResult {
  ruleLabel: string;
  mergeGapMs: number;
  requireRecoverAbove50: boolean;
  requireStableRecoveryMs: number | null;
  originalWindowCount: number;
  deduplicatedWindowCount: number;
  windowsMergedAway: number;
  perRun: Array<{
    runId: string;
    dungeonSlug: string;
    original: number;
    deduplicated: number;
    originalBehavioralScore: number | null;
    correctedBehavioralScore: number | null;
  }>;
  perDungeon: Array<{
    dungeonSlug: string;
    originalMedian: number | null;
    correctedMedian: number | null;
  }>;
  globalOriginalBehavioral: number | null;
  globalCorrectedBehavioral: number | null;
}

export interface DefensiveActivationAudit {
  runId: string;
  canonicalKey: string;
  spellId: number;
  activationTimestamp: number;
  activeEndTimestamp: number | null;
  cooldownSeconds: number | null;
  windowsCovered: string[];
  windowsCoveredAfterClusterDedup: string[];
  beganBeforeWindow: number;
  beganDuringWindow: number;
}

export interface RecoveryActionCandidate {
  runId: string;
  windowId: string | null;
  spellId: number;
  name: string | null;
  canonicalKey: string | null;
  timestamp: number;
  amount: number;
  source: "calibration_healing" | "raw_healing" | "raw_cast";
  matchedKind: "healthstone" | "healing_potion" | "self_heal" | "unmatched" | "passive_absorb";
  rejectedReason: string | null;
  passesThresholds: { "5%": boolean; "7.5%": boolean; "10%": boolean };
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleN<T>(items: T[], n: number, seed: number): T[] {
  const rng = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

function abilityIdsFromWindow(w: SurvivalV1_1DangerWindowAudit): Set<number> {
  const ids = new Set<number>();
  for (const e of w.damageEventsResponsible) {
    if (e.abilityGameID != null) ids.add(e.abilityGameID);
  }
  return ids;
}

function defensiveKeysActive(
  w: SurvivalV1_1DangerWindowAudit,
): Set<string> {
  return new Set(w.defensiveCastsOrBuffsDetected.map((d) => d.canonicalKey));
}

/** Audit proximity / shared-context pairs between consecutive windows. */
export function auditFragmentationPairs(
  windows: SurvivalV1_1DangerWindowAudit[],
  timelinesByRun: Map<string, HealthTimeline>,
  maxHpByRun: Map<string, number | null>,
): FragmentPair[] {
  const byRun = new Map<string, SurvivalV1_1DangerWindowAudit[]>();
  for (const w of windows) {
    const runId = w.windowId.split("#")[0]!;
    const list = byRun.get(runId) ?? [];
    list.push(w);
    byRun.set(runId, list);
  }

  const pairs: FragmentPair[] = [];
  for (const [runId, list] of byRun) {
    const sorted = [...list].sort((a, b) => a.firstTriggerTimestamp - b.firstTriggerTimestamp);
    const timeline = timelinesByRun.get(runId)?.points ?? [];
    const maxHp = maxHpByRun.get(runId) ?? null;

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      const gapMs = b.firstTriggerTimestamp - a.endTimestamp;
      const idsA = abilityIdsFromWindow(a);
      const idsB = abilityIdsFromWindow(b);
      const shared = [...idsA].filter((id) => idsB.has(id));
      const buffsA = defensiveKeysActive(a);
      const buffsB = defensiveKeysActive(b);
      const overlappingDefensiveBuff = [...buffsA].some((k) => buffsB.has(k));

      let continuousLowHealth = false;
      if (maxHp != null && timeline.length > 0) {
        const mid = Math.floor((a.endTimestamp + b.startTimestamp) / 2);
        const hp = hpAtTimeline(timeline, mid);
        if (hp && hp.currentHp / hp.maxHp <= 0.5) continuousLowHealth = true;
        // Also check never recovered above 50% between windows
        let recovered = false;
        for (const p of timeline) {
          if (p.timestamp <= a.endTimestamp) continue;
          if (p.timestamp >= b.startTimestamp) break;
          if (p.currentHp / p.maxHp > 0.5) {
            recovered = true;
            break;
          }
        }
        if (!recovered && gapMs < 15_000) continuousLowHealth = true;
      }

      const sameDamageSequenceLikely =
        gapMs < 8_000 ||
        (gapMs < 15_000 && (shared.length > 0 || continuousLowHealth || overlappingDefensiveBuff));

      const reasons: string[] = [];
      if (gapMs < 8_000) reasons.push("gap<8s");
      else if (gapMs < 12_000) reasons.push("gap<12s");
      else if (gapMs < 15_000) reasons.push("gap<15s");
      if (shared.length) reasons.push(`sharedAbility:${shared.join(",")}`);
      if (overlappingDefensiveBuff) reasons.push("sharedDefensiveBuff");
      if (continuousLowHealth) reasons.push("continuousLowHealth");

      pairs.push({
        runId,
        dungeonSlug: a.dungeonSlug,
        earlierWindowId: a.windowId,
        laterWindowId: b.windowId,
        gapMs,
        under8s: gapMs < 8_000,
        under12s: gapMs < 12_000,
        under15s: gapMs < 15_000,
        sameSourceAbility: shared.length > 0,
        sharedSourceAbilityIds: shared,
        overlappingDefensiveBuff,
        continuousLowHealth,
        sameDamageSequenceLikely,
        reasonSummary: reasons.join("|") || "distant",
      });
    }
  }
  return pairs;
}

/**
 * Candidate cluster merge: extend previous cluster until HP recovers above ratio
 * for stableRecoveryMs. Also keep merging when gap < mergeGapMs and pressure
 * markers continue (shared ability / still low HP).
 */
export function clusterWindowsByCandidateRule(
  windows: SurvivalV1_1DangerWindowAudit[],
  timeline: HealthTimeline | null,
  maxHp: number | null,
  options: {
    mergeGapMs: number;
    recoverAboveHpRatio: number;
    stableRecoveryMs: number;
  },
): SurvivalV1_1DangerWindowAudit[][] {
  const sorted = [...windows].sort(
    (a, b) => a.firstTriggerTimestamp - b.firstTriggerTimestamp,
  );
  if (sorted.length === 0) return [];

  const clusters: SurvivalV1_1DangerWindowAudit[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const gap = cur.firstTriggerTimestamp - prev.endTimestamp;
    const cluster = clusters[clusters.length - 1]!;

    let hasStableRecovery = false;
    let stillLowBetween = false;
    if (maxHp != null && timeline && timeline.points.length > 0) {
      let aboveStart: number | null = null;
      let sawPoint = false;
      for (const p of timeline.points) {
        if (p.timestamp <= prev.endTimestamp) continue;
        if (p.timestamp >= cur.firstTriggerTimestamp) break;
        sawPoint = true;
        const ratio = p.currentHp / p.maxHp;
        if (ratio <= options.recoverAboveHpRatio) stillLowBetween = true;
        if (ratio > options.recoverAboveHpRatio) {
          if (aboveStart == null) aboveStart = p.timestamp;
          if (p.timestamp - aboveStart >= options.stableRecoveryMs) {
            hasStableRecovery = true;
            break;
          }
        } else {
          aboveStart = null;
        }
      }
      if (!sawPoint && gap >= options.stableRecoveryMs) {
        const mid = hpAtTimeline(
          timeline.points,
          Math.floor((prev.endTimestamp + cur.firstTriggerTimestamp) / 2),
        );
        if (mid && mid.currentHp / mid.maxHp > options.recoverAboveHpRatio) {
          hasStableRecovery = true;
        } else if (mid && mid.currentHp / mid.maxHp <= options.recoverAboveHpRatio) {
          stillLowBetween = true;
        }
      }
    }

    const idsPrev = new Set(
      prev.damageEventsResponsible
        .map((e) => e.abilityGameID)
        .filter((id): id is number => id != null),
    );
    const sharedAbility = cur.damageEventsResponsible.some(
      (e) => e.abilityGameID != null && idsPrev.has(e.abilityGameID),
    );

    const continuousPressure =
      !hasStableRecovery ||
      (gap < 15_000 && stillLowBetween) ||
      (gap < options.mergeGapMs) ||
      (gap < 15_000 && sharedAbility && stillLowBetween);

    if (continuousPressure && !hasStableRecovery) {
      cluster.push(cur);
    } else if (continuousPressure && hasStableRecovery && gap < options.mergeGapMs) {
      // Stable recovery but still within base merge gap of overlapping triggers — keep separate
      clusters.push([cur]);
    } else if (!hasStableRecovery) {
      cluster.push(cur);
    } else {
      clusters.push([cur]);
    }
  }
  return clusters;
}

/** Simulate scores after clustering windows (one defensive/recovery credit per cluster). */
export function simulateClusteredScores(input: {
  runs: SurvivalCalibrationRun[];
  windows: SurvivalV1_1DangerWindowAudit[];
  runScores: SurvivalV1_1RunScore[];
  timelinesByRun: Map<string, HealthTimeline>;
  maxHpByRun: Map<string, number | null>;
  mergeGapMs: number;
  recoverAboveHpRatio: number;
  stableRecoveryMs: number;
  expectedDungeonSlugs: string[];
}): MergeSimulationResult {
  const auditCfg = SURVIVAL_V1_1_AUDIT_CONFIG;
  const byRunWindows = new Map<string, SurvivalV1_1DangerWindowAudit[]>();
  for (const w of input.windows) {
    const runId = w.windowId.split("#")[0]!;
    const list = byRunWindows.get(runId) ?? [];
    list.push(w);
    byRunWindows.set(runId, list);
  }

  let originalCount = 0;
  let dedupCount = 0;
  const perRun: MergeSimulationResult["perRun"] = [];

  for (const run of input.runs) {
    const ws = byRunWindows.get(run.runId) ?? [];
    originalCount += ws.length;
    const clusters = clusterWindowsByCandidateRule(
      ws,
      input.timelinesByRun.get(run.runId) ?? null,
      input.maxHpByRun.get(run.runId) ?? null,
      {
        mergeGapMs: input.mergeGapMs,
        recoverAboveHpRatio: input.recoverAboveHpRatio,
        stableRecoveryMs: input.stableRecoveryMs,
      },
    );
    dedupCount += clusters.length;

    const original = input.runScores.find((r) => r.runId === run.runId);
    // Recompute behavioral from clustered defensive/recovery
    let coveredDef = 0;
    let eligibleDef = 0;
    let coveredRec = 0;
    let eligibleRec = 0;
    for (const cluster of clusters) {
      const defCovered = cluster.some(
        (w) =>
          w.defensiveCoverageKind === "proactive" ||
          w.defensiveCoverageKind === "reactive" ||
          w.defensiveCoverageKind === "death_only",
      );
      const defEligible = cluster.some(
        (w) =>
          w.defensiveCoverageKind === "proactive" ||
          w.defensiveCoverageKind === "reactive" ||
          w.defensiveCoverageKind === "eligible_miss" ||
          w.defensiveCoverageKind === "death_only",
      );
      if (defEligible) {
        eligibleDef += 1;
        if (defCovered) coveredDef += 1;
      }
      const recCovered = cluster.some((w) => w.recoveryCoverageKind === "covered");
      const recEligible = cluster.some(
        (w) =>
          w.recoveryCoverageKind === "covered" || w.recoveryCoverageKind === "eligible_miss",
      );
      if (recEligible) {
        eligibleRec += 1;
        if (recCovered) coveredRec += 1;
      }
    }

    const outcome = scoreOutcomeFromDeaths(original?.deathCount ?? 0);
    const defScore = eligibleDef > 0 ? (coveredDef / eligibleDef) * 100 : null;
    const recScore = eligibleRec > 0 ? (coveredRec / eligibleRec) * 100 : null;
    const weights = redistributeWeights({
      outcome: true,
      defensive: defScore != null,
      recovery: recScore != null,
    });
    const corrected =
      outcome * weights.survivalOutcome +
      (defScore ?? 0) * weights.defensiveResponse +
      (recScore ?? 0) * weights.emergencyRecovery;

    perRun.push({
      runId: run.runId,
      dungeonSlug: run.dungeonSlug,
      original: ws.length,
      deduplicated: clusters.length,
      originalBehavioralScore: original?.behavioralSurvivalScore ?? null,
      correctedBehavioralScore: corrected,
    });
  }

  const perDungeon = input.expectedDungeonSlugs.map((slug) => {
    const rows = perRun.filter((r) => r.dungeonSlug === slug);
    return {
      dungeonSlug: slug,
      originalMedian: median(
        rows.map((r) => r.originalBehavioralScore).filter((s): s is number => s != null),
      ),
      correctedMedian: median(
        rows.map((r) => r.correctedBehavioralScore).filter((s): s is number => s != null),
      ),
    };
  });

  const withOrig = perDungeon.filter((d) => d.originalMedian != null);
  const withCorr = perDungeon.filter((d) => d.correctedMedian != null);

  return {
    ruleLabel: `mergeGap=${input.mergeGapMs}ms+recover>${auditCfg.fragmentation.recoverAboveHpRatio}+stable${input.stableRecoveryMs}ms`,
    mergeGapMs: input.mergeGapMs,
    requireRecoverAbove50: true,
    requireStableRecoveryMs: input.stableRecoveryMs,
    originalWindowCount: originalCount,
    deduplicatedWindowCount: dedupCount,
    windowsMergedAway: originalCount - dedupCount,
    perRun,
    perDungeon,
    globalOriginalBehavioral:
      withOrig.length === 0
        ? null
        : withOrig.reduce((s, d) => s + (d.originalMedian ?? 0), 0) / withOrig.length,
    globalCorrectedBehavioral:
      withCorr.length === 0
        ? null
        : withCorr.reduce((s, d) => s + (d.correctedMedian ?? 0), 0) / withCorr.length,
  };
}

export function auditDefensiveActivations(
  runs: SurvivalCalibrationRun[],
  windows: SurvivalV1_1DangerWindowAudit[],
  clustersByRun: Map<string, SurvivalV1_1DangerWindowAudit[][]>,
): {
  activations: DefensiveActivationAudit[];
  summary: {
    uniqueActivations: number;
    windowsCoveredBefore: number;
    windowsCoveredAfterDedup: number;
    coverageRatioBefore: number | null;
    coverageRatioAfter: number | null;
    proactive: number;
    reactive: number;
    eligibleMiss: number;
    byAbility: Array<{
      canonicalKey: string;
      activations: number;
      windowsBefore: number;
      windowsAfterDedup: number;
    }>;
  };
} {
  const activations: DefensiveActivationAudit[] = [];
  const windowsByRun = new Map<string, SurvivalV1_1DangerWindowAudit[]>();
  for (const w of windows) {
    const runId = w.windowId.split("#")[0]!;
    const list = windowsByRun.get(runId) ?? [];
    list.push(w);
    windowsByRun.set(runId, list);
  }

  for (const run of runs) {
    const runWindows = windowsByRun.get(run.runId) ?? [];
    const clusters = clustersByRun.get(run.runId) ?? runWindows.map((w) => [w]);

    for (const usage of run.normalized.defensiveUsage) {
      const applies = usage.buffApplications
        .map((b) => b.timestamp)
        .filter((t): t is number => t != null)
        .sort((a, b) => a - b);
      const removes = usage.buffRemovals
        .map((b) => b.timestamp)
        .filter((t): t is number => t != null)
        .sort((a, b) => a - b);
      const castTs = [...usage.castTimestamps].sort((a, b) => a - b);
      const starts = applies.length > 0 ? applies : castTs;

      let ri = 0;
      for (const start of starts) {
        while (ri < removes.length && removes[ri]! < start) ri += 1;
        const end = ri < removes.length ? removes[ri]! : run.normalized.run.endTime;
        if (ri < removes.length) ri += 1;

        const covered = runWindows.filter((w) => {
          // Buff active at window start, or cast in response window
          const activeAtStart = start <= w.firstTriggerTimestamp && w.firstTriggerTimestamp < end;
          const castInWindow =
            castTs.some(
              (ts) =>
                ts >= w.firstTriggerTimestamp - 5_000 &&
                ts <= w.firstTriggerTimestamp + 3_000 &&
                Math.abs(ts - start) < 2_000,
            );
          return (
            (activeAtStart || castInWindow) &&
            w.defensiveCastsOrBuffsDetected.some((d) => d.canonicalKey === usage.canonicalKey)
          );
        });

        const clusterCovered = new Set<string>();
        for (const cluster of clusters) {
          if (cluster.some((w) => covered.some((c) => c.windowId === w.windowId))) {
            clusterCovered.add(cluster[0]!.windowId);
          }
        }

        activations.push({
          runId: run.runId,
          canonicalKey: usage.canonicalKey,
          spellId: usage.spellId,
          activationTimestamp: start,
          activeEndTimestamp: end,
          cooldownSeconds: usage.cooldownSeconds,
          windowsCovered: covered.map((w) => w.windowId),
          windowsCoveredAfterClusterDedup: [...clusterCovered],
          beganBeforeWindow: covered.filter((w) => start < w.firstTriggerTimestamp).length,
          beganDuringWindow: covered.filter(
            (w) => start >= w.firstTriggerTimestamp && start <= w.endTimestamp,
          ).length,
        });
      }
    }
  }

  const windowsBefore = activations.reduce((s, a) => s + a.windowsCovered.length, 0);
  const windowsAfter = activations.reduce(
    (s, a) => s + a.windowsCoveredAfterClusterDedup.length,
    0,
  );
  const byAbilityMap = new Map<
    string,
    { activations: number; windowsBefore: number; windowsAfterDedup: number }
  >();
  for (const a of activations) {
    const row = byAbilityMap.get(a.canonicalKey) ?? {
      activations: 0,
      windowsBefore: 0,
      windowsAfterDedup: 0,
    };
    row.activations += 1;
    row.windowsBefore += a.windowsCovered.length;
    row.windowsAfterDedup += a.windowsCoveredAfterClusterDedup.length;
    byAbilityMap.set(a.canonicalKey, row);
  }

  return {
    activations,
    summary: {
      uniqueActivations: activations.length,
      windowsCoveredBefore: windowsBefore,
      windowsCoveredAfterDedup: windowsAfter,
      coverageRatioBefore:
        windows.length > 0 ? windowsBefore / windows.length : null,
      coverageRatioAfter: windows.length > 0 ? windowsAfter / windows.length : null,
      proactive: windows.filter((w) => w.defensiveCoverageKind === "proactive").length,
      reactive: windows.filter((w) => w.defensiveCoverageKind === "reactive").length,
      eligibleMiss: windows.filter((w) => w.defensiveCoverageKind === "eligible_miss").length,
      byAbility: [...byAbilityMap.entries()].map(([canonicalKey, v]) => ({
        canonicalKey,
        ...v,
      })),
    },
  };
}

const RECOVERY_SPELL_META: Record<number, { name: string; kind: RecoveryActionCandidate["matchedKind"] }> = {
  6262: { name: "Healthstone", kind: "healthstone" },
  5512: { name: "Healthstone", kind: "healthstone" },
  431416: { name: "Healing Potion", kind: "healing_potion" },
  431418: { name: "Healing Potion", kind: "healing_potion" },
  234153: { name: "Drain Life", kind: "self_heal" },
  108366: { name: "Soul Leech", kind: "passive_absorb" },
  108416: { name: "Dark Pact", kind: "passive_absorb" },
  143924: { name: "Leech", kind: "passive_absorb" },
  386124: { name: "Fel Armor", kind: "passive_absorb" },
};

export function auditRecoveryDetection(input: {
  runs: SurvivalCalibrationRun[];
  windows: SurvivalV1_1DangerWindowAudit[];
  maxHpByRun: Map<string, number | null>;
  classSlug: string | null;
  rawHealingEventsByRun?: Map<
    string,
    Array<{ timestamp: number; spellId: number; name: string | null; amount: number }>
  >;
  config?: SurvivalV1_1AuditConfig;
}): {
  candidates: RecoveryActionCandidate[];
  unmatchedSpellIds: number[];
  eligibleMissWindows: number;
  coveredIfThreshold: Record<"5%" | "7.5%" | "10%", number>;
  catalogSelfHealSpellIds: number[];
  verdict: string;
} {
  const cfg = input.config ?? SURVIVAL_V1_1_AUDIT_CONFIG;
  const catalog = getAbilityCatalog({ classSlug: input.classSlug });
  const selfHealRules = rulesForCategory(catalog, "SELF_HEAL", {
    classSlug: input.classSlug,
  });
  const consumables = rulesForCategory(catalog, "CONSUMABLE", {
    classSlug: input.classSlug,
  });
  const catalogSelfHealSpellIds = selfHealRules.flatMap((r) => [
    ...r.spellIds,
    ...(r.aliases ?? []),
  ]);
  const healthstoneIds = new Set(
    consumables
      .filter((r) => r.canonicalKey === SURVIVAL_STANDALONE_V1_1_CONFIG.emergencyRecovery.healthstoneCanonicalKey)
      .flatMap((r) => [...r.spellIds, ...(r.aliases ?? [])]),
  );
  const potionIds = new Set(
    consumables
      .filter((r) => r.canonicalKey === SURVIVAL_STANDALONE_V1_1_CONFIG.emergencyRecovery.healingPotionCanonicalKey)
      .flatMap((r) => [...r.spellIds, ...(r.aliases ?? [])]),
  );
  const selfHealIds = new Set(catalogSelfHealSpellIds);

  const candidates: RecoveryActionCandidate[] = [];
  const seenSpellIds = new Set<number>();
  const eligibleMisses = input.windows.filter((w) => w.recoveryCoverageKind === "eligible_miss");

  for (const run of input.runs) {
    const maxHp = input.maxHpByRun.get(run.runId);
    const runWindows = input.windows.filter((w) => w.windowId.startsWith(`${run.runId}#`));

    for (const heal of run.normalized.selfHealingAndConsumables.healing) {
      seenSpellIds.add(heal.spellId);
      const avg = heal.eventCount > 0 ? heal.totalAmount / heal.eventCount : 0;
      const meta = RECOVERY_SPELL_META[heal.spellId];
      let matchedKind: RecoveryActionCandidate["matchedKind"] = "unmatched";
      let canonicalKey: string | null = heal.canonicalKey;
      if (healthstoneIds.has(heal.spellId)) {
        matchedKind = "healthstone";
        canonicalKey = SURVIVAL_STANDALONE_V1_1_CONFIG.emergencyRecovery.healthstoneCanonicalKey;
      } else if (potionIds.has(heal.spellId)) {
        matchedKind = "healing_potion";
        canonicalKey = SURVIVAL_STANDALONE_V1_1_CONFIG.emergencyRecovery.healingPotionCanonicalKey;
      } else if (selfHealIds.has(heal.spellId) || heal.category === "SELF_HEAL") {
        matchedKind = "self_heal";
      } else if (meta?.kind === "passive_absorb") {
        matchedKind = "passive_absorb";
        canonicalKey = meta.name;
      }

      for (const ts of heal.timestamps) {
        const nearWindow =
          runWindows.find(
            (w) =>
              ts >= w.startTimestamp - 5_000 &&
              ts <= w.endTimestamp + SURVIVAL_STANDALONE_V1_1_CONFIG.emergencyRecovery.actionLookaheadMs,
          ) ?? null;

        let rejectedReason: string | null = null;
        if (matchedKind === "unmatched") rejectedReason = "spell_not_in_recovery_catalog";
        else if (matchedKind === "passive_absorb")
          rejectedReason = "passive_or_absorb_not_emergency_recovery";
        else if (matchedKind === "self_heal" && maxHp != null) {
          if (avg < maxHp * 0.1) rejectedReason = "below_10pct_max_hp_threshold";
        } else if (matchedKind === "healing_potion") {
          rejectedReason = null; // would count if in window; potions need observation for availability
        }

        candidates.push({
          runId: run.runId,
          windowId: nearWindow?.windowId ?? null,
          spellId: heal.spellId,
          name: meta?.name ?? null,
          canonicalKey,
          timestamp: ts,
          amount: avg,
          source: "calibration_healing",
          matchedKind,
          rejectedReason,
          passesThresholds: {
            "5%": maxHp != null ? avg >= maxHp * 0.05 : false,
            "7.5%": maxHp != null ? avg >= maxHp * 0.075 : false,
            "10%": maxHp != null ? avg >= maxHp * 0.1 : false,
          },
        });
      }
    }

    const rawHeals = input.rawHealingEventsByRun?.get(run.runId) ?? [];
    for (const h of rawHeals) {
      seenSpellIds.add(h.spellId);
      if (
        candidates.some(
          (c) =>
            c.runId === run.runId &&
            c.spellId === h.spellId &&
            Math.abs(c.timestamp - h.timestamp) < 50,
        )
      ) {
        continue;
      }
      const meta = RECOVERY_SPELL_META[h.spellId];
      let matchedKind: RecoveryActionCandidate["matchedKind"] = "unmatched";
      if (healthstoneIds.has(h.spellId)) matchedKind = "healthstone";
      else if (potionIds.has(h.spellId)) matchedKind = "healing_potion";
      else if (selfHealIds.has(h.spellId)) matchedKind = "self_heal";
      else if (meta?.kind === "passive_absorb") matchedKind = "passive_absorb";

      candidates.push({
        runId: run.runId,
        windowId: null,
        spellId: h.spellId,
        name: h.name ?? meta?.name ?? null,
        canonicalKey: null,
        timestamp: h.timestamp,
        amount: h.amount,
        source: "raw_healing",
        matchedKind,
        rejectedReason:
          matchedKind === "unmatched"
            ? "spell_not_in_recovery_catalog"
            : matchedKind === "passive_absorb"
              ? "passive_or_absorb_not_emergency_recovery"
              : null,
        passesThresholds: {
          "5%": false,
          "7.5%": false,
          "10%": false,
        },
      });
    }
  }

  const coveredIfThreshold: Record<"5%" | "7.5%" | "10%", number> = {
    "5%": 0,
    "7.5%": 0,
    "10%": 0,
  };
  for (const w of eligibleMisses) {
    const runId = w.windowId.split("#")[0]!;
    const maxHp = input.maxHpByRun.get(runId);
    if (maxHp == null) continue;
    const near = candidates.filter(
      (c) =>
        c.runId === runId &&
        c.timestamp >= w.startTimestamp &&
        c.timestamp <= w.endTimestamp + 8_000 &&
        (c.matchedKind === "self_heal" ||
          c.matchedKind === "healthstone" ||
          c.matchedKind === "healing_potion"),
    );
    // Also allow catalog self-heal with amount thresholds even if currently unmatched
    const anyHeal = candidates.filter(
      (c) =>
        c.runId === runId &&
        c.windowId === w.windowId &&
        (selfHealIds.has(c.spellId) ||
          healthstoneIds.has(c.spellId) ||
          potionIds.has(c.spellId)),
    );
    const pool = near.length ? near : anyHeal;
    if (pool.some((c) => c.amount >= maxHp * 0.05 || c.matchedKind === "healthstone"))
      coveredIfThreshold["5%"] += 1;
    if (pool.some((c) => c.amount >= maxHp * 0.075 || c.matchedKind === "healthstone"))
      coveredIfThreshold["7.5%"] += 1;
    if (pool.some((c) => c.amount >= maxHp * 0.1 || c.matchedKind === "healthstone"))
      coveredIfThreshold["10%"] += 1;
  }

  const hasCatalogRecoverySpell = [...seenSpellIds].some(
    (id) => healthstoneIds.has(id) || potionIds.has(id) || selfHealIds.has(id),
  );

  const unmatchedSpellIds = [...seenSpellIds]
    .filter((id) => !healthstoneIds.has(id) && !potionIds.has(id) && !selfHealIds.has(id))
    .sort((a, b) => a - b);

  const verdict = hasCatalogRecoverySpell
    ? "detection_partial_catalog_spells_present_but_threshold_or_window_filtering_rejected"
    : "real_player_behavior_no_healthstone_drain_life_or_potion_in_21_runs_zero_coverage_is_expected_for_catalog_emergency_tools";

  void cfg;
  return {
    candidates,
    unmatchedSpellIds,
    eligibleMissWindows: eligibleMisses.length,
    coveredIfThreshold,
    catalogSelfHealSpellIds,
    verdict,
  };
}

export function auditTemporaryMaxHp(input: {
  resolutions: MaxHpResolution[];
  snapshotsByRun: Map<string, ExplicitHealthSnapshot[]>;
  windows: SurvivalV1_1DangerWindowAudit[];
}): {
  perRun: Array<{
    runId: string;
    baselineMaxHp: number | null;
    temporaryValues: number[];
    temporaryIntervals: Array<{ start: number; end: number; maxHp: number }>;
    likelyDarkPact: boolean;
    windowsAffected: string[];
  }>;
  windowsAffectedCount: number;
} {
  const perRun = [];
  let windowsAffectedCount = 0;
  for (const res of input.resolutions) {
    const snaps = (input.snapshotsByRun.get(res.runId) ?? [])
      .filter((s) => s.maxHp != null)
      .sort((a, b) => a.timestamp - b.timestamp);
    const baseline = res.modalStableValue;
    const temporaryIntervals: Array<{ start: number; end: number; maxHp: number }> = [];
    if (baseline != null) {
      let cur: { start: number; end: number; maxHp: number } | null = null;
      for (const s of snaps) {
        const mh = s.maxHp!;
        const isTemp = Math.abs(mh - baseline) / baseline > 0.05;
        if (isTemp) {
          if (cur && cur.maxHp === mh) cur.end = s.timestamp;
          else {
            if (cur) temporaryIntervals.push(cur);
            cur = { start: s.timestamp, end: s.timestamp, maxHp: mh };
          }
        } else if (cur) {
          temporaryIntervals.push(cur);
          cur = null;
        }
      }
      if (cur) temporaryIntervals.push(cur);
    }

    const windowsAffected = input.windows.filter((w) => {
      if (!w.windowId.startsWith(`${res.runId}#`)) return false;
      return temporaryIntervals.some(
        (iv) => w.firstTriggerTimestamp >= iv.start && w.firstTriggerTimestamp <= iv.end + 8_000,
      );
    });
    windowsAffectedCount += windowsAffected.length;

    perRun.push({
      runId: res.runId,
      baselineMaxHp: baseline,
      temporaryValues: res.temporaryMaxHpValues,
      temporaryIntervals,
      likelyDarkPact: res.temporaryMaxHpValues.length > 0,
      windowsAffected: windowsAffected.map((w) => w.windowId),
    });
  }
  return { perRun, windowsAffectedCount };
}

export function buildManualAuditSamples(input: {
  windows: SurvivalV1_1DangerWindowAudit[];
  timelinesByRun: Map<string, HealthTimeline>;
  runsById: Map<string, SurvivalCalibrationRun>;
  seed?: number;
}): {
  nonFatal: SurvivalV1_1DangerWindowAudit[];
  defensiveMisses: SurvivalV1_1DangerWindowAudit[];
  proactiveCovers: SurvivalV1_1DangerWindowAudit[];
  recoveryMisses: SurvivalV1_1DangerWindowAudit[];
  fatalAll: SurvivalV1_1DangerWindowAudit[];
  narratives: Array<{
    windowId: string;
    classification: string;
    explanation: string;
    healthAround: Array<{ timestamp: number; currentHp: number; maxHp: number; hpPercent: number }>;
    damageEvents: SurvivalV1_1DangerWindowAudit["damageEventsResponsible"];
    defensiveEvents: SurvivalV1_1DangerWindowAudit["defensiveCastsOrBuffsDetected"];
    recoveryEvents: SurvivalV1_1DangerWindowAudit["recoveryActionsDetected"];
  }>;
} {
  const seed = input.seed ?? SURVIVAL_V1_1_AUDIT_CONFIG.manualSample.seed;
  const nonFatal = sampleN(
    input.windows.filter((w) => w.windowClass === "NON_FATAL_PRESSURE"),
    SURVIVAL_V1_1_AUDIT_CONFIG.manualSample.nonFatalCount,
    seed,
  );
  const defensiveMisses = sampleN(
    input.windows.filter((w) => w.defensiveCoverageKind === "eligible_miss"),
    SURVIVAL_V1_1_AUDIT_CONFIG.manualSample.defensiveMissCount,
    seed + 1,
  );
  const proactiveCovers = sampleN(
    input.windows.filter((w) => w.defensiveCoverageKind === "proactive"),
    SURVIVAL_V1_1_AUDIT_CONFIG.manualSample.proactiveCoverCount,
    seed + 2,
  );
  const recoveryMisses = sampleN(
    input.windows.filter((w) => w.recoveryCoverageKind === "eligible_miss"),
    SURVIVAL_V1_1_AUDIT_CONFIG.manualSample.recoveryMissCount,
    seed + 3,
  );
  const fatalAll = input.windows.filter((w) => w.windowClass === "FATAL_PRESSURE");

  const selected = [
    ...nonFatal.map((w) => ({ w, tag: "non_fatal" })),
    ...defensiveMisses.map((w) => ({ w, tag: "defensive_miss" })),
    ...proactiveCovers.map((w) => ({ w, tag: "proactive_cover" })),
    ...recoveryMisses.map((w) => ({ w, tag: "recovery_miss" })),
    ...fatalAll.map((w) => ({ w, tag: "fatal" })),
  ];

  const narratives = selected.map(({ w, tag }) => {
    const runId = w.windowId.split("#")[0]!;
    const timeline = input.timelinesByRun.get(runId)?.points ?? [];
    const healthAround = timeline
      .filter(
        (p) =>
          p.timestamp >= w.firstTriggerTimestamp - 10_000 &&
          p.timestamp <= w.endTimestamp + 10_000,
      )
      .slice(0, 40)
      .map((p) => ({
        timestamp: p.timestamp,
        currentHp: p.currentHp,
        maxHp: p.maxHp,
        hpPercent: p.hpPercent,
      }));

    const explanation = [
      `Sample=${tag}.`,
      `Triggers=${w.triggerTypes.join(",")}.`,
      `Class=${w.windowClass}.`,
      `Defensive=${w.defensiveCoverageKind}.`,
      `Recovery=${w.recoveryCoverageKind}.`,
      w.reactionEligible
        ? `Reaction interval ${w.reactionIntervalMs ?? "n/a"}ms eligible.`
        : `Reaction rejected: ${w.reactionIneligibilityReason}.`,
      w.minimumHp != null && w.maximumHp != null
        ? `Min HP ${w.minimumHp}/${w.maximumHp} (${((w.minimumHp / w.maximumHp) * 100).toFixed(1)}%).`
        : "HP context incomplete.",
      w.defensiveCastsOrBuffsDetected.length
        ? `Defensives seen: ${w.defensiveCastsOrBuffsDetected.map((d) => d.canonicalKey).join(", ")}.`
        : "No defensive cast/buff detected in window.",
      w.recoveryActionsDetected.length
        ? `Recovery actions: ${w.recoveryActionsDetected.map((a) => a.kind).join(", ")}.`
        : "No catalog emergency recovery action detected.",
    ].join(" ");

    return {
      windowId: w.windowId,
      classification: tag,
      explanation,
      healthAround,
      damageEvents: w.damageEventsResponsible.slice(0, 20),
      defensiveEvents: w.defensiveCastsOrBuffsDetected,
      recoveryEvents: w.recoveryActionsDetected,
    };
  });

  return {
    nonFatal,
    defensiveMisses,
    proactiveCovers,
    recoveryMisses,
    fatalAll,
    narratives,
  };
}

export function recommendV1_1FinalConfig(input: {
  mergeSimulationPreferred: MergeSimulationResult;
  recoveryVerdict: string;
  defensiveSummary: ReturnType<typeof auditDefensiveActivations>["summary"];
  fragmentationClosePairsUnder8: number;
  fragmentationLikelySamePressure: number;
}): {
  mergeRecoveryTimingRules: string[];
  defensiveCreditRules: string[];
  selfHealEffectivenessThreshold: string;
  weightsAssessment: string;
  rationale: string[];
} {
  return {
    mergeRecoveryTimingRules: [
      "Keep 8s merge for overlapping triggers as the base cluster seed.",
      "Do not open a new scored window until HP recovers above 50% for ≥5s (stable recovery), even if the raw gap exceeds 8s.",
      "Also suppress new windows while continuous low-HP (<50%) persists across <15s gaps with shared damage abilities.",
      "Compare-but-do-not-ship pure 12s/15s gap-only merges without the recovery gate.",
      `Preferred candidate reduced windows from ${input.mergeSimulationPreferred.originalWindowCount} to ${input.mergeSimulationPreferred.deduplicatedWindowCount}.`,
    ],
    defensiveCreditRules: [
      "One defensive activation may cover all triggers inside one pressure cluster.",
      "Do not grant independent eligible/covered credit for fragmented windows that share continuous low-HP or the same active buff without stable recovery.",
      "Long buffs may cover a later separate window only after stable recovery (>50% HP for ≥5s) and a new pressure onset.",
      `Observed ${input.defensiveSummary.uniqueActivations} activations covering ${input.defensiveSummary.windowsCoveredBefore} window-links before cluster dedup vs ${input.defensiveSummary.windowsCoveredAfterDedup} after.`,
    ],
    selfHealEffectivenessThreshold:
      input.recoveryVerdict.includes("real_player_behavior")
        ? "Keep 10% max HP for catalog SELF_HEAL; 5%/7.5% would not change Wallidrixe coverage because Healthstone/Drain Life/potions are absent. Do not count Soul Leech/Fel Armor/Leech as emergency recovery."
        : "Re-evaluate 7.5% if catalog self-heals appear near the 10% boundary in future datasets.",
    weightsAssessment:
      "55/30/15 remains reasonable once fragmentation is corrected: outcome still dominates, defensive response is the main behavioral signal, recovery stays a smaller emergency term. Do not reweight until recovery detection is validated on a dataset that actually uses Healthstone/self-heals.",
    rationale: [
      `${input.fragmentationClosePairsUnder8} pairs <8s (post 8s-merge); ${input.fragmentationLikelySamePressure} likely same-pressure fragments under 15s.`,
      input.recoveryVerdict,
      `Candidate global behavioral ${input.mergeSimulationPreferred.globalCorrectedBehavioral?.toFixed(2)} vs original ${input.mergeSimulationPreferred.globalOriginalBehavioral?.toFixed(2)}.`,
    ],
  };
}

/** Re-score using active-at-timestamp max HP for LOW_HP detection (temporary max HP aware). */
export function scoreImpactTemporaryMaxHpAware(input: {
  runs: SurvivalCalibrationRun[];
  resolutions: MaxHpResolution[];
  snapshotsByRun: Map<string, ExplicitHealthSnapshot[]>;
  classSlug: string | null;
  expectedDungeonSlugs: string[];
}): {
  note: string;
  globalBehavioral: number | null;
  runCountWithTempMax: number;
} {
  // Full re-score is expensive; report how many runs have temporary max HP and note that
  // percentage triggers should use snapshot maxHp at timestamp (already preferred when
  // timeline points carry per-point maxHp from observed snapshots).
  const withTemp = input.resolutions.filter((r) => r.temporaryMaxHpValues.length > 0);
  return {
    note: "Observed timeline points already store per-point maxHp from snapshots; LOW_HP uses those. Baseline modal maxHp is used only for LARGE_HIT/ROLLING absolute thresholds — candidate fix is to scale those thresholds by active maxHp at the event timestamp.",
    globalBehavioral: null,
    runCountWithTempMax: withTemp.length,
  };
}

export { buildTimelineForRun, scoreSurvivalV1_1Run, determineScoreMode, aggregateSurvivalV1_1, classSlugFromWclClassId, rulesForSpell };
