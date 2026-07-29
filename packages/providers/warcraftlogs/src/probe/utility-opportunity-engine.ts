/**
 * Utility V3.2 opportunity extraction engine (offline).
 * Consumes persisted probe artifacts / future shared evidence bundles.
 * Never fetches WCL.
 */
import type { AbilityCatalog } from "@mplus/abilities";
import { getAbilityCatalog, spellIdsForCategory } from "@mplus/abilities";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import type { UtilityV2RawRunBundle } from "./utility-v2-types.js";
import type {
  OpportunityExtractionCoverage,
  RawEvidenceAuditFinding,
  SupportSemanticClass,
  UtilityOpportunity,
  UtilityOpportunityConfidence,
  UtilityOpportunityOutcome,
} from "./utility-opportunity-types.js";

/** Minimal mechanic rule shape — avoids hard dependency on @mplus/mechanics at build time. */
export interface UtilityMechanicRule {
  spellId: number;
  dungeonSlug: string;
  ruleType: string;
  severity: number;
  active: boolean;
}

export interface UtilityMechanicCatalogLike {
  rules: UtilityMechanicRule[];
}

const DEFAULT_CAST_WINDOW_MS = 2500;

/**
 * True when the player is dead at any point overlapping [windowStartMs, windowEndMs].
 * Death at or before windowStart sticks through the window (simple sticky-death model).
 */
export function isPlayerDeadDuringWindow(
  deathEvents: Array<{ type?: string; timestamp?: number; targetID?: number }>,
  playerActorId: number,
  windowStartMs: number,
  windowEndMs: number,
): boolean {
  const deaths = deathEvents
    .filter((ev) => ev.targetID === playerActorId && typeof ev.timestamp === "number")
    .map((ev) => ev.timestamp as number)
    .sort((a, b) => a - b);
  for (const ts of deaths) {
    if (ts <= windowEndMs && ts >= Math.min(windowStartMs, windowEndMs)) return true;
    if (ts <= windowStartMs) return true;
  }
  return false;
}

function isNpcSourceType(type: string | null | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return t === "npc" || t === "boss" || t === "unknown";
}

function isFriendlyClassType(type: string | null | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return ![
    "npc",
    "boss",
    "pet",
    "guardian",
    "environment",
    "unknown",
  ].includes(t);
}

function eventAbilityId(ev: Record<string, unknown>): number | null {
  const flat = ev.abilityGameID;
  if (typeof flat === "number") return flat;
  const ability = ev.ability as { guid?: number } | undefined;
  return typeof ability?.guid === "number" ? ability.guid : null;
}

function eventSourceId(ev: Record<string, unknown>): number | null {
  if (typeof ev.sourceID === "number") return ev.sourceID;
  const source = ev.source as { id?: number } | undefined;
  return typeof source?.id === "number" ? source.id : null;
}

function eventTargetId(ev: Record<string, unknown>): number | null {
  if (typeof ev.targetID === "number") return ev.targetID;
  const target = ev.target as { id?: number } | undefined;
  return typeof target?.id === "number" ? target.id : null;
}

function eventSourceType(ev: Record<string, unknown>): string | null {
  const source = ev.source as { type?: string } | undefined;
  return source?.type ?? null;
}

function eventExtraAbilityId(ev: Record<string, unknown>): number | null {
  const extra = ev.extraAbility as { guid?: number } | undefined;
  if (typeof extra?.guid === "number") return extra.guid;
  if (typeof ev.extraAbilityGameID === "number") return ev.extraAbilityGameID as number;
  return null;
}

export function classifySupportSemantic(input: {
  abilityGameId: number | null;
  abilityName: string | null;
  kind: string;
  tier: string;
  targetActorId: number | null;
  playerActorId: number | null;
  correlationNotes: string[];
  catalog: AbilityCatalog;
}): SupportSemanticClass {
  const name = (input.abilityName ?? "").toLowerCase();
  const notes = input.correlationNotes;
  const selfTarget =
    input.playerActorId != null &&
    input.targetActorId != null &&
    input.targetActorId === input.playerActorId;

  const mobilityIds = new Set<number>([
    ...spellIdsForCategory(input.catalog, "MOVEMENT_UTILITY", {}),
  ]);
  if (input.abilityGameId != null && mobilityIds.has(input.abilityGameId)) {
    return "PERSONAL_MOBILITY";
  }
  // Generic personal-mobility heuristics (no class branch): blink/shimmer/roll names + self/unknown target
  if (
    /shimmer|blink|roll|disengage|charge$|ghost wolf|spiritwalker's grace|dash|sprint/.test(
      name,
    ) &&
    (selfTarget || input.targetActorId == null || input.targetActorId < 0)
  ) {
    return "PERSONAL_MOBILITY";
  }

  if (input.kind === "DISPEL" || input.kind === "PURGE") {
    if (input.tier === "CONFIRMED_IMPACT") {
      // Transparent: root/snare removal via "Rescue"-like abilities still reactive, not generic heal
      if (/rescue|secourir/.test(name)) return "REACTIVE_SUPPORT";
      return "REACTIVE_SUPPORT";
    }
    return "ROUTINE_ROTATIONAL_SUPPORT";
  }
  if (input.kind === "BATTLE_REZ") {
    return input.tier === "CONFIRMED_IMPACT" ? "EMERGENCY_SUPPORT" : "STRATEGIC_SUPPORT";
  }
  if (input.kind === "EXTERNAL") {
    if (selfTarget) return "PERSONAL_MOBILITY";
    if (input.tier === "CONFIRMED_IMPACT") return "STRATEGIC_SUPPORT";
    if (
      notes.includes("value_not_inferable_from_cast_alone") ||
      notes.includes("cast_observed")
    ) {
      return "UNVERIFIED_EXTERNAL";
    }
    return "ROUTINE_ROTATIONAL_SUPPORT";
  }
  return "UNVERIFIED_EXTERNAL";
}

interface HostileCastWindow {
  sourceId: number;
  abilityGameId: number;
  start: number;
  end: number | null;
  interruptible: boolean | null;
  completed: boolean | null;
  interrupted: boolean;
}

function buildHostileCastWindows(
  castEvents: Array<Record<string, unknown>>,
): HostileCastWindow[] {
  const open = new Map<string, HostileCastWindow>();
  const closed: HostileCastWindow[] = [];

  for (const ev of castEvents) {
    const sourceId = eventSourceId(ev);
    const abilityGameId = eventAbilityId(ev);
    const sourceType = eventSourceType(ev);
    if (sourceId == null || abilityGameId == null) continue;
    if (!isNpcSourceType(sourceType)) continue;

    const key = `${sourceId}:${abilityGameId}`;
    const type = String(ev.type ?? "");
    const ts = typeof ev.timestamp === "number" ? ev.timestamp : null;
    if (ts == null) continue;
    const interruptible =
      typeof ev.interruptible === "boolean" ? ev.interruptible : null;

    if (type === "begincast") {
      open.set(key, {
        sourceId,
        abilityGameId,
        start: ts,
        end: null,
        interruptible,
        completed: null,
        interrupted: false,
      });
      continue;
    }

    const window = open.get(key);
    if (!window && (type === "cast" || type === "castfailed" || type === "interrupted")) {
      // Instant or unobserved begin — still candidate if interruptible or interrupted
      if (interruptible === true || type === "interrupted" || type === "castfailed") {
        closed.push({
          sourceId,
          abilityGameId,
          start: ts,
          end: ts,
          interruptible,
          completed: type === "cast",
          interrupted: type === "interrupted" || type === "castfailed",
        });
      }
      continue;
    }
    if (!window) continue;

    if (interruptible != null) window.interruptible = interruptible;
    window.end = ts;
    if (type === "cast") {
      window.completed = true;
      window.interrupted = false;
    } else if (type === "castfailed" || type === "interrupted") {
      window.completed = false;
      window.interrupted = true;
    }
    open.delete(key);
    closed.push(window);
  }

  for (const w of open.values()) closed.push(w);
  return closed;
}

function mechanicSeverity(
  spellId: number,
  dungeonSlug: string,
  mechanicCatalog: UtilityMechanicCatalogLike,
): number {
  const rules = mechanicCatalog.rules.filter(
    (r) =>
      r.active &&
      r.spellId === spellId &&
      (r.ruleType === "PRIORITY_INTERRUPT" || r.ruleType === "CROWD_CONTROL") &&
      (r.dungeonSlug === dungeonSlug || r.dungeonSlug === "*"),
  );
  if (rules.length === 0) return 0.55;
  return Math.min(1, Math.max(...rules.map((r) => r.severity / 100)));
}

/**
 * Extract opportunities from a single normalized run + raw bundle.
 */
export function extractRunOpportunities(input: {
  normalized: UtilityNormalizedRun;
  raw?: UtilityV2RawRunBundle | null;
  castEvents?: Array<Record<string, unknown>>;
  interruptEvents?: Array<Record<string, unknown>>;
  deathEvents?: Array<{ type?: string; timestamp?: number; targetID?: number }>;
  catalog?: AbilityCatalog;
  mechanicCatalog?: UtilityMechanicCatalogLike;
}): UtilityOpportunity[] {
  const catalog =
    input.catalog ??
    getAbilityCatalog({
      classSlug: input.normalized.classSlug,
      specSlug: input.normalized.specialization,
      includeRacials: true,
    });
  const mechanicCatalog = input.mechanicCatalog ?? { rules: [] };
  const runId = `${input.normalized.reportCode}:${input.normalized.fightId}`;
  const playerId = input.normalized.playerActorId;
  const kickIds = [...spellIdsForCategory(catalog, "INTERRUPT", {
    classSlug: input.normalized.classSlug,
    specSlug: input.normalized.specialization,
  })];
  const opportunities: UtilityOpportunity[] = [];

  const castEvents =
    input.castEvents ??
    (input.raw?.casts as Array<Record<string, unknown>> | undefined) ??
    [];
  const interruptRaw =
    input.interruptEvents ??
    (input.raw?.interrupts as Array<Record<string, unknown>> | undefined) ??
    [];
  const deathEvents =
    input.deathEvents ??
    ((input.raw as { deaths?: Array<{ type?: string; timestamp?: number; targetID?: number }> } | null)
      ?.deaths ??
      []);

  const hostileWindows = buildHostileCastWindows(castEvents);
  const attributed = new Set<number>([
    playerId,
    ...(input.normalized.petActorIds ?? []),
  ].filter((x): x is number => x != null));

  // --- Path A: full hostile cast windows (preferred) ---
  if (hostileWindows.length > 0) {
    for (let i = 0; i < hostileWindows.length; i += 1) {
      const w = hostileWindows[i]!;
      const windowEnd = w.end ?? w.start + DEFAULT_CAST_WINDOW_MS;
      const exclusionReasons: string[] = [];
      const evidence: string[] = [`hostile_cast_window:${w.abilityGameId}`];

      if (w.interruptible === false) {
        opportunities.push({
          id: `${runId}:int-opp:${i}:na`,
          runId,
          dungeonSlug: input.normalized.dungeonSlug,
          sourceActorId: w.sourceId,
          targetActorId: null,
          hostileSpellId: w.abilityGameId,
          abilityGameId: null,
          opportunityType: "interrupt",
          openedAt: w.start,
          closedAt: w.end,
          outcome: "NOT_APPLICABLE",
          confidence: "HIGH",
          severity: 0,
          eligibleActions: kickIds,
          exclusionReasons: ["cast_not_interruptible"],
          evidenceReferences: evidence,
          derivation: "hostile_cast_window",
        });
        continue;
      }

      if (
        playerId != null &&
        isPlayerDeadDuringWindow(deathEvents, playerId, w.start, windowEnd)
      ) {
        opportunities.push({
          id: `${runId}:int-opp:${i}:dead`,
          runId,
          dungeonSlug: input.normalized.dungeonSlug,
          sourceActorId: w.sourceId,
          targetActorId: null,
          hostileSpellId: w.abilityGameId,
          abilityGameId: null,
          opportunityType: "interrupt",
          openedAt: w.start,
          closedAt: w.end,
          outcome: "NOT_APPLICABLE",
          confidence: "HIGH",
          severity: 0,
          eligibleActions: kickIds,
          exclusionReasons: ["player_dead_during_window"],
          evidenceReferences: [...evidence, "player_dead_during_window"],
          derivation: "hostile_cast_window",
        });
        continue;
      }

      let confidence: UtilityOpportunityConfidence =
        w.interruptible === true ? "HIGH" : "MEDIUM";
      if (w.interruptible == null) {
        exclusionReasons.push("interruptible_flag_absent");
        confidence = "LOW";
      }

      const intsInWindow = interruptRaw.filter((ev) => {
        if (String(ev.type) !== "interrupt") return false;
        const ts = ev.timestamp as number;
        return ts >= w.start && ts <= windowEnd + 50 && eventTargetId(ev) === w.sourceId;
      });
      const playerInt = intsInWindow.find((ev) => {
        const sid = eventSourceId(ev);
        return sid != null && attributed.has(sid);
      });
      const otherInt = intsInWindow.find((ev) => {
        const sid = eventSourceId(ev);
        return sid != null && !attributed.has(sid) && isFriendlyClassType(eventSourceType(ev));
      });

      // Cooldown availability (best-effort)
      const kickCd =
        catalog.rules.find((r) => r.category === "INTERRUPT")?.cooldownSeconds ?? null;
      let onCooldown = false;
      if (kickCd != null) {
        const prior = interruptRaw.filter((ev) => {
          const sid = eventSourceId(ev);
          return (
            String(ev.type) === "interrupt" &&
            sid != null &&
            attributed.has(sid) &&
            (ev.timestamp as number) < w.start &&
            (ev.timestamp as number) >= w.start - kickCd * 1000
          );
        });
        onCooldown = prior.length > 0;
        evidence.push(onCooldown ? "player_on_cooldown" : "player_cooldown_available");
      } else {
        exclusionReasons.push("kick_cooldown_unknown");
        if (confidence === "HIGH") confidence = "MEDIUM";
      }

      let outcome: UtilityOpportunityOutcome = "NOT_OBSERVABLE";
      if (playerInt) {
        outcome = "SUCCESS_DIRECT_INTERRUPT";
        evidence.push("player_interrupt_in_window");
        confidence = "HIGH";
      } else if (otherInt) {
        outcome = "SUCCESS_OTHER_PLAYER";
        evidence.push("other_player_interrupted_first");
      } else if (w.interrupted) {
        outcome = "SUCCESS_ALTERNATIVE_STOP";
        evidence.push("cast_failed_or_interrupted_without_player_kick");
      } else if (
        w.completed === true &&
        !onCooldown &&
        (w.interruptible === true || confidence !== "LOW")
      ) {
        // Confirmed miss only with strong evidence
        if (w.interruptible === true && kickCd != null && !onCooldown) {
          outcome = "CAST_COMPLETED_CONFIRMED_MISS";
          evidence.push("dangerous_cast_completed_player_available");
          confidence = "HIGH";
        } else if (w.interruptible === true) {
          outcome = "CAST_COMPLETED_CONFIRMED_MISS";
          confidence = "MEDIUM";
          exclusionReasons.push("cooldown_or_range_uncertain");
        } else {
          outcome = "NOT_OBSERVABLE";
          exclusionReasons.push("insufficient_miss_confidence");
        }
      } else if (onCooldown) {
        outcome = "NOT_APPLICABLE";
        exclusionReasons.push("player_on_cooldown");
      } else {
        outcome = "NOT_OBSERVABLE";
        exclusionReasons.push("insufficient_hostile_cast_interruptibility_evidence");
      }

      // Uncertain opportunities never become confirmed misses
      if (outcome === "CAST_COMPLETED_CONFIRMED_MISS" && confidence === "LOW") {
        outcome = "NOT_OBSERVABLE";
        exclusionReasons.push("downgraded_uncertain_miss");
      }

      opportunities.push({
        id: `${runId}:int-opp:${i}`,
        runId,
        dungeonSlug: input.normalized.dungeonSlug,
        sourceActorId: w.sourceId,
        targetActorId: null,
        hostileSpellId: w.abilityGameId,
        abilityGameId: playerInt ? eventAbilityId(playerInt) : null,
        opportunityType: "interrupt",
        openedAt: w.start,
        closedAt: w.end,
        outcome,
        confidence,
        severity: mechanicSeverity(w.abilityGameId, input.normalized.dungeonSlug, mechanicCatalog),
        eligibleActions: kickIds,
        exclusionReasons,
        evidenceReferences: evidence,
        derivation: "hostile_cast_window",
      });
    }
  }

  // --- Path B: success-only implied from player interrupt events (no miss denominator) ---
  const playerInterruptEvents = input.normalized.interruptEvents.filter(
    (e) => e.sourceKind === "PLAYER" || e.sourceKind === "OWNED_PET",
  );
  if (hostileWindows.length === 0) {
    for (let i = 0; i < playerInterruptEvents.length; i += 1) {
      const ev = playerInterruptEvents[i]!;
      const hostileSpellId = ev.interruptedSpellId;
      opportunities.push({
        id: `${runId}:int-success-implied:${i}`,
        runId,
        dungeonSlug: input.normalized.dungeonSlug,
        sourceActorId: ev.targetID,
        targetActorId: ev.targetID,
        hostileSpellId,
        abilityGameId: ev.abilityGameID,
        opportunityType: "interrupt",
        openedAt: ev.timestamp - DEFAULT_CAST_WINDOW_MS,
        closedAt: ev.timestamp,
        outcome: "SUCCESS_DIRECT_INTERRUPT",
        confidence: "MEDIUM",
        severity:
          hostileSpellId != null
            ? mechanicSeverity(hostileSpellId, input.normalized.dungeonSlug, mechanicCatalog)
            : 0.5,
        eligibleActions: kickIds,
        exclusionReasons: [
          "hostile_cast_stream_absent",
          "success_only_reconstruction_no_miss_denominator",
        ],
        evidenceReferences: [
          `interrupt_event:${ev.abilityGameID}`,
          hostileSpellId != null ? `extra_ability:${hostileSpellId}` : "extra_ability_absent",
        ],
        derivation: "success_only_implied",
      });
    }
  }

  // --- Dispel / purge opportunities from normalized stream ---
  for (let i = 0; i < input.normalized.dispelPurgeOpportunities.length; i += 1) {
    const opp = input.normalized.dispelPurgeOpportunities[i]!;
    const applyTs = opp.auraApplyTimestamp;
    if (applyTs == null) continue;
    const windowEnd = applyTs + (opp.reactionWindowMs ?? 8000);
    const matched = input.normalized.dispelPurgeEvents.find(
      (e) =>
        e.timestamp >= applyTs &&
        e.timestamp <= windowEnd + 50 &&
        (opp.auraTargetId == null || e.targetID === opp.auraTargetId),
    );
    let outcome: UtilityOpportunityOutcome = "NOT_OBSERVABLE";
    if (matched || opp.removedByPlayer) {
      outcome = "SUCCESS_REACTIVE_SUPPORT";
    } else if (opp.removedByOther) {
      outcome = "SUCCESS_OTHER_PLAYER";
    } else if (opp.status === "PLAYER_AVAILABLE" && opp.playerAbilityAvailable === true) {
      // Available but not proven completed harm — keep NOT_OBSERVABLE unless expired evidence
      outcome = "NOT_OBSERVABLE";
    } else if (opp.status === "UNRESOLVED" || opp.status === "RAW_EVIDENCE_ONLY") {
      outcome = "NOT_OBSERVABLE";
    } else if (opp.status === "CANDIDATE") {
      outcome = "NOT_OBSERVABLE";
    } else {
      outcome = "NOT_APPLICABLE";
    }

    opportunities.push({
      id: `${runId}:dispel-opp:${i}`,
      runId,
      dungeonSlug: input.normalized.dungeonSlug,
      sourceActorId: null,
      targetActorId: opp.auraTargetId,
      hostileSpellId: opp.auraAbilityGameId,
      abilityGameId: matched?.abilityGameID ?? null,
      opportunityType: opp.kind === "PURGE" ? "purge" : "dispel",
      openedAt: applyTs,
      closedAt: windowEnd,
      outcome,
      confidence: matched || opp.removedByPlayer ? "HIGH" : "LOW",
      severity: 0.6,
      eligibleActions: [
        ...spellIdsForCategory(catalog, "DISPEL", {}),
        ...spellIdsForCategory(catalog, "PURGE", {}),
      ],
      exclusionReasons: matched || opp.removedByPlayer ? [] : ["no_confirmed_player_dispel_response"],
      evidenceReferences: [`dispel_opportunity:${opp.id}`, ...opp.evidence],
      derivation: "dispel_aura_window",
      semanticClass: matched || opp.removedByPlayer ? "REACTIVE_SUPPORT" : null,
    });
  }

  return opportunities;
}

export function summarizeOpportunityCoverage(
  character: string,
  opportunities: UtilityOpportunity[],
  meta: {
    runs: number;
    dungeons: number;
    hostileCastWindowsAvailable: boolean;
    mechanicCatalogPriorityInterrupts: number;
  },
): OpportunityExtractionCoverage {
  const byType: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  const byDerivation: Record<string, number> = {};
  for (const o of opportunities) {
    byType[o.opportunityType] = (byType[o.opportunityType] ?? 0) + 1;
    byOutcome[o.outcome] = (byOutcome[o.outcome] ?? 0) + 1;
    byConfidence[o.confidence] = (byConfidence[o.confidence] ?? 0) + 1;
    byDerivation[o.derivation] = (byDerivation[o.derivation] ?? 0) + 1;
  }

  const missingData: OpportunityExtractionCoverage["missingData"] = [];
  if (!meta.hostileCastWindowsAvailable) {
    missingData.push({
      opportunityType: "interrupt",
      classification: "event_stream_missing",
      detail:
        "Persisted Casts contain only friendly player casts (no NPC begincast/cast/castfailed). Confirmed interrupt misses cannot be derived offline. filterSourceId may be null but NPC sources are absent.",
    });
  }
  if (meta.mechanicCatalogPriorityInterrupts === 0) {
    missingData.push({
      opportunityType: "interrupt",
      classification: "mechanic_catalog_missing",
      detail:
        "Active-season PRIORITY_INTERRUPT mechanic catalog is empty/seed-only; severity falls back to heuristic defaults.",
    });
  }
  missingData.push({
    opportunityType: "mechanic_avoidance",
    classification: "extraction_logic_missing",
    detail: "V3.2 extracts interrupt/dispel first; mechanic-avoidance opportunities deferred.",
  });

  return {
    character,
    runs: meta.runs,
    dungeons: meta.dungeons,
    byType,
    byOutcome,
    byConfidence,
    byDerivation,
    interruptSuccessImplied: opportunities.filter(
      (o) =>
        o.opportunityType === "interrupt" &&
        o.derivation === "success_only_implied" &&
        o.outcome === "SUCCESS_DIRECT_INTERRUPT",
    ).length,
    interruptConfirmedMisses: opportunities.filter(
      (o) => o.outcome === "CAST_COMPLETED_CONFIRMED_MISS",
    ).length,
    interruptNotObservable: opportunities.filter(
      (o) => o.opportunityType === "interrupt" && o.outcome === "NOT_OBSERVABLE",
    ).length,
    hostileCastWindowsAvailable: meta.hostileCastWindowsAvailable,
    mechanicCatalogPriorityInterrupts: meta.mechanicCatalogPriorityInterrupts,
    missingData,
  };
}

export function auditRawEvidenceForCharacter(input: {
  character: string;
  castRuns: Array<{ dataset?: { events?: Array<Record<string, unknown>>; filterSourceId?: number | null } }>;
  interruptRuns: Array<{ dataset?: { events?: Array<Record<string, unknown>> } }>;
  buffRuns?: Array<{ buffs?: { events?: Array<Record<string, unknown>> }; debuffs?: { events?: Array<Record<string, unknown>> } }>;
  dispelRuns?: Array<{ dataset?: { events?: Array<Record<string, unknown>> } }>;
  normalizedRuns: UtilityNormalizedRun[];
  deathsArtifactPresent: boolean;
}): RawEvidenceAuditFinding {
  let castsEventCount = 0;
  let castsNpcSourceCount = 0;
  let castsFriendlySourceCount = 0;
  let castsInterruptibleFlagCount = 0;
  let castFailedOrInterruptedCount = 0;
  let filterSourceId: number | null = null;

  for (const run of input.castRuns) {
    if (run.dataset?.filterSourceId != null) filterSourceId = run.dataset.filterSourceId;
    for (const ev of run.dataset?.events ?? []) {
      castsEventCount += 1;
      const st = eventSourceType(ev);
      if (isNpcSourceType(st)) castsNpcSourceCount += 1;
      else if (isFriendlyClassType(st)) castsFriendlySourceCount += 1;
      if (typeof ev.interruptible === "boolean") castsInterruptibleFlagCount += 1;
      const t = String(ev.type ?? "");
      if (t === "castfailed" || t === "interrupted") castFailedOrInterruptedCount += 1;
    }
  }

  let interruptEventCount = 0;
  let playerInterruptEventCount = 0;
  const extras = new Set<number>();
  const playerIds = new Set(
    input.normalizedRuns.map((r) => r.playerActorId).filter((x): x is number => x != null),
  );
  for (const run of input.interruptRuns) {
    for (const ev of run.dataset?.events ?? []) {
      if (String(ev.type) !== "interrupt") continue;
      interruptEventCount += 1;
      const sid = eventSourceId(ev);
      if (sid != null && playerIds.has(sid)) playerInterruptEventCount += 1;
      const extra = eventExtraAbilityId(ev);
      if (extra != null) extras.add(extra);
    }
  }

  let dispelEventCount = 0;
  for (const run of input.dispelRuns ?? []) {
    dispelEventCount += run.dataset?.events?.length ?? 0;
  }
  let buffEventCount = 0;
  let debuffEventCount = 0;
  for (const run of input.buffRuns ?? []) {
    buffEventCount += run.buffs?.events?.length ?? 0;
    debuffEventCount += run.debuffs?.events?.length ?? 0;
  }

  const interruptOpportunitiesPersisted = input.normalizedRuns.reduce(
    (s, r) => s + (r.interruptOpportunities?.length ?? 0),
    0,
  );
  const dispelOpportunitiesPersisted = input.normalizedRuns.reduce(
    (s, r) => s + (r.dispelPurgeOpportunities?.length ?? 0),
    0,
  );

  const canDeriveInterruptMissesOffline = castsNpcSourceCount > 0;
  const canDeriveInterruptSuccessesOffline = playerInterruptEventCount > 0;
  const canDeriveDispelOpportunitiesOffline = dispelOpportunitiesPersisted > 0 || dispelEventCount > 0;

  const notes: string[] = [];
  if (castsNpcSourceCount === 0 && castsEventCount > 0) {
    notes.push(
      "Casts stream has friendly sources only — hostile NPC cast windows were never persisted.",
    );
  }
  if (castsInterruptibleFlagCount === 0) {
    notes.push("No cast event exposes interruptible=true/false in persisted artifacts.");
  }
  if (interruptOpportunitiesPersisted === 0 && playerInterruptEventCount > 0) {
    notes.push(
      "Persisted interruptOpportunities empty despite player interrupt events — expected without hostile cast windows.",
    );
  }

  return {
    character: input.character,
    castsEventCount,
    castsNpcSourceCount,
    castsFriendlySourceCount,
    castsInterruptibleFlagCount,
    castFailedOrInterruptedCount,
    interruptEventCount,
    playerInterruptEventCount,
    uniqueInterruptedHostileSpells: extras.size,
    dispelEventCount,
    buffEventCount,
    debuffEventCount,
    deathsArtifactPresent: input.deathsArtifactPresent,
    filterSourceId,
    interruptOpportunitiesPersisted,
    dispelOpportunitiesPersisted,
    canDeriveInterruptMissesOffline,
    canDeriveInterruptSuccessesOffline,
    canDeriveDispelOpportunitiesOffline,
    notes,
  };
}
