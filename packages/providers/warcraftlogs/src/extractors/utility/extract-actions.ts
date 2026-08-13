/**
 * Catalog-driven Utility action extraction + deterministic deduplication.
 */
import {
  CURRENT_CATALOG_VERSION_ID,
  getAllRegisteredRules,
  type AbilityRule,
} from "@mplus/abilities";
import {
  UTILITY_ACTION_NORMALIZER_VERSION,
  UTILITY_ACTION_TIMELINE_SCHEMA_VERSION,
  WCL_EVENT_NORMALIZER_VERSION,
  hashUtilityActionTimelinePayload,
  type UtilityActionTimelineV1,
  type UtilityCanonicalAction,
  type UtilityCatalogGapRow,
  type UtilityCategory,
  type UtilityParticipantSummary,
} from "@mplus/contracts";
import { normalizeWclEventFields } from "../../normalize/wcl-event-normalizer.js";
import {
  defaultOutcomeForCategory,
  emptyCountsByCategory,
  evaluateUtilityCapabilities,
  isLikelyUtilityGapName,
  isUtilityCatalogRule,
  mapAbilityCategoryToUtilityCategory,
  spellIdsForRule,
  type UtilityDatasetCoverageRow,
  type UtilityProbeParticipant,
  type UtilityProbeSourceIdentity,
} from "./types.js";

/** Max gap between corroborating events for one canonical action. */
export const UTILITY_ACTION_MERGE_WINDOW_MS = 1_500;

/** WCL uses -1 (and sometimes 0) for "no target". */
function normalizeTargetActorId(value: number | null): number | null {
  if (value == null || value <= 0) return null;
  return value;
}

type SourceKind = "PLAYER" | "OWNED_PET_OR_GUARDIAN" | "OTHER";

interface CandidateAtom {
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
  utilityCategory: UtilityCategory;
  canOpenAction: boolean;
}

interface OpenAction {
  abilityKey: string;
  canonicalName: string;
  primarySpellId: number;
  observedSpellIds: Set<number>;
  utilityCategory: UtilityCategory;
  ownerActorId: number;
  sourceActorId: number;
  targetActorId: number | null;
  attributedToPet: boolean;
  petActorId: number | null;
  anchorTimestampMs: number;
  sourceDataset: string;
  evidenceEventTypes: Set<string>;
  limitations: Set<string>;
  rule: AbilityRule;
}

function buildSpellRuleIndex(rules: AbilityRule[]): Map<number, AbilityRule[]> {
  const map = new Map<number, AbilityRule[]>();
  for (const rule of rules) {
    if (!isUtilityCatalogRule(rule)) continue;
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
): AbilityRule | null {
  const candidates = index.get(spellId) ?? [];
  if (candidates.length === 0) return null;
  if (classSlug) {
    const scoped = candidates.find(
      (r) => r.classSlug == null || r.classSlug === classSlug,
    );
    if (scoped) return scoped;
  }
  return candidates[0] ?? null;
}

function eventTypeOf(raw: string | null): string {
  return (raw ?? "unknown").toLowerCase();
}

function canOpenFromEvent(
  dataset: string,
  eventType: string,
  category: UtilityCategory,
): boolean {
  const t = eventTypeOf(eventType);
  if (t === "refreshbuff" || t === "removebuff" || t === "removedebuff") {
    return false;
  }
  if (dataset === "Interrupts") return category === "INTERRUPT";
  if (dataset === "Dispels") {
    return category === "DEFENSIVE_DISPEL" || category === "OFFENSIVE_DISPEL";
  }
  if (dataset === "Casts") {
    return t === "cast" || t === "begincast" || t === "prepare" || t === "startcast" || t === "";
  }
  if (dataset === "Debuffs") {
    return (
      (category === "CROWD_CONTROL" || category === "STOP") &&
      (t === "applydebuff" || t === "apply" || t === "applydebuffstack")
    );
  }
  if (dataset === "Buffs") {
    return (
      (category === "EXTERNAL_SUPPORT" ||
        category === "OTHER_UTILITY" ||
        category === "COMBAT_RES") &&
      (t === "applybuff" || t === "apply")
    );
  }
  return false;
}

function compatibleEventTypes(category: UtilityCategory, nextType: string): boolean {
  const t = eventTypeOf(nextType);
  if (category === "INTERRUPT") {
    return t.includes("interrupt") || t === "cast" || t === "begincast";
  }
  if (category === "DEFENSIVE_DISPEL" || category === "OFFENSIVE_DISPEL") {
    return t.includes("dispel") || t === "cast" || t === "begincast";
  }
  if (category === "CROWD_CONTROL" || category === "STOP") {
    return (
      t === "cast" ||
      t === "begincast" ||
      t === "applydebuff" ||
      t === "apply" ||
      t === "applydebuffstack" ||
      t === "refreshdebuff" ||
      t === "removedebuff"
    );
  }
  if (
    category === "EXTERNAL_SUPPORT" ||
    category === "OTHER_UTILITY" ||
    category === "COMBAT_RES"
  ) {
    return (
      t === "cast" ||
      t === "begincast" ||
      t === "applybuff" ||
      t === "apply" ||
      t === "refreshbuff" ||
      t === "removebuff"
    );
  }
  return true;
}

function targetsCompatible(
  existing: number | null,
  next: number | null,
): { ok: boolean; locked: number | null } {
  if (existing == null) return { ok: true, locked: next };
  if (next == null) return { ok: true, locked: existing };
  return { ok: existing === next, locked: existing };
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

function participantByOwner(
  participants: UtilityProbeParticipant[],
  ownerActorId: number,
): UtilityProbeParticipant | undefined {
  return participants.find((p) => p.playerActorId === ownerActorId);
}

function nameForActor(
  participants: UtilityProbeParticipant[],
  actorId: number | null,
): string | null {
  if (actorId == null) return null;
  return participants.find((p) => p.playerActorId === actorId)?.characterName ?? null;
}

function datasetPriority(dataset: string): number {
  switch (dataset) {
    case "Interrupts":
    case "Dispels":
      return 0;
    case "Casts":
      return 1;
    case "Debuffs":
    case "Buffs":
      return 2;
    default:
      return 3;
  }
}

export interface ExtractUtilityActionsInput {
  source: UtilityProbeSourceIdentity;
  participants: UtilityProbeParticipant[];
  eventsByDataset: Partial<Record<string, Array<Record<string, unknown>>>>;
  coverage: UtilityDatasetCoverageRow[];
  catalogVersion?: string;
  mergeWindowMs?: number;
}

export interface ExtractUtilityActionsResult {
  timeline: UtilityActionTimelineV1;
  providerCallsDuringExtract: number;
}

export function extractUtilityActionTimeline(
  input: ExtractUtilityActionsInput,
): ExtractUtilityActionsResult {
  const catalogVersion = input.catalogVersion ?? CURRENT_CATALOG_VERSION_ID;
  const mergeWindowMs = input.mergeWindowMs ?? UTILITY_ACTION_MERGE_WINDOW_MS;
  const spellIndex = buildSpellRuleIndex(getAllRegisteredRules());

  const playerIds = new Set(input.participants.map((p) => p.playerActorId));
  const ownerByActor = new Map<number, number>();
  const classByOwner = new Map<number, string | null>();
  for (const p of input.participants) {
    classByOwner.set(p.playerActorId, p.classSlug);
    for (const petId of p.ownedPetActorIds) {
      ownerByActor.set(petId, p.playerActorId);
    }
  }

  const atoms: CandidateAtom[] = [];
  const gapMap = new Map<string, UtilityCatalogGapRow>();
  let rawCandidateEventCount = 0;
  const rawByOwner = new Map<number, number>();

  for (const dataset of ["Interrupts", "Dispels", "Casts", "Debuffs", "Buffs"] as const) {
    const rows = input.eventsByDataset[dataset] ?? [];
    for (const raw of rows) {
      const fields = normalizeWclEventFields(raw);
      const spellId = fields.abilityId.value;
      const timestampMs = fields.timestampMs.value;
      const sourceActorId = fields.sourceActorId.value;
      if (spellId == null || timestampMs == null || sourceActorId == null) continue;

      const kind = sourceKindFor(sourceActorId, playerIds, ownerByActor);
      if (kind === "OTHER") continue;

      const ownerActorId =
        kind === "PLAYER" ? sourceActorId : (ownerByActor.get(sourceActorId) ?? null);
      if (ownerActorId == null) continue;

      const ownerClass = classByOwner.get(ownerActorId) ?? null;
      const rule = pickRule(spellIndex, spellId, ownerClass);
      const eventType = fields.eventType.value ?? "unknown";
      const rawName = fields.rawAbilityName.value;

      // Only count utility-catalog (or gap) candidates toward raw counts.
      if (!rule) {
        const fromUtilityStream = dataset === "Interrupts" || dataset === "Dispels";
        const likelyName = isLikelyUtilityGapName(rawName);
        if (!fromUtilityStream && !likelyName) continue;

        rawCandidateEventCount += 1;
        rawByOwner.set(ownerActorId, (rawByOwner.get(ownerActorId) ?? 0) + 1);

        const key = `${spellId}|${ownerClass ?? ""}`;
        const existing = gapMap.get(key);
        if (existing) {
          existing.count += 1;
          if (rawName && existing.rawName == null) existing.rawName = rawName;
          if (!existing.eventTypes.includes(eventType)) existing.eventTypes.push(eventType);
          if (!existing.datasets.includes(dataset)) existing.datasets.push(dataset);
        } else {
          const owner = participantByOwner(input.participants, ownerActorId);
          gapMap.set(key, {
            spellId,
            rawName,
            sourceClassSlug: owner?.classSlug ?? ownerClass,
            sourceSpecSlug: owner?.specSlug ?? null,
            eventTypes: [eventType],
            datasets: [dataset],
            count: 1,
            reason: "PROBABLE_UTILITY_CATALOG_GAP",
          });
        }
        continue;
      }

      const utilityCategory = mapAbilityCategoryToUtilityCategory(rule.category);
      if (!utilityCategory) continue;

      rawCandidateEventCount += 1;
      rawByOwner.set(ownerActorId, (rawByOwner.get(ownerActorId) ?? 0) + 1);

      atoms.push({
        dataset,
        eventType,
        spellId,
        rawName,
        timestampMs,
        sourceActorId,
        ownerActorId,
        targetActorId: normalizeTargetActorId(fields.targetActorId.value),
        attributedToPet: kind === "OWNED_PET_OR_GUARDIAN",
        petActorId: kind === "OWNED_PET_OR_GUARDIAN" ? sourceActorId : null,
        rule,
        utilityCategory,
        canOpenAction: (() => {
        if (!canOpenFromEvent(dataset, eventType, utilityCategory)) return false;
        // Placement-only open for group utility: alias IDs (e.g. Gateway
        // traversal 113942) are evidence, not a second provided placement.
        if (
          (utilityCategory === "OTHER_UTILITY" ||
            utilityCategory === "EXTERNAL_SUPPORT") &&
          !rule.spellIds.includes(spellId)
        ) {
          return false;
        }
        return true;
      })(),
      });
    }
  }

  atoms.sort(
    (a, b) =>
      a.timestampMs - b.timestampMs ||
      a.rule.canonicalKey.localeCompare(b.rule.canonicalKey) ||
      a.sourceActorId - b.sourceActorId ||
      a.spellId - b.spellId,
  );

  const openActions: OpenAction[] = [];

  for (const atom of atoms) {
    let merged = false;
    for (let i = openActions.length - 1; i >= 0; i -= 1) {
      const open = openActions[i]!;
      if (atom.timestampMs - open.anchorTimestampMs > mergeWindowMs) break;
      if (open.abilityKey !== atom.rule.canonicalKey) continue;
      if (open.ownerActorId !== atom.ownerActorId) continue;
      if (open.utilityCategory !== atom.utilityCategory) continue;
      if (!compatibleEventTypes(open.utilityCategory, atom.eventType)) continue;
      const targetCheck = targetsCompatible(open.targetActorId, atom.targetActorId);
      if (!targetCheck.ok) continue;

      open.observedSpellIds.add(atom.spellId);
      open.evidenceEventTypes.add(atom.eventType);
      open.targetActorId = targetCheck.locked;
      if (atom.attributedToPet) {
        open.attributedToPet = true;
        open.petActorId = atom.petActorId;
      }
      if (datasetPriority(atom.dataset) < datasetPriority(open.sourceDataset)) {
        open.sourceDataset = atom.dataset;
        open.sourceActorId = atom.sourceActorId;
      }
      merged = true;
      break;
    }

    if (merged) continue;
    if (!atom.canOpenAction) continue;

    openActions.push({
      abilityKey: atom.rule.canonicalKey,
      canonicalName: atom.rule.name,
      primarySpellId: atom.rule.spellIds[0] ?? atom.spellId,
      observedSpellIds: new Set([atom.spellId]),
      utilityCategory: atom.utilityCategory,
      ownerActorId: atom.ownerActorId,
      sourceActorId: atom.sourceActorId,
      targetActorId: atom.targetActorId,
      attributedToPet: atom.attributedToPet,
      petActorId: atom.petActorId,
      anchorTimestampMs: atom.timestampMs,
      sourceDataset: atom.dataset,
      evidenceEventTypes: new Set([atom.eventType]),
      limitations: new Set(),
      rule: atom.rule,
    });
  }

  const capabilities = evaluateUtilityCapabilities(input.coverage);
  const buffsCapability = capabilities.find(
    (c) => c.capability === "UTILITY_EXTERNAL_TARGET_CONTEXT",
  );
  const buffsIncomplete = buffsCapability?.status !== "COMPLETE";

  const actions: UtilityCanonicalAction[] = [];
  let actionSeq = 0;
  for (const open of openActions) {
    const owner = participantByOwner(input.participants, open.ownerActorId);
    if (!owner) continue;

    const limitations = [...open.limitations];
    const targetActorId = open.targetActorId;
    const targetCharacterName = nameForActor(input.participants, targetActorId);

    if (
      (open.utilityCategory === "EXTERNAL_SUPPORT" ||
        open.utilityCategory === "COMBAT_RES") &&
      buffsIncomplete &&
      targetActorId == null
    ) {
      limitations.push("EXTERNAL_TARGET_CONTEXT_INCOMPLETE");
    }

    // Never invent a target from incomplete Buffs.
    if (buffsIncomplete && open.sourceDataset === "Casts" && targetActorId == null) {
      if (
        open.utilityCategory === "EXTERNAL_SUPPORT" &&
        !limitations.includes("EXTERNAL_TARGET_CONTEXT_INCOMPLETE")
      ) {
        limitations.push("EXTERNAL_TARGET_CONTEXT_INCOMPLETE");
      }
    }

    // External support: if target is self, keep as OTHER_UTILITY semantics already;
    // if target is another participant, retain as EXTERNAL_SUPPORT.
    let category = open.utilityCategory;
    if (
      category === "EXTERNAL_SUPPORT" &&
      targetActorId != null &&
      targetActorId === open.ownerActorId
    ) {
      category = "OTHER_UTILITY";
    }

    actionSeq += 1;
    const eventTypes = [...open.evidenceEventTypes].sort();
    actions.push({
      canonicalActionId: [
        input.source.reportCode,
        input.source.fightId,
        input.source.reportRevision,
        open.ownerActorId,
        open.abilityKey,
        open.anchorTimestampMs,
        actionSeq,
      ].join(":"),
      abilityKey: open.abilityKey,
      canonicalName: open.canonicalName,
      primarySpellId: open.primarySpellId,
      observedSpellIds: [...open.observedSpellIds].sort((a, b) => a - b),
      utilityCategory: category,
      reportCode: input.source.reportCode,
      fightId: input.source.fightId,
      reportRevision: input.source.reportRevision,
      dungeonSlug: input.source.dungeonSlug,
      rawTimestampMs: open.anchorTimestampMs,
      fightOffsetMs: Math.max(0, open.anchorTimestampMs - input.source.fightStartMs),
      sourceActorId: open.sourceActorId,
      ownerActorId: open.ownerActorId,
      targetActorId,
      sourceCharacterName: owner.characterName,
      targetCharacterName,
      sourceClassSlug: owner.classSlug,
      sourceSpecSlug: owner.specSlug,
      sourceDataset: open.sourceDataset,
      evidenceEventTypes: eventTypes,
      outcome: defaultOutcomeForCategory(category, eventTypes, open.sourceDataset),
      attributedToPet: open.attributedToPet,
      petActorId: open.petActorId,
      limitations,
      catalogVersion,
      normalizerVersion: UTILITY_ACTION_NORMALIZER_VERSION,
    });
  }

  actions.sort(
    (a, b) =>
      a.rawTimestampMs - b.rawTimestampMs ||
      a.ownerActorId - b.ownerActorId ||
      a.abilityKey.localeCompare(b.abilityKey),
  );

  const countsByCategory = emptyCountsByCategory();
  for (const action of actions) {
    countsByCategory[action.utilityCategory] =
      (countsByCategory[action.utilityCategory] ?? 0) + 1;
  }

  const gapSummary = [...gapMap.values()]
    .sort((a, b) => b.count - a.count || a.spellId - b.spellId)
    .slice(0, 50);

  const runLimitations: string[] = [];
  for (const cap of capabilities) {
    if (cap.status !== "COMPLETE") {
      runLimitations.push(`CAPABILITY_${cap.status}:${cap.capability}`);
      runLimitations.push(...cap.limitations);
    }
  }

  const participants: UtilityParticipantSummary[] = input.participants.map((p) => {
    const ownedActions = actions.filter((a) => a.ownerActorId === p.playerActorId);
    const catCounts = emptyCountsByCategory();
    for (const a of ownedActions) {
      catCounts[a.utilityCategory] = (catCounts[a.utilityCategory] ?? 0) + 1;
    }
    const targetMap = new Map<
      string,
      { targetActorId: number | null; targetCharacterName: string | null; actionCount: number }
    >();
    for (const a of ownedActions) {
      const key = `${a.targetActorId ?? "null"}|${a.targetCharacterName ?? ""}`;
      const existing = targetMap.get(key);
      if (existing) existing.actionCount += 1;
      else {
        targetMap.set(key, {
          targetActorId: a.targetActorId,
          targetCharacterName: a.targetCharacterName,
          actionCount: 1,
        });
      }
    }
    const unresolved = gapSummary
      .filter(
        (g) =>
          g.sourceClassSlug === p.classSlug ||
          (g.sourceClassSlug == null && p.classSlug == null),
      )
      .reduce((s, g) => s + g.count, 0);

    const participantLimitations = new Set<string>();
    for (const a of ownedActions) {
      for (const lim of a.limitations) participantLimitations.add(lim);
    }
    for (const cap of capabilities) {
      if (cap.status !== "COMPLETE") {
        participantLimitations.add(`CAPABILITY_${cap.status}:${cap.capability}`);
      }
    }

    return {
      playerActorId: p.playerActorId,
      characterName: p.characterName,
      classSlug: p.classSlug,
      specSlug: p.specSlug,
      ownedPetActorIds: p.ownedPetActorIds,
      rawCandidateEventCount: rawByOwner.get(p.playerActorId) ?? 0,
      canonicalActionCount: ownedActions.length,
      countsByCategory: catCounts,
      canonicalAbilityNames: [...new Set(ownedActions.map((a) => a.canonicalName))].sort(),
      targets: [...targetMap.values()].sort(
        (a, b) => b.actionCount - a.actionCount,
      ),
      petAttributedActionCount: ownedActions.filter((a) => a.attributedToPet).length,
      unresolvedLikelyUtilityCount: unresolved,
      capabilityCompleteness: capabilities,
      limitations: [...participantLimitations].sort(),
    };
  });

  const withoutHash: Omit<UtilityActionTimelineV1, "contentHash"> = {
    schemaVersion: UTILITY_ACTION_TIMELINE_SCHEMA_VERSION,
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
    participants,
    actions,
    countsByCategory,
    rawCandidateEventCount,
    canonicalActionCount: actions.length,
    capabilityCompleteness: capabilities,
    unresolvedLikelyUtilityCandidates: gapSummary,
    utilityCatalogGapSummary: gapSummary,
    datasetCoverage: input.coverage,
    limitations: [...new Set(runLimitations)].sort(),
    catalogVersion,
    normalizerVersion: UTILITY_ACTION_NORMALIZER_VERSION,
    eventNormalizerVersion: WCL_EVENT_NORMALIZER_VERSION,
  };

  const contentHash = hashUtilityActionTimelinePayload(withoutHash);
  return {
    timeline: { ...withoutHash, contentHash },
    providerCallsDuringExtract: 0,
  };
}

export function buildUtilityProbePrintSummary(timeline: UtilityActionTimelineV1): string {
  const lines: string[] = [
    "wcl.probe.utility-one-fight.summary",
    `source=${timeline.sourceKey.reportCode}:${timeline.sourceKey.fightId}:r${timeline.sourceKey.reportRevision}`,
    `rawCandidates=${timeline.rawCandidateEventCount} canonicalActions=${timeline.canonicalActionCount}`,
    `categories=${JSON.stringify(timeline.countsByCategory)}`,
  ];
  for (const p of timeline.participants) {
    lines.push(
      `participant=${p.characterName} actor=${p.playerActorId} raw=${p.rawCandidateEventCount} actions=${p.canonicalActionCount} pets=${p.petAttributedActionCount} cats=${JSON.stringify(p.countsByCategory)}`,
    );
  }
  for (const cap of timeline.capabilityCompleteness) {
    const incomplete =
      cap.incompleteDatasets.length > 0
        ? ` incompleteDatasets=${cap.incompleteDatasets.join(",")}`
        : "";
    const limits =
      cap.limitations.length > 0 ? ` limitations=${cap.limitations.join(",")}` : "";
    lines.push(`capability=${cap.capability} status=${cap.status}${incomplete}${limits}`);
  }
  const targetCtx = timeline.capabilityCompleteness.find(
    (c) => c.capability === "UTILITY_EXTERNAL_TARGET_CONTEXT",
  );
  if (targetCtx) {
    lines.push(
      `externalTargetContextComplete=${targetCtx.status === "COMPLETE"} status=${targetCtx.status}`,
    );
  }
  for (const row of timeline.datasetCoverage) {
    if (row.selectionKind) {
      lines.push(
        `dataset=${row.datasetKey} selection=${row.selectionKind} pages=${row.pageCount} events=${row.eventCount} complete=${row.complete} stopReason=${row.stopReason ?? "null"}`,
      );
    }
  }
  lines.push(`catalogGaps=${timeline.utilityCatalogGapSummary.length}`);
  return lines.join("\n");
}
