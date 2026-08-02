/**
 * Immutable dataset requirements for a Scoring V2 evidence batch.
 * Derived once from enabled consumers; acquisition must not invent work.
 */

import type { EvidenceDatasetKind, EvidenceV2EnabledConsumer } from "@mplus/contracts";
import {
  buildDatasetRequirements,
  type EvidenceDatasetRequirementV2,
} from "@mplus/provider-warcraftlogs";

export type { EvidenceDatasetRequirementV2 };

/** Map planner EvidenceDatasetKind → shared-evidence bundle keys. */
export function toSharedEvidenceDatasetKey(
  dataset: EvidenceDatasetKind,
):
  | "masterData"
  | "Casts"
  | "HostileCasts"
  | "Interrupts"
  | "Deaths"
  | "DamageTaken"
  | "DamageDone"
  | "Buffs"
  | "Debuffs"
  | "Dispels"
  | "Healing"
  | "CombatantInfo"
  | null {
  switch (dataset) {
    case "MASTER_DATA":
      return "masterData";
    case "CASTS":
      return "Casts";
    case "HOSTILE_CASTS":
      return "HostileCasts";
    case "INTERRUPTS":
      return "Interrupts";
    case "DEATHS":
      return "Deaths";
    case "DAMAGE_TAKEN":
      return "DamageTaken";
    case "DAMAGE_DONE":
      return "DamageDone";
    case "BUFFS":
      return "Buffs";
    case "DEBUFFS":
      return "Debuffs";
    case "DISPELS":
      return "Dispels";
    case "HEALING":
      return "Healing";
    case "COMBATANT_INFO":
      return "CombatantInfo";
    case "RANKING_PARSE":
      return null;
    default:
      return null;
  }
}

export function resolveBatchDatasetRequirements(
  enabledConsumers: readonly EvidenceV2EnabledConsumer[],
): EvidenceDatasetRequirementV2[] {
  return buildDatasetRequirements(enabledConsumers, { includeOptional: true });
}

export function sharedEvidenceKeysFromRequirements(
  requirements: readonly EvidenceDatasetRequirementV2[],
): Array<
  NonNullable<ReturnType<typeof toSharedEvidenceDatasetKey>>
> {
  const keys: Array<NonNullable<ReturnType<typeof toSharedEvidenceDatasetKey>>> = [];
  const seen = new Set<string>();
  for (const req of requirements) {
    const key = toSharedEvidenceDatasetKey(req.dataset);
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function requiresRankingParse(
  requirements: readonly EvidenceDatasetRequirementV2[],
): boolean {
  return requirements.some((r) => r.dataset === "RANKING_PARSE");
}

export function requiresSharedEventEvidence(
  requirements: readonly EvidenceDatasetRequirementV2[],
): boolean {
  return sharedEvidenceKeysFromRequirements(requirements).length > 0;
}
