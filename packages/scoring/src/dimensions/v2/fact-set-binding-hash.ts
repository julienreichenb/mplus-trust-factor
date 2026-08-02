/**
 * Slot-level fact-set binding hash for EvidenceManifestV2.slot.factSetHash.
 *
 * One selected slot may bind multiple typed RunFactSet rows (Performance /
 * Survival / Utility). The manifest stores a single factSetHash; this helper
 * builds / verifies that binding deterministically from extractor identities.
 *
 * Content integrity remains fail-closed at typed fact persistence (conflict
 * detection). Slot binding hashes intentionally exclude fact payloads so
 * Prisma JSON round-trips cannot falsely invalidate an otherwise correct set.
 */

import { createHash } from "node:crypto";

export interface SlotFactSetBindingMember {
  extractorFamily: string;
  extractorVersion: string;
  /** Per-family identity fingerprint (report + fight + revision + family + version). */
  inputFingerprint: string;
  /** Retained for callers; not included in the binding hash. */
  facts?: unknown;
}

/**
 * Build the manifest slot factSetHash for one or more typed fact members.
 *
 * Single-member slots keep the historical identity fingerprint so existing
 * placeholder / single-fact tests remain valid. Multi-member slots bind
 * sorted family+version+identity fingerprints.
 */
export function buildSlotFactSetBindingHash(
  members: SlotFactSetBindingMember[],
): string {
  if (members.length === 0) {
    return createHash("sha256").update("empty-slot-fact-binding", "utf8").digest("hex");
  }
  if (members.length === 1) {
    return members[0]!.inputFingerprint;
  }
  const lines = members
    .map((m) =>
      [m.extractorFamily, m.extractorVersion, m.inputFingerprint].join("\0"),
    )
    .sort((a, b) => a.localeCompare(b));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}
