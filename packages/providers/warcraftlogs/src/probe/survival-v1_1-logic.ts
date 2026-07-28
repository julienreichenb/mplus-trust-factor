import type { AbilityCatalog, AbilityRule } from "@mplus/abilities";
import { rulesForCategory } from "@mplus/abilities";
import { median } from "./survival-calibration-logic.js";
import type { SurvivalCalibrationRun } from "./survival-calibration-types.js";
import {
  filterInFightPlayerDeaths,
  redistributeWeights,
  scoreOutcomeFromDeaths,
} from "./survival-v1-logic.js";
import {
  SURVIVAL_STANDALONE_V1_1_CONFIG,
  type SurvivalStandaloneV1_1Config,
} from "./survival-v1_1-config.js";
import {
  buildHealthTimeline,
  hpAtTimeline,
  type TimelineBuildInput,
} from "./survival-v1_1-health.js";
import type {
  HealthTimeline,
  MaxHpResolution,
  SurvivalV1_1DangerWindowAudit,
  SurvivalV1_1DefensiveCoverageKind,
  SurvivalV1_1DungeonScore,
  SurvivalV1_1GlobalScore,
  SurvivalV1_1ReactionOpportunity,
  SurvivalV1_1RecoveryCoverageKind,
  SurvivalV1_1RunScore,
  SurvivalV1_1ScoreMode,
  SurvivalV1_1WindowClass,
} from "./survival-v1_1-types.js";

interface TriggerPoint {
  timestamp: number;
  type: "LOW_HP" | "ROLLING_DAMAGE" | "LARGE_HIT" | "PLAYER_DEATH";
  hpBefore: number | null;
  hpAfter: number | null;
  damageEvents: SurvivalV1_1DangerWindowAudit["damageEventsResponsible"];
  fromExplicitHealth: boolean;
}

interface MergedWindow {
  startTimestamp: number;
  endTimestamp: number;
  firstTriggerTimestamp: number;
  triggers: TriggerPoint[];
}

function emptyDefensiveCounts(): Record<SurvivalV1_1DefensiveCoverageKind, number> {
  return {
    proactive: 0,
    reactive: 0,
    death_only: 0,
    eligible_miss: 0,
    unavailable: 0,
    insufficient_reaction_time: 0,
    not_applicable: 0,
  };
}

function emptyRecoveryCounts(): Record<SurvivalV1_1RecoveryCoverageKind, number> {
  return {
    covered: 0,
    eligible_miss: 0,
    insufficient_reaction_time: 0,
    death_only_health_context_unavailable: 0,
    not_applicable: 0,
  };
}

function isUncertainRule(rule: AbilityRule): boolean {
  return (
    rule.supportCertainty === "uncertain" || rule.provenance.certainty === "uncertain"
  );
}

function talentConfirmed(
  rule: AbilityRule,
  run: SurvivalCalibrationRun,
  observedSpellIds: Set<number>,
): boolean {
  if (rule.availability !== "TALENT" && rule.availability !== "CHOICE_NODE") return true;
  for (const id of rule.spellIds) if (observedSpellIds.has(id)) return true;
  for (const id of rule.aliases ?? []) if (observedSpellIds.has(id)) return true;
  const tree = run.normalized.combatantInfo.raw?.talentTree;
  if (Array.isArray(tree) && rule.talentRequirements?.length) {
    const ids = new Set(
      tree
        .map((t) => (t && typeof t === "object" ? (t as { id?: unknown }).id : null))
        .filter((id): id is number => typeof id === "number"),
    );
    return rule.talentRequirements.every((req) => ids.has(req));
  }
  return false;
}

function collectObservedSpellIds(run: SurvivalCalibrationRun): Set<number> {
  const ids = new Set<number>();
  for (const d of run.defensives) ids.add(d.spellId);
  for (const c of run.consumablesAndSelfHealing.matchedCasts) ids.add(c.spellId);
  for (const h of run.consumablesAndSelfHealing.healingBySpell) ids.add(h.spellId);
  for (const d of run.normalized.defensiveUsage) ids.add(d.spellId);
  return ids;
}

interface AbilityUseEvent {
  canonicalKey: string;
  spellId: number;
  kind: "cast" | "buff_active" | "buff_apply";
  timestamp: number;
  cooldownSeconds: number | null;
}

function collectDefensiveUses(
  run: SurvivalCalibrationRun,
  config: SurvivalStandaloneV1_1Config,
): AbilityUseEvent[] {
  const uses: AbilityUseEvent[] = [];
  const categories = config.defensiveResponse.applicableCategories;
  for (const usage of run.normalized.defensiveUsage) {
    if (!(categories as readonly string[]).includes(usage.category)) continue;
    for (const ts of usage.castTimestamps) {
      uses.push({
        canonicalKey: usage.canonicalKey,
        spellId: usage.spellId,
        kind: "cast",
        timestamp: ts,
        cooldownSeconds: usage.cooldownSeconds,
      });
    }
    for (const buff of usage.buffApplications) {
      if (buff.timestamp == null) continue;
      uses.push({
        canonicalKey: usage.canonicalKey,
        spellId: usage.spellId,
        kind: "buff_apply",
        timestamp: buff.timestamp,
        cooldownSeconds: usage.cooldownSeconds,
      });
    }
  }
  return uses;
}

function buildBuffIntervals(
  run: SurvivalCalibrationRun,
): Map<string, Array<{ start: number; end: number }>> {
  const map = new Map<string, Array<{ start: number; end: number }>>();
  for (const usage of run.normalized.defensiveUsage) {
    const applies = usage.buffApplications
      .map((b) => b.timestamp)
      .filter((t): t is number => t != null)
      .sort((a, b) => a - b);
    const removes = usage.buffRemovals
      .map((b) => b.timestamp)
      .filter((t): t is number => t != null)
      .sort((a, b) => a - b);
    let ri = 0;
    const intervals: Array<{ start: number; end: number }> = [];
    for (const start of applies) {
      while (ri < removes.length && removes[ri]! < start) ri += 1;
      const end = ri < removes.length ? removes[ri]! : run.normalized.run.endTime;
      if (ri < removes.length) ri += 1;
      intervals.push({ start, end });
    }
    map.set(usage.canonicalKey, intervals);
  }
  return map;
}

function isBuffActiveAt(
  intervals: Map<string, Array<{ start: number; end: number }>>,
  canonicalKey: string,
  timestamp: number,
): boolean {
  return (intervals.get(canonicalKey) ?? []).some(
    (i) => i.start <= timestamp && timestamp < i.end,
  );
}

function lastCastBefore(
  uses: AbilityUseEvent[],
  canonicalKey: string,
  timestamp: number,
): number | null {
  let last: number | null = null;
  for (const u of uses) {
    if (u.canonicalKey !== canonicalKey) continue;
    if (u.kind !== "cast" && u.kind !== "buff_apply") continue;
    if (u.timestamp <= timestamp) last = u.timestamp;
  }
  return last;
}

function mergeDangerWindows(triggers: TriggerPoint[], mergeGapMs: number): MergedWindow[] {
  if (triggers.length === 0) return [];
  const sorted = [...triggers].sort((a, b) => a.timestamp - b.timestamp);
  const windows: MergedWindow[] = [];
  let current: MergedWindow = {
    startTimestamp: sorted[0]!.timestamp,
    endTimestamp: sorted[0]!.timestamp,
    firstTriggerTimestamp: sorted[0]!.timestamp,
    triggers: [sorted[0]!],
  };
  for (const t of sorted.slice(1)) {
    if (t.timestamp - current.endTimestamp <= mergeGapMs) {
      current.endTimestamp = t.timestamp;
      current.triggers.push(t);
    } else {
      windows.push(current);
      current = {
        startTimestamp: t.timestamp,
        endTimestamp: t.timestamp,
        firstTriggerTimestamp: t.timestamp,
        triggers: [t],
      };
    }
  }
  windows.push(current);
  return windows;
}

function classifyWindow(window: MergedWindow): SurvivalV1_1WindowClass {
  const hasDeath = window.triggers.some((t) => t.type === "PLAYER_DEATH");
  const hasNonDeath = window.triggers.some((t) => t.type !== "PLAYER_DEATH");
  if (hasDeath && !hasNonDeath) return "DEATH_ONLY_HEALTH_CONTEXT_UNAVAILABLE";
  if (hasDeath) return "FATAL_PRESSURE";
  return "NON_FATAL_PRESSURE";
}

function timeBelowLowHpMs(
  timeline: HealthTimeline,
  window: MergedWindow,
  lowHpRatio: number,
  maxHp: number | null,
): number | null {
  if (maxHp == null || timeline.points.length === 0) return null;
  const threshold = maxHp * lowHpRatio;
  const start = window.startTimestamp;
  const end = window.endTimestamp;
  let total = 0;
  let belowStart: number | null = null;
  for (const p of timeline.points) {
    if (p.timestamp < start) {
      if (p.currentHp <= threshold) belowStart = start;
      continue;
    }
    if (p.timestamp > end) break;
    if (p.currentHp <= threshold) {
      if (belowStart == null) belowStart = p.timestamp;
    } else if (belowStart != null) {
      total += p.timestamp - belowStart;
      belowStart = null;
    }
  }
  if (belowStart != null) total += Math.max(0, end - belowStart);
  return total;
}

export function detectV1_1DangerTriggers(input: {
  run: SurvivalCalibrationRun;
  maxHp: number | null;
  timeline: HealthTimeline | null;
  deaths: ReturnType<typeof filterInFightPlayerDeaths>;
  config?: SurvivalStandaloneV1_1Config;
}): TriggerPoint[] {
  const config = input.config ?? SURVIVAL_STANDALONE_V1_1_CONFIG;
  const triggers: TriggerPoint[] = [];
  const events = [...input.run.normalized.damageTaken.events]
    .filter((e) => e.targetID === input.run.playerActorId && e.timestamp != null)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  const points = input.timeline?.points ?? [];

  if (input.maxHp != null && input.maxHp > 0) {
    const maxHp = input.maxHp;
    for (const event of events) {
      const ts = event.timestamp!;
      const amount = Math.max(0, event.amount ?? 0);
      const at = hpAtTimeline(points, ts);
      const before = hpAtTimeline(points, ts - 1);
      const afterHp = at?.currentHp ?? null;
      const beforeHp = before?.currentHp ?? null;
      const responsible = [
        {
          timestamp: ts,
          abilityGameID: event.abilityGameID ?? null,
          sourceID: event.sourceID ?? null,
          amount,
          absorbed: event.absorbed ?? 0,
        },
      ];
      const fromExplicit = points.some(
        (p) => p.directlyObserved && Math.abs(p.timestamp - ts) <= 1,
      );

      if (amount >= maxHp * config.danger.largeHitRatio) {
        triggers.push({
          timestamp: ts,
          type: "LARGE_HIT",
          hpBefore: beforeHp,
          hpAfter: afterHp,
          damageEvents: responsible,
          fromExplicitHealth: fromExplicit || afterHp != null,
        });
      }
      if (afterHp != null && afterHp <= maxHp * config.danger.lowHpRatio) {
        triggers.push({
          timestamp: ts,
          type: "LOW_HP",
          hpBefore: beforeHp,
          hpAfter: afterHp,
          damageEvents: responsible,
          fromExplicitHealth: true,
        });
      }
    }

    let left = 0;
    let sum = 0;
    for (let right = 0; right < events.length; right += 1) {
      const endTs = events[right]!.timestamp!;
      sum += Math.max(0, events[right]!.amount ?? 0);
      while (left <= right && endTs - events[left]!.timestamp! > config.danger.rollingWindowMs) {
        sum -= Math.max(0, events[left]!.amount ?? 0);
        left += 1;
      }
      if (sum >= maxHp * config.danger.rollingDamageRatio) {
        const windowEvents = events.slice(left, right + 1).map((e) => ({
          timestamp: e.timestamp!,
          abilityGameID: e.abilityGameID ?? null,
          sourceID: e.sourceID ?? null,
          amount: Math.max(0, e.amount ?? 0),
          absorbed: e.absorbed ?? 0,
        }));
        triggers.push({
          timestamp: endTs,
          type: "ROLLING_DAMAGE",
          hpBefore: hpAtTimeline(points, endTs - 1)?.currentHp ?? null,
          hpAfter: hpAtTimeline(points, endTs)?.currentHp ?? null,
          damageEvents: windowEvents,
          fromExplicitHealth: points.some((p) => p.directlyObserved),
        });
      }
    }

    for (const p of points) {
      if (p.currentHp <= maxHp * config.danger.lowHpRatio) {
        const already = triggers.some(
          (t) => t.type === "LOW_HP" && Math.abs(t.timestamp - p.timestamp) <= 50,
        );
        if (!already) {
          triggers.push({
            timestamp: p.timestamp,
            type: "LOW_HP",
            hpBefore: null,
            hpAfter: p.currentHp,
            damageEvents: [],
            fromExplicitHealth: p.directlyObserved,
          });
        }
      }
    }
  }

  for (const death of input.deaths) {
    const ts = death.timestamp!;
    triggers.push({
      timestamp: ts,
      type: "PLAYER_DEATH",
      hpBefore: hpAtTimeline(points, ts - 1)?.currentHp ?? null,
      hpAfter: 0,
      damageEvents: [],
      fromExplicitHealth: false,
    });
  }

  return triggers;
}

export function determineScoreMode(
  runsWithValidMaxHp: number,
  runsWithCompleteTimeline: number,
  runCount: number,
  config: SurvivalStandaloneV1_1Config = SURVIVAL_STANDALONE_V1_1_CONFIG,
): SurvivalV1_1ScoreMode {
  if (runCount <= 0) return "OUTCOME_ONLY";
  const completeShare = runsWithCompleteTimeline / runCount;
  const maxHpShare = runsWithValidMaxHp / runCount;
  if (completeShare >= config.scoreMode.fullBehavioralMinRunShare) return "FULL_BEHAVIORAL";
  if (maxHpShare >= config.scoreMode.partialBehavioralMinRunShare) return "PARTIAL_BEHAVIORAL";
  return "OUTCOME_ONLY";
}

export function scoreSurvivalV1_1Run(input: {
  run: SurvivalCalibrationRun;
  catalog: AbilityCatalog;
  classSlug: string | null;
  maxHpResolution: MaxHpResolution;
  healthTimeline: HealthTimeline | null;
  eventPagesComplete: boolean;
  config?: SurvivalStandaloneV1_1Config;
}): {
  runScore: SurvivalV1_1RunScore;
  dangerWindows: SurvivalV1_1DangerWindowAudit[];
  reactionOpportunities: SurvivalV1_1ReactionOpportunity[];
} {
  const config = input.config ?? SURVIVAL_STANDALONE_V1_1_CONFIG;
  const { run, catalog, classSlug } = input;
  const startTime = run.normalized.run.startTime;
  const endTime = run.normalized.run.endTime;
  const inFightDeaths = filterInFightPlayerDeaths(
    run.deaths.deaths,
    run.playerActorId,
    startTime,
    endTime,
  );
  const deathCount = inFightDeaths.length;
  const maxHp = input.maxHpResolution.maxHp;
  const timeline = input.healthTimeline;

  const triggers = detectV1_1DangerTriggers({
    run,
    maxHp,
    timeline,
    deaths: inFightDeaths,
    config,
  });
  const merged = mergeDangerWindows(triggers, config.danger.mergeGapMs);

  const observedSpellIds = collectObservedSpellIds(run);
  const defensiveUses = collectDefensiveUses(run, config);
  const buffIntervals = buildBuffIntervals(run);
  const applicableRules = [
    ...rulesForCategory(catalog, "DEFENSIVE_MAJOR", { classSlug }),
    ...rulesForCategory(catalog, "DEFENSIVE_MINOR", { classSlug }),
    ...rulesForCategory(catalog, "IMMUNITY", { classSlug }),
  ].filter((r) => !isUncertainRule(r));

  const selfHealRules = rulesForCategory(catalog, "SELF_HEAL", { classSlug }).filter(
    (r) => !isUncertainRule(r),
  );
  const consumableRules = rulesForCategory(catalog, "CONSUMABLE", { classSlug });
  const recoveryResources: Array<{ canonicalKey: string; reason: string }> = [];
  for (const rule of selfHealRules) {
    if (rule.availability === "BASELINE" || talentConfirmed(rule, run, observedSpellIds)) {
      recoveryResources.push({
        canonicalKey: rule.canonicalKey,
        reason: rule.availability === "BASELINE" ? "baseline_self_heal" : "talent_confirmed",
      });
    }
  }
  const healthstone = consumableRules.find(
    (r) => r.canonicalKey === config.emergencyRecovery.healthstoneCanonicalKey,
  );
  if (healthstone) {
    const warlockOk =
      classSlug != null &&
      (config.emergencyRecovery.healthstoneConfirmedClassSlugs as readonly string[]).includes(
        classSlug,
      );
    const observed = healthstone.spellIds.some((id) => observedSpellIds.has(id));
    if (warlockOk || observed) {
      recoveryResources.push({
        canonicalKey: healthstone.canonicalKey,
        reason: warlockOk ? "warlock_healthstone_confirmed" : "observed_healthstone_use",
      });
    }
  }
  const potion = consumableRules.find(
    (r) => r.canonicalKey === config.emergencyRecovery.healingPotionCanonicalKey,
  );
  const potionObserved =
    potion != null && potion.spellIds.some((id) => observedSpellIds.has(id));

  const dangerWindows: SurvivalV1_1DangerWindowAudit[] = [];
  const reactionOpportunities: SurvivalV1_1ReactionOpportunity[] = [];
  const defensiveCounts = emptyDefensiveCounts();
  const recoveryCounts = emptyRecoveryCounts();

  let eligibleDefensive = 0;
  let coveredDefensive = 0;
  let eligibleRecovery = 0;
  let coveredRecovery = 0;

  merged.forEach((window, index) => {
    const firstTs = window.firstTriggerTimestamp;
    const windowClass = classifyWindow(window);
    const deathOutcome = window.triggers.some((t) => t.type === "PLAYER_DEATH");
    const deathTimestamp = deathOutcome
      ? Math.min(
          ...window.triggers.filter((t) => t.type === "PLAYER_DEATH").map((t) => t.timestamp),
        )
      : null;
    const hasExplicitHealthTrigger = window.triggers.some(
      (t) => t.type !== "PLAYER_DEATH" && t.fromExplicitHealth,
    );
    const timeToDeath = deathTimestamp != null ? deathTimestamp - firstTs : null;
    const reactionIntervalMs =
      deathTimestamp != null ? timeToDeath : config.defensiveResponse.castLookaheadMs;
    const reactionEligible =
      reactionIntervalMs == null
        ? true
        : reactionIntervalMs >= config.reaction.minReactionIntervalMs;
    const reactionIneligibilityReason = reactionEligible
      ? null
      : "insufficient_reaction_time";

    const belowMs = timeline
      ? timeBelowLowHpMs(timeline, window, config.danger.lowHpRatio, maxHp)
      : null;

    const applicableDefensiveRules = applicableRules.map((r) => ({
      canonicalKey: r.canonicalKey,
      spellId: r.spellIds[0]!,
      category: r.category,
      availability: r.availability,
      cooldownSeconds: r.cooldownSeconds ?? null,
    }));

    const confirmedAvailableDefensives: SurvivalV1_1DangerWindowAudit["confirmedAvailableDefensives"] =
      [];
    const defensiveCastsOrBuffsDetected: SurvivalV1_1DangerWindowAudit["defensiveCastsOrBuffsDetected"] =
      [];
    let proactive = false;
    let reactive = false;
    let hadEligibleDefensive = false;

    const castWindowStart = firstTs - config.defensiveResponse.castLookbackMs;
    const castWindowEnd = firstTs + config.defensiveResponse.castLookaheadMs;

    for (const rule of applicableRules) {
      if (rule.availability === "TALENT" || rule.availability === "CHOICE_NODE") {
        if (!talentConfirmed(rule, run, observedSpellIds)) continue;
      }
      const cd = rule.cooldownSeconds ?? null;
      const activeAtStart = isBuffActiveAt(buffIntervals, rule.canonicalKey, firstTs);
      const responseCasts = defensiveUses.filter(
        (u) =>
          u.canonicalKey === rule.canonicalKey &&
          u.kind !== "buff_active" &&
          u.timestamp >= castWindowStart &&
          u.timestamp <= castWindowEnd,
      );
      const priorCast = lastCastBefore(defensiveUses, rule.canonicalKey, castWindowStart);
      const onCdAtWindowOpen =
        cd != null && cd > 0 && priorCast != null && firstTs - priorCast < cd * 1000;

      if (activeAtStart) {
        hadEligibleDefensive = true;
        proactive = true;
        confirmedAvailableDefensives.push({
          canonicalKey: rule.canonicalKey,
          spellId: rule.spellIds[0]!,
          reason: "buff_already_active",
        });
        defensiveCastsOrBuffsDetected.push({
          canonicalKey: rule.canonicalKey,
          spellId: rule.spellIds[0]!,
          kind: "buff_active",
          timestamp: firstTs,
        });
        continue;
      }

      if (responseCasts.length > 0) {
        const castOk = responseCasts.some((cast) => {
          const prev = lastCastBefore(defensiveUses, rule.canonicalKey, cast.timestamp - 1);
          if (cd == null || cd <= 0 || prev == null) return true;
          return cast.timestamp - prev >= cd * 1000;
        });
        if (castOk) {
          hadEligibleDefensive = true;
          const anyBefore = responseCasts.some((c) => c.timestamp < firstTs);
          if (anyBefore) proactive = true;
          else reactive = true;
          confirmedAvailableDefensives.push({
            canonicalKey: rule.canonicalKey,
            spellId: rule.spellIds[0]!,
            reason: "cast_in_response_window",
          });
          for (const cast of responseCasts) {
            defensiveCastsOrBuffsDetected.push({
              canonicalKey: cast.canonicalKey,
              spellId: cast.spellId,
              kind: cast.kind === "cast" ? "cast" : "buff_apply",
              timestamp: cast.timestamp,
            });
          }
          continue;
        }
      }

      if (!onCdAtWindowOpen) {
        hadEligibleDefensive = true;
        confirmedAvailableDefensives.push({
          canonicalKey: rule.canonicalKey,
          spellId: rule.spellIds[0]!,
          reason:
            rule.availability === "BASELINE"
              ? "baseline_off_cooldown"
              : "talent_confirmed_off_cooldown",
        });
      }
    }

    let defensiveCoverageKind: SurvivalV1_1DefensiveCoverageKind;
    if (!hadEligibleDefensive) {
      defensiveCoverageKind = "unavailable";
      defensiveCounts.unavailable += 1;
    } else if (!reactionEligible && deathOutcome && !(proactive || reactive)) {
      defensiveCoverageKind = "insufficient_reaction_time";
      defensiveCounts.insufficient_reaction_time += 1;
    } else if (proactive || reactive) {
      if (windowClass === "DEATH_ONLY_HEALTH_CONTEXT_UNAVAILABLE") {
        defensiveCoverageKind = "death_only";
        defensiveCounts.death_only += 1;
      } else if (proactive) {
        defensiveCoverageKind = "proactive";
        defensiveCounts.proactive += 1;
      } else {
        defensiveCoverageKind = "reactive";
        defensiveCounts.reactive += 1;
      }
      if (reactionEligible || proactive) {
        eligibleDefensive += 1;
        coveredDefensive += 1;
      }
    } else if (!reactionEligible) {
      defensiveCoverageKind = "insufficient_reaction_time";
      defensiveCounts.insufficient_reaction_time += 1;
    } else {
      defensiveCoverageKind = "eligible_miss";
      defensiveCounts.eligible_miss += 1;
      eligibleDefensive += 1;
    }

    const lowHpExplicit =
      hasExplicitHealthTrigger &&
      window.triggers.some(
        (t) =>
          t.type === "LOW_HP" ||
          (t.hpAfter != null &&
            maxHp != null &&
            t.hpAfter <= maxHp * config.emergencyRecovery.lowHpRatio),
      );
    const recoveryOpportunity =
      lowHpExplicit && reactionEligible && recoveryResources.length > 0;

    const recoveryActionsDetected: SurvivalV1_1DangerWindowAudit["recoveryActionsDetected"] =
      [];
    let recoveryCovered = false;
    let recoveryCoverageKind: SurvivalV1_1RecoveryCoverageKind;

    if (windowClass === "DEATH_ONLY_HEALTH_CONTEXT_UNAVAILABLE") {
      recoveryCoverageKind = "death_only_health_context_unavailable";
      recoveryCounts.death_only_health_context_unavailable += 1;
    } else if (!lowHpExplicit) {
      recoveryCoverageKind = "not_applicable";
      recoveryCounts.not_applicable += 1;
    } else if (!reactionEligible) {
      recoveryCoverageKind = "insufficient_reaction_time";
      recoveryCounts.insufficient_reaction_time += 1;
    } else if (recoveryResources.length === 0) {
      recoveryCoverageKind = "not_applicable";
      recoveryCounts.not_applicable += 1;
    } else {
      const wStart = window.startTimestamp;
      const wEnd = window.endTimestamp + config.emergencyRecovery.actionLookaheadMs;
      const healthstoneIds = new Set([
        ...(healthstone?.spellIds ?? []),
        ...(healthstone?.aliases ?? []),
      ]);
      const potionIds = new Set([...(potion?.spellIds ?? []), ...(potion?.aliases ?? [])]);
      const selfHealIds = new Set(
        selfHealRules.flatMap((r) => [...r.spellIds, ...(r.aliases ?? [])]),
      );
      const healthstoneKey = config.emergencyRecovery.healthstoneCanonicalKey;
      const potionKey = config.emergencyRecovery.healingPotionCanonicalKey;

      for (const heal of run.normalized.selfHealingAndConsumables.healing) {
        const avg = heal.eventCount > 0 ? heal.totalAmount / heal.eventCount : 0;
        for (const ts of heal.timestamps) {
          if (ts < wStart || ts > wEnd) continue;
          if (healthstoneIds.has(heal.spellId) || heal.canonicalKey === healthstoneKey) {
            recoveryActionsDetected.push({
              canonicalKey: healthstoneKey,
              kind: "healthstone",
              timestamp: ts,
              amount: avg,
            });
            recoveryCovered = true;
          } else if (
            (potionIds.has(heal.spellId) || heal.canonicalKey === potionKey) &&
            potionObserved
          ) {
            recoveryActionsDetected.push({
              canonicalKey: potionKey,
              kind: "healing_potion",
              timestamp: ts,
              amount: avg,
            });
            recoveryCovered = true;
          } else if (selfHealIds.has(heal.spellId) || heal.category === "SELF_HEAL") {
            if (maxHp != null && avg >= maxHp * config.emergencyRecovery.selfHealMinRatio) {
              recoveryActionsDetected.push({
                canonicalKey: heal.canonicalKey ?? `spell:${heal.spellId}`,
                kind: "self_heal",
                timestamp: ts,
                amount: avg,
              });
              recoveryCovered = true;
            }
          }
        }
      }

      if (recoveryCovered) {
        recoveryCoverageKind = "covered";
        recoveryCounts.covered += 1;
        eligibleRecovery += 1;
        coveredRecovery += 1;
      } else if (recoveryOpportunity) {
        recoveryCoverageKind = "eligible_miss";
        recoveryCounts.eligible_miss += 1;
        eligibleRecovery += 1;
      } else {
        recoveryCoverageKind = "not_applicable";
        recoveryCounts.not_applicable += 1;
      }
    }

    const audit: SurvivalV1_1DangerWindowAudit = {
      windowId: `${run.runId}#dw${index + 1}`,
      reportCode: run.reportCode,
      fightId: run.fightId,
      dungeonSlug: run.dungeonSlug,
      windowClass,
      startTimestamp: window.startTimestamp,
      endTimestamp: window.endTimestamp,
      firstTriggerTimestamp: firstTs,
      deathTimestamp,
      triggerTypes: [...new Set(window.triggers.map((t) => t.type))],
      timeBelow35HpMs: belowMs,
      timeFromFirstTriggerToDeathMs: timeToDeath,
      reactionIntervalMs,
      reactionEligible,
      reactionIneligibilityReason,
      hpBefore: window.triggers[0]?.hpBefore ?? null,
      minimumHp: window.triggers.reduce<number | null>((min, t) => {
        if (t.hpAfter == null) return min;
        return min == null ? t.hpAfter : Math.min(min, t.hpAfter);
      }, null),
      maximumHp: maxHp,
      damageEventsResponsible: window.triggers.flatMap((t) => t.damageEvents),
      deathOutcome,
      applicableDefensiveRules,
      confirmedAvailableDefensives,
      defensiveCastsOrBuffsDetected,
      defensiveCoverageKind,
      recoveryResourcesConfirmedAvailable: recoveryResources,
      recoveryActionsDetected,
      recoveryCoverageKind,
      eventDataComplete: input.eventPagesComplete,
    };
    dangerWindows.push(audit);

    reactionOpportunities.push({
      windowId: audit.windowId,
      runId: run.runId,
      dungeonSlug: run.dungeonSlug,
      firstDangerTimestamp: firstTs,
      deathTimestamp,
      timeBelow35HpMs: belowMs,
      timeFromFirstTriggerToDeathMs: timeToDeath,
      reactionIntervalMs,
      reactionEligible,
      reason: reactionIneligibilityReason,
      defensiveAvailable: hadEligibleDefensive,
      recoveryAvailable: recoveryResources.length > 0 && lowHpExplicit,
      defensiveCoverageKind,
      recoveryCoverageKind,
    });
  });

  const outcomeOnlyScore = scoreOutcomeFromDeaths(deathCount);

  const outcome = {
    state: "SCORED" as const,
    score: outcomeOnlyScore,
    weightUsed: 0,
    reason: null as string | null,
    evidence: { deathCount } as Record<string, unknown>,
  };

  const defensiveResponse =
    eligibleDefensive === 0
      ? {
          state: "NOT_APPLICABLE" as const,
          score: null as number | null,
          weightUsed: 0,
          reason:
            merged.length === 0
              ? maxHp == null
                ? "no_danger_windows_max_hp_unavailable"
                : "no_danger_windows"
              : "no_eligible_defensive_windows",
          evidence: { dangerWindowCount: merged.length, defensiveCounts },
        }
      : {
          state: "SCORED" as const,
          score: (coveredDefensive / eligibleDefensive) * 100,
          weightUsed: 0,
          reason: null as string | null,
          evidence: {
            covered: coveredDefensive,
            eligible: eligibleDefensive,
            defensiveCounts,
          },
        };

  const emergencyRecovery =
    eligibleRecovery === 0
      ? {
          state: "NOT_APPLICABLE" as const,
          score: null as number | null,
          weightUsed: 0,
          reason:
            recoveryCounts.death_only_health_context_unavailable > 0
              ? "death_only_health_context_unavailable"
              : "no_eligible_recovery_opportunities",
          evidence: { recoveryCounts },
        }
      : {
          state: "SCORED" as const,
          score: (coveredRecovery / eligibleRecovery) * 100,
          weightUsed: 0,
          reason: null as string | null,
          evidence: {
            covered: coveredRecovery,
            eligible: eligibleRecovery,
            recoveryCounts,
          },
        };

  const weights = redistributeWeights({
    outcome: true,
    defensive: defensiveResponse.state === "SCORED",
    recovery: emergencyRecovery.state === "SCORED",
  });

  outcome.weightUsed = weights.survivalOutcome;
  defensiveResponse.weightUsed = weights.defensiveResponse;
  emergencyRecovery.weightUsed = weights.emergencyRecovery;

  const behavioralSurvivalScore =
    (outcome.score ?? 0) * weights.survivalOutcome +
    (defensiveResponse.score ?? 0) * weights.defensiveResponse +
    (emergencyRecovery.score ?? 0) * weights.emergencyRecovery;

  const runScore: SurvivalV1_1RunScore = {
    runId: run.runId,
    dungeonSlug: run.dungeonSlug,
    reportCode: run.reportCode,
    fightId: run.fightId,
    keyLevel: run.keyLevel,
    deathCount,
    maxHp,
    maxHpSource: input.maxHpResolution.maxHpSource,
    maxHpConfidence: input.maxHpResolution.maxHpConfidence,
    healthTimelineComplete: timeline?.complete ?? false,
    outcomeOnlyScore,
    behavioralSurvivalScore,
    outcome,
    defensiveResponse,
    emergencyRecovery,
    weightsApplied: weights,
    dangerWindowCount: dangerWindows.length,
    nonFatalWindowCount: dangerWindows.filter((w) => w.windowClass === "NON_FATAL_PRESSURE")
      .length,
    fatalWindowCount: dangerWindows.filter((w) => w.windowClass === "FATAL_PRESSURE").length,
    deathOnlyWindowCount: dangerWindows.filter(
      (w) => w.windowClass === "DEATH_ONLY_HEALTH_CONTEXT_UNAVAILABLE",
    ).length,
    defensiveCounts,
    recoveryCounts,
    dangerWindowIds: dangerWindows.map((w) => w.windowId),
  };

  return { runScore, dangerWindows, reactionOpportunities };
}

export function buildTimelineForRun(
  run: SurvivalCalibrationRun,
  maxHp: number,
  snapshots: TimelineBuildInput["snapshots"],
  eventPagesComplete: boolean,
): HealthTimeline {
  const healEvents = run.normalized.selfHealingAndConsumables.healing.flatMap((h) => {
    const avg = h.eventCount > 0 ? h.totalAmount / h.eventCount : 0;
    return h.timestamps.map((timestamp) => ({
      timestamp,
      amount: avg,
      abilityGameID: h.spellId,
    }));
  });
  return buildHealthTimeline({
    runId: run.runId,
    reportCode: run.reportCode,
    fightId: run.fightId,
    maxHp,
    snapshots,
    damageEvents: run.normalized.damageTaken.events
      .filter((e) => e.targetID === run.playerActorId && e.timestamp != null)
      .map((e) => ({
        timestamp: e.timestamp!,
        amount: Math.max(0, e.amount ?? 0),
        absorbed: e.absorbed ?? 0,
        abilityGameID: e.abilityGameID ?? null,
      })),
    healEvents,
    deathTimestamps: run.deaths.deaths
      .map((d) => d.timestamp)
      .filter((t): t is number => t != null),
    fightStart: run.normalized.run.startTime,
    fightEnd: run.normalized.run.endTime,
    eventPagesComplete,
  });
}

export function aggregateSurvivalV1_1(
  runScores: SurvivalV1_1RunScore[],
  expectedDungeonSlugs: string[],
  scoreMode: SurvivalV1_1ScoreMode,
): { perDungeon: SurvivalV1_1DungeonScore[]; global: SurvivalV1_1GlobalScore } {
  const perDungeon: SurvivalV1_1DungeonScore[] = expectedDungeonSlugs.map((slug) => {
    const runs = runScores.filter((r) => r.dungeonSlug === slug);
    const outcomeScores = runs.map((r) => r.outcomeOnlyScore);
    const behavioralScores = runs
      .map((r) => r.behavioralSurvivalScore)
      .filter((s): s is number => s != null);
    return {
      dungeonSlug: slug,
      runCount: runs.length,
      medianOutcomeOnlyScore: median(outcomeScores),
      medianBehavioralScore: behavioralScores.length ? median(behavioralScores) : null,
      runOutcomeOnlyScores: outcomeScores,
      runBehavioralScores: behavioralScores,
    };
  });

  const withOutcome = perDungeon.filter((d) => d.medianOutcomeOnlyScore != null);
  const withBehavioral = perDungeon.filter((d) => d.medianBehavioralScore != null);
  const outcomeOnlyScore =
    withOutcome.length === 0
      ? null
      : withOutcome.reduce((s, d) => s + (d.medianOutcomeOnlyScore ?? 0), 0) /
        withOutcome.length;
  const behavioralSurvivalScore =
    withBehavioral.length === 0
      ? null
      : withBehavioral.reduce((s, d) => s + (d.medianBehavioralScore ?? 0), 0) /
        withBehavioral.length;

  const runsWithValidMaxHp = runScores.filter((r) => r.maxHp != null).length;

  return {
    perDungeon,
    global: {
      outcomeOnlyScore,
      behavioralSurvivalScore,
      scoreMode,
      availableDungeonCount: withOutcome.length,
      expectedDungeonCount: expectedDungeonSlugs.length,
      runsWithValidMaxHp,
      runCount: runScores.length,
      healthStateCoverageShare:
        runScores.length === 0 ? 0 : runsWithValidMaxHp / runScores.length,
      note:
        scoreMode === "FULL_BEHAVIORAL"
          ? "Behavioral score has sufficient health-state coverage."
          : scoreMode === "PARTIAL_BEHAVIORAL"
            ? "Behavioral score is partial — health-state coverage below full threshold."
            : "Health-state coverage too low; treat outcomeOnlyScore as primary.",
    },
  };
}
