import type {
  RunCombatFacts,
  RunCombatFactsCoverage,
  RunCombatFactsLimitations,
  WclAuraEvent,
  WclCastEvent,
  WclCombatantInfo,
  WclDamageTakenEvent,
  WclDeathEvent,
  WclDispelEvent,
  WclHealingEvent,
  WclInterruptEvent,
} from "../types.js";
import { wclError } from "../client/errors.js";
import { buildActorMap, resolveActorSourceIdStrict, resolveAttributedSourceIds } from "../discovery/run-matching.js";

export interface BuildCombatFactsInput {
  reportCode: string;
  fightId: number;
  revision: number;
  characterName: string;
  realmSlug: string;
  actors: Array<{ id: number; name: string; type: string; subType?: string | null; server?: string | null }>;
  eventsByType: Record<string, unknown>;
  alreadyFetched?: boolean;
}

export function buildRunCombatFacts(input: BuildCombatFactsInput): RunCombatFacts {
  const actorMap = buildActorMap(input.actors);
  const resolved = resolveActorSourceIdStrict(actorMap, input.characterName, input.realmSlug);
  if ("error" in resolved) {
    throw wclError(
      resolved.error === "AMBIGUOUS" ? "INVALID_RESPONSE" : "NOT_FOUND",
      resolved.message,
      { actorResolution: resolved.error },
    );
  }
  const targetSourceId = resolved.sourceId;
  const attributedSourceIds = resolveAttributedSourceIds(
    actorMap,
    targetSourceId,
    input.characterName,
  );
  const attributedSet = new Set(attributedSourceIds);

  const coverage: RunCombatFactsCoverage = {
    casts: false,
    interrupts: false,
    deaths: false,
    damageTaken: false,
    auras: false,
    dispels: false,
    healing: false,
    combatantInfo: false,
  };
  const limitations: RunCombatFactsLimitations = {
    missingCategories: [],
    truncatedPages: [],
    notes: input.alreadyFetched ? ["Duplicate detailed fetch skipped — revision unchanged"] : [],
  };

  const casts = mapEvents(input.eventsByType.Casts, mapCastEvent).filter((e) =>
    attributedSet.has(e.sourceId),
  );
  const interrupts = mapEvents(input.eventsByType.Interrupts, mapInterruptEvent).filter((e) =>
    attributedSet.has(e.sourceId),
  );
  const deaths = mapEvents(input.eventsByType.Deaths, mapDeathEvent);
  const damageTaken = mapEvents(input.eventsByType.DamageTaken, mapDamageTakenEvent);
  const buffs = mapEvents(input.eventsByType.Buffs, (e) => mapAuraEvent(e, "apply"));
  const debuffs = mapEvents(input.eventsByType.Debuffs, (e) => mapAuraEvent(e, "apply")).filter(
    (e) => attributedSet.has(e.sourceId),
  );
  const dispels = mapEvents(input.eventsByType.Dispels, mapDispelEvent).filter((e) =>
    attributedSet.has(e.sourceId),
  );
  const healing = mapEvents(input.eventsByType.Healing, mapHealingEvent);

  if (casts.length) coverage.casts = true;
  if (interrupts.length) coverage.interrupts = true;
  if (deaths.length) coverage.deaths = true;
  if (damageTaken.length) coverage.damageTaken = true;
  if (buffs.length || debuffs.length) coverage.auras = true;
  if (dispels.length) coverage.dispels = true;
  if (healing.length) coverage.healing = true;

  let combatantInfo: WclCombatantInfo | null = null;
  const combatantRows = mapEvents(input.eventsByType.CombatantInfo, (e) => e);
  if (combatantRows.length) {
    const row = combatantRows[0]!;
    combatantInfo = {
      sourceId: targetSourceId,
      specId: typeof row.specID === "number" ? row.specID : null,
      gear: row.gear ?? null,
      talents: row.talents ?? null,
      artifactTraits: row.artifactTraits ?? null,
    };
    coverage.combatantInfo = true;
  }

  for (const [category, raw] of Object.entries(input.eventsByType)) {
    if (category.startsWith("_")) continue;
    if (raw && typeof raw === "object" && (raw as Record<string, unknown>)._truncated) {
      limitations.truncatedPages.push(category);
    }
  }

  return {
    reportCode: input.reportCode,
    fightId: input.fightId,
    revision: input.revision,
    targetSourceId,
    attributedSourceIds,
    actorMap,
    casts,
    interrupts,
    deaths,
    damageTaken,
    auras: [...buffs, ...debuffs],
    dispels,
    healing,
    combatantInfo,
    coverage,
    limitations,
  };
}

function mapEvents<T>(raw: unknown, mapper: (row: Record<string, unknown>) => T): T[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const container = raw as { data?: unknown };
  if (!Array.isArray(container.data)) {
    return [];
  }
  return container.data.map((row) => mapper(row as Record<string, unknown>));
}

function num(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

function mapCastEvent(row: Record<string, unknown>): WclCastEvent {
  const ability = row.ability as Record<string, unknown> | undefined;
  return {
    timestamp: num(row, "timestamp") ?? 0,
    abilityGameId: num(row, "abilityGameID") ?? (ability ? num(ability, "guid") : null) ?? 0,
    sourceId: num(row, "sourceID") ?? 0,
    targetId: num(row, "targetID"),
  };
}

function mapInterruptEvent(row: Record<string, unknown>): WclInterruptEvent {
  const extra = row.extraAbility as Record<string, unknown> | undefined;
  return {
    timestamp: num(row, "timestamp") ?? 0,
    abilityGameId: num(row, "abilityGameID") ?? 0,
    sourceId: num(row, "sourceID") ?? 0,
    targetId: num(row, "targetID"),
    interruptedAbilityGameId: extra ? num(extra, "abilityGameID") : null,
  };
}

function mapDeathEvent(row: Record<string, unknown>): WclDeathEvent {
  return {
    timestamp: num(row, "timestamp") ?? 0,
    sourceId: num(row, "sourceID") ?? 0,
    targetId: num(row, "targetID") ?? 0,
    killerId: num(row, "killerID"),
    abilityGameId: num(row, "abilityGameID"),
  };
}

function mapDamageTakenEvent(row: Record<string, unknown>): WclDamageTakenEvent {
  return {
    timestamp: num(row, "timestamp") ?? 0,
    sourceId: num(row, "sourceID"),
    targetId: num(row, "targetID") ?? 0,
    abilityGameId: num(row, "abilityGameID") ?? 0,
    amount: num(row, "amount") ?? 0,
  };
}

function mapAuraEvent(row: Record<string, unknown>, fallbackType: WclAuraEvent["type"]): WclAuraEvent {
  const rawType = row.type;
  let type: WclAuraEvent["type"] = fallbackType;
  if (rawType === "remove" || rawType === "refresh" || rawType === "apply") {
    type = rawType;
  }
  return {
    timestamp: num(row, "timestamp") ?? 0,
    type,
    abilityGameId: num(row, "abilityGameID") ?? 0,
    sourceId: num(row, "sourceID") ?? 0,
    targetId: num(row, "targetID") ?? 0,
  };
}

function mapDispelEvent(row: Record<string, unknown>): WclDispelEvent {
  const extra = row.extraAbility as Record<string, unknown> | undefined;
  return {
    timestamp: num(row, "timestamp") ?? 0,
    abilityGameId: num(row, "abilityGameID") ?? 0,
    sourceId: num(row, "sourceID") ?? 0,
    targetId: num(row, "targetID") ?? 0,
    dispelledAbilityGameId: extra ? num(extra, "abilityGameID") : null,
  };
}

function mapHealingEvent(row: Record<string, unknown>): WclHealingEvent {
  return {
    timestamp: num(row, "timestamp") ?? 0,
    abilityGameId: num(row, "abilityGameID") ?? 0,
    sourceId: num(row, "sourceID") ?? 0,
    targetId: num(row, "targetID") ?? 0,
    amount: num(row, "amount") ?? 0,
    overheal: num(row, "overheal"),
  };
}
