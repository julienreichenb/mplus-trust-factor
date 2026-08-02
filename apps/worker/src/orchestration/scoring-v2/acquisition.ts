import { createHash } from "node:crypto";
import type {
  AnalyzeEvidenceSlotJobV2,
  EvidenceCandidateAcquisitionResult,
  EvidenceCandidateDiscoveryIdentity,
  EvidenceDatasetKind,
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
  recordInvalidCandidateReason,
} from "@mplus/observability";
import {
  PERFORMANCE_V2_EXTRACTOR_FAMILY,
  PERFORMANCE_V2_EXTRACTOR_VERSION,
  PERFORMANCE_V2_FACT_SCHEMA_VERSION,
  SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
  extractPerformanceRunParseFactV2,
  extractSurvivalFactDocumentV2FromSharedEvidence,
  extractUtilityV2RunFactSetFromSharedEvidence,
  hashFactDocumentContent,
  type FrozenSlotBindingV2,
  type WclRunEvidenceBundle,
} from "@mplus/provider-warcraftlogs";
import {
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  SURVIVAL_V2_SCHEMA_VERSION,
  UTILITY_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_EXTRACTOR_VERSION,
  UTILITY_V2_SCHEMA_VERSION,
  buildSlotFactSetBindingHash,
} from "@mplus/scoring";
import { getAbilityCatalog } from "@mplus/abilities";
import type { WorkerContainer } from "../../container.js";
import {
  requiresRankingParse,
  requiresSharedEventEvidence,
  resolveBatchDatasetRequirements,
  sharedEvidenceKeysFromRequirements,
  type EvidenceDatasetRequirementV2,
} from "./dataset-requirements.js";
import type { ScoringV2EvidenceTransport } from "./evidence-transport.js";
import {
  persistTypedFactSet,
  type TypedDimensionFactPayload,
} from "./typed-fact-persist.js";
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

function datasetKindFromSharedKey(key: string): EvidenceDatasetKind | null {
  switch (key) {
    case "masterData":
      return "MASTER_DATA";
    case "Casts":
      return "CASTS";
    case "HostileCasts":
      return "HOSTILE_CASTS";
    case "Interrupts":
      return "INTERRUPTS";
    case "Deaths":
      return "DEATHS";
    case "DamageTaken":
      return "DAMAGE_TAKEN";
    case "DamageDone":
      return "DAMAGE_DONE";
    case "Buffs":
      return "BUFFS";
    case "Debuffs":
      return "DEBUFFS";
    case "Dispels":
      return "DISPELS";
    case "Healing":
      return "HEALING";
    case "CombatantInfo":
      return "COMBATANT_INFO";
    default:
      return null;
  }
}

async function persistArtifactBytes(input: {
  artifacts: ArtifactRepository;
  provider: "WARCRAFT_LOGS";
  artifactClass: string;
  payload: unknown;
}): Promise<{ artifactId: string; contentHash: string; bytes: number }> {
  const contentHash = buildDatasetContentHash(input.payload);
  const bytes = Buffer.from(JSON.stringify(input.payload), "utf8");
  const { artifactId } = await input.artifacts.persist({
    provider: input.provider,
    bytes,
    compression: "GZIP",
    artifactClass: input.artifactClass,
  });
  return { artifactId, contentHash, bytes: bytes.byteLength };
}

function buildSlotBinding(input: {
  slotId: string;
  dungeonSlug: string;
  slotIndex: 0 | 1;
  keyLevel: number | null;
  reportCode: string;
  fightId: number;
  reportRevision: number;
}): FrozenSlotBindingV2 {
  return {
    slotId: input.slotId,
    dungeonSlug: input.dungeonSlug,
    slotIndex: input.slotIndex,
    keyLevel: input.keyLevel,
    identity: {
      reportCode: input.reportCode,
      fightId: input.fightId,
      reportRevision: input.reportRevision,
    },
  };
}

/**
 * Acquire one candidate: shared evidence once → typed extractors → no shadow_placeholder.
 */
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
  /** Immutable dataset requirements from batch metadata. */
  datasetRequirements: EvidenceDatasetRequirementV2[];
  /** Slot binding context for extractors. */
  slotContext: {
    slotId: string;
    dungeonSlug: string;
    slotIndex: 0 | 1;
  };
  /** Injectable transport — tests supply fixtures; production uses provider-backed transport. */
  transport: ScoringV2EvidenceTransport;
  classSlug?: string | null;
  specSlug?: string | null;
}): Promise<{
  result: EvidenceCandidateAcquisitionResult;
  datasetCompatibilityKeys: string[];
  factSetFingerprint: string | null;
  typedFactPayloads: TypedDimensionFactPayload[];
  rejectedAttempts: EvidenceCandidateAcquisitionResult[];
  providerCallTotal: number;
}> {
  const rejectedAttempts: EvidenceCandidateAcquisitionResult[] = [];
  const { container, datasetRequirements } = input;
  let providerCallTotal = 0;

  const needShared = requiresSharedEventEvidence(datasetRequirements);
  const needRanking = requiresRankingParse(datasetRequirements);
  const sharedKeys = sharedEvidenceKeysFromRequirements(datasetRequirements);

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
      const details = await input.transport.getReportFightDetails({
        reportCode: identity.reportCode,
        fightId: identity.fightId,
        ctx,
      });
      providerCallTotal += details.providerCalls;

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

      const reportRevision = details.reportRevision;
      const playerActorId = details.playerActorId ?? candidate.actorId;
      const dungeonSlug =
        details.dungeonSlug ?? input.slotContext.dungeonSlug;
      const artifactIds: string[] = [];
      const datasetHashes: EvidenceCandidateAcquisitionResult["datasetHashes"] = [];
      const datasetCompatibilityKeys: string[] = [];

      // Persist fight-details artifact before extraction.
      const fightArtifact = await persistArtifactBytes({
        artifacts: input.artifacts,
        provider: "WARCRAFT_LOGS",
        artifactClass: "wcl-fight-details-v2",
        payload: details.data,
      });
      artifactIds.push(fightArtifact.artifactId);

      await input.evidence.upsertWclReportRevision({
        reportCode: identity.reportCode,
        revision: reportRevision,
        visibility: "PUBLIC",
        startTimeMs: BigInt(details.startTime ?? 0),
        endTimeMs: BigInt(details.endTime ?? 0),
        metadataHash: fightArtifact.contentHash,
        fetchedAt: new Date(),
      });

      if (details.providerCalls > 0) {
        recordDatasetOutcome({
          outcome: "fetched",
          datasetKey: "fight-details",
          bytes: fightArtifact.bytes,
        });
        emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2DatasetFetched, {
          characterId: input.characterId,
          correlationId: input.correlationId,
          datasetKey: "fight-details",
          bytes: fightArtifact.bytes,
        });
      } else {
        recordDatasetOutcome({ outcome: "cache_hit", datasetKey: "fight-details" });
        emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2DatasetCacheHit, {
          characterId: input.characterId,
          correlationId: input.correlationId,
          datasetKey: "fight-details",
        });
      }

      let bundle: WclRunEvidenceBundle | null = null;
      if (needShared) {
        const shared = await input.transport.acquireSharedEvidence({
          reportCode: identity.reportCode,
          fightId: identity.fightId,
          reportRevision,
          playerActorId,
          ownedPetActorIds: details.ownedPetActorIds,
          dungeonSlug,
          startTime: details.startTime,
          endTime: details.endTime,
          datasetKeys: sharedKeys,
          ctx,
        });
        providerCallTotal += shared.providerCalls;
        bundle = shared.bundle;

        if (shared.providerCalls > 0 && bundle) {
          const sharedArtifact = await persistArtifactBytes({
            artifacts: input.artifacts,
            provider: "WARCRAFT_LOGS",
            artifactClass: "wcl-shared-evidence-v2",
            payload: {
              schemaVersion: bundle.schemaVersion,
              reportCode: bundle.reportCode,
              fightId: bundle.fightId,
              reportRevision: bundle.reportRevision,
              completeness: bundle.completeness,
              payloadFingerprints: bundle.payloadFingerprints,
              // Bounded summary only — not full event arrays in the artifact envelope meta.
              eventCounts: Object.fromEntries(
                Object.entries(bundle.eventDatasets).map(([k, ds]) => [
                  k,
                  ds?.eventCount ?? 0,
                ]),
              ),
            },
          });
          artifactIds.push(sharedArtifact.artifactId);
          recordDatasetOutcome({
            outcome: "fetched",
            datasetKey: "shared-evidence",
            bytes: sharedArtifact.bytes,
          });
          emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2DatasetFetched, {
            characterId: input.characterId,
            correlationId: input.correlationId,
            datasetKey: "shared-evidence",
            bytes: sharedArtifact.bytes,
          });
        } else if (shared.cacheHits > 0) {
          recordDatasetOutcome({ outcome: "cache_hit", datasetKey: "shared-evidence" });
          emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2DatasetCacheHit, {
            characterId: input.characterId,
            correlationId: input.correlationId,
            datasetKey: "shared-evidence",
          });
        }

        if (bundle) {
          for (const [key, ds] of Object.entries(bundle.eventDatasets)) {
            if (!ds) continue;
            const kind = datasetKindFromSharedKey(key);
            if (!kind) continue;
            const compatibilityKey = [
              identity.reportCode,
              String(identity.fightId),
              String(reportRevision),
              kind,
              EVIDENCE_PLANNER_PROVIDER_CONTRACT,
            ].join(":");
            datasetCompatibilityKeys.push(compatibilityKey);
            datasetHashes.push({
              dataset: kind,
              contentHash: ds.pages[0]?.payloadFingerprint ?? buildDatasetContentHash(ds.events),
            });

            if (input.manifestSlotIdForPersistence) {
              try {
                await input.evidence.createDataset({
                  manifestSlotId: input.manifestSlotIdForPersistence,
                  datasetKey: kind.toLowerCase(),
                  compatibilityKey,
                  artifactId: artifactIds[artifactIds.length - 1] ?? fightArtifact.artifactId,
                  schemaVersion: SCORING_V2_DATASET_SCHEMA_VERSION,
                  providerContractVersion: EVIDENCE_PLANNER_PROVIDER_CONTRACT,
                  state: "READY",
                  eventCount: ds.eventCount,
                  pageCount: ds.pageCount,
                  truncated: ds.truncated,
                  payloadFingerprint: ds.pages[0]?.payloadFingerprint ?? null,
                  fetchedAt: new Date(),
                  costSource: ds.costSource,
                });
              } catch {
                // Unique compatibility key — reusable completed artifact survives.
              }
            }
          }
        }
      }

      const slotBinding = buildSlotBinding({
        slotId: input.slotContext.slotId,
        dungeonSlug,
        slotIndex: input.slotContext.slotIndex,
        keyLevel: candidate.keyLevel,
        reportCode: identity.reportCode,
        fightId: identity.fightId,
        reportRevision,
      });

      const typedFactPayloads: TypedDimensionFactPayload[] = [];
      const consumers = new Set(
        datasetRequirements.flatMap((r) => r.consumers),
      );

      // --- Performance ---
      if (consumers.has("PERFORMANCE")) {
        let rankingEvidence = null;
        if (needRanking) {
          const ranking = await input.transport.getRankingParse({
            reportCode: identity.reportCode,
            fightId: identity.fightId,
            reportRevision,
            dungeonSlug,
            keyLevel: candidate.keyLevel,
            ctx,
          });
          providerCallTotal += ranking.providerCalls;
          rankingEvidence = ranking.evidence;
          if (ranking.providerCalls === 0 && ranking.evidence) {
            recordDatasetOutcome({ outcome: "cache_hit", datasetKey: "ranking-parse" });
          } else if (ranking.providerCalls > 0) {
            recordDatasetOutcome({ outcome: "fetched", datasetKey: "ranking-parse" });
          }
          if (rankingEvidence) {
            datasetHashes.push({
              dataset: "RANKING_PARSE",
              contentHash: hashFactDocumentContent(rankingEvidence),
            });
          }
        }

        try {
          const outcome = extractPerformanceRunParseFactV2({
            slot: slotBinding,
            evidence: rankingEvidence,
          });
          typedFactPayloads.push({
            dimension: "PERFORMANCE",
            status: outcome.status,
            extractorFamily: PERFORMANCE_V2_EXTRACTOR_FAMILY,
            extractorVersion: PERFORMANCE_V2_EXTRACTOR_VERSION,
            schemaVersion: PERFORMANCE_V2_FACT_SCHEMA_VERSION,
            facts: outcome.fact,
            limitations: outcome.limitations,
            category: outcome.category,
            reason: outcome.reason,
            artifactIds,
            coverage: { rankingParse: rankingEvidence != null },
          });
        } catch {
          typedFactPayloads.push({
            dimension: "PERFORMANCE",
            status: "FAILED",
            extractorFamily: PERFORMANCE_V2_EXTRACTOR_FAMILY,
            extractorVersion: PERFORMANCE_V2_EXTRACTOR_VERSION,
            schemaVersion: PERFORMANCE_V2_FACT_SCHEMA_VERSION,
            facts: null,
            limitations: ["performance_extraction_failed"],
            category: "analysis_failed",
            reason: "performance_extractor_threw",
            artifactIds,
            coverage: {},
          });
        }
      }

      // --- Survival ---
      if (consumers.has("SURVIVAL")) {
        try {
          if (!bundle || playerActorId == null) {
            typedFactPayloads.push({
              dimension: "SURVIVAL",
              status: "UNAVAILABLE",
              extractorFamily: SURVIVAL_V2_EXTRACTOR_FAMILY,
              extractorVersion: SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
              schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
              facts: null,
              limitations: [
                bundle == null
                  ? "incomplete_survival_shared_evidence"
                  : "player_actor_missing",
              ],
              category:
                bundle == null ? "incomplete_shared_evidence" : "identity_incomplete",
              reason:
                bundle == null
                  ? "required_survival_datasets_absent"
                  : "player_actor_missing",
              artifactIds,
              coverage: {},
            });
          } else {
            const catalog = getAbilityCatalog({
              classSlug: input.classSlug ?? null,
              specSlug: input.specSlug ?? null,
            });
            const outcome = extractSurvivalFactDocumentV2FromSharedEvidence({
              bundle,
              slot: slotBinding,
              characterId: input.characterId,
              identity: {
                region: input.region as "EU" | "US" | "KR" | "TW",
                realmSlug: "unknown",
                name: "unknown",
              },
              playerActorId,
              ownedPetActorIds: details.ownedPetActorIds,
              catalog,
              classSlug: input.classSlug ?? null,
              specSlug: input.specSlug ?? null,
              keyLevel: candidate.keyLevel,
            });
            typedFactPayloads.push({
              dimension: "SURVIVAL",
              status: outcome.status,
              extractorFamily: SURVIVAL_V2_EXTRACTOR_FAMILY,
              extractorVersion: SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
              schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
              facts: outcome.fact,
              limitations: outcome.limitations,
              category: outcome.category,
              reason: outcome.reason,
              artifactIds,
              coverage: { sharedEvidence: true },
            });
          }
        } catch {
          typedFactPayloads.push({
            dimension: "SURVIVAL",
            status: "FAILED",
            extractorFamily: SURVIVAL_V2_EXTRACTOR_FAMILY,
            extractorVersion: SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
            schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
            facts: null,
            limitations: ["survival_extraction_failed"],
            category: "analysis_failed",
            reason: "survival_extractor_threw",
            artifactIds,
            coverage: {},
          });
        }
      }

      // --- Utility ---
      if (consumers.has("UTILITY")) {
        try {
          if (!bundle) {
            typedFactPayloads.push({
              dimension: "UTILITY",
              status: "UNAVAILABLE",
              extractorFamily: UTILITY_V2_EXTRACTOR_FAMILY,
              extractorVersion: UTILITY_V2_EXTRACTOR_VERSION,
              schemaVersion: UTILITY_V2_SCHEMA_VERSION,
              facts: null,
              limitations: ["incomplete_utility_shared_evidence"],
              category: "incomplete_shared_evidence",
              reason: "required_utility_datasets_absent",
              artifactIds,
              coverage: {},
            });
          } else {
            const outcome = extractUtilityV2RunFactSetFromSharedEvidence({
              bundle,
              slot: slotBinding,
              classSlug: input.classSlug ?? null,
              specSlug: input.specSlug ?? null,
            });
            typedFactPayloads.push({
              dimension: "UTILITY",
              status: outcome.status,
              extractorFamily: UTILITY_V2_EXTRACTOR_FAMILY,
              extractorVersion: UTILITY_V2_EXTRACTOR_VERSION,
              schemaVersion: UTILITY_V2_SCHEMA_VERSION,
              facts: outcome.fact,
              limitations: outcome.limitations,
              category: outcome.category,
              reason: outcome.reason,
              artifactIds,
              coverage: { sharedEvidence: true },
            });
          }
        } catch {
          typedFactPayloads.push({
            dimension: "UTILITY",
            status: "FAILED",
            extractorFamily: UTILITY_V2_EXTRACTOR_FAMILY,
            extractorVersion: UTILITY_V2_EXTRACTOR_VERSION,
            schemaVersion: UTILITY_V2_SCHEMA_VERSION,
            facts: null,
            limitations: ["utility_extraction_failed"],
            category: "analysis_failed",
            reason: "utility_extractor_threw",
            artifactIds,
            coverage: {},
          });
        }
      }

      // Persist typed facts when a real manifest slot exists (post-freeze path / tests).
      if (input.manifestSlotIdForPersistence) {
        for (const payload of typedFactPayloads) {
          if (payload.status !== "WRITTEN" || payload.facts == null) continue;
          const persisted = await persistTypedFactSet({
            evidence: input.evidence,
            logger: container.logger,
            characterId: input.characterId,
            correlationId: input.correlationId,
            manifestSlotId: input.manifestSlotIdForPersistence,
            reportCode: identity.reportCode,
            fightId: identity.fightId,
            reportRevision,
            payload,
          });
          if (persisted.outcome === "conflict") {
            throw new Error(`fact_persist_conflict:${payload.dimension}`);
          }
        }
      }

      const written = typedFactPayloads.filter(
        (p) => p.status === "WRITTEN" && p.facts != null,
      );
      const factSetFingerprint =
        written.length > 0
          ? buildSlotFactSetBindingHash(
              written.map((p) => ({
                extractorFamily: p.extractorFamily,
                extractorVersion: p.extractorVersion,
                inputFingerprint: buildFactSetFingerprint({
                  reportCode: identity.reportCode,
                  fightId: identity.fightId,
                  reportRevision,
                  extractorFamily: p.extractorFamily,
                  extractorVersion: p.extractorVersion,
                }),
                facts: p.facts,
              })),
            )
          : buildFactSetFingerprint({
              reportCode: identity.reportCode,
              fightId: identity.fightId,
              reportRevision,
              extractorFamily: "scoring-v2-acquisition",
              extractorVersion: "2.0.0",
            });

      const dimValidity = {
        performance: mapValidity(typedFactPayloads, "PERFORMANCE"),
        survival: mapValidity(typedFactPayloads, "SURVIVAL"),
        utility: mapValidity(typedFactPayloads, "UTILITY"),
        reasons: typedFactPayloads
          .filter((p) => p.status !== "WRITTEN")
          .map((p) => `${p.dimension}:${p.status}:${p.reason ?? "n/a"}`)
          .slice(0, 16),
      };

      return {
        result: {
          discoveryIdentity: identity,
          acquisitionStatus: "ACQUIRED",
          reportRevision,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes,
          factSetHash: factSetFingerprint,
          dimensionValidity: dimValidity,
          keyLevel: candidate.keyLevel,
          timed: candidate.timed,
          runScore: candidate.runScore,
          completedAt: candidate.completedAt,
          actorId: playerActorId,
          evidenceCompleteness: candidate.evidenceCompleteness,
        },
        datasetCompatibilityKeys,
        factSetFingerprint,
        typedFactPayloads,
        rejectedAttempts,
        providerCallTotal,
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
    typedFactPayloads: [],
    rejectedAttempts,
    providerCallTotal,
  };
}

function mapValidity(
  payloads: TypedDimensionFactPayload[],
  dimension: TypedDimensionFactPayload["dimension"],
): "VALID" | "PARTIAL" | "INVALID" {
  const row = payloads.find((p) => p.dimension === dimension);
  if (!row) return "INVALID";
  if (row.status === "WRITTEN") return "VALID";
  if (row.status === "UNAVAILABLE") return "PARTIAL";
  return "INVALID";
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

export { resolveBatchDatasetRequirements };

export type { AnalyzeEvidenceSlotJobV2, FinalizeEvidenceBatchJobV2 };

/** @deprecated Kept for type imports — shadow placeholder family is no longer written on success. */
export {
  SCORING_V2_FACT_EXTRACTOR_FAMILY,
  SCORING_V2_FACT_EXTRACTOR_VERSION,
  SCORING_V2_FACT_SCHEMA_VERSION,
};
