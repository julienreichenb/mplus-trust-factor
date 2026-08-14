/**
 * Catalog-driven Survival activation extraction + pressure classification
 * from a shared CapabilityEvidencePackageV1 (no live WCL).
 */
import {
  CURRENT_CATALOG_VERSION_ID,
  getAllRegisteredRules,
  normalizeRetailClassSlug,
  projectSurvivalActivations,
  type AbilityRole,
  type AbilityRule,
  type SurvivalActivationEvent,
} from "@mplus/abilities";
import {
  PARTICIPANT_SURVIVAL_SUMMARY_SCHEMA_VERSION,
  SURVIVAL_ACTION_NORMALIZER_VERSION,
  SURVIVAL_ACTION_TIMELINE_SCHEMA_VERSION,
  WCL_EVENT_NORMALIZER_VERSION,
  PRESSURE_WINDOW_DERIVATION_VERSION,
  hashParticipantSurvivalSummaryPayload,
  hashSurvivalActionTimelinePayload,
  type CapabilityEvidencePackageV1,
  type ParticipantSurvivalSummaryV1,
  type SurvivalActionTimelineV1,
  type SurvivalActivationSource,
  type SurvivalCanonicalActivation,
  type SurvivalCatalogGapRow,
  type SurvivalDeathEvent,
} from "@mplus/contracts";
import { buildPressureWindows } from "./pressure-windows.js";
import { SURVIVAL_ONE_FIGHT_PRESSURE_CONFIG } from "./pressure-config.js";
import {
  evaluateSurvivalCapabilities,
  gapConfidence,
  isLikelySurvivalGapName,
  isSurvivalCatalogRule,
  mapAbilityCategoryToSurvivalDefensive,
  proposeGapCategory,
  spellIdsForRule,
  survivalActivationKindForCategory,
  type SurvivalProbeParticipant,
  type SurvivalProbeSourceIdentity,
} from "./types.js";

export const SURVIVAL_ACTION_MERGE_WINDOW_MS =
  SURVIVAL_ONE_FIGHT_PRESSURE_CONFIG.activation.mergeWindowMs;

type SourceKind = "PLAYER" | "OWNED_PET_OR_GUARDIAN" | "OTHER";

interface CandidateAtom {
  eventId: string;
  dataset: string;
  eventType: string;
  spellId: number;
  rawName: string | null;
  timestampMs: number;
  sourceActorId: number;
  ownerActorId: number;
  targetActorId: number | null;
  attributedToPet: boolean;
  petActorId: number | null;
  rule: AbilityRule;
  activationKind: NonNullable<ReturnType<typeof survivalActivationKindForCategory>>;
  defensiveCategory: NonNullable<ReturnType<typeof mapAbilityCategoryToSurvivalDefensive>>;
  /** For externals: recipient participant (buff target). */
  participantActorId: number;
}

function buildSpellRuleIndex(rules: AbilityRule[]): Map<number, AbilityRule[]> {
  const map = new Map<number, AbilityRule[]>();
  for (const rule of rules) {
    if (!isSurvivalCatalogRule(rule)) continue;
    for (const id of spellIdsForRule(rule)) {
      const list = map.get(id) ?? [];
      list.push(rule);
      map.set(id, list);
    }
  }
  return map;
}

function pickRule(
  index: Map<number, AbilityRule[]>,
  spellId: number,
  classSlug: string | null,
  specSlug: string | null = null,
  role: AbilityRole | null = null,
): AbilityRule | null {
  const candidates = index.get(spellId) ?? [];
  if (candidates.length === 0) return null;
  const normalizedClass = normalizeRetailClassSlug(classSlug);
  const matching = candidates.filter((rule) => {
    if (rule.classSlug != null && normalizedClass && rule.classSlug !== normalizedClass) {
      return false;
    }
    if (rule.specSlugs.length > 0 && specSlug && !rule.specSlugs.includes(specSlug)) {
      return false;
    }
    if (role && rule.roles.length > 0 && !rule.roles.includes(role)) {
      return false;
    }
    return true;
  });
  if (matching.length > 0) return matching[0] ?? null;
  // Shared consumables / class-null rules when participant class unknown.
  return candidates.find((r) => r.classSlug == null) ?? null;
}

function eventTypeOf(raw: string | null): string {
  return (raw ?? "unknown").toLowerCase();
}

function activationSourceFromTypes(
  types: string[],
  attributedToPet: boolean,
  kind: CandidateAtom["activationKind"],
): SurvivalActivationSource {
  if (kind === "EXTERNAL_DEFENSIVE_RECEIVED") return "EXTERNAL_BUFF";
  if (attributedToPet) return "PET_CAST";
  const set = new Set(types.map(eventTypeOf));
  const hasCast = [...set].some((t) => t === "cast" || t === "begincast");
  const hasBuff = [...set].some((t) => t === "applybuff" || t === "apply");
  if (hasCast && hasBuff) return "CAST_AND_BUFF";
  if (hasCast) return "CAST";
  if (hasBuff) return "BUFF_APPLY";
  return "UNKNOWN";
}

function sourceKindFor(
  actorId: number,
  playerIds: Set<number>,
  ownerByActor: Map<number, number>,
): SourceKind {
  if (playerIds.has(actorId)) return "PLAYER";
  if (ownerByActor.has(actorId)) return "OWNED_PET_OR_GUARDIAN";
  return "OTHER";
}

function participantById(
  participants: SurvivalProbeParticipant[],
  actorId: number,
): SurvivalProbeParticipant | undefined {
  return participants.find((p) => p.playerActorId === actorId);
}

function nameForActor(
  participants: SurvivalProbeParticipant[],
  actorId: number | null,
): string | null {
  if (actorId == null) return null;
  return participants.find((p) => p.playerActorId === actorId)?.characterName ?? null;
}

export interface ExtractSurvivalFromCapabilityInput {
  source: SurvivalProbeSourceIdentity;
  participants: SurvivalProbeParticipant[];
  capabilityPackage: CapabilityEvidencePackageV1;
  packageArtifactId?: string | null;
  catalogVersion?: string;
  mergeWindowMs?: number;
}

export interface ExtractSurvivalFromCapabilityResult {
  timeline: SurvivalActionTimelineV1;
  providerCallsDuringExtract: number;
}

export function extractSurvivalFromCapabilityPackage(
  input: ExtractSurvivalFromCapabilityInput,
): ExtractSurvivalFromCapabilityResult {
  const catalogVersion = input.catalogVersion ?? CURRENT_CATALOG_VERSION_ID;
  const mergeWindowMs = input.mergeWindowMs ?? SURVIVAL_ACTION_MERGE_WINDOW_MS;
  const pkg = input.capabilityPackage;
  const spellIndex = buildSpellRuleIndex(getAllRegisteredRules());

  const playerIds = new Set(input.participants.map((p) => p.playerActorId));
  const ownerByActor = new Map<number, number>();
  const classByOwner = new Map<number, string | null>();
  const specByOwner = new Map<number, string | null>();
  const roleByOwner = new Map<number, AbilityRole | null>();
  for (const p of input.participants) {
    classByOwner.set(p.playerActorId, normalizeRetailClassSlug(p.classSlug));
    specByOwner.set(p.playerActorId, p.specSlug);
    roleByOwner.set(p.playerActorId, p.role ?? null);
    for (const petId of p.ownedPetActorIds) {
      ownerByActor.set(petId, p.playerActorId);
    }
  }

  const capabilities = evaluateSurvivalCapabilities(pkg.coverage);
  const atoms: CandidateAtom[] = [];
  const gapMap = new Map<string, SurvivalCatalogGapRow>();
  let rawDefensiveEventCount = 0;
  let rawRecoveryEventCount = 0;
  const rawDefensiveByOwner = new Map<number, number>();
  const rawRecoveryByOwner = new Map<number, number>();

  const relevantEvents = pkg.compactEvents.filter((e) => {
    const caps = new Set(e.capabilities);
    return (
      caps.has("SURVIVAL_DEFENSIVE_ACTIVATIONS") ||
      caps.has("SURVIVAL_RECOVERY_ACTIVATIONS") ||
      caps.has("UTILITY_EXTERNAL_CASTS") ||
      caps.has("UTILITY_EXTERNAL_TARGET_CONTEXT")
    );
  });

  for (const event of relevantEvents) {
    const spellId = event.spellId;
    const timestampMs = event.timestampMs;
    const sourceActorId = event.sourceActorId;
    if (spellId == null || sourceActorId == null) continue;
    // Healing events prove impact; Casts/Buffs prove toolkit activation.
    if (event.dataset === "Healing") continue;

    const kind = sourceKindFor(sourceActorId, playerIds, ownerByActor);
    const sourceOwner =
      event.sourceOwnerPlayerActorId ??
      (kind === "PLAYER"
        ? sourceActorId
        : kind === "OWNED_PET_OR_GUARDIAN"
          ? (ownerByActor.get(sourceActorId) ?? null)
          : null);

    const targetPlayer =
      event.targetPlayerActorId ??
      (event.targetActorId != null && playerIds.has(event.targetActorId)
        ? event.targetActorId
        : null);

    const ownerClass =
      sourceOwner != null ? (classByOwner.get(sourceOwner) ?? null) : null;
    const ownerSpec =
      sourceOwner != null ? (specByOwner.get(sourceOwner) ?? null) : null;
    const ownerRole =
      sourceOwner != null ? (roleByOwner.get(sourceOwner) ?? null) : null;
    const rule = pickRule(spellIndex, spellId, ownerClass, ownerSpec, ownerRole);
    const eventType = event.eventType ?? "unknown";
    const rawName = event.rawName;

    if (!rule) {
      const likely = isLikelySurvivalGapName(rawName);
      if (!likely) continue;
      const proposed = proposeGapCategory(rawName);
      const key = `${spellId}|${ownerClass ?? ""}`;
      const existing = gapMap.get(key);
      if (existing) {
        existing.count += 1;
        if (rawName && existing.rawName == null) existing.rawName = rawName;
        if (!existing.eventTypes.includes(eventType)) existing.eventTypes.push(eventType);
        if (!existing.datasets.includes(event.dataset)) existing.datasets.push(event.dataset);
        if (existing.evidenceTimestampsMs.length < 20) {
          existing.evidenceTimestampsMs.push(timestampMs);
        }
      } else {
        const owner =
          sourceOwner != null ? participantById(input.participants, sourceOwner) : null;
        gapMap.set(key, {
          spellId,
          rawName,
          sourceClassSlug: owner?.classSlug ?? ownerClass,
          sourceSpecSlug: owner?.specSlug ?? null,
          eventTypes: [eventType],
          datasets: [event.dataset],
          count: 1,
          evidenceTimestampsMs: [timestampMs],
          proposedCategory: proposed,
          proposedConfidence: gapConfidence(proposed, 1),
          reason: "PROBABLE_SURVIVAL_CATALOG_GAP",
        });
      }
      continue;
    }

    const activationKind = survivalActivationKindForCategory(rule.category);
    const defensiveCategory = mapAbilityCategoryToSurvivalDefensive(rule.category);
    if (!activationKind || !defensiveCategory) continue;

    if (activationKind !== "EXTERNAL_DEFENSIVE_RECEIVED") {
      if (sourceOwner == null) continue;
      if (activationKind === "PERSONAL_DEFENSIVE") {
        rawDefensiveEventCount += 1;
        rawDefensiveByOwner.set(sourceOwner, (rawDefensiveByOwner.get(sourceOwner) ?? 0) + 1);
      } else if (activationKind === "RECOVERY") {
        if (
          targetPlayer != null &&
          sourceOwner != null &&
          targetPlayer !== sourceOwner
        ) {
          continue;
        }
        rawRecoveryEventCount += 1;
        rawRecoveryByOwner.set(sourceOwner, (rawRecoveryByOwner.get(sourceOwner) ?? 0) + 1);
      }

      atoms.push({
        eventId: event.eventId,
        dataset: event.dataset,
        eventType,
        spellId,
        rawName,
        timestampMs,
        sourceActorId,
        ownerActorId: sourceOwner,
        targetActorId: event.targetActorId,
        attributedToPet: kind === "OWNED_PET_OR_GUARDIAN",
        petActorId: kind === "OWNED_PET_OR_GUARDIAN" ? sourceActorId : null,
        rule,
        activationKind,
        defensiveCategory,
        participantActorId: sourceOwner,
      });
      continue;
    }

    // External: credit caster for Utility; Survival retains received context on recipient only.
    if (sourceOwner == null || targetPlayer == null) continue;
    if (targetPlayer === sourceOwner) continue;

    atoms.push({
      eventId: event.eventId,
      dataset: event.dataset,
      eventType,
      spellId,
      rawName,
      timestampMs,
      sourceActorId,
      ownerActorId: sourceOwner,
      targetActorId: targetPlayer,
      attributedToPet: kind === "OWNED_PET_OR_GUARDIAN",
      petActorId: kind === "OWNED_PET_OR_GUARDIAN" ? sourceActorId : null,
      rule,
      activationKind,
      defensiveCategory,
      participantActorId: targetPlayer,
    });
  }

  // Also scan unknown summaries for gap reporting (no auto-classify into activations).
  for (const unknown of pkg.unknownAbilitySummaries) {
    if (!isLikelySurvivalGapName(unknown.rawName)) continue;
    const proposed = proposeGapCategory(unknown.rawName);
    const key = `${unknown.spellId}|gap`;
    if (gapMap.has(key)) continue;
    gapMap.set(key, {
      spellId: unknown.spellId,
      rawName: unknown.rawName,
      sourceClassSlug: null,
      sourceSpecSlug: null,
      eventTypes: [...unknown.eventTypes],
      datasets: ["unknown"],
      count: unknown.count,
      evidenceTimestampsMs: [
        ...(unknown.firstTimestampMs != null ? [unknown.firstTimestampMs] : []),
        ...(unknown.lastTimestampMs != null &&
        unknown.lastTimestampMs !== unknown.firstTimestampMs
          ? [unknown.lastTimestampMs]
          : []),
      ].slice(0, 20),
      proposedCategory: proposed,
      proposedConfidence: gapConfidence(proposed, unknown.count),
      reason: "PROBABLE_SURVIVAL_CATALOG_GAP",
    });
  }

  atoms.sort(
    (a, b) =>
      a.timestampMs - b.timestampMs ||
      a.rule.canonicalKey.localeCompare(b.rule.canonicalKey) ||
      a.participantActorId - b.participantActorId ||
      a.spellId - b.spellId,
  );

  const atomByEventId = new Map(atoms.map((a) => [a.eventId, a]));
  const projectionEvents: SurvivalActivationEvent[] = atoms.map((atom) => ({
    eventId: atom.eventId,
    timestampMs: atom.timestampMs,
    eventType: atom.eventType,
    spellId: atom.spellId,
    canonicalKey: atom.rule.canonicalKey,
    sourceOwnerPlayerActorId: atom.ownerActorId,
    sourceActorId: atom.sourceActorId,
    targetPlayerActorId:
      atom.activationKind === "EXTERNAL_DEFENSIVE_RECEIVED"
        ? atom.participantActorId
        : atom.targetActorId != null && playerIds.has(atom.targetActorId)
          ? atom.targetActorId
          : null,
    dataset:
      atom.dataset === "Casts" || atom.dataset === "Buffs"
        ? atom.dataset
        : null,
  }));

  const projection = projectSurvivalActivations({
    events: projectionEvents,
    rules: [...new Map(atoms.map((a) => [a.rule.canonicalKey, a.rule])).values()],
    windowMs: mergeWindowMs,
  });

  let actionSeq = 0;
  const activations: SurvivalCanonicalActivation[] = [];
  for (const projected of projection.activations) {
    const seed =
      atomByEventId.get(projected.contributingEventIds[0] ?? "") ??
      atoms.find(
        (a) =>
          a.rule.canonicalKey === projected.canonicalKey &&
          a.timestampMs === projected.timestampMs,
      );
    if (!seed) continue;

    const contributingAtoms = projected.contributingEventIds
      .map((id) => atomByEventId.get(id))
      .filter((a): a is CandidateAtom => a != null);

    const evidenceEventTypes = new Set<string>();
    const evidenceEventIds = new Set<string>();
    const observedSpellIds = new Set<number>();
    let attributedToPet = seed.attributedToPet;
    let petActorId = seed.petActorId;
    let sourceDataset = seed.dataset;
    let sourceActorId = seed.sourceActorId;
    let targetActorId = seed.targetActorId;

    for (const atom of contributingAtoms) {
      evidenceEventTypes.add(atom.eventType);
      evidenceEventIds.add(atom.eventId);
      observedSpellIds.add(atom.spellId);
      if (atom.attributedToPet) {
        attributedToPet = true;
        petActorId = atom.petActorId;
      }
      if (atom.dataset === "Casts" && sourceDataset !== "Casts") {
        sourceDataset = atom.dataset;
        sourceActorId = atom.sourceActorId;
      }
      if (atom.targetActorId != null) targetActorId = atom.targetActorId;
    }

    const caster = participantById(input.participants, seed.ownerActorId);
    if (!caster) continue;
    const recipientId =
      seed.activationKind === "EXTERNAL_DEFENSIVE_RECEIVED"
        ? (projected.targetPlayerActorId ?? seed.participantActorId)
        : seed.participantActorId;
    const eventTypes = [...evidenceEventTypes].sort();
    actionSeq += 1;
    activations.push({
      canonicalActivationId: [
        input.source.reportCode,
        input.source.fightId,
        input.source.reportRevision,
        seed.participantActorId,
        seed.rule.canonicalKey,
        projected.timestampMs,
        actionSeq,
      ].join(":"),
      abilityKey: seed.rule.canonicalKey,
      canonicalName: seed.rule.name,
      primarySpellId: projected.primarySpellId,
      observedSpellIds: [...observedSpellIds].sort((a, b) => a - b),
      activationKind: seed.activationKind,
      defensiveCategory: seed.defensiveCategory,
      reportCode: input.source.reportCode,
      fightId: input.source.fightId,
      reportRevision: input.source.reportRevision,
      participantActorId: seed.participantActorId,
      sourceActorId,
      targetActorId,
      casterActorId: seed.ownerActorId,
      recipientActorId: recipientId,
      sourceCharacterName: caster.characterName,
      targetCharacterName: nameForActor(input.participants, targetActorId),
      casterCharacterName: caster.characterName,
      recipientCharacterName: nameForActor(input.participants, recipientId),
      sourceClassSlug: caster.classSlug,
      sourceSpecSlug: caster.specSlug,
      rawTimestampMs: projected.timestampMs,
      fightOffsetMs: Math.max(0, projected.timestampMs - input.source.fightStartMs),
      activationSource: activationSourceFromTypes(
        eventTypes,
        attributedToPet,
        seed.activationKind,
      ),
      sourceDataset,
      evidenceEventTypes: eventTypes,
      evidenceEventIds: [...evidenceEventIds].sort(),
      attributedToPet,
      petActorId,
      creditsSurvivalUsageToRecipient: seed.activationKind !== "EXTERNAL_DEFENSIVE_RECEIVED",
      creditsCasterForUtility: seed.activationKind === "EXTERNAL_DEFENSIVE_RECEIVED",
      relatedPressureWindowId: null,
      responseRelation: null,
      limitations:
        seed.activationKind === "EXTERNAL_DEFENSIVE_RECEIVED" && targetActorId == null
          ? ["EXTERNAL_TARGET_CONTEXT_INCOMPLETE"]
          : [],
      catalogVersion,
      normalizerVersion: SURVIVAL_ACTION_NORMALIZER_VERSION,
    });
  }

  activations.sort(
    (a, b) =>
      a.rawTimestampMs - b.rawTimestampMs ||
      a.participantActorId - b.participantActorId ||
      a.abilityKey.localeCompare(b.abilityKey),
  );

  const deaths: SurvivalDeathEvent[] = [];
  let deathSeq = 0;
  for (const event of pkg.compactEvents) {
    if (!event.capabilities.includes("SURVIVAL_DEATHS")) continue;
    if (event.dataset !== "Deaths") continue;
    const victim =
      event.targetPlayerActorId ??
      (event.targetActorId != null && playerIds.has(event.targetActorId)
        ? event.targetActorId
        : event.sourceActorId != null && playerIds.has(event.sourceActorId)
          ? event.sourceActorId
          : null);
    if (victim == null) continue;
    deathSeq += 1;
    deaths.push({
      deathEventId: [
        input.source.reportCode,
        input.source.fightId,
        input.source.reportRevision,
        victim,
        "death",
        event.timestampMs,
        deathSeq,
      ].join(":"),
      participantActorId: victim,
      rawTimestampMs: event.timestampMs,
      fightOffsetMs: Math.max(0, event.timestampMs - input.source.fightStartMs),
      killingAbilitySpellId: event.spellId,
      killingAbilityName: event.rawName,
      sourceActorId: event.sourceActorId,
      evidenceEventId: event.eventId,
      relatedPressureWindowId: null,
    });
  }

  const pressure = buildPressureWindows({
    source: input.source,
    participants: input.participants,
    damageEvents: pkg.compactEvents,
    activations,
    deaths,
    packageContentHash: pkg.contentHash,
  });

  const gapSummary = [...gapMap.values()]
    .sort((a, b) => b.count - a.count || a.spellId - b.spellId)
    .slice(0, 80);

  const runLimitations: string[] = [];
  for (const cap of capabilities) {
    if (cap.status !== "COMPLETE") {
      runLimitations.push(`CAPABILITY_${cap.status}:${cap.capability}`);
      runLimitations.push(...cap.limitations);
    }
  }
  if (pressure.timeline.limitations.includes("MAX_HP_CONTEXT_UNAVAILABLE")) {
    runLimitations.push("MAX_HP_CONTEXT_UNAVAILABLE");
  }

  const personal = pressure.updatedActivations.filter(
    (a) => a.activationKind === "PERSONAL_DEFENSIVE",
  );
  const recovery = pressure.updatedActivations.filter(
    (a) => a.activationKind === "RECOVERY",
  );
  const externals = pressure.updatedActivations.filter(
    (a) => a.activationKind === "EXTERNAL_DEFENSIVE_RECEIVED",
  );

  const participants: ParticipantSurvivalSummaryV1[] = input.participants.map((p) => {
    const damageEvents = pkg.compactEvents.filter(
      (e) =>
        e.capabilities.includes("SURVIVAL_DAMAGE_TAKEN") &&
        (e.targetPlayerActorId === p.playerActorId ||
          e.targetActorId === p.playerActorId),
    );
    const damageTakenTotal = damageEvents.reduce(
      (s, e) => s + Math.max(0, e.amount ?? 0),
      0,
    );
    const ownedPersonal = personal.filter((a) => a.participantActorId === p.playerActorId);
    const ownedRecovery = recovery.filter((a) => a.participantActorId === p.playerActorId);
    const ownedExternal = externals.filter(
      (a) =>
        a.participantActorId === p.playerActorId &&
        a.recipientActorId === p.playerActorId &&
        a.creditsSurvivalUsageToRecipient === false,
    );
    const ownedWindows = pressure.windows.filter((w) => w.participantActorId === p.playerActorId);
    const deathCount = pressure.updatedDeaths.filter(
      (d) => d.participantActorId === p.playerActorId,
    ).length;
    const participantLimitations = new Set<string>();
    for (const cap of capabilities) {
      if (cap.status === "COMPLETE") continue;
      const isOptional =
        cap.capability === "UTILITY_EXTERNAL_CASTS" ||
        cap.capability === "UTILITY_EXTERNAL_TARGET_CONTEXT" ||
        cap.capability === "PARTICIPANT_METADATA" ||
        cap.capability === "ACTOR_OWNERSHIP";
      if (isOptional) {
        participantLimitations.add(`OPTIONAL_CONTEXT_${cap.status}:${cap.capability}`);
        continue;
      }
      participantLimitations.add(`CAPABILITY_${cap.status}:${cap.capability}`);
    }
    if (ownedWindows.some((w) => w.limitations.includes("MAX_HP_CONTEXT_UNAVAILABLE"))) {
      participantLimitations.add("MAX_HP_CONTEXT_UNAVAILABLE");
    }

    const withoutHash: Omit<ParticipantSurvivalSummaryV1, "contentHash"> = {
      schemaVersion: PARTICIPANT_SURVIVAL_SUMMARY_SCHEMA_VERSION,
      reportCode: input.source.reportCode,
      fightId: input.source.fightId,
      reportRevision: input.source.reportRevision,
      playerActorId: p.playerActorId,
      characterName: p.characterName,
      classSlug: p.classSlug,
      specSlug: p.specSlug,
      ownedPetActorIds: p.ownedPetActorIds,
      damageTakenTotal,
      damageTakenEventCount: damageEvents.length,
      deathCount,
      rawDefensiveEventCount: rawDefensiveByOwner.get(p.playerActorId) ?? 0,
      canonicalPersonalDefensiveCount: ownedPersonal.length,
      rawRecoveryEventCount: rawRecoveryByOwner.get(p.playerActorId) ?? 0,
      canonicalRecoveryCount: ownedRecovery.length,
      externalDefensiveReceivedCount: ownedExternal.length,
      pressureWindowCount: ownedWindows.length,
      sustainedPressureCount: ownedWindows.filter((w) =>
        w.windowClass === "SUSTAINED_PRESSURE" || w.windowClass === "FATAL_PRESSURE",
      ).length,
      isolatedDamageCount: ownedWindows.filter((w) => w.windowClass === "ISOLATED_DAMAGE")
        .length,
      noResponseWindowCount: ownedWindows.filter(
        (w) =>
          w.response.noPersonalDefensiveResponse &&
          (w.windowClass === "SUSTAINED_PRESSURE" || w.windowClass === "FATAL_PRESSURE"),
      ).length,
      petAttributedActivationCount: [...ownedPersonal, ...ownedRecovery].filter(
        (a) => a.attributedToPet,
      ).length,
      capabilityEvidencePackageContentHash: pkg.contentHash,
      capabilityCompleteness: capabilities,
      limitations: [...participantLimitations].sort(),
      catalogVersion,
      normalizerVersion: SURVIVAL_ACTION_NORMALIZER_VERSION,
    };
    return {
      ...withoutHash,
      contentHash: hashParticipantSurvivalSummaryPayload(withoutHash),
    };
  });

  // Ensure incomplete optional context does not flip DamageTaken to incomplete in summaries.
  const damageCap = capabilities.find((c) => c.capability === "SURVIVAL_DAMAGE_TAKEN");
  if (damageCap?.status === "COMPLETE") {
    for (const p of participants) {
      p.limitations = p.limitations.filter(
        (l) => !l.includes("SURVIVAL_DAMAGE_TAKEN") || l.startsWith("OPTIONAL_"),
      );
    }
  }

  const withoutHash: Omit<SurvivalActionTimelineV1, "contentHash"> = {
    schemaVersion: SURVIVAL_ACTION_TIMELINE_SCHEMA_VERSION,
    sourceKey: {
      reportCode: input.source.reportCode,
      fightId: input.source.fightId,
      reportRevision: input.source.reportRevision,
    },
    dungeonSlug: input.source.dungeonSlug,
    keyLevel: input.source.keyLevel,
    fightStartMs: input.source.fightStartMs,
    fightEndMs: input.source.fightEndMs,
    region: input.source.region,
    capabilityEvidencePackageContentHash: pkg.contentHash,
    capabilityEvidencePackageArtifactId: input.packageArtifactId ?? null,
    participants,
    activations: pressure.updatedActivations,
    deaths: pressure.updatedDeaths,
    pressureWindows: pressure.windows,
    pressureTimeline: pressure.timeline,
    rawDefensiveEventCount,
    canonicalPersonalDefensiveCount: personal.length,
    rawRecoveryEventCount,
    canonicalRecoveryCount: recovery.length,
    externalDefensiveReceivedCount: externals.length,
    capabilityCompleteness: capabilities,
    survivalCatalogGapSummary: gapSummary,
    limitations: [...new Set(runLimitations)].sort(),
    catalogVersion,
    normalizerVersion: SURVIVAL_ACTION_NORMALIZER_VERSION,
    eventNormalizerVersion: WCL_EVENT_NORMALIZER_VERSION,
    pressureDerivationVersion: PRESSURE_WINDOW_DERIVATION_VERSION,
    pressureConfigVersion: SURVIVAL_ONE_FIGHT_PRESSURE_CONFIG.version,
  };

  return {
    timeline: {
      ...withoutHash,
      contentHash: hashSurvivalActionTimelinePayload(withoutHash),
    },
    providerCallsDuringExtract: 0,
  };
}

export function buildSurvivalProbePrintSummary(timeline: SurvivalActionTimelineV1): string {
  const lines: string[] = [
    "wcl.probe.survival-one-fight.summary",
    `source=${timeline.sourceKey.reportCode}:${timeline.sourceKey.fightId}:r${timeline.sourceKey.reportRevision}`,
    `packageHash=${timeline.capabilityEvidencePackageContentHash.slice(0, 12)}`,
    `rawDefensive=${timeline.rawDefensiveEventCount} canonicalDefensive=${timeline.canonicalPersonalDefensiveCount}`,
    `rawRecovery=${timeline.rawRecoveryEventCount} canonicalRecovery=${timeline.canonicalRecoveryCount}`,
    `externalReceived=${timeline.externalDefensiveReceivedCount} deaths=${timeline.deaths.length} pressureWindows=${timeline.pressureWindows.length}`,
  ];
  for (const p of timeline.participants) {
    lines.push(
      `participant=${p.characterName} actor=${p.playerActorId} dmg=${p.damageTakenTotal} deaths=${p.deathCount} def=${p.canonicalPersonalDefensiveCount} rec=${p.canonicalRecoveryCount} ext=${p.externalDefensiveReceivedCount} pw=${p.pressureWindowCount} sustained=${p.sustainedPressureCount} isolated=${p.isolatedDamageCount} pkg=${p.capabilityEvidencePackageContentHash.slice(0, 12)}`,
    );
  }
  for (const cap of timeline.capabilityCompleteness) {
    lines.push(
      `capability=${cap.capability} status=${cap.status} incomplete=${cap.incompleteDatasets.join(",") || "-"}`,
    );
  }
  lines.push(`catalogGaps=${timeline.survivalCatalogGapSummary.length}`);
  return lines.join("\n");
}
