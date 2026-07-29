import type { AbilityAvailability, AbilityCatalog, AbilityRule } from "@mplus/abilities";
import { rulesForCategory, rulesForSpell } from "@mplus/abilities";
import type { SurvivalCalibrationRun } from "./survival-calibration-types.js";
import type { SurvivalDeathFact, SurvivalPreservedEvent } from "./survival-probe-types.js";
import {
  SURVIVAL_STANDALONE_V1_CONFIG,
  type SurvivalStandaloneV1Config,
} from "./survival-v1-config.js";
import type {
  DangerTriggerType,
  SurvivalV1ComponentResult,
  SurvivalV1DangerWindowAudit,
  SurvivalV1DungeonScore,
  SurvivalV1GlobalScore,
  SurvivalV1RunScore,
} from "./survival-v1-types.js";
import { median } from "./survival-calibration-logic.js";

export interface SurvivalV1ScoreInput {
  run: SurvivalCalibrationRun;
  catalog: AbilityCatalog;
  classSlug: string | null;
  config?: SurvivalStandaloneV1Config;
}

interface ResolvedMaxHp {
  maxHp: number | null;
  source: SurvivalV1RunScore["maxHpSource"];
}

interface TriggerPoint {
  timestamp: number;
  type: DangerTriggerType;
  hpBefore: number | null;
  hpAfter: number | null;
  damageEvents: SurvivalV1DangerWindowAudit["damageEventsResponsible"];
}

interface TimelinePoint {
  timestamp: number;
  hp: number;
}

function asFinite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return null;
}

/** Resolve max HP strictly — never invent from stamina or formulas. */
export function resolvePlayerMaxHp(run: SurvivalCalibrationRun): ResolvedMaxHp {
  const events = run.normalized.damageTaken.events ?? [];
  for (const event of events) {
    const fromEvent =
      asFinite(event.raw?.maxHitPoints) ??
      asFinite(event.additionalFields?.maxHitPoints) ??
      asFinite((event.raw?.target as Record<string, unknown> | undefined)?.maxHitPoints);
    if (fromEvent != null) return { maxHp: fromEvent, source: "event_maxHitPoints" };
  }

  const combatant = run.normalized.combatantInfo.raw;
  if (combatant) {
    const fromCombatant =
      asFinite(combatant.maxHitPoints) ??
      asFinite(combatant.maxHp) ??
      asFinite(combatant.hitPoints) ??
      asFinite(combatant.maxHealth);
    if (fromCombatant != null) return { maxHp: fromCombatant, source: "combatantInfo" };
  }

  if (run.damageTaken.playerMaxHp != null && run.damageTaken.playerMaxHp > 0) {
    return { maxHp: run.damageTaken.playerMaxHp, source: "raw_field" };
  }

  return { maxHp: null, source: null };
}

export function scoreOutcomeFromDeaths(
  deathCount: number,
  config: SurvivalStandaloneV1Config = SURVIVAL_STANDALONE_V1_CONFIG,
): number {
  if (deathCount <= 0) return config.outcomeByDeaths[0];
  if (deathCount === 1) return config.outcomeByDeaths[1];
  if (deathCount === 2) return config.outcomeByDeaths[2];
  return config.outcomeByDeaths.threeOrMore;
}

/** Deaths attributable to the player inside [startTime, endTime]. */
export function filterInFightPlayerDeaths(
  deaths: SurvivalDeathFact[],
  playerActorId: number,
  startTime: number,
  endTime: number,
): SurvivalDeathFact[] {
  return deaths.filter((d) => {
    const ts = d.timestamp;
    if (ts == null) return false;
    if (ts < startTime || ts > endTime) return false;
    const diedId = d.event.targetID ?? d.event.sourceID;
    return diedId === playerActorId;
  });
}

function unabsorbedAmount(event: SurvivalPreservedEvent): number {
  return Math.max(0, event.amount ?? 0);
}

/**
 * Reconstruct HP timeline when maxHp is known.
 * Starts at maxHp; damage (amount) reduces HP; healing ticks increase HP (capped).
 */
export function rebuildHpTimeline(
  run: SurvivalCalibrationRun,
  maxHp: number,
): TimelinePoint[] {
  const start = run.normalized.run.startTime;
  const points: TimelinePoint[] = [{ timestamp: start, hp: maxHp }];
  type Delta = { timestamp: number; delta: number };
  const deltas: Delta[] = [];

  for (const event of run.normalized.damageTaken.events) {
    if (event.targetID !== run.playerActorId) continue;
    if (event.timestamp == null) continue;
    deltas.push({ timestamp: event.timestamp, delta: -unabsorbedAmount(event) });
  }

  for (const heal of run.normalized.selfHealingAndConsumables.healing) {
    const avg =
      heal.eventCount > 0 ? Math.max(0, heal.totalAmount / heal.eventCount) : 0;
    for (const ts of heal.timestamps) {
      deltas.push({ timestamp: ts, delta: avg });
    }
  }

  deltas.sort((a, b) => a.timestamp - b.timestamp || a.delta - b.delta);
  let hp = maxHp;
  for (const d of deltas) {
    hp = Math.min(maxHp, Math.max(0, hp + d.delta));
    points.push({ timestamp: d.timestamp, hp });
  }
  return points;
}

function hpAt(timeline: TimelinePoint[], timestamp: number): number | null {
  if (timeline.length === 0) return null;
  let current = timeline[0]!.hp;
  for (const p of timeline) {
    if (p.timestamp > timestamp) break;
    current = p.hp;
  }
  return current;
}

export function detectDangerTriggers(input: {
  run: SurvivalCalibrationRun;
  maxHp: number | null;
  deaths: SurvivalDeathFact[];
  config?: SurvivalStandaloneV1Config;
}): { triggers: TriggerPoint[]; hpDetectionAvailable: boolean } {
  const config = input.config ?? SURVIVAL_STANDALONE_V1_CONFIG;
  const triggers: TriggerPoint[] = [];
  const hpDetectionAvailable = input.maxHp != null && input.maxHp > 0;
  const events = [...input.run.normalized.damageTaken.events]
    .filter((e) => e.targetID === input.run.playerActorId && e.timestamp != null)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  const timeline =
    hpDetectionAvailable && input.maxHp != null
      ? rebuildHpTimeline(input.run, input.maxHp)
      : [];

  if (hpDetectionAvailable && input.maxHp != null) {
    const maxHp = input.maxHp;
    // Low HP + large hit from damage stream
    for (const event of events) {
      const ts = event.timestamp!;
      const amount = unabsorbedAmount(event);
      const before = hpAt(timeline, ts - 1);
      const after = hpAt(timeline, ts);
      const responsible = [
        {
          timestamp: ts,
          abilityGameID: event.abilityGameID,
          sourceID: event.sourceID,
          amount,
          absorbed: event.absorbed ?? 0,
        },
      ];

      if (amount >= maxHp * config.danger.largeHitRatio) {
        triggers.push({
          timestamp: ts,
          type: "LARGE_HIT",
          hpBefore: before,
          hpAfter: after,
          damageEvents: responsible,
        });
      }
      if (after != null && after <= maxHp * config.danger.lowHpRatio) {
        triggers.push({
          timestamp: ts,
          type: "LOW_HP",
          hpBefore: before,
          hpAfter: after,
          damageEvents: responsible,
        });
      }
    }

    // Rolling 5s unabsorbed damage
    let left = 0;
    let sum = 0;
    for (let right = 0; right < events.length; right += 1) {
      const endTs = events[right]!.timestamp!;
      sum += unabsorbedAmount(events[right]!);
      while (left <= right && endTs - events[left]!.timestamp! > config.danger.rollingWindowMs) {
        sum -= unabsorbedAmount(events[left]!);
        left += 1;
      }
      if (sum >= maxHp * config.danger.rollingDamageRatio) {
        const windowEvents = events.slice(left, right + 1).map((e) => ({
          timestamp: e.timestamp!,
          abilityGameID: e.abilityGameID,
          sourceID: e.sourceID,
          amount: unabsorbedAmount(e),
          absorbed: e.absorbed ?? 0,
        }));
        triggers.push({
          timestamp: endTs,
          type: "ROLLING_DAMAGE",
          hpBefore: hpAt(timeline, endTs - 1),
          hpAfter: hpAt(timeline, endTs),
          damageEvents: windowEvents,
        });
      }
    }
  }

  for (const death of input.deaths) {
    if (death.timestamp == null) continue;
    triggers.push({
      timestamp: death.timestamp,
      type: "PLAYER_DEATH",
      hpBefore: hpDetectionAvailable ? hpAt(timeline, death.timestamp - 1) : null,
      hpAfter: 0,
      damageEvents: [],
    });
  }

  triggers.sort((a, b) => a.timestamp - b.timestamp);
  return { triggers, hpDetectionAvailable };
}

/** Merge triggers within mergeGapMs into danger windows. */
export function mergeDangerWindows(
  triggers: TriggerPoint[],
  mergeGapMs: number,
): Array<{
  startTimestamp: number;
  endTimestamp: number;
  firstTriggerTimestamp: number;
  triggers: TriggerPoint[];
}> {
  if (triggers.length === 0) return [];
  const windows: Array<{
    startTimestamp: number;
    endTimestamp: number;
    firstTriggerTimestamp: number;
    triggers: TriggerPoint[];
  }> = [];

  let current = {
    startTimestamp: triggers[0]!.timestamp,
    endTimestamp: triggers[0]!.timestamp,
    firstTriggerTimestamp: triggers[0]!.timestamp,
    triggers: [triggers[0]!],
  };

  for (let i = 1; i < triggers.length; i += 1) {
    const t = triggers[i]!;
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

function isUncertainRule(rule: AbilityRule): boolean {
  return (
    rule.supportCertainty === "uncertain" ||
    rule.provenance.certainty === "uncertain"
  );
}

function talentConfirmed(
  rule: AbilityRule,
  run: SurvivalCalibrationRun,
  observedSpellIds: Set<number>,
): boolean {
  if (rule.availability !== "TALENT" && rule.availability !== "CHOICE_NODE") {
    return true;
  }
  // Observed cast/buff during the fight confirms the talent is selected.
  for (const id of rule.spellIds) {
    if (observedSpellIds.has(id)) return true;
  }
  for (const id of rule.aliases ?? []) {
    if (observedSpellIds.has(id)) return true;
  }
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
  // Buff-only defensives may have castCount 0
  for (const d of run.normalized.defensiveUsage) {
    ids.add(d.spellId);
    for (const _ of d.buffApplications) ids.add(d.spellId);
  }
  return ids;
}

interface AbilityUseEvent {
  canonicalKey: string;
  spellId: number;
  kind: "cast" | "buff_active" | "buff_apply";
  timestamp: number;
  cooldownSeconds: number | null;
  availability: AbilityAvailability;
}

function collectDefensiveUses(
  run: SurvivalCalibrationRun,
  catalog: AbilityCatalog,
  config: SurvivalStandaloneV1Config,
): AbilityUseEvent[] {
  const uses: AbilityUseEvent[] = [];
  const categories = config.defensiveResponse.applicableCategories;

  for (const usage of run.normalized.defensiveUsage) {
    if (!(categories as readonly string[]).includes(usage.category)) continue;
    const rules = rulesForSpell(catalog, usage.spellId).filter((r) =>
      (categories as readonly string[]).includes(r.category),
    );
    const rule = rules[0];
    if (rule && isUncertainRule(rule)) continue;

    for (const ts of usage.castTimestamps) {
      uses.push({
        canonicalKey: usage.canonicalKey,
        spellId: usage.spellId,
        kind: "cast",
        timestamp: ts,
        cooldownSeconds: usage.cooldownSeconds,
        availability: usage.availability,
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
        availability: usage.availability,
      });
    }
    // Reconstruct active intervals for "already active" checks
    const applies = usage.buffApplications
      .map((b) => b.timestamp)
      .filter((t): t is number => t != null)
      .sort((a, b) => a - b);
    const removes = usage.buffRemovals
      .map((b) => b.timestamp)
      .filter((t): t is number => t != null)
      .sort((a, b) => a - b);
    let ri = 0;
    for (const start of applies) {
      while (ri < removes.length && removes[ri]! < start) ri += 1;
      const end = ri < removes.length ? removes[ri]! : run.normalized.run.endTime;
      if (ri < removes.length) ri += 1;
      uses.push({
        canonicalKey: usage.canonicalKey,
        spellId: usage.spellId,
        kind: "buff_active",
        timestamp: start,
        cooldownSeconds: usage.cooldownSeconds,
        availability: usage.availability,
      });
      // Store end as a synthetic marker via parallel list — handled in isBuffActive
      void end;
    }
  }

  // Also include calibration defensives summary (buff-only)
  for (const d of run.defensives) {
    if (!(categories as readonly string[]).includes(d.category)) continue;
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
  const list = intervals.get(canonicalKey) ?? [];
  return list.some((i) => i.start <= timestamp && timestamp < i.end);
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

export function redistributeWeights(
  available: {
    outcome: boolean;
    defensive: boolean;
    recovery: boolean;
  },
  config: SurvivalStandaloneV1Config = SURVIVAL_STANDALONE_V1_CONFIG,
): { survivalOutcome: number; defensiveResponse: number; emergencyRecovery: number } {
  const base = {
    survivalOutcome: available.outcome ? config.weights.survivalOutcome : 0,
    defensiveResponse: available.defensive ? config.weights.defensiveResponse : 0,
    emergencyRecovery: available.recovery ? config.weights.emergencyRecovery : 0,
  };
  const sum = base.survivalOutcome + base.defensiveResponse + base.emergencyRecovery;
  if (sum <= 0) {
    return { survivalOutcome: 1, defensiveResponse: 0, emergencyRecovery: 0 };
  }
  return {
    survivalOutcome: base.survivalOutcome / sum,
    defensiveResponse: base.defensiveResponse / sum,
    emergencyRecovery: base.emergencyRecovery / sum,
  };
}

function ratioToScore(covered: number, eligible: number): number {
  if (eligible <= 0) return 0;
  return (covered / eligible) * 100;
}

export function scoreSurvivalV1Run(input: SurvivalV1ScoreInput): {
  runScore: SurvivalV1RunScore;
  dangerWindows: SurvivalV1DangerWindowAudit[];
} {
  const config = input.config ?? SURVIVAL_STANDALONE_V1_CONFIG;
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
  const maxHpResolved = resolvePlayerMaxHp(run);
  const { triggers, hpDetectionAvailable } = detectDangerTriggers({
    run,
    maxHp: maxHpResolved.maxHp,
    deaths: inFightDeaths,
    config,
  });
  const merged = mergeDangerWindows(triggers, config.danger.mergeGapMs);

  const observedSpellIds = collectObservedSpellIds(run);
  const defensiveUses = collectDefensiveUses(run, catalog, config);
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

  // Recovery resource confirmation
  const recoveryResources: Array<{ canonicalKey: string; reason: string }> = [];
  for (const rule of selfHealRules) {
    if (rule.availability === "BASELINE" || talentConfirmed(rule, run, observedSpellIds)) {
      recoveryResources.push({
        canonicalKey: rule.canonicalKey,
        reason:
          rule.availability === "BASELINE"
            ? "baseline_self_heal"
            : "talent_confirmed",
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
    if (warlockOk || observedSpellIds.has(healthstone.spellIds[0]!)) {
      recoveryResources.push({
        canonicalKey: healthstone.canonicalKey,
        reason: warlockOk ? "warlock_healthstone_confirmed" : "observed_healthstone_use",
      });
    }
  }
  // Healing potion: never assumed — only if observed during fight (proves ownership for responses,
  // but does NOT alone create opportunities unless already eligible from other resources).
  const potion = consumableRules.find(
    (r) => r.canonicalKey === config.emergencyRecovery.healingPotionCanonicalKey,
  );
  const potionObserved =
    potion != null &&
    (observedSpellIds.has(potion.spellIds[0]!) ||
      potion.spellIds.some((id) => observedSpellIds.has(id)));

  const dangerWindows: SurvivalV1DangerWindowAudit[] = [];
  let eligibleDefensive = 0;
  let coveredDefensive = 0;
  let eligibleRecovery = 0;
  let coveredRecovery = 0;

  merged.forEach((window, index) => {
    const firstTs = window.firstTriggerTimestamp;
    const deathOutcome = window.triggers.some((t) => t.type === "PLAYER_DEATH");
    const triggerTypes = [...new Set(window.triggers.map((t) => t.type))];
    const damageEventsResponsible = window.triggers.flatMap((t) => t.damageEvents);
    const hpBefore = window.triggers[0]?.hpBefore ?? null;
    const minimumHp = window.triggers.reduce<number | null>((min, t) => {
      if (t.hpAfter == null) return min;
      return min == null ? t.hpAfter : Math.min(min, t.hpAfter);
    }, null);

    const confirmedAvailableDefensives: SurvivalV1DangerWindowAudit["confirmedAvailableDefensives"] =
      [];
    const applicableDefensiveRules = applicableRules.map((r) => ({
      canonicalKey: r.canonicalKey,
      spellId: r.spellIds[0]!,
      category: r.category,
      availability: r.availability,
      cooldownSeconds: r.cooldownSeconds ?? null,
    }));

    const defensiveCastsOrBuffsDetected: SurvivalV1DangerWindowAudit["defensiveCastsOrBuffsDetected"] =
      [];
    let defensiveCovered = false;
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

      // Off cooldown at danger start (ignoring response casts inside the lookback window).
      const priorCast = lastCastBefore(defensiveUses, rule.canonicalKey, castWindowStart);
      const onCdAtWindowOpen =
        cd != null &&
        cd > 0 &&
        priorCast != null &&
        firstTs - priorCast < cd * 1000;

      if (activeAtStart) {
        hadEligibleDefensive = true;
        defensiveCovered = true;
        confirmedAvailableDefensives.push({
          canonicalKey: rule.canonicalKey,
          spellId: rule.spellIds[0]!,
          reason: "baseline_or_talent_buff_already_active",
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
        // Cast in response window counts if not blocked by an earlier CD outside the window.
        const castOk = responseCasts.some((cast) => {
          const prev = lastCastBefore(defensiveUses, rule.canonicalKey, cast.timestamp - 1);
          if (cd == null || cd <= 0 || prev == null) return true;
          return cast.timestamp - prev >= cd * 1000;
        });
        if (castOk) {
          hadEligibleDefensive = true;
          defensiveCovered = true;
          confirmedAvailableDefensives.push({
            canonicalKey: rule.canonicalKey,
            spellId: rule.spellIds[0]!,
            reason: "available_and_cast_in_response_window",
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

    const defensiveEligible = hadEligibleDefensive;
    if (defensiveEligible) {
      eligibleDefensive += 1;
      if (defensiveCovered) coveredDefensive += 1;
    }

    // Recovery eligibility
    const lowHpRecovery =
      hpDetectionAvailable &&
      minimumHp != null &&
      maxHpResolved.maxHp != null &&
      minimumHp <= maxHpResolved.maxHp * config.emergencyRecovery.lowHpRatio;
    const recoveryOpportunity = lowHpRecovery || deathOutcome;
    const recoveryEligible =
      recoveryOpportunity && recoveryResources.length > 0;

    const recoveryActionsDetected: SurvivalV1DangerWindowAudit["recoveryActionsDetected"] =
      [];
    let recoveryCovered = false;

    if (recoveryEligible) {
      eligibleRecovery += 1;
      const wStart = window.startTimestamp;
      const wEnd = window.endTimestamp + config.emergencyRecovery.actionLookaheadMs;
      const healthstoneIds = new Set([
        ...(healthstone?.spellIds ?? []),
        ...(healthstone?.aliases ?? []),
      ]);
      const potionIds = new Set([
        ...(potion?.spellIds ?? []),
        ...(potion?.aliases ?? []),
      ]);
      const selfHealIds = new Set(selfHealRules.flatMap((r) => [...r.spellIds, ...(r.aliases ?? [])]));
      const healthstoneKey = config.emergencyRecovery.healthstoneCanonicalKey;
      const potionKey = config.emergencyRecovery.healingPotionCanonicalKey;

      for (const heal of run.normalized.selfHealingAndConsumables.healing) {
        const avg = heal.eventCount > 0 ? heal.totalAmount / heal.eventCount : 0;
        for (const ts of heal.timestamps) {
          if (ts < wStart || ts > wEnd) continue;
          const isHealthstone =
            healthstoneIds.has(heal.spellId) || heal.canonicalKey === healthstoneKey;
          const isPotion =
            potionIds.has(heal.spellId) || heal.canonicalKey === potionKey;
          if (isHealthstone) {
            recoveryActionsDetected.push({
              canonicalKey: healthstoneKey,
              kind: "healthstone",
              timestamp: ts,
              amount: avg,
            });
            recoveryCovered = true;
          } else if (isPotion && potionObserved) {
            recoveryActionsDetected.push({
              canonicalKey: potionKey,
              kind: "healing_potion",
              timestamp: ts,
              amount: avg,
            });
            recoveryCovered = true;
          } else if (selfHealIds.has(heal.spellId) || heal.category === "SELF_HEAL") {
            if (
              maxHpResolved.maxHp != null &&
              avg >= maxHpResolved.maxHp * config.emergencyRecovery.selfHealMinRatio
            ) {
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

      for (const cast of run.normalized.selfHealingAndConsumables.consumableAndSelfHealCasts) {
        for (const ts of cast.castTimestamps) {
          if (ts < wStart || ts > wEnd) continue;
          if (cast.canonicalKey === healthstoneKey) {
            recoveryActionsDetected.push({
              canonicalKey: cast.canonicalKey,
              kind: "healthstone",
              timestamp: ts,
              amount: null,
            });
            recoveryCovered = true;
          }
          if (cast.canonicalKey === potionKey && potionObserved) {
            recoveryActionsDetected.push({
              canonicalKey: cast.canonicalKey,
              kind: "healing_potion",
              timestamp: ts,
              amount: null,
            });
            recoveryCovered = true;
          }
        }
      }

      if (recoveryCovered) coveredRecovery += 1;
    }

    let rejectionOrNotApplicableReason: string | null = null;
    if (!defensiveEligible && !recoveryEligible) {
      rejectionOrNotApplicableReason = !hpDetectionAvailable
        ? "no_confirmed_available_defensive_and_no_max_hp_for_hp_triggers"
        : "no_confirmed_available_defensive_or_recovery_resource";
    }

    dangerWindows.push({
      windowId: `${run.runId}#dw${index + 1}`,
      reportCode: run.reportCode,
      fightId: run.fightId,
      dungeonSlug: run.dungeonSlug,
      startTimestamp: window.startTimestamp,
      endTimestamp: window.endTimestamp,
      firstTriggerTimestamp: firstTs,
      triggerTypes,
      hpBefore,
      minimumHp,
      maximumHp: maxHpResolved.maxHp,
      damageEventsResponsible,
      deathOutcome,
      applicableDefensiveRules,
      confirmedAvailableDefensives,
      defensiveCastsOrBuffsDetected,
      recoveryResourcesConfirmedAvailable: recoveryResources,
      recoveryActionsDetected,
      defensiveCovered: defensiveEligible ? defensiveCovered : null,
      recoveryCovered: recoveryEligible ? recoveryCovered : null,
      defensiveEligible,
      recoveryEligible,
      componentResult: {
        defensive: defensiveEligible
          ? defensiveCovered
            ? "covered"
            : "missed"
          : "not_eligible",
        recovery: recoveryEligible
          ? recoveryCovered
            ? "covered"
            : "missed"
          : "not_eligible",
      },
      rejectionOrNotApplicableReason,
      eventDataComplete:
        run.missingDatasets.length === 0 &&
        (hpDetectionAvailable || triggerTypes.includes("PLAYER_DEATH")),
    });
  });

  const outcome: SurvivalV1ComponentResult = {
    state: "SCORED",
    score: scoreOutcomeFromDeaths(deathCount, config),
    weightUsed: 0,
    reason: null,
    evidence: {
      deathCount,
      deathTimestamps: inFightDeaths.map((d) => d.timestamp),
      excludedDeathEvidence: run.deaths.deaths.length - inFightDeaths.length,
    },
  };

  let defensiveResponse: SurvivalV1ComponentResult;
  if (eligibleDefensive === 0) {
    defensiveResponse = {
      state: "NOT_APPLICABLE",
      score: null,
      weightUsed: 0,
      reason:
        merged.length === 0
          ? hpDetectionAvailable
            ? "no_danger_windows"
            : "no_danger_windows_max_hp_unavailable_for_hp_triggers"
          : "no_eligible_danger_windows_with_confirmed_available_defensive",
      evidence: {
        dangerWindowCount: merged.length,
        hpDetectionAvailable,
        maxHp: maxHpResolved.maxHp,
      },
    };
  } else {
    defensiveResponse = {
      state: "SCORED",
      score: ratioToScore(coveredDefensive, eligibleDefensive),
      weightUsed: 0,
      reason: null,
      evidence: {
        covered: coveredDefensive,
        eligible: eligibleDefensive,
      },
    };
  }

  let emergencyRecovery: SurvivalV1ComponentResult;
  if (eligibleRecovery === 0) {
    emergencyRecovery = {
      state: "NOT_APPLICABLE",
      score: null,
      weightUsed: 0,
      reason:
        merged.length === 0
          ? "no_danger_windows"
          : recoveryResources.length === 0
            ? "no_confirmed_recovery_resource"
            : "no_eligible_recovery_opportunities",
      evidence: {
        recoveryResources,
        potionAssumed: false,
        potionObserved,
      },
    };
  } else {
    emergencyRecovery = {
      state: "SCORED",
      score: ratioToScore(coveredRecovery, eligibleRecovery),
      weightUsed: 0,
      reason: null,
      evidence: {
        covered: coveredRecovery,
        eligible: eligibleRecovery,
      },
    };
  }

  const weights = redistributeWeights({
    outcome: true,
    defensive: defensiveResponse.state === "SCORED",
    recovery: emergencyRecovery.state === "SCORED",
  }, config);
  outcome.weightUsed = weights.survivalOutcome;
  defensiveResponse.weightUsed = weights.defensiveResponse;
  emergencyRecovery.weightUsed = weights.emergencyRecovery;

  const score =
    (outcome.score ?? 0) * weights.survivalOutcome +
    (defensiveResponse.score ?? 0) * weights.defensiveResponse +
    (emergencyRecovery.score ?? 0) * weights.emergencyRecovery;

  const runScore: SurvivalV1RunScore = {
    runId: run.runId,
    dungeonSlug: run.dungeonSlug,
    reportCode: run.reportCode,
    fightId: run.fightId,
    keyLevel: run.keyLevel,
    deathCount,
    maxHp: maxHpResolved.maxHp,
    maxHpSource: maxHpResolved.source,
    outcome,
    defensiveResponse,
    emergencyRecovery,
    score,
    weightsApplied: weights,
    dangerWindowCount: dangerWindows.length,
    eligibleDefensiveWindows: eligibleDefensive,
    coveredDefensiveWindows: coveredDefensive,
    eligibleRecoveryWindows: eligibleRecovery,
    coveredRecoveryWindows: coveredRecovery,
    dangerWindowIds: dangerWindows.map((w) => w.windowId),
  };

  return { runScore, dangerWindows };
}

export function aggregateSurvivalV1Dungeons(
  runScores: SurvivalV1RunScore[],
  expectedDungeonSlugs: string[],
): { perDungeon: SurvivalV1DungeonScore[]; global: SurvivalV1GlobalScore } {
  const perDungeon: SurvivalV1DungeonScore[] = expectedDungeonSlugs.map((slug) => {
    const runs = runScores.filter((r) => r.dungeonSlug === slug);
    const scores = runs.map((r) => r.score);
    return {
      dungeonSlug: slug,
      runCount: runs.length,
      medianScore: median(scores),
      runScores: scores,
      componentCoverage: {
        outcomeScored: runs.filter((r) => r.outcome.state === "SCORED").length,
        defensiveScored: runs.filter((r) => r.defensiveResponse.state === "SCORED").length,
        defensiveNotApplicable: runs.filter((r) => r.defensiveResponse.state === "NOT_APPLICABLE")
          .length,
        recoveryScored: runs.filter((r) => r.emergencyRecovery.state === "SCORED").length,
        recoveryNotApplicable: runs.filter((r) => r.emergencyRecovery.state === "NOT_APPLICABLE")
          .length,
      },
    };
  });

  const withScores = perDungeon.filter((d) => d.medianScore != null);
  const equalWeight =
    withScores.length === 0
      ? null
      : withScores.reduce((s, d) => s + (d.medianScore ?? 0), 0) / withScores.length;

  return {
    perDungeon,
    global: {
      score: equalWeight,
      availableDungeonCount: withScores.length,
      expectedDungeonCount: expectedDungeonSlugs.length,
      dungeonMedians: perDungeon.map((d) => ({
        dungeonSlug: d.dungeonSlug,
        medianScore: d.medianScore,
      })),
      note: "Equal-weight average of dungeon median scores. Not weighted by run count. Not a percentile.",
    },
  };
}
