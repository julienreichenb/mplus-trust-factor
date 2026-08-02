/**
 * Idempotent typed RunFactSet persistence for Scoring V2.
 * Provider-free — only writes already-extracted bounded fact documents.
 */

import type { Prisma } from "@mplus/database";
import type { EvidenceRepository } from "@mplus/database";
import {
  hashFactDocumentContent,
  buildTypedFactSetFingerprint,
  type DimensionFactExtractionStatus,
  type FactExtractionCategory,
  type ScoringV2ExtractableDimension,
} from "@mplus/provider-warcraftlogs";
import {
  OBS_EVENTS,
  emitScoringV2Event,
  recordFactSetWritten,
} from "@mplus/observability";

export interface TypedDimensionFactPayload {
  dimension: ScoringV2ExtractableDimension;
  status: DimensionFactExtractionStatus;
  extractorFamily: string;
  extractorVersion: string;
  schemaVersion: string;
  /** Bounded fact document — never raw WCL pages. */
  facts: unknown | null;
  limitations: string[];
  category: FactExtractionCategory | null;
  reason: string | null;
  /** Artifact ids for source evidence (optional references). */
  artifactIds: string[];
  coverage: Record<string, unknown>;
}

export interface PersistTypedFactSetInput {
  evidence: EvidenceRepository;
  logger: {
    info: (obj: object, msg?: string) => void;
    warn?: (obj: object, msg?: string) => void;
    error?: (obj: object, msg?: string) => void;
  };
  characterId: string;
  correlationId?: string | null;
  manifestSlotId: string;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  /** Frozen class/spec identity — binds catalog-dependent fingerprints. */
  classSlug?: string | null;
  specSlug?: string | null;
  payload: TypedDimensionFactPayload;
}

export type PersistTypedFactSetResult =
  | { outcome: "written"; created: boolean; inputFingerprint: string; contentHash: string }
  | { outcome: "skipped_unavailable" | "skipped_failed"; reason: string }
  | { outcome: "conflict"; reason: string };

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Persist one typed fact set. UNAVAILABLE/FAILED payloads are not written as
 * shadow_placeholder — callers record outcomes separately.
 */
export async function persistTypedFactSet(
  input: PersistTypedFactSetInput,
): Promise<PersistTypedFactSetResult> {
  const { payload } = input;
  if (payload.status === "UNAVAILABLE") {
    return {
      outcome: "skipped_unavailable",
      reason: payload.reason ?? "unavailable",
    };
  }
  if (payload.status === "FAILED" || payload.facts == null) {
    return {
      outcome: "skipped_failed",
      reason: payload.reason ?? "failed",
    };
  }

  const contentHash = hashFactDocumentContent(payload.facts);
  const fingerprintParts: Parameters<typeof buildTypedFactSetFingerprint>[0] = {
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    extractorFamily: payload.extractorFamily,
    extractorVersion: payload.extractorVersion,
  };
  if ("classSlug" in input || "specSlug" in input) {
    fingerprintParts.classSlug = input.classSlug ?? null;
    fingerprintParts.specSlug = input.specSlug ?? null;
  }
  const inputFingerprint = buildTypedFactSetFingerprint(fingerprintParts);

  // Fail closed: same logical identity (slot+family+version) with different content.
  const existing = await input.evidence.findFactSetByLogicalIdentity({
    manifestSlotId: input.manifestSlotId,
    extractorFamily: payload.extractorFamily,
    extractorVersion: payload.extractorVersion,
  });

  if (existing) {
    const existingContentHash = hashFactDocumentContent(existing.facts);
    if (existingContentHash === contentHash) {
      return {
        outcome: "written",
        created: false,
        inputFingerprint: existing.inputFingerprint,
        contentHash,
      };
    }
    return {
      outcome: "conflict",
      reason: "fact_content_conflict",
    };
  }

  try {
    await input.evidence.createFactSet({
      manifestSlotId: input.manifestSlotId,
      characterId: input.characterId,
      extractorFamily: payload.extractorFamily,
      extractorVersion: payload.extractorVersion,
      schemaVersion: payload.schemaVersion,
      inputFingerprint,
      facts: payload.facts as Prisma.InputJsonValue,
      coverage: {
        ...payload.coverage,
        contentHash,
        artifactIds: payload.artifactIds,
        dimension: payload.dimension,
        status: payload.status,
      } as Prisma.InputJsonValue,
      limitations: payload.limitations,
      computedAt: new Date(),
    });
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) throw error;
    const raced = await input.evidence.findFactSetByLogicalIdentity({
      manifestSlotId: input.manifestSlotId,
      extractorFamily: payload.extractorFamily,
      extractorVersion: payload.extractorVersion,
    });
    if (!raced) throw error;
    const racedHash = hashFactDocumentContent(raced.facts);
    if (racedHash !== contentHash) {
      return { outcome: "conflict", reason: "fact_content_conflict_race" };
    }
    return {
      outcome: "written",
      created: false,
      inputFingerprint: raced.inputFingerprint,
      contentHash,
    };
  }

  recordFactSetWritten({ dimension: payload.dimension });
  emitScoringV2Event(
    {
      info: input.logger.info,
      warn: input.logger.warn ?? input.logger.info,
      error: input.logger.error ?? input.logger.info,
    },
    OBS_EVENTS.scoringV2FactSetWritten,
    {
      characterId: input.characterId,
      correlationId: input.correlationId,
      factSetFingerprint: inputFingerprint,
      dimension: payload.dimension,
    },
  );

  return {
    outcome: "written",
    created: true,
    inputFingerprint,
    contentHash,
  };
}
