import type {
  EvidenceCandidateMetadataV2,
  MythicRunDTO,
  RunSourceRefDTO,
} from "@mplus/contracts";

function wclSources(run: MythicRunDTO): RunSourceRefDTO[] {
  const seen = new Set<string>();
  const out: RunSourceRefDTO[] = [];
  for (const s of run.sources) {
    if (s.provider !== "WARCRAFT_LOGS" || s.reportCode == null || s.fightId == null) {
      continue;
    }
    const key = `${s.reportCode}:${s.fightId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

type MythicRunEvidenceOptions = {
  evidenceCompleteness?: number;
  actorId?: number | null;
  accessState?: EvidenceCandidateMetadataV2["accessState"];
  identityResolution?: EvidenceCandidateMetadataV2["identityResolution"];
  fightAccessible?: boolean;
  hardError?: boolean;
  discoverySource?: string;
};

/**
 * One evidence candidate per distinct WCL reportCode:fightId on the run.
 * Fusion may attach multiple WCL uploads of the same key; discovery/selection
 * identities must remain report-scoped (known-good canary behavior).
 */
export function mythicRunToEvidenceCandidateMetadataList(
  run: MythicRunDTO,
  options?: MythicRunEvidenceOptions,
): EvidenceCandidateMetadataV2[] {
  const sources = wclSources(run);
  if (sources.length === 0) return [];

  return sources.map((source) => ({
    discoveryIdentity: {
      reportCode: source.reportCode!,
      fightId: source.fightId!,
    },
    reportRevision: source.revision,
    dungeonSlug: run.dungeonSlug.trim().toLowerCase(),
    keyLevel: run.keyLevel,
    timed: run.timed,
    runScore: run.scoreValue,
    evidenceCompleteness:
      options?.evidenceCompleteness ?? (source.revision != null ? 1 : 0.5),
    completedAt: run.completedAt,
    fightDurationMs: run.durationMs > 0 ? run.durationMs : null,
    actorId: options?.actorId ?? null,
    accessState: options?.accessState ?? "PUBLIC",
    identityResolution: options?.identityResolution ?? "RESOLVED",
    fightAccessible: options?.fightAccessible ?? true,
    hardError: options?.hardError ?? false,
    discoverySource: options?.discoverySource ?? "canonical-run",
  }));
}

/**
 * Adapter from current MythicRunDTO (+ WCL source) to EvidenceCandidateMetadataV2.
 * Provider-free: reads only already-normalized run DTOs.
 * Returns null when no WCL report/fight identity is present.
 * Prefer {@link mythicRunToEvidenceCandidateMetadataList} when fused runs may
 * carry multiple WCL source identities.
 */
export function mythicRunToEvidenceCandidateMetadata(
  run: MythicRunDTO,
  options?: MythicRunEvidenceOptions,
): EvidenceCandidateMetadataV2 | null {
  return mythicRunToEvidenceCandidateMetadataList(run, options)[0] ?? null;
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
