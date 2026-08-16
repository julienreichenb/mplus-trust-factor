/**
 * Exact CharacterRunDigest lineage for a frozen CharacterScore selected-run slot.
 *
 * Unique persisted digest key: rawRunId + participantActorId + extractorVersion.
 * Unique raw run key: reportCode + fightId + reportRevision + acquisitionVersion.
 *
 * Score slot identity (when persisted): reportCode, fightId, reportRevision, participantActorId.
 * Preferred extractor: slot.extractorVersion, else PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION.
 *
 * Order:
 * 1. reportCode (case-insensitive) + fightId
 * 2. participantActorId when the slot stores it
 * 3. reportRevision when the slot stores it — never fall back to another revision
 * 4. preferred extractorVersion when more than one extractor remains
 * 5. if more than one row still remains (e.g. distinct acquisition versions), return null
 */
export interface CanonicalDigestIdentitySlot {
  reportCode: string;
  fightId: number;
  reportRevision?: number | null;
  participantActorId?: number | null;
  extractorVersion?: string | null;
}

export interface CanonicalDigestCandidate {
  participantActorId: number;
  extractorVersion: string;
  rawRun: { reportCode: string; fightId: number; reportRevision: number };
}

export function selectExactCanonicalRunDigest<T extends CanonicalDigestCandidate>(
  rows: T[],
  slot: CanonicalDigestIdentitySlot,
  preferredExtractorVersion: string,
): T | null {
  const code = slot.reportCode.trim().toLowerCase();
  let matches = rows.filter(
    (row) =>
      row.rawRun.reportCode.toLowerCase() === code && row.rawRun.fightId === slot.fightId,
  );
  if (slot.participantActorId != null) {
    matches = matches.filter((row) => row.participantActorId === slot.participantActorId);
  }
  if (slot.reportRevision != null) {
    matches = matches.filter((row) => row.rawRun.reportRevision === slot.reportRevision);
  } else {
    const revisions = new Set(matches.map((row) => row.rawRun.reportRevision));
    if (revisions.size > 1) return null;
  }
  if (matches.length === 0) return null;
  const preferred =
    typeof slot.extractorVersion === "string" && slot.extractorVersion.trim() !== ""
      ? slot.extractorVersion.trim()
      : preferredExtractorVersion;
  const byExtractor = matches.filter((row) => row.extractorVersion === preferred);
  const remaining = byExtractor.length > 0 ? byExtractor : matches.length === 1 ? matches : [];
  if (remaining.length !== 1) return null;
  return remaining[0] ?? null;
}
