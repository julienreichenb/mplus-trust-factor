/**
 * Extract minimal CombatantInfo loadout proof for cooldown availability.
 * Does not invent a parallel talent system — only projects spell IDs / node ids.
 */

export type LoadoutEvidenceState = "PRESENT" | "ABSENT" | "UNPARSEABLE";

export interface ParticipantLoadoutEvidence {
  actorId: number;
  blizzardSpecId: number | null;
  talentSpellIds: number[];
  talentTreeNodeIds: number[];
  evidenceState: LoadoutEvidenceState;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

/**
 * Pull talent spell IDs and tree node/entry IDs from a raw CombatantInfo event.
 * WCL talentTree nodes expose `{ id, nodeId, rank, spellId }`.
 */
export function extractLoadoutIdsFromCombatantInfo(raw: unknown): {
  talentSpellIds: number[];
  talentTreeNodeIds: number[];
  blizzardSpecId: number | null;
  evidenceState: LoadoutEvidenceState;
} {
  const row = asRecord(raw);
  if (row == null) {
    return {
      talentSpellIds: [],
      talentTreeNodeIds: [],
      blizzardSpecId: null,
      evidenceState: "ABSENT",
    };
  }

  const blizzardSpecId =
    asPositiveInt(row.specID) ?? asPositiveInt(row.specId) ?? null;

  const spellIds = new Set<number>();
  const nodeIds = new Set<number>();
  let sawTalentPayload = false;
  let parseFailed = false;

  const ingestTree = (tree: unknown) => {
    if (tree == null) return;
    sawTalentPayload = true;
    if (!Array.isArray(tree)) {
      parseFailed = true;
      return;
    }
    for (const node of tree) {
      const rec = asRecord(node);
      if (rec == null) {
        parseFailed = true;
        continue;
      }
      const spellId = asPositiveInt(rec.spellId) ?? asPositiveInt(rec.spellID);
      if (spellId != null) spellIds.add(spellId);
      const nodeId =
        asPositiveInt(rec.id) ??
        asPositiveInt(rec.nodeId) ??
        asPositiveInt(rec.entryId);
      if (nodeId != null) nodeIds.add(nodeId);
    }
  };

  ingestTree(row.talentTree);
  ingestTree(row.talent_tree);

  const talents = row.talents;
  if (talents != null) {
    sawTalentPayload = true;
    if (Array.isArray(talents)) {
      for (const t of talents) {
        if (typeof t === "number") {
          const id = asPositiveInt(t);
          if (id != null) spellIds.add(id);
          continue;
        }
        const rec = asRecord(t);
        if (rec == null) {
          parseFailed = true;
          continue;
        }
        const spellId = asPositiveInt(rec.spellId) ?? asPositiveInt(rec.spellID);
        if (spellId != null) spellIds.add(spellId);
        const nodeId = asPositiveInt(rec.id) ?? asPositiveInt(rec.nodeId);
        if (nodeId != null) nodeIds.add(nodeId);
      }
    } else {
      parseFailed = true;
    }
  }

  if (!sawTalentPayload) {
    return {
      talentSpellIds: [],
      talentTreeNodeIds: [],
      blizzardSpecId,
      evidenceState: "ABSENT",
    };
  }

  if (parseFailed && spellIds.size === 0 && nodeIds.size === 0) {
    return {
      talentSpellIds: [],
      talentTreeNodeIds: [],
      blizzardSpecId,
      evidenceState: "UNPARSEABLE",
    };
  }

  return {
    talentSpellIds: [...spellIds].sort((a, b) => a - b),
    talentTreeNodeIds: [...nodeIds].sort((a, b) => a - b),
    blizzardSpecId,
    evidenceState: spellIds.size > 0 || nodeIds.size > 0 ? "PRESENT" : "ABSENT",
  };
}

export function extractParticipantLoadoutsFromCombatantEvents(
  events: ReadonlyArray<unknown>,
  friendlyPlayerActorIds: ReadonlySet<number>,
): ParticipantLoadoutEvidence[] {
  const byActor = new Map<number, ParticipantLoadoutEvidence>();

  for (const raw of events) {
    const row = asRecord(raw);
    if (row == null) continue;
    const actorId =
      asPositiveInt(row.sourceID) ??
      asPositiveInt(row.sourceId) ??
      asPositiveInt(asRecord(row.source)?.id);
    if (actorId == null || !friendlyPlayerActorIds.has(actorId)) continue;

    const extracted = extractLoadoutIdsFromCombatantInfo(row);
    const existing = byActor.get(actorId);
    if (existing == null) {
      byActor.set(actorId, {
        actorId,
        blizzardSpecId: extracted.blizzardSpecId,
        talentSpellIds: extracted.talentSpellIds,
        talentTreeNodeIds: extracted.talentTreeNodeIds,
        evidenceState: extracted.evidenceState,
      });
      continue;
    }

    // Merge multiple CombatantInfo rows for the same actor (prefer richer payload).
    const mergedSpells = new Set([
      ...existing.talentSpellIds,
      ...extracted.talentSpellIds,
    ]);
    const mergedNodes = new Set([
      ...existing.talentTreeNodeIds,
      ...extracted.talentTreeNodeIds,
    ]);
    const state: LoadoutEvidenceState =
      mergedSpells.size > 0 || mergedNodes.size > 0
        ? "PRESENT"
        : extracted.evidenceState === "UNPARSEABLE" ||
            existing.evidenceState === "UNPARSEABLE"
          ? "UNPARSEABLE"
          : "ABSENT";
    byActor.set(actorId, {
      actorId,
      blizzardSpecId: existing.blizzardSpecId ?? extracted.blizzardSpecId,
      talentSpellIds: [...mergedSpells].sort((a, b) => a - b),
      talentTreeNodeIds: [...mergedNodes].sort((a, b) => a - b),
      evidenceState: state,
    });
  }

  return [...byActor.values()].sort((a, b) => a.actorId - b.actorId);
}
