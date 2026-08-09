import type { AbilityCatalog, AbilityRole, AbilityRule } from "@mplus/abilities";
import {
  dimensionTagsForRule,
  getAllRegisteredRules,
  normalizeRetailClassSlug,
  projectOffensiveActivations,
  ruleResolvableSpellIds,
  rulesForSpell,
} from "@mplus/abilities";
import {
  isMalformedTimestamp,
  normalizeWclEventFields,
  sanitizeUnresolvedEventShape,
  WCL_ABILITY_ID_SOURCE_PATHS,
  WCL_SOURCE_ACTOR_ID_SOURCE_PATHS,
  WCL_TARGET_ACTOR_ID_SOURCE_PATHS,
} from "../../normalize/wcl-event-normalizer.js";
import type {
  OffensiveProbeAbilityInventoryRow,
  OffensiveProbeCatalogMatch,
  OffensiveProbePersistenceSection,
  OffensiveProbeDataLoad,
  OffensiveProbeDataLoadMode,
  OffensiveProbeDiagnostics,
  OffensiveProbeEvidenceIntegrity,
  OffensiveProbeEventInput,
  OffensiveProbeFightSelection,
  OffensiveProbeParticipantReport,
  OffensiveProbeReport,
  OffensiveProbeTimelineEntry,
  OffensiveSourceKind,
} from "./types.js";

const MAX_UNRESOLVED_SAMPLES = 10;

export interface BuildOffensiveProbeReportInput {
  selection: OffensiveProbeFightSelection;
  casts: Array<Record<string, unknown>>;
  buffs: Array<Record<string, unknown>>;
  catalog: AbilityCatalog;
  dataLoad: OffensiveProbeDataLoad;
  eventSource?: OffensiveProbeDataLoadMode;
  persistence?: OffensiveProbePersistenceSection;
  generatedAt?: string;
  /** When provided, builds per-participant deduplicated activation reports. */
  participants?: Array<{
    playerActorId: number;
    characterName: string;
    classSlug: string | null;
    specSlug: string | null;
    role?: AbilityRole | null;
    ownedPetActorIds: number[];
  }>;
  evidenceIntegrity?: Partial<OffensiveProbeEvidenceIntegrity>;
}

function classifySourceKind(
  sourceActorId: number | null,
  selection: OffensiveProbeFightSelection,
): OffensiveSourceKind {
  if (sourceActorId == null) return "OTHER";
  if (sourceActorId === selection.playerActorId) return "PLAYER";
  if (selection.ownedPetActorIds.includes(sourceActorId)) return "OWNED_PET_OR_GUARDIAN";
  return "OTHER";
}

function catalogMatchForSpell(
  spellId: number,
  catalog: AbilityCatalog,
  classSlug: string | null,
  specSlug: string | null,
  role: AbilityRole | null = null,
): OffensiveProbeCatalogMatch {
  const normalizedClass = normalizeRetailClassSlug(classSlug);
  const rules = rulesForSpell(catalog, spellId).filter((rule) =>
    ruleMatchesParticipant(rule, normalizedClass, specSlug, role),
  );
  if (rules.length === 0) {
    return {
      matched: false,
      canonicalKey: null,
      canonicalName: null,
      catalogCategory: null,
      matchKind: null,
    };
  }
  const rule = rules[0]!;
  const primaryId = rule.spellIds[0] ?? spellId;
  const isAlias = spellId !== primaryId && (rule.aliases ?? []).includes(spellId);
  return {
    matched: true,
    canonicalKey: rule.canonicalKey,
    canonicalName: rule.name,
    catalogCategory: rule.category,
    matchKind: isAlias ? "ALIAS_SPELL_ID" : "PRIMARY_SPELL_ID",
  };
}

function incrementCount(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function isBuffApply(eventType: string | null): boolean {
  return eventType === "apply" || eventType === "applybuff" || eventType === "refreshbuff";
}

function isCastEvent(eventType: string | null, dataset: "Casts" | "Buffs"): boolean {
  if (dataset !== "Casts") return false;
  return (
    eventType == null ||
    eventType === "cast" ||
    eventType === "begincast" ||
    eventType === "prepare" ||
    eventType === "startcast"
  );
}

function ruleMatchesParticipant(
  rule: AbilityRule,
  classSlug: string | null,
  specSlug: string | null,
  role: AbilityRole | null,
): boolean {
  if (rule.classSlug != null && classSlug && rule.classSlug !== classSlug) return false;
  if (rule.specSlugs.length > 0 && specSlug && !rule.specSlugs.includes(specSlug)) {
    return false;
  }
  if (role && rule.roles.length > 0 && !rule.roles.includes(role)) {
    return false;
  }
  return true;
}

function offensiveRulesForParticipant(
  classSlug: string | null,
  specSlug: string | null,
  role: AbilityRole | null = null,
): AbilityRule[] {
  const normalizedClass = normalizeRetailClassSlug(classSlug);
  return getAllRegisteredRules().filter((rule) => {
    if (!dimensionTagsForRule(rule).includes("PERFORMANCE_OFFENSIVE_COOLDOWN")) return false;
    return ruleMatchesParticipant(rule, normalizedClass, specSlug, role);
  });
}

function spellIdsForRule(rule: AbilityRule): Set<number> {
  return new Set(ruleResolvableSpellIds(rule));
}

export function buildOffensiveParticipantActivationReports(input: {
  participants: Array<{
    playerActorId: number;
    characterName: string;
    classSlug: string | null;
    specSlug: string | null;
    role?: AbilityRole | null;
    ownedPetActorIds: number[];
  }>;
  casts: Array<Record<string, unknown>>;
  buffs: Array<Record<string, unknown>>;
}): OffensiveProbeParticipantReport[] {
  const rows: OffensiveProbeEventInput[] = [
    ...input.casts.map((row, index) => ({ dataset: "Casts" as const, row, index })),
    ...input.buffs.map((row, index) => ({ dataset: "Buffs" as const, row, index })),
  ];

  return input.participants.map((participant) => {
    const owned = new Set([participant.playerActorId, ...participant.ownedPetActorIds]);
    const classSlug = normalizeRetailClassSlug(participant.classSlug);
    const role = participant.role ?? null;
    const rules = offensiveRulesForParticipant(classSlug, participant.specSlug, role);
    const spellToKey = new Map<number, string>();
    for (const rule of rules) {
      for (const spellId of spellIdsForRule(rule)) {
        spellToKey.set(spellId, rule.canonicalKey);
      }
    }

    const seenEventKeys = new Set<string>();
    const activationEvents = [];
    for (const event of rows) {
      const fields = normalizeWclEventFields(event.row);
      const sourceId = fields.sourceActorId.value;
      const spellId = fields.abilityId.value;
      const timestampMs = fields.timestampMs.value;
      if (sourceId == null || spellId == null || timestampMs == null) continue;
      if (!owned.has(sourceId)) continue;
      const eventType = fields.eventType.value;
      // Collapse duplicate pages/scopes that repeat the same physical WCL event.
      const dedupeKey = [
        event.dataset,
        timestampMs,
        sourceId,
        spellId,
        eventType ?? "",
      ].join("|");
      if (seenEventKeys.has(dedupeKey)) continue;
      seenEventKeys.add(dedupeKey);
      const canonicalKey = spellToKey.get(spellId) ?? null;
      if (!canonicalKey) continue;
      activationEvents.push({
        eventId: `${event.dataset}:${event.index}:${timestampMs}:${spellId}`,
        timestampMs,
        eventType,
        spellId,
        canonicalKey,
        sourceOwnerPlayerActorId: participant.playerActorId,
        sourceActorId: sourceId,
        targetPlayerActorId: fields.targetActorId.value,
      });
    }

    const projection = projectOffensiveActivations({
      events: activationEvents,
      rules,
    });

    return {
      playerActorId: participant.playerActorId,
      characterName: participant.characterName,
      classSlug,
      specSlug: participant.specSlug,
      role,
      ownedPetActorIds: participant.ownedPetActorIds,
      rawMatchedActivationEventCount: projection.rawRetainedEventCount,
      deduplicatedActivationCount: projection.deduplicatedActivationCount,
      canonicalKeysActivated: Object.keys(projection.byCanonicalKey).sort(),
      activations: projection.activations.map((activation) => ({
        activationId: activation.activationId,
        canonicalKey: activation.canonicalKey,
        primarySpellId: activation.primarySpellId,
        timestampMs: activation.timestampMs,
        rawMatchedEventCount: activation.contributingEventIds.length,
        contributingSpellIds: activation.contributingSpellIds,
        observedSpellIds: [...new Set(activation.contributingSpellIds)].sort(
          (a, b) => a - b,
        ),
        targetActorId: activation.targetPlayerActorId,
      })),
    };
  });
}

export function buildOffensiveProbeReport(
  input: BuildOffensiveProbeReportInput,
): OffensiveProbeReport {
  const { selection, catalog } = input;
  const eventSource = input.eventSource ?? input.dataLoad.mode;
  const events: OffensiveProbeEventInput[] = [
    ...input.casts.map((row, index) => ({ dataset: "Casts" as const, row, index })),
    ...input.buffs.map((row, index) => ({ dataset: "Buffs" as const, row, index })),
  ];

  const diagnostics: OffensiveProbeDiagnostics = {
    abilityIdSourcePathCounts: {},
    sourceActorIdSourcePathCounts: {},
    targetActorIdSourcePathCounts: {},
    eventTypeCounts: {},
    unresolvedAbilityIdCount: 0,
    malformedTimestampCount: 0,
    playerEventCount: 0,
    ownedPetOrGuardianEventCount: 0,
    otherActorEventCount: 0,
    unresolvedEventSamples: [],
  };

  const inventoryBySpell = new Map<number, OffensiveProbeAbilityInventoryRow>();
  const timeline: OffensiveProbeTimelineEntry[] = [];
  let normalizedEventCount = 0;
  let unresolvedEventCount = 0;

  for (const event of events) {
    const normalized = normalizeWclEventFields(event.row);
    const abilityPath = normalized.abilityId.sourcePath;
    incrementCount(
      diagnostics.abilityIdSourcePathCounts,
      abilityPath ?? "unresolved",
    );
    incrementCount(
      diagnostics.sourceActorIdSourcePathCounts,
      normalized.sourceActorId.sourcePath ?? "unresolved",
    );
    incrementCount(
      diagnostics.targetActorIdSourcePathCounts,
      normalized.targetActorId.sourcePath ?? "unresolved",
    );
    incrementCount(
      diagnostics.eventTypeCounts,
      normalized.eventType.value ?? "missing",
    );

    if (normalized.abilityId.value == null) {
      diagnostics.unresolvedAbilityIdCount += 1;
      unresolvedEventCount += 1;
      if (diagnostics.unresolvedEventSamples.length < MAX_UNRESOLVED_SAMPLES) {
        diagnostics.unresolvedEventSamples.push({
          dataset: event.dataset,
          index: event.index,
          reason: "ability_id_unresolved",
          shape: sanitizeUnresolvedEventShape(event.row),
        });
      }
      continue;
    }

    if (isMalformedTimestamp(normalized.timestampMs.value)) {
      diagnostics.malformedTimestampCount += 1;
      unresolvedEventCount += 1;
      if (diagnostics.unresolvedEventSamples.length < MAX_UNRESOLVED_SAMPLES) {
        diagnostics.unresolvedEventSamples.push({
          dataset: event.dataset,
          index: event.index,
          reason: "malformed_timestamp",
          shape: sanitizeUnresolvedEventShape(event.row),
        });
      }
      continue;
    }

    normalizedEventCount += 1;
    const sourceKind = classifySourceKind(normalized.sourceActorId.value, selection);
    if (sourceKind === "PLAYER") diagnostics.playerEventCount += 1;
    else if (sourceKind === "OWNED_PET_OR_GUARDIAN") {
      diagnostics.ownedPetOrGuardianEventCount += 1;
    } else diagnostics.otherActorEventCount += 1;

    if (sourceKind === "PLAYER" || sourceKind === "OWNED_PET_OR_GUARDIAN") {
      const spellId = normalized.abilityId.value;
      const rawName = normalized.rawAbilityName.value;
      const eventType = normalized.eventType.value;
      const timestampMs = normalized.timestampMs.value!;
      const fightOffsetMs = timestampMs - selection.fightStartMs;

      const existing = inventoryBySpell.get(spellId);
      if (!existing) {
        inventoryBySpell.set(spellId, {
          spellId,
          observedRawNames: rawName ? [rawName] : [],
          eventStreams: [event.dataset],
          eventTypes: eventType ? [eventType] : [],
          sourceActorIds: normalized.sourceActorId.value != null ? [normalized.sourceActorId.value] : [],
          sourceOwnership: [sourceKind],
          castCount: isCastEvent(eventType, event.dataset) ? 1 : 0,
          buffApplyCount: isBuffApply(eventType) ? 1 : 0,
          firstTimestampMs: timestampMs,
          lastTimestampMs: timestampMs,
          catalogMatch: catalogMatchForSpell(
            spellId,
            catalog,
            selection.classSlug,
            selection.specSlug,
          ),
        });
      } else {
        if (rawName && !existing.observedRawNames.includes(rawName)) {
          existing.observedRawNames.push(rawName);
        }
        if (!existing.eventStreams.includes(event.dataset)) {
          existing.eventStreams.push(event.dataset);
        }
        if (eventType && !existing.eventTypes.includes(eventType)) {
          existing.eventTypes.push(eventType);
        }
        if (
          normalized.sourceActorId.value != null &&
          !existing.sourceActorIds.includes(normalized.sourceActorId.value)
        ) {
          existing.sourceActorIds.push(normalized.sourceActorId.value);
        }
        if (!existing.sourceOwnership.includes(sourceKind)) {
          existing.sourceOwnership.push(sourceKind);
        }
        if (isCastEvent(eventType, event.dataset)) existing.castCount += 1;
        if (isBuffApply(eventType)) existing.buffApplyCount += 1;
        if (existing.firstTimestampMs == null || timestampMs < existing.firstTimestampMs) {
          existing.firstTimestampMs = timestampMs;
        }
        if (existing.lastTimestampMs == null || timestampMs > existing.lastTimestampMs) {
          existing.lastTimestampMs = timestampMs;
        }
      }

      const catalogMatch = inventoryBySpell.get(spellId)!.catalogMatch;
      timeline.push({
        reportCode: selection.reportCode,
        fightId: selection.fightId,
        reportRevision: selection.reportRevision,
        dungeonSlug: selection.dungeonSlug,
        spellId,
        rawName,
        canonicalName: catalogMatch.canonicalName,
        eventType,
        dataset: event.dataset,
        rawTimestampMs: timestampMs,
        fightOffsetMs,
        sourceActorId: normalized.sourceActorId.value,
        sourceKind,
        targetActorId: normalized.targetActorId.value,
        abilityIdSourcePath: normalized.abilityId.sourcePath,
        eventSource,
      });
    }
  }

  timeline.sort((a, b) => {
    if (a.rawTimestampMs !== b.rawTimestampMs) return a.rawTimestampMs - b.rawTimestampMs;
    if (a.dataset !== b.dataset) return a.dataset.localeCompare(b.dataset);
    return a.spellId - b.spellId;
  });

  const abilityInventory = [...inventoryBySpell.values()].sort((a, b) => a.spellId - b.spellId);
  const catalogMatchCount = abilityInventory.filter((row) => row.catalogMatch.matched).length;

  // Ensure diagnostic path keys exist even when zero (helps fixture assertions).
  for (const path of WCL_ABILITY_ID_SOURCE_PATHS) {
    diagnostics.abilityIdSourcePathCounts[path] ??= 0;
  }
  for (const path of WCL_SOURCE_ACTOR_ID_SOURCE_PATHS) {
    diagnostics.sourceActorIdSourcePathCounts[path] ??= 0;
  }
  for (const path of WCL_TARGET_ACTOR_ID_SOURCE_PATHS) {
    diagnostics.targetActorIdSourcePathCounts[path] ??= 0;
  }

  const participantReports = buildOffensiveParticipantActivationReports({
    participants: input.participants ?? [
      {
        playerActorId: selection.playerActorId,
        characterName: "unknown",
        classSlug: selection.classSlug,
        specSlug: selection.specSlug,
        ownedPetActorIds: selection.ownedPetActorIds,
      },
    ],
    casts: input.casts,
    buffs: input.buffs,
  });
  const deduplicatedActivationCount = participantReports.reduce(
    (sum, p) => sum + p.deduplicatedActivationCount,
    0,
  );
  const storageSchemesRead = [
    ...new Set(
      (input.dataLoad.storageSchemesRead ?? []).map((scheme) => scheme.toLowerCase()),
    ),
  ].sort();
  const totalProviderCalls =
    input.evidenceIntegrity?.totalProviderCalls ??
    input.dataLoad.totalProviderCalls ??
    input.dataLoad.wclRequests ??
    0;
  const providerCallsDuringReload =
    input.evidenceIntegrity?.providerCallsDuringReload ??
    input.dataLoad.providerCallsDuringReload ??
    input.persistence?.providerCallsDuringReload ??
    0;
  const fillersExcluded = input.evidenceIntegrity?.fillersExcluded ?? true;
  const evidenceIntegrity: OffensiveProbeEvidenceIntegrity = {
    totalProviderCalls,
    providerCallsDuringReload,
    storageSchemesRead,
    fillersExcluded,
    allFiveParticipantsResolved:
      input.evidenceIntegrity?.allFiveParticipantsResolved ??
      participantReports.length === 5,
    participantCount: participantReports.length,
  };

  return {
    schemaVersion: "wcl-offensive-one-fight-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    selection,
    dataLoad: {
      ...input.dataLoad,
      storageSchemesRead,
      totalProviderCalls,
      providerCallsDuringReload,
    },
    persistence: input.persistence,
    rawEventCounts: {
      casts: input.casts.length,
      buffs: input.buffs.length,
    },
    diagnostics,
    abilityInventory,
    timeline,
    participants: participantReports,
    evidenceIntegrity,
    summary: {
      normalizedEventCount,
      unresolvedEventCount,
      distinctObservedSpellIds: abilityInventory.length,
      catalogMatchCount,
      participantCount: participantReports.length,
      deduplicatedActivationCount,
      fillersExcluded,
      totalProviderCalls,
      providerCallsDuringReload,
    },
  };
}

export function printOffensiveProbeSummary(report: OffensiveProbeReport): void {
  const { selection, rawEventCounts, summary, dataLoad, evidenceIntegrity, participants } =
    report;
  console.log("wcl.probe.offensive-one-fight");
  console.log(
    [
      `mode=${dataLoad.mode}`,
      `fight=${selection.reportCode}:${selection.fightId}:r${selection.reportRevision}`,
      `manifest=${selection.manifestId}`,
      `slot=${selection.slotId}`,
      `dungeon=${selection.dungeonSlug ?? "unknown"}`,
      `casts=${rawEventCounts.casts}`,
      `buffs=${rawEventCounts.buffs}`,
      `normalized=${summary.normalizedEventCount}`,
      `unresolved=${summary.unresolvedEventCount}`,
      `spellIds=${summary.distinctObservedSpellIds}`,
      `catalogMatches=${summary.catalogMatchCount}`,
      `participants=${summary.participantCount}`,
      `allFiveParticipantsResolved=${evidenceIntegrity.allFiveParticipantsResolved}`,
      `deduplicatedActivations=${summary.deduplicatedActivationCount}`,
      `fillersExcluded=${evidenceIntegrity.fillersExcluded}`,
      `storageSchemes=${evidenceIntegrity.storageSchemesRead.join(",") || "none"}`,
      `totalProviderCalls=${evidenceIntegrity.totalProviderCalls}`,
      `providerCallsDuringReload=${evidenceIntegrity.providerCallsDuringReload}`,
    ].join(" "),
  );
  for (const participant of participants) {
    console.log(
      [
        `participant actor=${participant.playerActorId}`,
        `name=${participant.characterName}`,
        `class=${participant.classSlug ?? "unknown"}`,
        `spec=${participant.specSlug ?? "unknown"}`,
        `role=${participant.role ?? "unknown"}`,
        `rawMatchedEvents=${participant.rawMatchedActivationEventCount}`,
        `deduplicatedActivations=${participant.deduplicatedActivationCount}`,
        `canonicalKeys=${participant.canonicalKeysActivated.join("|") || "none"}`,
      ].join(" "),
    );
  }
}
