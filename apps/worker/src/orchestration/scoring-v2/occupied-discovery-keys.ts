import type { EvidenceV2SlotRecord } from "./types.js";

/**
 * Discovery identities already claimed by sibling slots in the same batch.
 * Includes acquired winners and in-flight reservations so parallel slot jobs
 * never hydrate the same reportCode+fightId for typed fact persistence.
 */
export function collectOccupiedDiscoveryKeys(
  slots: ReadonlyArray<
    Pick<EvidenceV2SlotRecord, "slotId" | "acquiredDiscoveryKey" | "reservedDiscoveryKey">
  >,
  excludeSlotId: string,
): Set<string> {
  const keys = new Set<string>();
  for (const slot of slots) {
    if (slot.slotId === excludeSlotId) continue;
    if (slot.acquiredDiscoveryKey) keys.add(slot.acquiredDiscoveryKey);
    if (slot.reservedDiscoveryKey) keys.add(slot.reservedDiscoveryKey);
  }
  return keys;
}
