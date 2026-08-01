import type {
  EvidenceCandidateMetadataV2,
  MythicRunDTO,
  RunSourceRefDTO,
} from "@mplus/contracts";

function wclSource(run: MythicRunDTO): RunSourceRefDTO | null {
  return (
    run.sources.find(
      (s) =>
        s.provider === "WARCRAFT_LOGS" &&
        s.reportCode != null &&
        s.fightId != null,
    ) ?? null
  );
}

/**
 * Adapter from current MythicRunDTO (+ WCL source) to EvidenceCandidateMetadataV2.
 * Provider-free: reads only already-normalized run DTOs.
 * Returns null when no WCL report/fight identity is present.
 */
export function mythicRunToEvidenceCandidateMetadata(
  run: MythicRunDTO,
  options?: {
    evidenceCompleteness?: number;
    actorId?: number | null;
    accessState?: EvidenceCandidateMetadataV2["accessState"];
    identityResolution?: EvidenceCandidateMetadataV2["identityResolution"];
    fightAccessible?: boolean;
    hardError?: boolean;
    discoverySource?: string;
  },
): EvidenceCandidateMetadataV2 | null {
  const source = wclSource(run);
  if (!source?.reportCode || source.fightId == null) return null;

  return {
    discoveryIdentity: {
      reportCode: source.reportCode,
      fightId: source.fightId,
    },
    reportRevision: source.revision,
    dungeonSlug: run.dungeonSlug.trim().toLowerCase(),
    keyLevel: run.keyLevel,
    timed: run.timed,
    runScore: run.scoreValue,
    evidenceCompleteness: options?.evidenceCompleteness ?? (source.revision != null ? 1 : 0.5),
    completedAt: run.completedAt,
    fightDurationMs: run.durationMs > 0 ? run.durationMs : null,
    actorId: options?.actorId ?? null,
    accessState: options?.accessState ?? "PUBLIC",
    identityResolution: options?.identityResolution ?? "RESOLVED",
    fightAccessible: options?.fightAccessible ?? true,
    hardError: options?.hardError ?? false,
    discoverySource: options?.discoverySource ?? "canonical-run",
  };
}

/**
 * Lightweight adapter from V1 scoring-run candidate shape when WCL identity is known.
 */
export function scoringRunCandidateToEvidenceMetadata(input: {
  reportCode: string;
  fightId: number;
  reportRevision: number | null;
  dungeonSlug: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  durationMs: number | null;
  scoreValue: number | null;
  hasWclSource: boolean;
  evidenceCompleteness?: number;
}): EvidenceCandidateMetadataV2 | null {
  if (!input.hasWclSource) return null;
  return {
    discoveryIdentity: {
      reportCode: input.reportCode,
      fightId: input.fightId,
    },
    reportRevision: input.reportRevision,
    dungeonSlug: input.dungeonSlug.trim().toLowerCase(),
    keyLevel: input.keyLevel,
    timed: input.timed,
    runScore: input.scoreValue,
    evidenceCompleteness: input.evidenceCompleteness ?? (input.reportRevision != null ? 1 : 0.5),
    completedAt: input.completedAt,
    fightDurationMs: input.durationMs != null && input.durationMs > 0 ? input.durationMs : null,
    actorId: null,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
    discoverySource: "scoring-run-candidate-v1",
  };
}
