import type { AbilityCatalog, AbilityCategory } from "@mplus/abilities";
import { getAbilityCatalog, spellIdsForCategory } from "@mplus/abilities";
import { CURRENT_MPLUS_ZONE_DUNGEON_SLUGS } from "../discovery/run-discovery.js";
import { equalWeightMean, median } from "./survival-calibration-logic.js";
import { activeSeasonDungeonPool } from "./survival-probe-logic.js";
import { KNOWN_CROSS_STREAM_CC_IN_INTERRUPTS } from "./utility-catalog-audit.js";
import {
  attributedSourceIds,
  buildHostileValidatedByDamage,
  isBossActor,
  isHostileActor,
  preserveUtilityEvent,
} from "./utility-probe-logic.js";
import type {
  UtilityActorContext,
  UtilityNormalizedRun,
  UtilityPreservedEvent,
} from "./utility-probe-types.js";
import {
  UTILITY_V2_AUDIT_CONFIG,
  type UtilityV2AuditConfig,
  type UtilityV2DomainKey,
  type UtilityV2EvidenceTier,
} from "./utility-v2-config.js";
import type {
  UtilityV2AuditDataset,
  UtilityV2DomainEvidenceSummary,
  UtilityV2DungeonSimulatedScore,
  UtilityV2EvidenceItem,
  UtilityV2HostileCastWindow,
  UtilityV2RawRunBundle,
  UtilityV2RunAudit,
  UtilityV2ScenarioOptions,
  UtilityV2SensitivityScenarioResult,
} from "./utility-v2-types.js";

const DOMAIN_KEYS = Object.keys(
  UTILITY_V2_AUDIT_CONFIG.domainWeights,
) as UtilityV2DomainKey[];

function emptyTierCounts(): Record<UtilityV2EvidenceTier, number> {
  return { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 };
}

function eventType(row: Record<string, unknown>, preserved: UtilityPreservedEvent): string {
  const t = preserved.type ?? row.type;
  return typeof t === "string" ? t.toLowerCase() : "";
}

function interruptibleFlag(row: Record<string, unknown>, preserved: UtilityPreservedEvent): boolean | null {
  if (typeof row.interruptible === "boolean") return row.interruptible;
  const extras = preserved.additionalFields;
  if (typeof extras.interruptible === "boolean") return extras.interruptible;
  return null;
}

function ruleSpellIds(rule: { spellIds: number[]; aliases?: number[] }): Set<number> {
  return new Set<number>([...rule.spellIds, ...(rule.aliases ?? [])]);
}

function spellIdsFromCatalogRules(
  catalog: AbilityCatalog,
  predicate: (rule: (typeof catalog.rules)[number]) => boolean,
): Set<number> {
  const out = new Set<number>();
  for (const rule of catalog.rules) {
    if (!predicate(rule)) continue;
    for (const id of ruleSpellIds(rule)) out.add(id);
  }
  return out;
}

function casterControlSpellIdsFromCatalog(catalog: AbilityCatalog): Set<number> {
  return spellIdsFromCatalogRules(
    catalog,
    (r) =>
      typeof r.canonicalKey === "string" &&
      r.canonicalKey.includes("caster-control"),
  );
}

function mechanicAvoidanceSpellIdsFromCatalog(catalog: AbilityCatalog): Set<number> {
  return spellIdsFromCatalogRules(
    catalog,
    (r) => typeof r.name === "string" && r.name.toLowerCase() === "shadowmeld",
  );
}

function demonicGatewaySpellIdsFromCatalog(catalog: AbilityCatalog): {
  castIds: Set<number>;
  auraIds: Set<number>;
} {
  const castIds = new Set<number>();
  const auraIds = new Set<number>();
  for (const rule of catalog.rules) {
    if (!rule.canonicalKey.includes("demonic-gateway") && rule.name !== "Demonic Gateway") continue;
    for (const id of rule.spellIds) castIds.add(id);
    for (const id of rule.aliases ?? []) auraIds.add(id);
  }
  return { castIds, auraIds };
}

export function buildHostileCastWindows(
  casts: Array<Record<string, unknown>>,
  actorCtx: UtilityActorContext,
  fightId: number,
  reportCode: string,
): UtilityV2HostileCastWindow[] {
  const meta = { fightId, reportCode, actorCtx };
  const windows: UtilityV2HostileCastWindow[] = [];
  const beginByKey = new Map<
    string,
    {
      start: number;
      sourceId: number;
      abilityGameId: number | null;
      interruptible: boolean | null;
    }
  >();

  for (const row of casts) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.sourceID == null || preserved.timestamp == null) continue;
    if (!isHostileActor(preserved.sourceID, actorCtx)) continue;

    const typ = eventType(row, preserved);
    const key = `${preserved.sourceID}:${preserved.abilityGameID ?? "x"}`;
    const interruptible = interruptibleFlag(row, preserved);

    if (typ === "begincast" || typ === "caststart" || typ === "begin cast") {
      beginByKey.set(key, {
        start: preserved.timestamp,
        sourceId: preserved.sourceID,
        abilityGameId: preserved.abilityGameID,
        interruptible,
      });
      continue;
    }

    if (typ === "cast" || typ === "castsuccess" || typ === "") {
      const begin = beginByKey.get(key);
      if (begin) {
        windows.push({
          start: begin.start,
          end: preserved.timestamp,
          sourceId: begin.sourceId,
          abilityGameId: begin.abilityGameId,
          interruptible: begin.interruptible ?? interruptible,
          completed: true,
        });
        beginByKey.delete(key);
      } else if (interruptible === true) {
        windows.push({
          start: preserved.timestamp,
          end: preserved.timestamp,
          sourceId: preserved.sourceID,
          abilityGameId: preserved.abilityGameID,
          interruptible: true,
          completed: true,
        });
      }
      continue;
    }

    if (typ === "castfailed" || typ === "interrupted") {
      const begin = beginByKey.get(key);
      if (begin) {
        windows.push({
          start: begin.start,
          end: preserved.timestamp,
          sourceId: begin.sourceId,
          abilityGameId: begin.abilityGameId,
          interruptible: begin.interruptible ?? interruptible ?? true,
          completed: false,
        });
        beginByKey.delete(key);
      }
    }
  }

  for (const open of beginByKey.values()) {
    windows.push({
      start: open.start,
      end: null,
      sourceId: open.sourceId,
      abilityGameId: open.abilityGameId,
      interruptible: open.interruptible,
      completed: null,
    });
  }

  return windows.sort((a, b) => a.start - b.start);
}

function abilityNameFromRow(row: Record<string, unknown>): string | null {
  const ability = row.ability as Record<string, unknown> | undefined;
  return typeof ability?.name === "string" ? ability.name : null;
}

function buildActorContext(
  normalized: UtilityNormalizedRun,
  masterActors: Array<{
    id: number;
    name: string;
    type: string;
    subType?: string | null;
    petOwner?: number | null;
  }>,
  damageEvents: Array<Record<string, unknown>>,
): UtilityActorContext {
  const friendlyPlayerIds = masterActors
    .filter((a) => a.type === "Player")
    .map((a) => a.id)
    .filter((id) => id !== normalized.playerActorId);

  const base = {
    playerActorId: normalized.playerActorId,
    ownedPetActorIds: normalized.petActorIds,
    friendlyPlayerIds,
    actorsById: new Map(
      masterActors.map((a) => [
        a.id,
        {
          id: a.id,
          name: a.name,
          type: a.type,
          subType: a.subType ?? null,
          petOwner: a.petOwner ?? null,
        },
      ]),
    ),
  };

  const hostileValidatedByDamage = buildHostileValidatedByDamage(
    damageEvents,
    base,
    normalized.fightId,
    normalized.reportCode,
  );

  return { ...base, hostileValidatedByDamage };
}

function hasDomainToolkit(
  domain: UtilityV2DomainKey,
  catalog: AbilityCatalog,
  classSlug: string | null,
  specSlug: string | null,
  config: UtilityV2AuditConfig = UTILITY_V2_AUDIT_CONFIG,
): boolean {
  const opts = { classSlug, specSlug };
  switch (domain) {
    case "castStops":
      return spellIdsForCategory(catalog, "INTERRUPT", opts).size > 0;
    case "casterControl":
      return config.absoluteRubric.casterControl.spellIds.length > 0;
    case "strategicCc":
      return (
        spellIdsForCategory(catalog, "HARD_CC", opts).size > 0 ||
        spellIdsForCategory(catalog, "SOFT_CC", opts).size > 0
      );
    case "mechanicAvoidance":
      return config.absoluteRubric.mechanicAvoidance.spellIds.length > 0;
    case "groupMobility":
      return spellIdsForCategory(catalog, "GROUP_UTILITY", opts).size > 0;
    case "support":
      return (
        spellIdsForCategory(catalog, "DISPEL", opts).size > 0 ||
        spellIdsForCategory(catalog, "PURGE", opts).size > 0 ||
        spellIdsForCategory(catalog, "EXTERNAL_DEFENSIVE", opts).size > 0 ||
        spellIdsForCategory(catalog, "BATTLE_REZ", opts).size > 0
      );
    default:
      return false;
  }
}

function correlateCastStop(
  timestamp: number,
  targetId: number | null,
  windows: UtilityV2HostileCastWindow[],
  windowMs: number,
): { matched: boolean; notes: string[] } {
  const notes: string[] = [];
  for (const w of windows) {
    if (targetId != null && w.sourceId !== targetId) continue;
    const end = w.end ?? w.start + 3_000;
    if (timestamp >= w.start - 50 && timestamp <= end + windowMs) {
      if (w.completed === false) {
        notes.push("hostile_cast_window_ended_incomplete");
        return { matched: true, notes };
      }
      if (w.completed === true && timestamp <= end + windowMs) {
        notes.push("hostile_cast_window_correlated");
        return { matched: true, notes };
      }
    }
  }
  return { matched: false, notes };
}

function hostileCastsDuringWindow(
  targetId: number | null,
  start: number,
  end: number,
  casts: Array<Record<string, unknown>>,
  actorCtx: UtilityActorContext,
  fightId: number,
  reportCode: string,
): boolean {
  if (targetId == null) return false;
  const meta = { fightId, reportCode, actorCtx };
  for (const row of casts) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.sourceID !== targetId || preserved.timestamp == null) continue;
    if (preserved.timestamp < start || preserved.timestamp > end) continue;
    const typ = eventType(row, preserved);
    if (typ.includes("cast")) return true;
  }
  return false;
}

function trackAuraDurations(
  rows: Array<Record<string, unknown>>,
  spellIds: Set<number>,
  actorCtx: UtilityActorContext,
  attributedOnly: boolean,
  fightId: number,
  reportCode: string,
): Map<string, { applyTs: number; removeTs: number | null; targetId: number | null; spellId: number }> {
  const meta = { fightId, reportCode, actorCtx };
  const open = new Map<string, number>();
  const result = new Map<
    string,
    { applyTs: number; removeTs: number | null; targetId: number | null; spellId: number }
  >();
  const attributed = attributedSourceIds(actorCtx);

  for (const row of rows) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.timestamp == null || preserved.abilityGameID == null) continue;
    if (!spellIds.has(preserved.abilityGameID)) continue;
    if (attributedOnly && (preserved.sourceID == null || !attributed.has(preserved.sourceID))) continue;

    const typ = eventType(row, preserved);
    const key = `${preserved.targetID ?? "none"}:${preserved.abilityGameID}:${preserved.sourceID ?? "none"}`;

    if (typ.includes("apply")) {
      open.set(key, preserved.timestamp);
      result.set(key, {
        applyTs: preserved.timestamp,
        removeTs: null,
        targetId: preserved.targetID,
        spellId: preserved.abilityGameID,
      });
      continue;
    }

    if (typ.includes("remove")) {
      const applyTs = open.get(key);
      const entry = result.get(key);
      if (entry && applyTs != null) {
        entry.removeTs = preserved.timestamp;
      } else {
        result.set(key, {
          applyTs: preserved.timestamp,
          removeTs: preserved.timestamp,
          targetId: preserved.targetID,
          spellId: preserved.abilityGameID,
        });
      }
      open.delete(key);
    }
  }

  return result;
}

function auditCastStops(input: {
  normalized: UtilityNormalizedRun;
  raw: UtilityV2RawRunBundle;
  actorCtx: UtilityActorContext;
  catalog: AbilityCatalog;
  config: UtilityV2AuditConfig;
}): UtilityV2EvidenceItem[] {
  const { normalized, raw, actorCtx, catalog, config } = input;
  const items: UtilityV2EvidenceItem[] = [];
  const interruptIds = spellIdsForCategory(catalog, "INTERRUPT", {
    classSlug: normalized.classSlug,
    specSlug: normalized.specialization,
  });
  const crossStreamIds = new Set<number>([
    ...config.crossStreamCcSpellIds,
    ...KNOWN_CROSS_STREAM_CC_IN_INTERRUPTS,
  ]);
  const windows = buildHostileCastWindows(raw.casts, actorCtx, normalized.fightId, normalized.reportCode);
  const corrMs = config.correlationWindowsMs.castStop;

  for (const ev of normalized.interruptEvents) {
    const spellId = ev.abilityGameID;
    const isRegular = interruptIds.has(spellId);
    const isCrossStream = crossStreamIds.has(spellId);
    if (!isRegular && !isCrossStream) continue;

    const notes: string[] = [];
    let tier: UtilityV2EvidenceTier = "CONFIRMED_APPLICATION";
    let confidence: UtilityV2EvidenceItem["confidence"] = "MEDIUM";
    let observability: UtilityV2EvidenceItem["observability"] = "PARTIAL";

    if (isRegular) {
      if (ev.interruptedSpellId != null) {
        tier = "CONFIRMED_IMPACT";
        notes.push("interrupted_spell_id_present");
        confidence = "HIGH";
        observability = "FULL";
      } else {
        notes.push("interrupt_event_without_interrupted_spell_id");
      }
      items.push({
        id: `${normalized.reportCode}:${normalized.fightId}:cast-stop:${ev.timestamp}:${spellId}`,
        domain: "castStops",
        kind: "REGULAR_INTERRUPT",
        tier,
        timestamp: ev.timestamp,
        abilityGameID: spellId,
        abilityName:
          (ev.event.additionalFields.abilityExtras as { name?: string } | undefined)?.name ?? null,
        targetActorId: ev.targetID,
        interruptedSpellId: ev.interruptedSpellId,
        removedSpellId: null,
        durationMs: null,
        correlationNotes: notes,
        confidence,
        observability,
      });
      continue;
    }

    const corr = correlateCastStop(ev.timestamp, ev.targetID, windows, corrMs);
    if (ev.interruptedSpellId != null || corr.matched) {
      tier = "CONFIRMED_IMPACT";
      confidence = "HIGH";
      observability = "FULL";
      notes.push(...corr.notes, "cross_stream_interrupts_stream");
      if (ev.interruptedSpellId != null) notes.push("interrupted_spell_id_present");
    } else if (ev.event.type?.includes("apply")) {
      tier = "CONFIRMED_APPLICATION";
      notes.push("cross_stream_apply_without_cast_stop_proof");
    } else {
      notes.push("cross_stream_event_observed");
    }

    items.push({
      id: `${normalized.reportCode}:${normalized.fightId}:cross-stop:${ev.timestamp}:${spellId}`,
      domain: "castStops",
      kind: "CROSS_STREAM_CAST_STOP",
      tier,
      timestamp: ev.timestamp,
      abilityGameID: spellId,
      abilityName:
        (ev.event.additionalFields.abilityExtras as { name?: string } | undefined)?.name ?? null,
      targetActorId: ev.targetID,
      interruptedSpellId: ev.interruptedSpellId,
      removedSpellId: null,
      durationMs: null,
      correlationNotes: notes,
      confidence,
      observability,
    });
  }

  return items;
}

function auditCasterControl(input: {
  normalized: UtilityNormalizedRun;
  raw: UtilityV2RawRunBundle;
  actorCtx: UtilityActorContext;
  catalog: AbilityCatalog;
  config: UtilityV2AuditConfig;
}): UtilityV2EvidenceItem[] {
  const { normalized, raw, actorCtx, catalog, config } = input;
  const spellIds = casterControlSpellIdsFromCatalog(catalog);
  if (spellIds.size === 0) return [];
  const items: UtilityV2EvidenceItem[] = [];
  const attributed = attributedSourceIds(actorCtx);
  const meta = { fightId: normalized.fightId, reportCode: normalized.reportCode, actorCtx };
  const debuffAuras = trackAuraDurations(
    [...raw.buffs, ...raw.debuffs],
    spellIds,
    actorCtx,
    true,
    normalized.fightId,
    normalized.reportCode,
  );

  for (const row of raw.casts) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.sourceID == null || !attributed.has(preserved.sourceID)) continue;
    if (preserved.abilityGameID == null || !spellIds.has(preserved.abilityGameID)) continue;
    const typ = eventType(row, preserved);
    if (!typ.includes("cast")) continue;
    const targetId = preserved.targetID;
    if (!isHostileActor(targetId, actorCtx)) continue;

    items.push({
      id: `${normalized.reportCode}:${normalized.fightId}:tongues-cast:${preserved.timestamp}`,
      domain: "casterControl",
      kind: "CASTER_CONTROL",
      tier: "RAW_CAST",
      timestamp: preserved.timestamp!,
      abilityGameID: preserved.abilityGameID,
      abilityName: abilityNameFromRow(row),
      targetActorId: targetId,
      interruptedSpellId: null,
      removedSpellId: null,
      durationMs: null,
      correlationNotes: ["player_cast_on_hostile"],
      confidence: "LOW",
      observability: "LIMITED",
    });
  }

  for (const aura of debuffAuras.values()) {
    if (aura.targetId == null || !isHostileActor(aura.targetId, actorCtx)) continue;
    const end = aura.removeTs ?? aura.applyTs + config.absoluteRubric.casterControl.minCoverageDurationMs;
    const durationMs = Math.max(0, end - aura.applyTs);
    const hadCasts = hostileCastsDuringWindow(
      aura.targetId,
      aura.applyTs,
      end,
      raw.casts,
      actorCtx,
      normalized.fightId,
      normalized.reportCode,
    );

    let tier: UtilityV2EvidenceTier = "CONFIRMED_APPLICATION";
    const notes = ["debuff_application_on_hostile"];
    let confidence: UtilityV2EvidenceItem["confidence"] = "MEDIUM";
    let observability: UtilityV2EvidenceItem["observability"] = "PARTIAL";

    if (hadCasts && durationMs >= config.absoluteRubric.casterControl.minCoverageDurationMs) {
      tier = "CONFIRMED_IMPACT";
      notes.push("hostile_caster_observed_during_debuff");
      confidence = "HIGH";
      observability = "FULL";
    }

    items.push({
      id: `${normalized.reportCode}:${normalized.fightId}:tongues-aura:${aura.applyTs}:${aura.spellId}`,
      domain: "casterControl",
      kind: "CASTER_CONTROL",
      tier,
      timestamp: aura.applyTs,
      abilityGameID: aura.spellId,
      abilityName: null,
      targetActorId: aura.targetId,
      interruptedSpellId: null,
      removedSpellId: null,
      durationMs,
      correlationNotes: notes,
      confidence,
      observability,
    });
  }

  return dedupeEvidenceByTimestamp(items);
}

function auditStrategicCc(input: {
  normalized: UtilityNormalizedRun;
  raw: UtilityV2RawRunBundle;
  actorCtx: UtilityActorContext;
  catalog: AbilityCatalog;
  config: UtilityV2AuditConfig;
}): UtilityV2EvidenceItem[] {
  const { normalized, raw, actorCtx, catalog, config } = input;
  const ccIds = new Set<number>([
    ...spellIdsForCategory(catalog, "HARD_CC", {
      classSlug: normalized.classSlug,
      specSlug: normalized.specialization,
    }),
    ...spellIdsForCategory(catalog, "SOFT_CC", {
      classSlug: normalized.classSlug,
      specSlug: normalized.specialization,
    }),
  ]);
  for (const id of casterControlSpellIdsFromCatalog(catalog)) ccIds.delete(id);

  const items: UtilityV2EvidenceItem[] = [];
  const debuffAuras = trackAuraDurations(
    [...raw.buffs, ...raw.debuffs],
    ccIds,
    actorCtx,
    true,
    normalized.fightId,
    normalized.reportCode,
  );

  for (const cc of normalized.ccEvents) {
    if (!ccIds.has(cc.abilityGameID)) continue;
    let tier: UtilityV2EvidenceTier = "RAW_CAST";
    const notes: string[] = ["cc_cast_observed"];
    if (cc.debuffApplied) {
      tier = "CONFIRMED_APPLICATION";
      notes.push("debuff_application_confirmed");
    }
    if (
      cc.nonBossTarget &&
      cc.durationMs != null &&
      cc.durationMs >= config.absoluteRubric.strategicCc.prolongedControlMs
    ) {
      tier = "CONFIRMED_IMPACT";
      notes.push("prolonged_non_boss_control");
    }

    items.push({
      id: `${normalized.reportCode}:${normalized.fightId}:strat-cc-cast:${cc.timestamp}`,
      domain: "strategicCc",
      kind: "STRATEGIC_CC",
      tier,
      timestamp: cc.timestamp,
      abilityGameID: cc.abilityGameID,
      abilityName: cc.canonical?.name ?? null,
      targetActorId: cc.targetID,
      interruptedSpellId: null,
      removedSpellId: null,
      durationMs: cc.durationMs,
      correlationNotes: notes,
      confidence: cc.debuffApplied ? "MEDIUM" : "LOW",
      observability: cc.debuffApplied ? "PARTIAL" : "LIMITED",
    });
  }

  for (const aura of debuffAuras.values()) {
    if (aura.targetId == null) continue;
    const boss = isBossActor(aura.targetId, actorCtx);
    if (boss === true) continue;
    const end = aura.removeTs ?? aura.applyTs + 3_000;
    const durationMs = Math.max(0, end - aura.applyTs);
    let tier: UtilityV2EvidenceTier = "CONFIRMED_APPLICATION";
    const notes = ["cc_debuff_on_non_boss"];
    if (durationMs >= config.absoluteRubric.strategicCc.routingControlMs) {
      tier = "CONFIRMED_IMPACT";
      notes.push("prolonged_control_routing_candidate");
    } else if (durationMs >= config.absoluteRubric.strategicCc.prolongedControlMs) {
      tier = "CONFIRMED_IMPACT";
      notes.push("prolonged_control");
    }

    items.push({
      id: `${normalized.reportCode}:${normalized.fightId}:strat-cc-aura:${aura.applyTs}:${aura.spellId}`,
      domain: "strategicCc",
      kind: "STRATEGIC_CC",
      tier,
      timestamp: aura.applyTs,
      abilityGameID: aura.spellId,
      abilityName: null,
      targetActorId: aura.targetId,
      interruptedSpellId: null,
      removedSpellId: null,
      durationMs,
      correlationNotes: notes,
      confidence: durationMs >= config.absoluteRubric.strategicCc.prolongedControlMs ? "HIGH" : "MEDIUM",
      observability: aura.removeTs != null ? "FULL" : "PARTIAL",
    });
  }

  return dedupeEvidenceByTimestamp(items);
}

function auditMechanicAvoidance(input: {
  normalized: UtilityNormalizedRun;
  raw: UtilityV2RawRunBundle;
  actorCtx: UtilityActorContext;
  catalog: AbilityCatalog;
  config: UtilityV2AuditConfig;
}): UtilityV2EvidenceItem[] {
  const { normalized, raw, actorCtx, catalog, config } = input;
  const spellIds = mechanicAvoidanceSpellIdsFromCatalog(catalog);
  if (spellIds.size === 0) return [];
  const items: UtilityV2EvidenceItem[] = [];
  const attributed = attributedSourceIds(actorCtx);
  const meta = { fightId: normalized.fightId, reportCode: normalized.reportCode, actorCtx };
  const windows = buildHostileCastWindows(raw.casts, actorCtx, normalized.fightId, normalized.reportCode);
  const corrMs = config.absoluteRubric.mechanicAvoidance.correlationWindowMs;

  for (const row of raw.casts) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.sourceID == null || !attributed.has(preserved.sourceID)) continue;
    if (preserved.abilityGameID == null || !spellIds.has(preserved.abilityGameID)) continue;
    const typ = eventType(row, preserved);
    if (!typ.includes("cast")) continue;

    let tier: UtilityV2EvidenceTier = "RAW_CAST";
    const notes = ["shadowmeld_cast_observed"];
    let confidence: UtilityV2EvidenceItem["confidence"] = "LOW";
    let observability: UtilityV2EvidenceItem["observability"] = "LIMITED";

    for (const w of windows) {
      if (preserved.timestamp == null) continue;
      if (Math.abs(preserved.timestamp - w.start) <= corrMs) {
        tier = "CONFIRMED_IMPACT";
        notes.push("correlated_with_hostile_cast_start");
        confidence = "HIGH";
        observability = "FULL";
        break;
      }
      if (
        w.completed === false &&
        preserved.timestamp >= w.start &&
        preserved.timestamp <= (w.end ?? w.start) + corrMs
      ) {
        tier = "CONFIRMED_IMPACT";
        notes.push("correlated_with_hostile_cast_cancellation");
        confidence = "HIGH";
        observability = "FULL";
        break;
      }
    }

    if (tier === "RAW_CAST") {
      tier = "CONFIRMED_APPLICATION";
      notes.push("activation_without_impact_correlation_partial_credit");
      confidence = "MEDIUM";
      observability = "PARTIAL";
    }

    items.push({
      id: `${normalized.reportCode}:${normalized.fightId}:meld:${preserved.timestamp}`,
      domain: "mechanicAvoidance",
      kind: "MECHANIC_AVOIDANCE",
      tier,
      timestamp: preserved.timestamp!,
      abilityGameID: preserved.abilityGameID,
      abilityName: abilityNameFromRow(row),
      targetActorId: preserved.targetID,
      interruptedSpellId: null,
      removedSpellId: null,
      durationMs: null,
      correlationNotes: notes,
      confidence,
      observability,
    });
  }

  return items;
}

function auditGroupMobility(input: {
  normalized: UtilityNormalizedRun;
  raw: UtilityV2RawRunBundle;
  actorCtx: UtilityActorContext;
  catalog: AbilityCatalog;
  config: UtilityV2AuditConfig;
}): UtilityV2EvidenceItem[] {
  const { normalized, raw, actorCtx, catalog, config } = input;
  const rubric = config.absoluteRubric.groupMobility;
  const { castIds, auraIds } = demonicGatewaySpellIdsFromCatalog(catalog);
  if (castIds.size === 0 && auraIds.size === 0) return [];
  const items: UtilityV2EvidenceItem[] = [];
  const attributed = attributedSourceIds(actorCtx);
  const meta = { fightId: normalized.fightId, reportCode: normalized.reportCode, actorCtx };

  const gatewayCasts: Array<{ ts: number }> = [];
  for (const row of raw.casts) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.sourceID == null || !attributed.has(preserved.sourceID)) continue;
    if (preserved.abilityGameID == null || !castIds.has(preserved.abilityGameID)) continue;
    const typ = eventType(row, preserved);
    if (!typ.includes("cast")) continue;
    gatewayCasts.push({ ts: preserved.timestamp! });
    items.push({
      id: `${normalized.reportCode}:${normalized.fightId}:gw-cast:${preserved.timestamp}`,
      domain: "groupMobility",
      kind: "GROUP_MOBILITY_CAST",
      tier: "RAW_CAST",
      timestamp: preserved.timestamp!,
      abilityGameID: preserved.abilityGameID,
      abilityName: abilityNameFromRow(row),
      targetActorId: preserved.targetID,
      interruptedSpellId: null,
      removedSpellId: null,
      durationMs: null,
      correlationNotes: ["gateway_cast_placement_only_partial_credit"],
      confidence: "LOW",
      observability: "LIMITED",
    });
  }

  const traversals = trackAuraDurations(
    [...raw.buffs, ...raw.debuffs],
    auraIds,
    actorCtx,
    false,
    normalized.fightId,
    normalized.reportCode,
  );

  const users = new Set<number>();
  for (const aura of traversals.values()) {
    if (aura.targetId == null) continue;
    const durationMs = aura.removeTs != null ? Math.max(0, aura.removeTs - aura.applyTs) : null;
    const pairedCast = gatewayCasts.some(
      (c) => Math.abs(c.ts - aura.applyTs) <= config.correlationWindowsMs.gatewayTraversal,
    );

    let tier: UtilityV2EvidenceTier = "CONFIRMED_APPLICATION";
    const notes = ["gateway_aura_apply_observed"];
    if (
      durationMs != null &&
      durationMs >= rubric.minTraversalDurationMs &&
      durationMs <= rubric.maxTraversalDurationMs &&
      pairedCast
    ) {
      tier = "CONFIRMED_IMPACT";
      notes.push("paired_cast_and_aura_traversal");
      users.add(aura.targetId);
    } else if (pairedCast) {
      notes.push("paired_cast_aura_without_full_traversal_proof");
    }

    items.push({
      id: `${normalized.reportCode}:${normalized.fightId}:gw-aura:${aura.applyTs}:${aura.targetId}`,
      domain: "groupMobility",
      kind: "GROUP_MOBILITY_TRAVERSAL",
      tier,
      timestamp: aura.applyTs,
      abilityGameID: aura.spellId,
      abilityName: "Demonic Gateway",
      targetActorId: aura.targetId,
      interruptedSpellId: null,
      removedSpellId: null,
      durationMs,
      correlationNotes: notes,
      confidence: tier === "CONFIRMED_IMPACT" ? "HIGH" : "MEDIUM",
      observability: aura.removeTs != null ? "FULL" : "PARTIAL",
    });
  }

  if (users.size > 0) {
    for (const item of items) {
      if (item.kind === "GROUP_MOBILITY_TRAVERSAL" && item.tier === "CONFIRMED_IMPACT") {
        item.correlationNotes.push(`unique_traversal_users_in_run:${users.size}`);
      }
    }
  }

  return dedupeEvidenceByTimestamp(items);
}

function auditSupport(input: { normalized: UtilityNormalizedRun }): UtilityV2EvidenceItem[] {
  const { normalized } = input;
  const items: UtilityV2EvidenceItem[] = [];

  for (const ev of normalized.dispelPurgeEvents) {
    items.push({
      id: `${normalized.reportCode}:${normalized.fightId}:support:${ev.timestamp}:${ev.abilityGameID}`,
      domain: "support",
      kind: ev.kind === "PURGE" ? "PURGE" : "DISPEL",
      tier: ev.removedSpellId != null ? "CONFIRMED_IMPACT" : "CONFIRMED_APPLICATION",
      timestamp: ev.timestamp,
      abilityGameID: ev.abilityGameID,
      abilityName:
        (ev.event.additionalFields.abilityExtras as { name?: string } | undefined)?.name ?? null,
      targetActorId: ev.targetID,
      interruptedSpellId: null,
      removedSpellId: ev.removedSpellId,
      durationMs: null,
      correlationNotes: ev.removedSpellId != null ? ["removed_spell_confirmed"] : ["dispel_event_observed"],
      confidence: ev.removedSpellId != null ? "HIGH" : "MEDIUM",
      observability: "FULL",
    });
  }

  for (const ev of normalized.externalGroupUtilityEvents) {
    items.push({
      id: `${normalized.reportCode}:${normalized.fightId}:ext:${ev.timestamp}`,
      domain: "support",
      kind: ev.category === "BATTLE_REZ" ? "BATTLE_REZ" : "EXTERNAL",
      tier: ev.classification === "CONFIRMED_USEFUL" ? "CONFIRMED_IMPACT" : "CONFIRMED_APPLICATION",
      timestamp: ev.timestamp,
      abilityGameID: ev.abilityGameID,
      abilityName: ev.canonical?.name ?? null,
      targetActorId: ev.targetID,
      interruptedSpellId: null,
      removedSpellId: null,
      durationMs: null,
      correlationNotes: [...ev.evidence],
      confidence: ev.classification === "CONFIRMED_USEFUL" ? "HIGH" : "MEDIUM",
      observability: "PARTIAL",
    });
  }

  return items;
}

function dedupeEvidenceByTimestamp(items: UtilityV2EvidenceItem[]): UtilityV2EvidenceItem[] {
  const tierRank: Record<UtilityV2EvidenceTier, number> = {
    CONFIRMED_IMPACT: 3,
    CONFIRMED_APPLICATION: 2,
    RAW_CAST: 1,
  };
  const byKey = new Map<string, UtilityV2EvidenceItem>();
  for (const item of items) {
    const key = `${item.domain}:${item.kind}:${item.timestamp}:${item.abilityGameID}:${item.targetActorId}`;
    const existing = byKey.get(key);
    if (!existing || tierRank[item.tier] > tierRank[existing.tier]) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function summarizeDomain(
  domain: UtilityV2DomainKey,
  items: UtilityV2EvidenceItem[],
  durationHours: number,
  applicable: boolean,
  missedOpportunityCount: number,
): UtilityV2DomainEvidenceSummary {
  const tierCounts = emptyTierCounts();
  for (const item of items) tierCounts[item.tier] += 1;

  const normalizedRatesPerHour = emptyTierCounts();
  const hours = Math.max(durationHours, 1 / 60);
  for (const tier of UTILITY_V2_AUDIT_CONFIG.evidenceTiers) {
    normalizedRatesPerHour[tier] = tierCounts[tier] / hours;
  }

  let observability: UtilityV2DomainEvidenceSummary["observability"] = "NOT_APPLICABLE";
  let confidence: UtilityV2DomainEvidenceSummary["confidence"] = "NOT_APPLICABLE";
  if (applicable) {
    const obsCounts = { FULL: 0, PARTIAL: 0, LIMITED: 0 };
    const confCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const item of items) {
      obsCounts[item.observability] += 1;
      confCounts[item.confidence] += 1;
    }
    observability =
      obsCounts.FULL >= obsCounts.PARTIAL && obsCounts.FULL >= obsCounts.LIMITED
        ? "FULL"
        : obsCounts.PARTIAL >= obsCounts.LIMITED
          ? "PARTIAL"
          : "LIMITED";
    confidence =
      confCounts.HIGH >= confCounts.MEDIUM && confCounts.HIGH >= confCounts.LOW
        ? "HIGH"
        : confCounts.MEDIUM >= confCounts.LOW
          ? "MEDIUM"
          : "LOW";
    if (items.length === 0) {
      observability = "LIMITED";
      confidence = "LOW";
    }
  }

  return {
    domain,
    applicable,
    applicabilityReason: applicable ? null : "No toolkit or spell coverage for this domain",
    tierCounts,
    items,
    normalizedRatesPerHour,
    observability,
    confidence,
    missedOpportunityCount,
  };
}

export function domainDeltaFromEvidence(
  domain: UtilityV2DomainKey,
  summary: UtilityV2DomainEvidenceSummary,
  config: UtilityV2AuditConfig = UTILITY_V2_AUDIT_CONFIG,
  tierMultiplier = 1,
): number {
  if (!summary.applicable) return 0;
  const rubric = config.absoluteRubric[domain];
  let delta = 0;
  for (const tier of config.evidenceTiers) {
    const rate = summary.normalizedRatesPerHour[tier];
    delta += rate * rubric.tierPoints[tier] * tierMultiplier;
  }
  return Math.min(rubric.maxDeltaAboveBaseline, Math.max(0, delta));
}

export function redistributeDomainWeights(
  weights: Record<UtilityV2DomainKey, number>,
  applicability: Record<UtilityV2DomainKey, boolean>,
): Record<UtilityV2DomainKey, number> {
  const out = { ...weights };
  let removed = 0;
  for (const key of DOMAIN_KEYS) {
    if (!applicability[key]) {
      removed += out[key];
      out[key] = 0;
    }
  }
  const applicableKeys = DOMAIN_KEYS.filter((k) => applicability[k]);
  if (applicableKeys.length === 0 || removed <= 0) return out;
  const applicableSum = applicableKeys.reduce((s, k) => s + weights[k], 0);
  for (const key of applicableKeys) {
    out[key] = weights[key] + (removed * weights[key]) / applicableSum;
  }
  return out;
}

export function scoreUtilityV2Run(
  runAudit: Omit<UtilityV2RunAudit, "simulatedScore" | "simulatedScoreByDomain" | "deltaFromNeutral">,
  options: UtilityV2ScenarioOptions = {
    id: "baseline",
    label: "baseline",
    tierMultiplier: 1,
    applyMissedOpportunityPenalty: false,
  },
  config: UtilityV2AuditConfig = UTILITY_V2_AUDIT_CONFIG,
): Pick<UtilityV2RunAudit, "simulatedScore" | "simulatedScoreByDomain" | "deltaFromNeutral"> {
  const applicability = Object.fromEntries(
    DOMAIN_KEYS.map((k) => [k, runAudit.domains[k].applicable]),
  ) as Record<UtilityV2DomainKey, boolean>;

  let weights: Record<UtilityV2DomainKey, number> = { ...config.domainWeights };
  if (options.weightOverrides) {
    for (const [k, v] of Object.entries(options.weightOverrides) as [UtilityV2DomainKey, number][]) {
      weights[k] = v;
    }
    const sum = DOMAIN_KEYS.reduce((s, k) => s + weights[k], 0);
    if (sum > 0) {
      for (const k of DOMAIN_KEYS) weights[k] /= sum;
    }
  }
  weights = redistributeDomainWeights(weights, applicability);

  const tierMult = options.tierMultiplier ?? 1;
  const simulatedScoreByDomain = Object.fromEntries(
    DOMAIN_KEYS.map((k) => {
      if (!applicability[k]) return [k, null];
      const delta = domainDeltaFromEvidence(k, runAudit.domains[k], config, tierMult);
      return [k, config.neutralBaseline + delta];
    }),
  ) as Record<UtilityV2DomainKey, number | null>;

  let weighted = 0;
  let weightSum = 0;
  for (const k of DOMAIN_KEYS) {
    const score = simulatedScoreByDomain[k];
    if (score == null) continue;
    weighted += score * weights[k];
    weightSum += weights[k];
  }

  let simulatedScore = weightSum > 0 ? weighted / weightSum : config.neutralBaseline;

  if (options.applyMissedOpportunityPenalty && runAudit.missedInterruptOpportunities > 0) {
    const penalty = Math.min(
      config.missedOpportunityPenalty.maxPenaltyBelowBaseline,
      runAudit.missedInterruptOpportunities * config.missedOpportunityPenalty.perMissedAvailableInterrupt,
    );
    simulatedScore = Math.max(
      config.neutralBaseline - config.missedOpportunityPenalty.maxPenaltyBelowBaseline,
      simulatedScore - penalty,
    );
  }

  return {
    simulatedScore: Math.round(simulatedScore * 100) / 100,
    simulatedScoreByDomain,
    deltaFromNeutral: Math.round((simulatedScore - config.neutralBaseline) * 100) / 100,
  };
}

export function auditUtilityV2Run(input: {
  normalized: UtilityNormalizedRun;
  raw: UtilityV2RawRunBundle;
  masterActors: Array<{
    id: number;
    name: string;
    type: string;
    subType?: string | null;
    petOwner?: number | null;
  }>;
  damageEvents?: Array<Record<string, unknown>>;
  catalog?: AbilityCatalog;
  config?: UtilityV2AuditConfig;
}): UtilityV2RunAudit {
  const config = input.config ?? UTILITY_V2_AUDIT_CONFIG;
  const catalog =
    input.catalog ??
    getAbilityCatalog({
      classSlug: input.normalized.classSlug,
      specSlug: input.normalized.specialization,
      includeRacials: true,
    });

  const actorCtx = buildActorContext(
    input.normalized,
    input.masterActors,
    input.damageEvents ?? [],
  );

  const durationHours = Math.max(input.normalized.durationMs / 3_600_000, 1 / 60);
  const classSlug = input.normalized.classSlug;
  const specSlug = input.normalized.specialization;
  const missedInterruptOpportunities = input.normalized.interruptOpportunities.filter(
    (o) => o.status === "PLAYER_AVAILABLE" && o.playerInterruptTimestamp == null,
  ).length;

  const domains = {
    castStops: summarizeDomain(
      "castStops",
      auditCastStops({
        normalized: input.normalized,
        raw: input.raw,
        actorCtx,
        catalog,
        config,
      }),
      durationHours,
      hasDomainToolkit("castStops", catalog, classSlug, specSlug, config),
      missedInterruptOpportunities,
    ),
    casterControl: summarizeDomain(
      "casterControl",
      auditCasterControl({
        normalized: input.normalized,
        raw: input.raw,
        actorCtx,
        catalog,
        config,
      }),
      durationHours,
      hasDomainToolkit("casterControl", catalog, classSlug, specSlug, config),
      0,
    ),
    strategicCc: summarizeDomain(
      "strategicCc",
      auditStrategicCc({
        normalized: input.normalized,
        raw: input.raw,
        actorCtx,
        catalog,
        config,
      }),
      durationHours,
      hasDomainToolkit("strategicCc", catalog, classSlug, specSlug, config),
      0,
    ),
    mechanicAvoidance: summarizeDomain(
      "mechanicAvoidance",
      auditMechanicAvoidance({
        normalized: input.normalized,
        raw: input.raw,
        actorCtx,
        catalog,
        config,
      }),
      durationHours,
      hasDomainToolkit("mechanicAvoidance", catalog, classSlug, specSlug, config),
      0,
    ),
    groupMobility: summarizeDomain(
      "groupMobility",
      auditGroupMobility({
        normalized: input.normalized,
        raw: input.raw,
        actorCtx,
        catalog,
        config,
      }),
      durationHours,
      hasDomainToolkit("groupMobility", catalog, classSlug, specSlug, config),
      0,
    ),
    support: summarizeDomain(
      "support",
      auditSupport({ normalized: input.normalized }),
      durationHours,
      hasDomainToolkit("support", catalog, classSlug, specSlug, config),
      0,
    ),
  } satisfies Record<UtilityV2DomainKey, UtilityV2DomainEvidenceSummary>;

  const partial: Omit<
    UtilityV2RunAudit,
    "simulatedScore" | "simulatedScoreByDomain" | "deltaFromNeutral"
  > = {
    runId: `${input.normalized.reportCode}:${input.normalized.fightId}`,
    reportCode: input.normalized.reportCode,
    fightId: input.normalized.fightId,
    dungeonSlug: input.normalized.dungeonSlug,
    durationMs: input.normalized.durationMs,
    durationHours,
    domains,
    missedInterruptOpportunities,
  };

  return { ...partial, ...scoreUtilityV2Run(partial) };
}

export function aggregateUtilityV2Dungeons(
  runAudits: UtilityV2RunAudit[],
  expectedDungeons: string[],
): UtilityV2DungeonSimulatedScore[] {
  return expectedDungeons.map((dungeonSlug) => {
    const runs = runAudits.filter((r) => r.dungeonSlug === dungeonSlug);
    const tierTotals = emptyTierCounts();
    const domainTierTotals = Object.fromEntries(
      DOMAIN_KEYS.map((d) => [d, emptyTierCounts()]),
    ) as Record<UtilityV2DomainKey, Record<UtilityV2EvidenceTier, number>>;

    for (const run of runs) {
      for (const d of DOMAIN_KEYS) {
        for (const tier of UTILITY_V2_AUDIT_CONFIG.evidenceTiers) {
          domainTierTotals[d][tier] += run.domains[d].tierCounts[tier];
          tierTotals[tier] += run.domains[d].tierCounts[tier];
        }
      }
    }

    return {
      dungeonSlug,
      runCount: runs.length,
      medianSimulatedScore: median(runs.map((r) => r.simulatedScore)),
      meanSimulatedScore:
        runs.length > 0
          ? Math.round((runs.reduce((s, r) => s + r.simulatedScore, 0) / runs.length) * 100) / 100
          : null,
      tierTotals,
      domainTierTotals,
    };
  });
}

export function runUtilityV2Sensitivity(
  runAudits: UtilityV2RunAudit[],
  perDungeon: UtilityV2DungeonSimulatedScore[],
  scenarios: UtilityV2ScenarioOptions[],
  config: UtilityV2AuditConfig = UTILITY_V2_AUDIT_CONFIG,
): UtilityV2SensitivityScenarioResult[] {
  const baselineId = scenarios[0]?.id ?? "baseline";
  let baselineGlobal: number | null = null;
  const results: UtilityV2SensitivityScenarioResult[] = [];

  for (const scenario of scenarios) {
    const dungeonMedians = perDungeon.map((d) => {
      const scores = runAudits
        .filter((r) => r.dungeonSlug === d.dungeonSlug)
        .map((r) => {
          const partial = {
            runId: r.runId,
            reportCode: r.reportCode,
            fightId: r.fightId,
            dungeonSlug: r.dungeonSlug,
            durationMs: r.durationMs,
            durationHours: r.durationHours,
            domains: r.domains,
            missedInterruptOpportunities: r.missedInterruptOpportunities,
          };
          return scoreUtilityV2Run(partial, scenario, config).simulatedScore;
        });
      return { dungeonSlug: d.dungeonSlug, medianScore: median(scores) };
    });

    const dungeonsWithRuns = dungeonMedians.filter((d) => d.medianScore != null);
    const globalSimulatedScore = equalWeightMean(dungeonsWithRuns.map((d) => d.medianScore));

    if (scenario.id === baselineId) baselineGlobal = globalSimulatedScore;

    results.push({
      scenarioId: scenario.id,
      label: scenario.label,
      globalSimulatedScore,
      perDungeon: dungeonMedians,
      deltaFromBaselineScenario:
        baselineGlobal != null && globalSimulatedScore != null
          ? Math.round((globalSimulatedScore - baselineGlobal) * 100) / 100
          : null,
    });
  }

  return results;
}

export function buildUtilityV2AuditDataset(input: {
  runs: UtilityNormalizedRun[];
  rawByRunId: Map<string, UtilityV2RawRunBundle>;
  masterByReport: Map<
    string,
    {
      actors: Array<{
        id: number;
        name: string;
        type: string;
        subType?: string | null;
        petOwner?: number | null;
      }>;
    }
  >;
  subject: UtilityV2AuditDataset["subject"];
  scoredAt: string;
  config?: UtilityV2AuditConfig;
}): UtilityV2AuditDataset {
  const config = input.config ?? UTILITY_V2_AUDIT_CONFIG;
  const expected = activeSeasonDungeonPool(CURRENT_MPLUS_ZONE_DUNGEON_SLUGS);

  const runAudits = input.runs.map((normalized) => {
    const runId = `${normalized.reportCode}:${normalized.fightId}`;
    const raw = input.rawByRunId.get(runId) ?? {
      runId,
      reportCode: normalized.reportCode,
      fightId: normalized.fightId,
      casts: [],
      buffs: [],
      debuffs: [],
      interrupts: [],
    };
    const master = input.masterByReport.get(normalized.reportCode);
    return auditUtilityV2Run({
      normalized,
      raw,
      masterActors: master?.actors ?? [],
      config,
    });
  });

  const evidenceInventory = runAudits.flatMap((run) =>
    DOMAIN_KEYS.flatMap((d) => run.domains[d].items),
  );

  const perDungeon = aggregateUtilityV2Dungeons(runAudits, expected);
  const dungeonsWithRuns = perDungeon.filter((d) => d.runCount > 0);
  const globalSimulatedScore = equalWeightMean(dungeonsWithRuns.map((d) => d.medianSimulatedScore));

  const aggregateTierCounts = emptyTierCounts();
  const aggregateDomainTierCounts = Object.fromEntries(
    DOMAIN_KEYS.map((d) => [d, emptyTierCounts()]),
  ) as Record<UtilityV2DomainKey, Record<UtilityV2EvidenceTier, number>>;

  const observabilitySummary = Object.fromEntries(
    DOMAIN_KEYS.map((d) => [d, { full: 0, partial: 0, limited: 0, na: 0 }]),
  ) as UtilityV2AuditDataset["global"]["observabilitySummary"];
  const confidenceSummary = Object.fromEntries(
    DOMAIN_KEYS.map((d) => [d, { high: 0, medium: 0, low: 0, na: 0 }]),
  ) as UtilityV2AuditDataset["global"]["confidenceSummary"];

  for (const run of runAudits) {
    for (const d of DOMAIN_KEYS) {
      const dom = run.domains[d];
      for (const tier of config.evidenceTiers) {
        aggregateTierCounts[tier] += dom.tierCounts[tier];
        aggregateDomainTierCounts[d][tier] += dom.tierCounts[tier];
      }
      if (!dom.applicable) {
        observabilitySummary[d].na += 1;
        confidenceSummary[d].na += 1;
        continue;
      }
      if (dom.observability === "FULL") observabilitySummary[d].full += 1;
      else if (dom.observability === "PARTIAL") observabilitySummary[d].partial += 1;
      else observabilitySummary[d].limited += 1;
      if (dom.confidence === "HIGH") confidenceSummary[d].high += 1;
      else if (dom.confidence === "MEDIUM") confidenceSummary[d].medium += 1;
      else confidenceSummary[d].low += 1;
    }
  }

  const sensitivityAnalysis = runUtilityV2Sensitivity(
    runAudits,
    perDungeon,
    config.sensitivityScenarios.map((s) => ({
      id: s.id,
      label: s.label,
      weightOverrides: "weightOverrides" in s ? s.weightOverrides : undefined,
      tierMultiplier: s.tierMultiplier,
      applyMissedOpportunityPenalty: s.applyMissedOpportunityPenalty,
    })),
    config,
  );

  return {
    auditVersion: config.version,
    scoredAt: input.scoredAt,
    config,
    subject: input.subject,
    evidenceInventory,
    runAudits,
    perDungeon,
    global: {
      neutralBaseline: config.neutralBaseline,
      simulatedScore: globalSimulatedScore,
      deltaFromNeutral:
        globalSimulatedScore != null
          ? Math.round((globalSimulatedScore - config.neutralBaseline) * 100) / 100
          : null,
      runCount: runAudits.length,
      dungeonCount: dungeonsWithRuns.length,
      aggregateTierCounts,
      aggregateDomainTierCounts,
      observabilitySummary,
      confidenceSummary,
    },
    sensitivityAnalysis,
    diagnostics: {
      rejectedV1Reasons: [
        "V1 scored absence of confirmed action as zero without confirmed opportunity context",
        "V1 diminishing-return caps calibrated from Wallidrixe medians/maxima",
        "V1 excluded Curse of Tongues, Blight of Tongues, Shadowmeld, and under-valued Gateway",
        "V1 under-valued strategic CC and cross-stream cast stops",
      ],
      rawDatasetCoverage: {
        runsWithCasts: [...input.rawByRunId.values()].filter((r) => r.casts.length > 0).length,
        runsWithBuffsDebuffs: [...input.rawByRunId.values()].filter(
          (r) => r.buffs.length > 0 || r.debuffs.length > 0,
        ).length,
      },
      notes: [...config.notes],
    },
  };
}

export function isInterruptCategory(category: AbilityCategory): boolean {
  return category === "INTERRUPT";
}
