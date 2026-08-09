/**
 * Derive per-participant pressure windows from shared DamageTaken compact events.
 * Transparent calibration model — not a Survival score.
 */
import {
  PRESSURE_WINDOW_DERIVATION_VERSION,
  hashPressureWindowTimelinePayload,
  type PressureWindowTimelineV1,
  type PressureWindowV1,
  type PressureWindowClass,
  type SurvivalCanonicalActivation,
  type SurvivalDeathEvent,
} from "@mplus/contracts";
import type { CapabilityCompactEvent } from "@mplus/contracts";
import {
  SURVIVAL_ONE_FIGHT_PRESSURE_CONFIG,
  type SurvivalOneFightPressureConfig,
} from "./pressure-config.js";
import type { SurvivalProbeParticipant, SurvivalProbeSourceIdentity } from "./types.js";

export interface DamageTakenPoint {
  eventId: string;
  timestampMs: number;
  amount: number;
  participantActorId: number;
  maxHpHint: number | null;
}

function classifyWindow(input: {
  totalDamage: number;
  hitCount: number;
  peakHitDamage: number;
  rollingDamageSum: number;
  maxHp: number | null;
  hasDeath: boolean;
  config: SurvivalOneFightPressureConfig;
}): { windowClass: PressureWindowClass; facts: {
  sustainedByRollingThreshold: boolean;
  sustainedByHitDensity: boolean;
  isolatedByLowAbsoluteDamage: boolean;
  rollingDamageRatioOfMaxHp: number | null;
  peakHitRatioOfMaxHp: number | null;
} } {
  const { config } = input;
  const rollingRatio =
    input.maxHp != null && input.maxHp > 0
      ? input.rollingDamageSum / input.maxHp
      : null;
  const peakRatio =
    input.maxHp != null && input.maxHp > 0 ? input.peakHitDamage / input.maxHp : null;

  const sustainedByRollingThreshold =
    rollingRatio != null
      ? rollingRatio >= config.rollingDamageRatioOfMaxHp
      : input.rollingDamageSum >= config.absolute.sustainedRollingDamage;

  const sustainedByHitDensity =
    input.hitCount >= config.absolute.sustainedMinHits &&
    (rollingRatio != null
      ? rollingRatio >= config.rollingDamageRatioOfMaxHp * 0.5
      : input.rollingDamageSum >= config.absolute.sustainedRollingDamage * 0.5);

  const largeHit =
    peakRatio != null
      ? peakRatio >= config.largeHitRatioOfMaxHp
      : input.peakHitDamage >= config.absolute.isolatedPeakHitMax;

  const isolatedByLowAbsoluteDamage =
    input.hitCount <= 1 &&
    input.totalDamage <= config.absolute.isolatedTotalDamageMax &&
    input.peakHitDamage <= config.absolute.isolatedPeakHitMax &&
    !sustainedByRollingThreshold;

  let windowClass: PressureWindowClass;
  if (input.hasDeath && (sustainedByRollingThreshold || sustainedByHitDensity || largeHit)) {
    windowClass = "FATAL_PRESSURE";
  } else if (input.hasDeath) {
    windowClass = "FATAL_PRESSURE";
  } else if (sustainedByRollingThreshold || sustainedByHitDensity) {
    windowClass = "SUSTAINED_PRESSURE";
  } else if (input.hitCount <= 1) {
    // Single-hit spikes (including large hits) remain isolated — never sustained.
    windowClass = "ISOLATED_DAMAGE";
  } else if (isolatedByLowAbsoluteDamage) {
    windowClass = "ISOLATED_DAMAGE";
  } else {
    windowClass = "ISOLATED_DAMAGE";
  }

  return {
    windowClass,
    facts: {
      sustainedByRollingThreshold,
      sustainedByHitDensity,
      isolatedByLowAbsoluteDamage,
      rollingDamageRatioOfMaxHp: rollingRatio,
      peakHitRatioOfMaxHp: peakRatio,
    },
  };
}

function victimActorId(event: CapabilityCompactEvent): number | null {
  return event.targetPlayerActorId ?? event.targetActorId;
}

export function collectDamageTakenPoints(
  events: readonly CapabilityCompactEvent[],
  playerIds: ReadonlySet<number>,
): DamageTakenPoint[] {
  const out: DamageTakenPoint[] = [];
  for (const e of events) {
    if (!e.capabilities.includes("SURVIVAL_DAMAGE_TAKEN")) continue;
    if (e.dataset !== "DamageTaken") continue;
    const victim = victimActorId(e);
    if (victim == null || !playerIds.has(victim)) continue;
    out.push({
      eventId: e.eventId,
      timestampMs: e.timestampMs,
      amount: Math.max(0, e.amount ?? 0),
      participantActorId: victim,
      maxHpHint:
        e.maxHitPoints != null && Number.isFinite(e.maxHitPoints) && e.maxHitPoints > 0
          ? e.maxHitPoints
          : null,
    });
  }
  return out.sort(
    (a, b) =>
      a.participantActorId - b.participantActorId ||
      a.timestampMs - b.timestampMs ||
      a.eventId.localeCompare(b.eventId),
  );
}

interface RawSegment {
  participantActorId: number;
  startMs: number;
  endMs: number;
  points: DamageTakenPoint[];
  rollingDamageSum: number;
  maxHp: number | null;
}

/**
 * Build candidate sustained/isolated segments per participant using rolling sums.
 */
export function deriveRawPressureSegments(input: {
  points: DamageTakenPoint[];
  config?: SurvivalOneFightPressureConfig;
}): RawSegment[] {
  const config = input.config ?? SURVIVAL_ONE_FIGHT_PRESSURE_CONFIG;
  const byParticipant = new Map<number, DamageTakenPoint[]>();
  for (const p of input.points) {
    const list = byParticipant.get(p.participantActorId) ?? [];
    list.push(p);
    byParticipant.set(p.participantActorId, list);
  }

  const segments: RawSegment[] = [];

  for (const [participantActorId, points] of byParticipant) {
    if (points.length === 0) continue;

    // Emit a segment for every rolling-window end that crosses sustained threshold,
    // plus isolated single-hit candidates that never join a sustained segment.
    let left = 0;
    let sum = 0;

    for (let right = 0; right < points.length; right += 1) {
      const endTs = points[right]!.timestampMs;
      sum += points[right]!.amount;
      while (left <= right && endTs - points[left]!.timestampMs > config.rollingWindowMs) {
        sum -= points[left]!.amount;
        left += 1;
      }
      const windowPoints = points.slice(left, right + 1);
      const maxHp =
        windowPoints.map((p) => p.maxHpHint).find((h) => h != null && h > 0) ?? null;
      const classified = classifyWindow({
        totalDamage: sum,
        hitCount: windowPoints.length,
        peakHitDamage: Math.max(0, ...windowPoints.map((p) => p.amount)),
        rollingDamageSum: sum,
        maxHp,
        hasDeath: false,
        config,
      });
      if (
        classified.facts.sustainedByRollingThreshold ||
        classified.facts.sustainedByHitDensity
      ) {
        segments.push({
          participantActorId,
          startMs: windowPoints[0]!.timestampMs,
          endMs: endTs,
          points: windowPoints,
          rollingDamageSum: sum,
          maxHp,
        });
      }
    }

    // Large isolated spikes only — low isolated damage is retained in totals,
    // not promoted to a pressure window (and never to sustained pressure).
    const covered = new Set<string>();
    for (const seg of segments) {
      if (seg.participantActorId !== participantActorId) continue;
      for (const p of seg.points) covered.add(p.eventId);
    }
    for (const p of points) {
      if (covered.has(p.eventId)) continue;
      const classified = classifyWindow({
        totalDamage: p.amount,
        hitCount: 1,
        peakHitDamage: p.amount,
        rollingDamageSum: p.amount,
        maxHp: p.maxHpHint,
        hasDeath: false,
        config,
      });
      if (classified.facts.isolatedByLowAbsoluteDamage) {
        continue;
      }
      const largeHit =
        classified.facts.peakHitRatioOfMaxHp != null
          ? classified.facts.peakHitRatioOfMaxHp >= config.largeHitRatioOfMaxHp
          : p.amount >= config.absolute.isolatedPeakHitMax;
      if (!largeHit && classified.windowClass !== "SUSTAINED_PRESSURE") {
        continue;
      }
      segments.push({
        participantActorId,
        startMs: p.timestampMs,
        endMs: p.timestampMs,
        points: [p],
        rollingDamageSum: p.amount,
        maxHp: p.maxHpHint,
      });
    }
  }

  return mergeSegments(segments, config);
}

function mergeSegments(
  segments: RawSegment[],
  config: SurvivalOneFightPressureConfig,
): RawSegment[] {
  const byParticipant = new Map<number, RawSegment[]>();
  for (const s of segments) {
    const list = byParticipant.get(s.participantActorId) ?? [];
    list.push(s);
    byParticipant.set(s.participantActorId, list);
  }
  const merged: RawSegment[] = [];
  for (const [, list] of byParticipant) {
    list.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const out: RawSegment[] = [];
    for (const seg of list) {
      const prev = out[out.length - 1];
      if (prev && seg.startMs - prev.endMs <= config.mergeGapMs) {
        const pointMap = new Map(prev.points.map((p) => [p.eventId, p]));
        for (const p of seg.points) pointMap.set(p.eventId, p);
        prev.points = [...pointMap.values()].sort(
          (a, b) => a.timestampMs - b.timestampMs || a.eventId.localeCompare(b.eventId),
        );
        prev.startMs = Math.min(prev.startMs, seg.startMs);
        prev.endMs = Math.max(prev.endMs, seg.endMs);
        prev.rollingDamageSum = prev.points.reduce((s, p) => s + p.amount, 0);
        prev.maxHp = prev.maxHp ?? seg.maxHp;
      } else {
        out.push({ ...seg, points: [...seg.points] });
      }
    }
    merged.push(...out);
  }
  return merged;
}

function responseForWindow(input: {
  windowId: string;
  participantActorId: number;
  startMs: number;
  endMs: number;
  activations: SurvivalCanonicalActivation[];
  deaths: SurvivalDeathEvent[];
  config: SurvivalOneFightPressureConfig;
}): PressureWindowV1["response"] {
  const { config } = input;
  const before: string[] = [];
  const during: string[] = [];
  const recovery: string[] = [];
  const externals: string[] = [];
  const deathIds: string[] = [];

  for (const a of input.activations) {
    if (a.participantActorId !== input.participantActorId) continue;
    const t = a.rawTimestampMs;
    if (a.activationKind === "EXTERNAL_DEFENSIVE_RECEIVED") {
      if (
        t >= input.startMs - config.response.beforeLookbackMs &&
        t <= input.endMs + config.response.afterRecoveryLookaheadMs
      ) {
        externals.push(a.canonicalActivationId);
      }
      continue;
    }
    if (a.activationKind === "PERSONAL_DEFENSIVE") {
      if (
        t >= input.startMs - config.response.beforeLookbackMs &&
        t < input.startMs
      ) {
        before.push(a.canonicalActivationId);
      } else if (
        t >= input.startMs - config.response.duringSlackMs &&
        t <= input.endMs + config.response.duringSlackMs
      ) {
        during.push(a.canonicalActivationId);
      }
    }
    if (a.activationKind === "RECOVERY") {
      if (
        t > input.endMs &&
        t <= input.endMs + config.response.afterRecoveryLookaheadMs
      ) {
        recovery.push(a.canonicalActivationId);
      } else if (
        t >= input.startMs &&
        t <= input.endMs + config.response.duringSlackMs
      ) {
        recovery.push(a.canonicalActivationId);
      }
    }
  }

  for (const d of input.deaths) {
    if (d.participantActorId !== input.participantActorId) continue;
    if (
      d.rawTimestampMs >= input.startMs - config.response.duringSlackMs &&
      d.rawTimestampMs <= input.endMs + config.response.afterRecoveryLookaheadMs
    ) {
      deathIds.push(d.deathEventId);
    }
  }

  return {
    defensivesBefore: before,
    defensivesDuring: during,
    recoveryAfter: recovery,
    externalDefensivesReceived: externals,
    deathEventIds: deathIds,
    noPersonalDefensiveResponse: before.length === 0 && during.length === 0,
    noRecoveryResponse: recovery.length === 0,
  };
}

export function buildPressureWindows(input: {
  source: SurvivalProbeSourceIdentity;
  participants: SurvivalProbeParticipant[];
  damageEvents: readonly CapabilityCompactEvent[];
  activations: SurvivalCanonicalActivation[];
  deaths: SurvivalDeathEvent[];
  packageContentHash: string;
  config?: SurvivalOneFightPressureConfig;
}): {
  windows: PressureWindowV1[];
  timeline: PressureWindowTimelineV1;
  updatedActivations: SurvivalCanonicalActivation[];
  updatedDeaths: SurvivalDeathEvent[];
} {
  const config = input.config ?? SURVIVAL_ONE_FIGHT_PRESSURE_CONFIG;
  const playerIds = new Set(input.participants.map((p) => p.playerActorId));
  const nameById = new Map(input.participants.map((p) => [p.playerActorId, p.characterName]));
  const points = collectDamageTakenPoints(input.damageEvents, playerIds);
  const segments = deriveRawPressureSegments({ points, config });

  // Attach deaths that fall outside any segment as DEATH_WITHOUT_PRESSURE_CONTEXT.
  const deathOnlySegments: RawSegment[] = [];
  for (const death of input.deaths) {
    const covered = segments.some(
      (s) =>
        s.participantActorId === death.participantActorId &&
        death.rawTimestampMs >= s.startMs - config.response.duringSlackMs &&
        death.rawTimestampMs <= s.endMs + config.response.afterRecoveryLookaheadMs,
    );
    if (!covered) {
      deathOnlySegments.push({
        participantActorId: death.participantActorId,
        startMs: death.rawTimestampMs,
        endMs: death.rawTimestampMs,
        points: [],
        rollingDamageSum: 0,
        maxHp: null,
      });
    }
  }

  const allSegments = [...segments, ...deathOnlySegments].sort(
    (a, b) =>
      a.participantActorId - b.participantActorId ||
      a.startMs - b.startMs ||
      a.endMs - b.endMs,
  );

  const windows: PressureWindowV1[] = [];
  let seq = 0;
  for (const seg of allSegments) {
    seq += 1;
    const endMs = seg.endMs + (seg.points.length > 0 ? config.trailingQuietMs : 0);
    const totalDamage = seg.points.reduce((s, p) => s + p.amount, 0);
    const peakHitDamage =
      seg.points.length === 0 ? 0 : Math.max(0, ...seg.points.map((p) => p.amount));
    const hasDeathNearby = input.deaths.some(
      (d) =>
        d.participantActorId === seg.participantActorId &&
        d.rawTimestampMs >= seg.startMs - config.response.duringSlackMs &&
        d.rawTimestampMs <= endMs + config.response.afterRecoveryLookaheadMs,
    );

    const limitations: string[] = [];
    if (seg.maxHp == null) limitations.push("MAX_HP_CONTEXT_UNAVAILABLE");
    if (seg.points.some((p) => p.amount === 0)) {
      limitations.push("SOME_DAMAGE_AMOUNTS_MISSING_OR_ZERO");
    }

    const classified =
      seg.points.length === 0 && hasDeathNearby
        ? {
            windowClass: "DEATH_WITHOUT_PRESSURE_CONTEXT" as const,
            facts: {
              sustainedByRollingThreshold: false,
              sustainedByHitDensity: false,
              isolatedByLowAbsoluteDamage: false,
              rollingDamageRatioOfMaxHp: null,
              peakHitRatioOfMaxHp: null,
            },
          }
        : classifyWindow({
            totalDamage,
            hitCount: seg.points.length,
            peakHitDamage,
            rollingDamageSum: seg.rollingDamageSum,
            maxHp: seg.maxHp,
            hasDeath: hasDeathNearby,
            config,
          });

    const pressureWindowId = [
      input.source.reportCode,
      input.source.fightId,
      input.source.reportRevision,
      seg.participantActorId,
      "pw",
      seg.startMs,
      seq,
    ].join(":");

    const response = responseForWindow({
      windowId: pressureWindowId,
      participantActorId: seg.participantActorId,
      startMs: seg.startMs,
      endMs,
      activations: input.activations,
      deaths: input.deaths,
      config,
    });

    windows.push({
      pressureWindowId,
      participantActorId: seg.participantActorId,
      characterName: nameById.get(seg.participantActorId) ?? `actor:${seg.participantActorId}`,
      windowClass: classified.windowClass,
      derivation: {
        derivationVersion: PRESSURE_WINDOW_DERIVATION_VERSION,
        configVersion: config.version,
        windowStartMs: seg.startMs,
        windowEndMs: endMs,
        fightOffsetStartMs: Math.max(0, seg.startMs - input.source.fightStartMs),
        fightOffsetEndMs: Math.max(0, endMs - input.source.fightStartMs),
        totalDamage,
        hitCount: seg.points.length,
        peakHitDamage,
        rollingWindowMs: config.rollingWindowMs,
        rollingDamageSum: seg.rollingDamageSum,
        maxHpUsed: seg.maxHp,
        rollingDamageRatioOfMaxHp: classified.facts.rollingDamageRatioOfMaxHp,
        peakHitRatioOfMaxHp: classified.facts.peakHitRatioOfMaxHp,
        sustainedByRollingThreshold: classified.facts.sustainedByRollingThreshold,
        sustainedByHitDensity: classified.facts.sustainedByHitDensity,
        isolatedByLowAbsoluteDamage: classified.facts.isolatedByLowAbsoluteDamage,
        evidenceEventIds: seg.points.map((p) => p.eventId),
      },
      response,
      limitations,
    });
  }

  const updatedActivations = input.activations.map((a) => {
    const related = windows.find((w) => {
      if (w.participantActorId !== a.participantActorId) return false;
      const ids = [
        ...w.response.defensivesBefore,
        ...w.response.defensivesDuring,
        ...w.response.recoveryAfter,
        ...w.response.externalDefensivesReceived,
      ];
      return ids.includes(a.canonicalActivationId);
    });
    if (!related) {
      return { ...a, relatedPressureWindowId: null, responseRelation: "UNRELATED" as const };
    }
    let responseRelation: SurvivalCanonicalActivation["responseRelation"] = "UNRELATED";
    if (related.response.defensivesBefore.includes(a.canonicalActivationId)) {
      responseRelation = "BEFORE_PRESSURE";
    } else if (related.response.defensivesDuring.includes(a.canonicalActivationId)) {
      responseRelation = "DURING_PRESSURE";
    } else if (related.response.recoveryAfter.includes(a.canonicalActivationId)) {
      responseRelation = "AFTER_PRESSURE_RECOVERY";
    } else if (related.response.externalDefensivesReceived.includes(a.canonicalActivationId)) {
      responseRelation = "EXTERNAL_RECEIVED";
    }
    return {
      ...a,
      relatedPressureWindowId: related.pressureWindowId,
      responseRelation,
    };
  });

  const updatedDeaths = input.deaths.map((d) => {
    const related = windows.find(
      (w) =>
        w.participantActorId === d.participantActorId &&
        w.response.deathEventIds.includes(d.deathEventId),
    );
    return {
      ...d,
      relatedPressureWindowId: related?.pressureWindowId ?? null,
    };
  });

  const runLimitations = [
    ...new Set(windows.flatMap((w) => w.limitations)),
  ].sort();

  const withoutHash: Omit<PressureWindowTimelineV1, "contentHash"> = {
    schemaVersion: "pressure-window-timeline-v1",
    sourceKey: {
      reportCode: input.source.reportCode,
      fightId: input.source.fightId,
      reportRevision: input.source.reportRevision,
    },
    derivationVersion: PRESSURE_WINDOW_DERIVATION_VERSION,
    configVersion: config.version,
    capabilityEvidencePackageContentHash: input.packageContentHash,
    windows,
    limitations: runLimitations,
  };

  return {
    windows,
    timeline: {
      ...withoutHash,
      contentHash: hashPressureWindowTimelinePayload(withoutHash),
    },
    updatedActivations,
    updatedDeaths,
  };
}
