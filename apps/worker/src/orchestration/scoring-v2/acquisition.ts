import { createHash } from "node:crypto";
import type {
  AnalyzeEvidenceSlotJobV2,
  EvidenceCandidateAcquisitionResult,
  EvidenceCandidateDiscoveryIdentity,
  EvidenceV2EnabledConsumer,
  FinalizeEvidenceBatchJobV2,
  ProviderFetchContext,
} from "@mplus/contracts";
import { discoveryIdentityKey } from "@mplus/contracts";
import type { ArtifactRepository, EvidenceRepository } from "@mplus/database";
import {
  OBS_EVENTS,
  emitScoringV2Event,
  recordDatasetOutcome,
  recordFactSetWritten,
  recordInvalidCandidateReason,
} from "@mplus/observability";
import type { WorkerContainer } from "../../container.js";
import {
  SCORING_V2_DATASET_SCHEMA_VERSION,
  SCORING_V2_FACT_EXTRACTOR_FAMILY,
  SCORING_V2_FACT_EXTRACTOR_VERSION,
  SCORING_V2_FACT_SCHEMA_VERSION,
} from "./types.js";

const EVIDENCE_PLANNER_PROVIDER_CONTRACT = "wcl-graphql-v2-events";

export class ScoringV2CancelledError extends Error {
  readonly code = "CANCELLED";
  constructor(message = "Scoring V2 batch cancelled") {
    super(message);
    this.name = "ScoringV2CancelledError";
  }
}

export class ScoringV2SupersededError extends Error {
  readonly code = "REFRESH_SUPERSEDED_DEDUPED";
  constructor(message = "Scoring V2 batch superseded") {
    super(message);
    this.name = "ScoringV2SupersededError";
  }
}

export class ScoringV2RateDeferError extends Error {
  readonly code = "SCORING_V2_RATE_DEFER";
  readonly delayMs: number;
  constructor(message: string, delayMs = 60_000) {
    super(message);
    this.name = "ScoringV2RateDeferError";
    this.delayMs = delayMs;
  }
}

export function buildFactSetFingerprint(parts: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  extractorFamily: string;
  extractorVersion: string;
}): string {
  return createHash("sha256")
    .update(
      [
        parts.reportCode,
        String(parts.fightId),
        String(parts.reportRevision),
        parts.extractorFamily,
        parts.extractorVersion,
      ].join("|"),
      "utf8",
    )
    .digest("hex");
}

export function buildDatasetContentHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function resolveEnabledConsumers(env: WorkerContainer["env"]): EvidenceV2EnabledConsumer[] {
  const consumers: EvidenceV2EnabledConsumer[] = [];
  if (env.SCORING_V2_PERFORMANCE_ENABLED) consumers.push("PERFORMANCE");
  if (env.SCORING_V2_SURVIVAL_ENABLED) consumers.push("SURVIVAL");
  if (env.SCORING_V2_UTILITY_ENABLED) consumers.push("UTILITY");
  // Shadow pipeline still needs at least one consumer label for dataset planning.
  if (consumers.length === 0) {
    return ["PERFORMANCE", "SURVIVAL", "UTILITY"];
  }
  return consumers;
}

export function isScoringV2ShadowOrchestrationEnabled(env: WorkerContainer["env"]): boolean {
  return (
    env.SCORING_V2_ENABLED &&
    env.SCORING_V2_SELECTION_ENABLED &&
    env.SCORING_V2_EVIDENCE_FETCH_ENABLED
  );
}

/** Publication must stay blocked in this checkpoint regardless of env misconfiguration. */
export function assertPublicationBlocked(env: WorkerContainer["env"]): void {
  if (env.SCORING_V2_PUBLICATION_ENABLED) {
    throw new Error(
      "SCORING_V2_PUBLICATION_ENABLED is true — Prompt 05 shadow checkpoint forbids public pointer mutation",
    );
  }
}

export async function acquireCandidateWithFallback(input: {
  container: WorkerContainer;
  candidates: Array<{
    discoveryIdentity: EvidenceCandidateDiscoveryIdentity;
    rank: number;
    keyLevel: number;
    timed: boolean | null;
    runScore: number | null;
    evidenceCompleteness: number;
    completedAt: string | null;
    actorId: number | null;
  }>;
  region: string;
  correlationId: string | null;
  shouldCancel: () => Promise<boolean>;
  evidence: EvidenceRepository;
  artifacts: ArtifactRepository;
  manifestSlotIdForPersistence: string | null;
  characterId: string;
}): Promise<{
  result: EvidenceCandidateAcquisitionResult;
  datasetCompatibilityKeys: string[];
  factSetFingerprint: string | null;
  rejectedAttempts: EvidenceCandidateAcquisitionResult[];
}> {
  const rejectedAttempts: EvidenceCandidateAcquisitionResult[] = [];
  const { container } = input;

  for (const candidate of input.candidates) {
    if (await input.shouldCancel()) {
      throw new ScoringV2CancelledError();
    }

    const identity = candidate.discoveryIdentity;
    const ctx: ProviderFetchContext = {
      region: input.region as ProviderFetchContext["region"],
      requestId: `v2-slot-${identity.reportCode}-${identity.fightId}-${Date.now()}`,
      correlationId: input.correlationId ?? `v2-slot-${identity.reportCode}`,
      forceRefresh: false,
      now: new Date().toISOString(),
    };

    try {
      const details = await container.providers.warcraftlogs.getReportFightDetails(
        identity.reportCode,
        identity.fightId,
        ctx,
      );

      if (details.data == null) {
        recordInvalidCandidateReason("ACQUISITION_FAILED");
        rejectedAttempts.push({
          discoveryIdentity: identity,
          acquisitionStatus: "REJECTED",
          reportRevision: null,
          rejectionReason: "ACQUISITION_FAILED",
          rejectionDetail: "getReportFightDetails returned null data",
          datasetHashes: [],
          factSetHash: null,
          dimensionValidity: null,
          keyLevel: candidate.keyLevel,
          timed: candidate.timed,
          runScore: candidate.runScore,
          completedAt: candidate.completedAt,
          actorId: candidate.actorId,
          evidenceCompleteness: candidate.evidenceCompleteness,
        });
        continue;
      }

      const payload = details.data;
      const reportRevision =
        typeof (payload as { reportRevision?: unknown }).reportRevision === "number"
          ? ((payload as { reportRevision: number }).reportRevision)
          : typeof (payload as { revision?: unknown }).revision === "number"
            ? ((payload as { revision: number }).revision)
            : 0;

      const contentHash = buildDatasetContentHash(payload);
      const compatibilityKey = [
        identity.reportCode,
        String(identity.fightId),
        String(reportRevision),
        "fight-details",
        EVIDENCE_PLANNER_PROVIDER_CONTRACT,
      ].join(":");

      const bytes = Buffer.from(JSON.stringify(payload), "utf8");
      const { artifactId } = await input.artifacts.persist({
        provider: "WARCRAFT_LOGS",
        bytes,
        compression: "GZIP",
        artifactClass: "wcl-fight-details-v2",
      });

      await input.evidence.upsertWclReportRevision({
        reportCode: identity.reportCode,
        revision: reportRevision,
        visibility: "PUBLIC",
        startTimeMs: BigInt(0),
        endTimeMs: BigInt(0),
        metadataHash: contentHash,
        fetchedAt: new Date(),
      });

      // Emit only after artifact + report-revision persistence succeed.
      recordDatasetOutcome({
        outcome: "fetched",
        datasetKey: "fight-details",
        bytes: bytes.byteLength,
      });
      emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2DatasetFetched, {
        characterId: input.characterId,
        correlationId: input.correlationId,
        datasetKey: "fight-details",
        bytes: bytes.byteLength,
      });

      const factSetFingerprint = buildFactSetFingerprint({
        reportCode: identity.reportCode,
        fightId: identity.fightId,
        reportRevision,
        extractorFamily: SCORING_V2_FACT_EXTRACTOR_FAMILY,
        extractorVersion: SCORING_V2_FACT_EXTRACTOR_VERSION,
      });

      // Persist dataset/fact only when a real manifest slot row exists (post-freeze
      // redelivery). During acquisition we keep fingerprints on the batch slot record.
      if (input.manifestSlotIdForPersistence) {
        try {
          await input.evidence.createDataset({
            manifestSlotId: input.manifestSlotIdForPersistence,
            datasetKey: "combatantinfo",
            compatibilityKey,
            artifactId,
            schemaVersion: SCORING_V2_DATASET_SCHEMA_VERSION,
            providerContractVersion: EVIDENCE_PLANNER_PROVIDER_CONTRACT,
            state: "READY",
            eventCount: 0,
            pageCount: 1,
            truncated: false,
            payloadFingerprint: contentHash,
            fetchedAt: new Date(),
            costSource: "measured_unknown",
          });
        } catch {
          // Unique compatibility key — reusable completed artifact survives.
        }

        try {
          await input.evidence.createFactSet({
            manifestSlotId: input.manifestSlotIdForPersistence,
            characterId: input.characterId,
            extractorFamily: SCORING_V2_FACT_EXTRACTOR_FAMILY,
            extractorVersion: SCORING_V2_FACT_EXTRACTOR_VERSION,
            schemaVersion: SCORING_V2_FACT_SCHEMA_VERSION,
            inputFingerprint: factSetFingerprint,
            facts: {
              schemaVersion: SCORING_V2_FACT_SCHEMA_VERSION,
              kind: "shadow_placeholder",
              reportCode: identity.reportCode,
              fightId: identity.fightId,
              reportRevision,
              artifactId,
              compatibilityKey,
            },
            coverage: { fightDetails: true },
            limitations: ["DIMENSION_CALCULATORS_NOT_WIRED"],
            computedAt: new Date(),
          });
          recordFactSetWritten({});
          emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2FactSetWritten, {
            characterId: input.characterId,
            correlationId: input.correlationId,
            factSetFingerprint,
          });
        } catch {
          // Idempotent on fingerprint collisions.
        }
      }

      return {
        result: {
          discoveryIdentity: identity,
          acquisitionStatus: "ACQUIRED",
          reportRevision,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes: [{ dataset: "COMBATANT_INFO", contentHash }],
          factSetHash: factSetFingerprint,
          dimensionValidity: {
            performance: "PARTIAL",
            survival: "PARTIAL",
            utility: "PARTIAL",
            reasons: ["SHADOW_PLACEHOLDER_FACT_SET"],
          },
          keyLevel: candidate.keyLevel,
          timed: candidate.timed,
          runScore: candidate.runScore,
          completedAt: candidate.completedAt,
          actorId: candidate.actorId,
          evidenceCompleteness: candidate.evidenceCompleteness,
        },
        datasetCompatibilityKeys: [compatibilityKey],
        factSetFingerprint,
        rejectedAttempts,
      };
    } catch (error) {
      if (error instanceof ScoringV2CancelledError || error instanceof ScoringV2SupersededError) {
        throw error;
      }
      recordInvalidCandidateReason("HARD_PROVIDER_ERROR");
      rejectedAttempts.push({
        discoveryIdentity: identity,
        acquisitionStatus: "REJECTED",
        reportRevision: null,
        rejectionReason: "HARD_PROVIDER_ERROR",
        rejectionDetail: error instanceof Error ? error.message : "unknown_provider_error",
        datasetHashes: [],
        factSetHash: null,
        dimensionValidity: null,
        keyLevel: candidate.keyLevel,
        timed: candidate.timed,
        runScore: candidate.runScore,
        completedAt: candidate.completedAt,
        actorId: candidate.actorId,
        evidenceCompleteness: candidate.evidenceCompleteness,
      });
    }
  }

  const last = input.candidates[input.candidates.length - 1];
  return {
    result: {
      discoveryIdentity: last?.discoveryIdentity ?? { reportCode: "none", fightId: 0 },
      acquisitionStatus: "REJECTED",
      reportRevision: null,
      rejectionReason: "FALLBACK_EXHAUSTED",
      rejectionDetail: `exhausted ${input.candidates.length} candidates`,
      datasetHashes: [],
      factSetHash: null,
      dimensionValidity: null,
      keyLevel: last?.keyLevel ?? null,
      timed: last?.timed ?? null,
      runScore: last?.runScore ?? null,
      completedAt: last?.completedAt ?? null,
      actorId: last?.actorId ?? null,
      evidenceCompleteness: last?.evidenceCompleteness ?? null,
    },
    datasetCompatibilityKeys: [],
    factSetFingerprint: null,
    rejectedAttempts,
  };
}

export function collectAcquisitionResultsForFinalize(
  slots: Array<{ acquisitionResult: EvidenceCandidateAcquisitionResult | null }>,
): EvidenceCandidateAcquisitionResult[] {
  const out: EvidenceCandidateAcquisitionResult[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    if (!slot.acquisitionResult) continue;
    const key = discoveryIdentityKey(slot.acquisitionResult.discoveryIdentity);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot.acquisitionResult);
  }
  return out;
}

export type { AnalyzeEvidenceSlotJobV2, FinalizeEvidenceBatchJobV2 };
