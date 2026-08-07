/**
 * Reconcile an incomplete frozen manifest with newly discovered candidates.
 * Creates a new content hash / revision — never mutates a completed manifest.
 */
import type {
  CharacterSeasonEvidenceManifestV2,
  EvidenceCandidateMetadataV2,
} from "@mplus/contracts";

export function selectedSlotsAsCandidates(
  manifest: CharacterSeasonEvidenceManifestV2,
): EvidenceCandidateMetadataV2[] {
  const out: EvidenceCandidateMetadataV2[] = [];
  for (const slot of manifest.slots) {
    if (slot.state !== "SELECTED" || !slot.identity) continue;
    out.push({
      discoveryIdentity: {
        reportCode: slot.identity.reportCode,
        fightId: slot.identity.fightId,
      },
      reportRevision: slot.identity.reportRevision,
      dungeonSlug: slot.dungeonSlug,
      keyLevel: slot.keyLevel ?? 1,
      timed: slot.timed,
      runScore: slot.runScore,
      evidenceCompleteness: 1,
      completedAt: slot.completedAt ?? "1970-01-01T00:00:00.000Z",
      fightDurationMs: null,
      actorId: slot.actorId,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: "prior_incomplete_manifest",
    });
  }
  return out;
}

export function mergeDiscoveryCandidates(input: {
  prior: readonly EvidenceCandidateMetadataV2[];
  discovered: readonly EvidenceCandidateMetadataV2[];
}): EvidenceCandidateMetadataV2[] {
  const byId = new Map<string, EvidenceCandidateMetadataV2>();
  for (const c of [...input.prior, ...input.discovered]) {
    const k = `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;
    const existing = byId.get(k);
    if (!existing) {
      byId.set(k, c);
      continue;
    }
    // Prefer richer / higher key when merging same identity.
    const prefer =
      (c.keyLevel ?? 0) > (existing.keyLevel ?? 0) ||
      (c.runScore ?? 0) > (existing.runScore ?? 0)
        ? c
        : existing;
    byId.set(k, prefer);
  }
  return [...byId.values()];
}

export function assertNoDuplicateSelectedIdentities(
  manifest: CharacterSeasonEvidenceManifestV2,
): void {
  const seen = new Set<string>();
  for (const slot of manifest.slots) {
    if (slot.state !== "SELECTED" || !slot.identity) continue;
    const k = `${slot.identity.reportCode}:${slot.identity.fightId}`;
    if (seen.has(k)) {
      throw Object.assign(new Error(`duplicate_source_fight:${k}`), {
        code: "DUPLICATE_SOURCE_FIGHT",
      });
    }
    seen.add(k);
  }
}
