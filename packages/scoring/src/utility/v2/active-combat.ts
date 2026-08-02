/**
 * Active-combat duration estimate from hostile activity timestamps (provider-free).
 */

import { UTILITY_V2_ACTIVE_COMBAT_GAP_MS } from "./constants.js";

export interface ActiveCombatEstimate {
  activeCombatMs: number;
  fightDurationMs: number;
  activityWindowMs: number;
  gapThresholdMs: number;
  method: "hostile_activity_windows" | "fight_duration_fallback";
  eventCount: number;
  windowCount: number;
  notes: string[];
}

export function estimateActiveCombatMs(input: {
  fightDurationMs: number;
  hostileEventTimestampsMs: number[];
  gapThresholdMs?: number;
}): ActiveCombatEstimate {
  const gap = input.gapThresholdMs ?? UTILITY_V2_ACTIVE_COMBAT_GAP_MS;
  const fight = Math.max(0, input.fightDurationMs);
  const notes: string[] = [];
  const ts = [...new Set(input.hostileEventTimestampsMs.filter((t) => Number.isFinite(t)))]
    .map((t) => Math.max(0, t))
    .sort((a, b) => a - b);

  if (ts.length < 3 || fight <= 0) {
    notes.push("insufficient_hostile_activity_fallback_fight_duration");
    return {
      activeCombatMs: fight,
      fightDurationMs: fight,
      activityWindowMs: 0,
      gapThresholdMs: gap,
      method: "fight_duration_fallback",
      eventCount: ts.length,
      windowCount: 0,
      notes,
    };
  }

  const pad = Math.min(Math.floor(gap / 4), 2000);
  let activity = 0;
  let windowCount = 0;
  let start = ts[0]!;
  let prev = ts[0]!;
  for (let i = 1; i < ts.length; i += 1) {
    const t = ts[i]!;
    if (t - prev > gap) {
      activity += Math.max(0, prev - start + pad);
      windowCount += 1;
      start = t;
    }
    prev = t;
  }
  activity += Math.max(0, prev - start + pad);
  windowCount += 1;

  const clamped = Math.min(fight, Math.max(0, activity));
  const coverage = fight > 0 ? clamped / fight : 0;
  if (coverage < 0.2) {
    notes.push(`activity_coverage_${Math.round(coverage * 100)}_pct_below_20_fallback`);
    return {
      activeCombatMs: fight,
      fightDurationMs: fight,
      activityWindowMs: clamped,
      gapThresholdMs: gap,
      method: "fight_duration_fallback",
      eventCount: ts.length,
      windowCount,
      notes,
    };
  }

  notes.push("hostile_activity_windows");
  return {
    activeCombatMs: clamped,
    fightDurationMs: fight,
    activityWindowMs: clamped,
    gapThresholdMs: gap,
    method: "hostile_activity_windows",
    eventCount: ts.length,
    windowCount,
    notes,
  };
}

export function activeCombatHours(estimate: ActiveCombatEstimate): number {
  return Math.max(estimate.activeCombatMs / 3_600_000, 1 / 60);
}
