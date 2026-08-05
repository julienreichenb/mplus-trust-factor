/**
 * Incremental page processing for capability-scoped evidence.
 * Retains only capability-relevant compact events; never feeds scorers raw pages.
 */
import {
  dimensionTagsForRule,
  getAllRegisteredRules,
  type AbilityDimensionTag,
  type AbilityRule,
} from "@mplus/abilities";
import type {
  CapabilityCompactEvent,
  CapabilityUnknownAbilitySummary,
  EvidenceCapability,
} from "@mplus/contracts";
import { normalizeWclEventFields } from "../../normalize/wcl-event-normalizer.js";
import { collectRuleEvidenceSpellIds } from "./relevant-ability-ids.js";

type SourceKind = "PLAYER" | "OWNED_PET_OR_GUARDIAN" | "OTHER";

function buildSpellRuleIndex(rules: AbilityRule[]): Map<number, AbilityRule[]> {
  const map = new Map<number, AbilityRule[]>();
  for (const rule of rules) {
    for (const id of collectRuleEvidenceSpellIds(rule)) {
      const list = map.get(id) ?? [];
      list.push(rule);
      map.set(id, list);
    }
  }
  return map;
}

function sourceKindFor(
  actorId: number | null,
  playerIds: Set<number>,
  ownerByActor: Map<number, number>,
): SourceKind {
  if (actorId == null) return "OTHER";
  if (playerIds.has(actorId)) return "PLAYER";
  if (ownerByActor.has(actorId)) return "OWNED_PET_OR_GUARDIAN";
  return "OTHER";
}

function capabilitiesForRule(
  rule: AbilityRule,
  wanted: ReadonlySet<EvidenceCapability>,
): EvidenceCapability[] {
  const tags = new Set<AbilityDimensionTag>(dimensionTagsForRule(rule));
  const out: EvidenceCapability[] = [];
  const push = (cap: EvidenceCapability, tag: AbilityDimensionTag) => {
    if (wanted.has(cap) && tags.has(tag)) out.push(cap);
  };
  push("PERFORMANCE_OFFENSIVE_ACTIVATIONS", "PERFORMANCE_OFFENSIVE_COOLDOWN");
  push("SURVIVAL_DEFENSIVE_ACTIVATIONS", "SURVIVAL_PERSONAL_DEFENSIVE");
  push("SURVIVAL_RECOVERY_ACTIVATIONS", "SURVIVAL_RECOVERY");
  push("UTILITY_INTERRUPTS", "UTILITY_INTERRUPT");
  push("UTILITY_DISPELS", "UTILITY_DISPEL");
  push("UTILITY_CROWD_CONTROL", "UTILITY_CROWD_CONTROL");
  if (
    wanted.has("UTILITY_EXTERNAL_CASTS") &&
    (tags.has("UTILITY_EXTERNAL") || tags.has("UTILITY_COMBAT_RES"))
  ) {
    out.push("UTILITY_EXTERNAL_CASTS");
  }
  if (
    wanted.has("UTILITY_EXTERNAL_TARGET_CONTEXT") &&
    (tags.has("UTILITY_EXTERNAL") ||
      tags.has("UTILITY_COMBAT_RES") ||
      tags.has("SURVIVAL_PERSONAL_DEFENSIVE"))
  ) {
    out.push("UTILITY_EXTERNAL_TARGET_CONTEXT");
  }
  return [...new Set(out)];
}

export interface PageProcessorState {
  compactEvents: CapabilityCompactEvent[];
  unknownSummaries: Map<number, CapabilityUnknownAbilitySummary>;
  eventsBeforeFilter: number;
  eventsAfterFilter: number;
  eventSeq: number;
}

export function createPageProcessorState(): PageProcessorState {
  return {
    compactEvents: [],
    unknownSummaries: new Map(),
    eventsBeforeFilter: 0,
    eventsAfterFilter: 0,
    eventSeq: 0,
  };
}

export function processCapabilityEvidencePage(input: {
  state: PageProcessorState;
  dataset: string;
  rawEvents: Array<Record<string, unknown>>;
  mode: "PRODUCTION_CAPABILITY_ACQUISITION" | "PROBE_DISCOVERY_ACQUISITION";
  capabilitySet: readonly EvidenceCapability[];
  friendlyPlayerActorIds: readonly number[];
  ownerByActor: Map<number, number>;
  relevantAbilityIds: ReadonlySet<number>;
  rules?: readonly AbilityRule[];
  /** Max unknown summaries retained in production packages. */
  maxUnknownSummaries?: number;
}): void {
  const wanted = new Set(input.capabilitySet);
  const playerIds = new Set(input.friendlyPlayerActorIds);
  const spellIndex = buildSpellRuleIndex(
    input.rules ? [...input.rules] : getAllRegisteredRules(),
  );
  const maxUnknown = input.maxUnknownSummaries ?? 200;

  for (const raw of input.rawEvents) {
    input.state.eventsBeforeFilter += 1;
    const fields = normalizeWclEventFields(raw);
    const timestampMs = fields.timestampMs.value;
    if (timestampMs == null) continue;

    const sourceActorId = fields.sourceActorId.value;
    const targetActorId = fields.targetActorId.value;
    const sourceKind = sourceKindFor(sourceActorId, playerIds, input.ownerByActor);
    const sourceOwnerPlayerActorId =
      sourceKind === "PLAYER"
        ? sourceActorId
        : sourceKind === "OWNED_PET_OR_GUARDIAN" && sourceActorId != null
          ? (input.ownerByActor.get(sourceActorId) ?? null)
          : null;
    const targetPlayerActorId =
      targetActorId != null && playerIds.has(targetActorId) ? targetActorId : null;

    const amount =
      typeof (raw as { amount?: unknown }).amount === "number"
        ? ((raw as { amount: number }).amount)
        : null;

    if (input.dataset === "DamageTaken") {
      const involvesFriendlyVictim =
        targetPlayerActorId != null ||
        (sourceActorId != null && playerIds.has(sourceActorId));
      if (!involvesFriendlyVictim) continue;
      if (!wanted.has("SURVIVAL_DAMAGE_TAKEN")) continue;
      input.state.eventSeq += 1;
      input.state.eventsAfterFilter += 1;
      input.state.compactEvents.push({
        eventId: `DamageTaken:${input.state.eventSeq}:${timestampMs}`,
        timestampMs,
        dataset: "DamageTaken",
        eventType: fields.eventType.value,
        spellId: fields.abilityId.value,
        rawName: fields.rawAbilityName.value,
        sourceActorId,
        sourceOwnerPlayerActorId,
        targetActorId,
        targetPlayerActorId:
          targetPlayerActorId ??
          (sourceActorId != null && playerIds.has(sourceActorId) ? sourceActorId : null),
        amount,
        capabilities: ["SURVIVAL_DAMAGE_TAKEN"],
      });
      continue;
    }

    if (input.dataset === "Deaths") {
      if (!wanted.has("SURVIVAL_DEATHS")) continue;
      if (targetPlayerActorId == null && !(sourceActorId != null && playerIds.has(sourceActorId))) {
        continue;
      }
      input.state.eventSeq += 1;
      input.state.eventsAfterFilter += 1;
      input.state.compactEvents.push({
        eventId: `Deaths:${input.state.eventSeq}:${timestampMs}`,
        timestampMs,
        dataset: "Deaths",
        eventType: fields.eventType.value,
        spellId: fields.abilityId.value,
        rawName: fields.rawAbilityName.value,
        sourceActorId,
        sourceOwnerPlayerActorId,
        targetActorId,
        targetPlayerActorId:
          targetPlayerActorId ??
          (sourceActorId != null && playerIds.has(sourceActorId) ? sourceActorId : null),
        capabilities: ["SURVIVAL_DEATHS"],
      });
      continue;
    }

    if (input.dataset === "Interrupts" && wanted.has("UTILITY_INTERRUPTS")) {
      if (sourceOwnerPlayerActorId == null) continue;
      input.state.eventSeq += 1;
      input.state.eventsAfterFilter += 1;
      input.state.compactEvents.push({
        eventId: `Interrupts:${input.state.eventSeq}:${timestampMs}`,
        timestampMs,
        dataset: "Interrupts",
        eventType: fields.eventType.value,
        spellId: fields.abilityId.value,
        rawName: fields.rawAbilityName.value,
        sourceActorId,
        sourceOwnerPlayerActorId,
        targetActorId,
        targetPlayerActorId,
        capabilities: ["UTILITY_INTERRUPTS"],
      });
      continue;
    }

    if (input.dataset === "Dispels" && wanted.has("UTILITY_DISPELS")) {
      if (sourceOwnerPlayerActorId == null) continue;
      input.state.eventSeq += 1;
      input.state.eventsAfterFilter += 1;
      input.state.compactEvents.push({
        eventId: `Dispels:${input.state.eventSeq}:${timestampMs}`,
        timestampMs,
        dataset: "Dispels",
        eventType: fields.eventType.value,
        spellId: fields.abilityId.value,
        rawName: fields.rawAbilityName.value,
        sourceActorId,
        sourceOwnerPlayerActorId,
        targetActorId,
        targetPlayerActorId,
        capabilities: ["UTILITY_DISPELS"],
      });
      continue;
    }

    const spellId = fields.abilityId.value;
    if (spellId == null) continue;

    const involvesFriendly =
      sourceOwnerPlayerActorId != null ||
      targetPlayerActorId != null ||
      (sourceActorId != null && playerIds.has(sourceActorId));
    if (!involvesFriendly) continue;

    const ruleCandidates = spellIndex.get(spellId) ?? [];
    const rule = ruleCandidates[0] ?? null;

    if (input.mode === "PRODUCTION_CAPABILITY_ACQUISITION") {
      if (!input.relevantAbilityIds.has(spellId) || !rule) {
        // Bounded unknown summary only — never retain full unknown timelines.
        const existing = input.state.unknownSummaries.get(spellId);
        const rawName = fields.rawAbilityName.value;
        const eventType = fields.eventType.value ?? "unknown";
        if (existing) {
          existing.count += 1;
          if (rawName && existing.rawName == null) existing.rawName = rawName;
          if (!existing.eventTypes.includes(eventType)) existing.eventTypes.push(eventType);
          if (!existing.actorOwnership.includes(sourceKind)) {
            existing.actorOwnership.push(sourceKind);
          }
          existing.lastTimestampMs = timestampMs;
        } else if (input.state.unknownSummaries.size < maxUnknown) {
          input.state.unknownSummaries.set(spellId, {
            spellId,
            rawName,
            eventTypes: [eventType],
            actorOwnership: [sourceKind],
            count: 1,
            firstTimestampMs: timestampMs,
            lastTimestampMs: timestampMs,
            reasonExcluded: "NOT_IN_REVIEWED_CATALOG_FILTER",
          });
        }
        continue;
      }
    } else if (!rule) {
      // Probe discovery: still bound unknowns; do not keep full timelines.
      const existing = input.state.unknownSummaries.get(spellId);
      if (existing) {
        existing.count += 1;
        existing.lastTimestampMs = timestampMs;
      } else if (input.state.unknownSummaries.size < maxUnknown) {
        input.state.unknownSummaries.set(spellId, {
          spellId,
          rawName: fields.rawAbilityName.value,
          eventTypes: [fields.eventType.value ?? "unknown"],
          actorOwnership: [sourceKind],
          count: 1,
          firstTimestampMs: timestampMs,
          lastTimestampMs: timestampMs,
          reasonExcluded: "PROBE_UNMATCHED_FOR_DISCOVERY",
        });
      }
      continue;
    }

    const caps = capabilitiesForRule(rule!, wanted);
    if (caps.length === 0) continue;

    input.state.eventSeq += 1;
    input.state.eventsAfterFilter += 1;
    input.state.compactEvents.push({
      eventId: `${input.dataset}:${input.state.eventSeq}:${spellId}:${timestampMs}`,
      timestampMs,
      dataset: input.dataset,
      eventType: fields.eventType.value,
      spellId,
      rawName: fields.rawAbilityName.value,
      sourceActorId,
      sourceOwnerPlayerActorId,
      targetActorId,
      targetPlayerActorId,
      capabilities: caps,
    });
  }
}
