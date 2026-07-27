import type { WclGraphQlClient } from "../client/graphql-client.js";
import { eventsPageSchema, parseWithSchema } from "../client/graphql-client.js";
import { wclError } from "../client/errors.js";
import { DETAILED_EVENT_TYPES, OPERATIONS, type EventDataType } from "../operations/queries.js";
import {
  MAX_EVENT_PAGES,
  MAX_EVENTS_PER_CATEGORY,
} from "../discovery/bounds.js";
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
  WclRateBudgetDecision,
} from "../types.js";
import { buildActorMap, resolveActorSourceIdStrict } from "../discovery/run-matching.js";
import { shouldDeferExpensiveWork } from "../rate/rate-budget.js";

export interface FetchCombatFactsInput {
  reportCode: string;
  fightId: number;
  revision: number;
  characterName: string;
  realmSlug: string;
  actors: Array<{ id: number; name: string; type: string; subType?: string | null; server?: string | null }>;
  eventLimit?: number;
  includeHealing?: boolean;
  /** Optional rate budget gate checked before each event category. */
  rateBudget?: WclRateBudgetDecision | null;
  maxEventPages?: number;
  maxEventsPerCategory?: number;
}

export async function fetchAllEventPages(
  client: WclGraphQlClient,
  input: {
    reportCode: string;
    fightId: number;
    dataType: EventDataType;
    sourceId: number | null;
    eventLimit?: number;
    maxEventPages?: number;
    maxEventsPerCategory?: number;
  },
): Promise<{ events: Array<Record<string, unknown>>; truncated: boolean }> {
  const all: Array<Record<string, unknown>> = [];
  let startTime: number | undefined;
  let pages = 0;
  let truncated = false;
  const seenTimestamps = new Set<number>();
  const maxPages = input.maxEventPages ?? MAX_EVENT_PAGES;
  const maxEvents = input.maxEventsPerCategory ?? MAX_EVENTS_PER_CATEGORY;

  while (pages < maxPages) {
    const result = await client.request({
      operationName: OPERATIONS.ReportEvents.operationName,
      query: OPERATIONS.ReportEvents.query,
      variables: {
        code: input.reportCode,
        fightIDs: [input.fightId],
        dataType: input.dataType,
        sourceID: input.sourceId ?? undefined,
        startTime,
        limit: input.eventLimit ?? 1000,
        translate: false,
        useAbilityIDs: false,
        useActorIDs: false,
      },
    });

    const parsed = parseWithSchema(eventsPageSchema, result.response.data, "ReportEvents");
    const page = parsed.reportData.report?.events;
    if (!page) {
      break;
    }

    all.push(...(page.data ?? []));
    pages += 1;

    if (all.length >= maxEvents) {
      truncated = true;
      all.length = maxEvents;
      break;
    }

    if (page.nextPageTimestamp == null) {
      break;
    }
    if (seenTimestamps.has(page.nextPageTimestamp)) {
      truncated = true;
      break;
    }
    seenTimestamps.add(page.nextPageTimestamp);
    startTime = page.nextPageTimestamp;
  }

  if (pages >= maxPages) {
    truncated = true;
  }

  return { events: all, truncated };
}

export async function buildRunCombatFactsFromEvents(
  client: WclGraphQlClient,
  input: FetchCombatFactsInput,
): Promise<RunCombatFacts> {
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
    notes: [],
  };

  const casts: WclCastEvent[] = [];
  const interrupts: WclInterruptEvent[] = [];
  const deaths: WclDeathEvent[] = [];
  const damageTaken: WclDamageTakenEvent[] = [];
  const auras: WclAuraEvent[] = [];
  const dispels: WclDispelEvent[] = [];
  const healing: WclHealingEvent[] = [];
  let combatantInfo: WclCombatantInfo | null = null;

  const typesToFetch = input.includeHealing
    ? DETAILED_EVENT_TYPES
    : DETAILED_EVENT_TYPES.filter((t) => t !== "Healing");

  for (const dataType of typesToFetch) {
    if (input.rateBudget && shouldDeferExpensiveWork(input.rateBudget)) {
      limitations.notes.push(
        `Rate budget ${input.rateBudget.action} — stopped before event type ${dataType}`,
      );
      limitations.missingCategories.push(...typesToFetch.slice(typesToFetch.indexOf(dataType)));
      break;
    }

    const { events, truncated } = await fetchAllEventPages(client, {
      reportCode: input.reportCode,
      fightId: input.fightId,
      dataType,
      sourceId: targetSourceId,
      eventLimit: input.eventLimit,
      maxEventPages: input.maxEventPages,
      maxEventsPerCategory: input.maxEventsPerCategory,
    });

    if (truncated) {
      limitations.truncatedPages.push(dataType);
    }

    switch (dataType) {
      case "Casts":
        casts.push(...events.map(mapCastEvent));
        coverage.casts = true;
        break;
      case "Interrupts":
        interrupts.push(...events.map(mapInterruptEvent));
        coverage.interrupts = true;
        break;
      case "Deaths":
        deaths.push(...events.map(mapDeathEvent));
        coverage.deaths = true;
        break;
      case "DamageTaken":
        damageTaken.push(...events.map(mapDamageTakenEvent));
        coverage.damageTaken = true;
        break;
      case "Buffs":
      case "Debuffs":
        auras.push(...events.map((e) => mapAuraEvent(e, dataType === "Buffs" ? "apply" : "apply")));
        coverage.auras = true;
        break;
      case "Dispels":
        dispels.push(...events.map(mapDispelEvent));
        coverage.dispels = true;
        break;
      case "Healing":
        healing.push(...events.map(mapHealingEvent));
        coverage.healing = true;
        break;
      case "CombatantInfo": {
        const first = events[0];
        if (first) {
          combatantInfo = {
            sourceId: targetSourceId,
            specId: num(first, "specID"),
            maxHitPoints:
              num(first, "maxHitPoints") ??
              num(first, "maxHitpoints") ??
              num(first, "hitPoints"),
            gear: first.gear ?? null,
            talents: first.talents ?? null,
            artifactTraits: first.artifactTraits ?? null,
          };
          coverage.combatantInfo = true;
        }
        break;
      }
      default:
        break;
    }
  }

  for (const required of ["casts", "interrupts", "deaths", "damageTaken"] as const) {
    if (!coverage[required]) {
      limitations.missingCategories.push(required);
    }
  }

  return {
    reportCode: input.reportCode,
    fightId: input.fightId,
    revision: input.revision,
    targetSourceId,
    actorMap,
    casts,
    interrupts,
    deaths,
    damageTaken,
    auras,
    dispels,
    healing,
    combatantInfo,
    coverage,
    limitations,
  };
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
