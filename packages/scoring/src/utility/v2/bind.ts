/**
 * Bind Utility fact sets to frozen EvidenceManifestV2 selected slots.
 * Rejects mismatched / unbound facts — does not invent a shared binder.
 */

import type {
  UtilityV2BindingResult,
  UtilityV2FrozenManifestRef,
  UtilityV2ManifestSlotRef,
  UtilityV2RunFactSet,
} from "./types.js";

export function selectedManifestSlots(
  manifest: UtilityV2FrozenManifestRef,
): UtilityV2ManifestSlotRef[] {
  return manifest.slots.filter(
    (s) => s.state === "SELECTED" && s.identity != null,
  );
}

function identityMatches(
  fact: UtilityV2RunFactSet,
  slot: UtilityV2ManifestSlotRef,
): boolean {
  const id = slot.identity;
  if (id == null) return false;
  if (fact.slotId !== slot.slotId) return false;
  if (fact.reportCode == null || fact.fightId == null || fact.reportRevision == null) {
    return false;
  }
  return (
    fact.reportCode === id.reportCode &&
    fact.fightId === id.fightId &&
    fact.reportRevision === id.reportRevision &&
    fact.dungeonSlug === slot.dungeonSlug &&
    (fact.slotIndex == null || fact.slotIndex === slot.slotIndex)
  );
}

/**
 * Validate every provided fact against selected manifest slots.
 * Any unbound / mismatched fact fails the whole bind (UNAVAILABLE upstream).
 */
export function bindUtilityV2FactsToManifest(input: {
  manifest: UtilityV2FrozenManifestRef;
  factSets: UtilityV2RunFactSet[];
  extractionFailed?: boolean;
}): UtilityV2BindingResult {
  const reasons: string[] = [];
  const selected = selectedManifestSlots(input.manifest);

  if (input.extractionFailed) {
    return {
      ok: false,
      boundFactSets: [],
      selectedSlotCount: selected.length,
      boundSelectedSlotCount: 0,
      reasons: ["extraction_failed"],
    };
  }

  if (input.factSets.length === 0) {
    return {
      ok: false,
      boundFactSets: [],
      selectedSlotCount: selected.length,
      boundSelectedSlotCount: 0,
      reasons: ["no_fact_sets"],
    };
  }

  if (selected.length === 0) {
    return {
      ok: false,
      boundFactSets: [],
      selectedSlotCount: 0,
      boundSelectedSlotCount: 0,
      reasons: ["no_selected_manifest_slots"],
    };
  }

  const bySlotId = new Map(selected.map((s) => [s.slotId, s]));
  const bound: UtilityV2RunFactSet[] = [];
  const usedSlots = new Set<string>();

  for (const fact of input.factSets) {
    if (!fact.slotId) {
      reasons.push("fact_missing_slot_id");
      return {
        ok: false,
        boundFactSets: [],
        selectedSlotCount: selected.length,
        boundSelectedSlotCount: 0,
        reasons,
      };
    }
    if (fact.reportCode == null || fact.fightId == null || fact.reportRevision == null) {
      reasons.push(`fact_unbound_identity:${fact.slotId}`);
      return {
        ok: false,
        boundFactSets: [],
        selectedSlotCount: selected.length,
        boundSelectedSlotCount: 0,
        reasons,
      };
    }
    const slot = bySlotId.get(fact.slotId);
    if (!slot) {
      reasons.push(`fact_slot_not_selected:${fact.slotId}`);
      return {
        ok: false,
        boundFactSets: [],
        selectedSlotCount: selected.length,
        boundSelectedSlotCount: 0,
        reasons,
      };
    }
    if (!identityMatches(fact, slot)) {
      reasons.push(`fact_identity_mismatch:${fact.slotId}`);
      return {
        ok: false,
        boundFactSets: [],
        selectedSlotCount: selected.length,
        boundSelectedSlotCount: 0,
        reasons,
      };
    }
    if (usedSlots.has(fact.slotId)) {
      reasons.push(`duplicate_fact_slot:${fact.slotId}`);
      return {
        ok: false,
        boundFactSets: [],
        selectedSlotCount: selected.length,
        boundSelectedSlotCount: 0,
        reasons,
      };
    }
    usedSlots.add(fact.slotId);
    bound.push(fact);
  }

  bound.sort(
    (a, b) =>
      a.dungeonSlug.localeCompare(b.dungeonSlug) ||
      (a.slotIndex ?? 0) - (b.slotIndex ?? 0) ||
      a.slotId.localeCompare(b.slotId),
  );

  return {
    ok: true,
    boundFactSets: bound,
    selectedSlotCount: selected.length,
    boundSelectedSlotCount: bound.length,
    reasons: [],
  };
}
