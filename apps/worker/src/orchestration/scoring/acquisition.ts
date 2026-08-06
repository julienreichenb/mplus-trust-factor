import { createHash } from "node:crypto";
import type {
  AnalyzeEvidenceSlotJobV2,
  CandidateRejectionReason,
  EvidenceCandidateAcquisitionResult,
  EvidenceCandidateDiscoveryIdentity,
  EvidenceDatasetKind,
  EvidenceV2EnabledConsumer,
  FinalizeEvidenceBatchJobV2,
  ProviderFetchContext,
} from "@mplus/contracts";
import { discoveryIdentityKey, ExternalApiError } from "@mplus/contracts";
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
  emptyProviderAccounting,
  type ScoringV2ProviderAccounting,
} from "./provider-accounting.js";
import {
  resolveFrozenClassSpecIdentity,
  type FrozenClassSpecIdentity,
} from "./class-spec-identity.js";
import { persistWclRunDigestAndRoster } from "./wcl-run-digest-persist.js";
import {
  requiresRankingParse,
  requiresSharedEventEvidence,
  resolveBatchDatasetRequirements,
  sharedEvidenceKeysFromRequirements,
  type EvidenceDatasetRequirementV2,
} from "./dataset-requirements.js";
import type { AcquiredEvidenceDatasetDescriptor } from "./dataset-descriptor-persist.js";
import {
  persistDatasetDescriptor,
} from "./dataset-descriptor-persist.js";
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
/** Ranking parse RawArtifact class — never reuse fight-details / shared-evidence artifact ids. */
export const RANKING_PARSE_ARTIFACT_CLASS = "wcl-ranking-parse-v2" as const;
export const RANKING_PARSE_PROVIDER_CONTRACT = "wcl-ranking-parse-v1" as const;
export const RANKING_PARSE_DATASET_KEY = "ranking_parse" as const;

/** Derive timed tri-state from fight-details payload keystoneBonus when present. */
export function keystoneBonusFromFightDetails(data: unknown): boolean | null {
  if (data == null || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const fight =
    (root.fight as Record<string, unknown> | undefined) ??
    (root.reportFight as Record<string, unknown> | undefined) ??
    root;
  const bonus = fight.keystoneBonus;
  if (typeof bonus !== "number" || !Number.isFinite(bonus)) return null;
  if (bonus > 0) return true;
  if (bonus === 0) return false;
  return null;
}

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

const OWNERSHIP_REJECTION_REASONS = new Set<string>([
  "TARGET_NOT_IN_REPORT",
  "TARGET_NOT_IN_FIGHT",
  "TARGET_AMBIGUOUS",
  "FIGHT_NOT_MYTHIC_PLUS",
  "FIGHT_INCOMPLETE",
]);

function ownershipRejectionFromError(error: unknown): {
  reason: CandidateRejectionReason;
  detail: string;
} | null {
  const message = error instanceof Error ? error.message : String(error);
  let ownershipReason: string | null = null;
  if (error instanceof ExternalApiError && error.provider === "warcraftlogs") {
    const details = error.details as { ownershipReason?: string } | null;
    ownershipReason = details?.ownershipReason ?? null;
  }
  if (!ownershipReason) {
    for (const reason of OWNERSHIP_REJECTION_REASONS) {
      if (message.startsWith(reason) || message.includes(reason)) {
        ownershipReason = reason;
        break;
      }
    }
  }
  if (!ownershipReason) return null;
  if (ownershipReason === "FIGHT_INCOMPLETE") {
    return { reason: "INCOMPLETE_FIGHT", detail: message };
  }
  if (
    ownershipReason === "TARGET_NOT_IN_REPORT" ||
    ownershipReason === "TARGET_NOT_IN_FIGHT" ||
    ownershipReason === "TARGET_AMBIGUOUS" ||
    ownershipReason === "FIGHT_NOT_MYTHIC_PLUS"
  ) {
    return { reason: ownershipReason, detail: message };
  }
  return null;
}

export function buildFactSetFingerprint(parts: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  extractorFamily: string;
  extractorVersion: string;
  /** When provided (including null), binds catalog identity into the fingerprint. */
  classSlug?: string | null;
  specSlug?: string | null;
}): string {
  const segments = [
    parts.reportCode,
    String(parts.fightId),
    String(parts.reportRevision),
    parts.extractorFamily,
    parts.extractorVersion,
  ];
  if ("classSlug" in parts || "specSlug" in parts) {
    segments.push(parts.classSlug ?? "", parts.specSlug ?? "");
  }
  return createHash("sha256").update(segments.join("|"), "utf8").digest("hex");
}

export function buildDatasetContentHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function resolveEnabledConsumers(env: WorkerContainer["env"]): EvidenceV2EnabledConsumer[] {
  if (!env.SCORING_ENABLED) return [];
  return ["PERFORMANCE", "SURVIVAL", "UTILITY"];
}

export function isScoringEnabled(env: WorkerContainer["env"]): boolean {
  return env.SCORING_ENABLED === true;
}

/** @deprecated Use isScoringEnabled */
export function isScoringV2ShadowOrchestrationEnabled(env: WorkerContainer["env"]): boolean {
  return isScoringEnabled(env);
}

/** Publication must stay blocked unless the publication gate is intentionally enabled. */
export function assertPublicationBlocked(env: WorkerContainer["env"]): void {
  if (env.SCORING_PUBLICATION_ENABLED) {
    throw new Error(
      "SCORING_PUBLICATION_ENABLED is true — canary/shadow path forbids public pointer mutation",
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

function isIdempotentDatasetUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

async function persistRankingParseDescriptor(input: {
  evidence: EvidenceRepository;
  manifestSlotId: string | null;
  descriptor: AcquiredEvidenceDatasetDescriptor;
  datasetDescriptors: AcquiredEvidenceDatasetDescriptor[];
}): Promise<void> {
  input.datasetDescriptors.push(input.descriptor);
  if (!input.manifestSlotId) return;
  try {
    const result = await persistDatasetDescriptor({
      evidence: input.evidence,
      manifestSlotId: input.manifestSlotId,
      descriptor: input.descriptor,
    });
    if (result.outcome === "conflict") {
      throw new Error(`ranking_parse_dataset_conflict:${result.reason}`);
    }
  } catch (error) {
    if (isIdempotentDatasetUniqueViolation(error)) {
      // Race on (manifestSlotId, datasetKey) with identical content — redelivery.
      const raced = await input.evidence.findDatasetBySlotAndKey({
        manifestSlotId: input.manifestSlotId,
        datasetKey: input.descriptor.datasetKey,
      });
      if (
        raced &&
        raced.payloadFingerprint === input.descriptor.payloadFingerprint &&
        raced.state === input.descriptor.state &&
        raced.artifactId === input.descriptor.artifactId
      ) {
        return;
      }
    }
    throw error;
  }
}

function buildRankingParseDescriptor(input: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  state: "READY" | "UNAVAILABLE" | "FAILED";
  rankingArtifactId: string | null;
  payloadFingerprint: string;
  eventCount: number;
}): AcquiredEvidenceDatasetDescriptor {
  return {
    datasetKey: RANKING_PARSE_DATASET_KEY,
    datasetKind: "RANKING_PARSE",
    compatibilityKey: [
      input.reportCode,
      String(input.fightId),
      String(input.reportRevision),
      "RANKING_PARSE",
      RANKING_PARSE_PROVIDER_CONTRACT,
    ].join(":"),
    artifactId: input.rankingArtifactId,
    schemaVersion: "1.0.0",
    providerContractVersion: RANKING_PARSE_PROVIDER_CONTRACT,
    state: input.state,
    eventCount: input.eventCount,
    pageCount: 0,
    truncated: false,
    payloadFingerprint: input.payloadFingerprint,
    fetchedAt: new Date().toISOString(),
    costSource: input.rankingArtifactId != null ? "wcl" : null,
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
  };
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
  /** Required by live WCL fight analysis to resolve the target actor. */
  targetCharacter: {
    region: "EU" | "US" | "KR" | "TW";
    realmSlug: string;
    name: string;
  };
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
  /**
   * Discovery keys already taken by sibling slots. Skipped as DUPLICATE_REPORT_FIGHT
   * before any provider call.
   */
  excludeDiscoveryKeys?: ReadonlySet<string>;
  /**
   * Concurrency-safe reservation for reportCode:fightId before hydration.
   * Return false when a sibling already holds the identity.
   */
  reserveDiscoveryIdentity?: (discoveryKey: string) => Promise<boolean>;
  /** Release a failed/skipped attempt reservation. */
  releaseDiscoveryIdentity?: (discoveryKey: string) => Promise<void>;
  /** Injectable transport — tests supply fixtures; production uses provider-backed transport. */
  transport: ScoringV2EvidenceTransport;
  classSlug?: string | null;
  specSlug?: string | null;
  /** Explicit frozen identity state; derived from class/spec when omitted. */
  classSpecIdentity?: FrozenClassSpecIdentity;
}): Promise<{
  result: EvidenceCandidateAcquisitionResult;
  datasetCompatibilityKeys: string[];
  datasetDescriptors: AcquiredEvidenceDatasetDescriptor[];
  factSetFingerprint: string | null;
  typedFactPayloads: TypedDimensionFactPayload[];
  rejectedAttempts: EvidenceCandidateAcquisitionResult[];
  providerCallTotal: number;
  providerAccounting: ScoringV2ProviderAccounting;
}> {
  const rejectedAttempts: EvidenceCandidateAcquisitionResult[] = [];
  const { container, datasetRequirements } = input;
  let providerCallTotal = 0;
  let providerAccounting = emptyProviderAccounting();

  const classSpecIdentity =
    input.classSpecIdentity ??
    resolveFrozenClassSpecIdentity({
      planClassSlug: input.classSlug ?? null,
      planSpecSlug: input.specSlug ?? null,
    });
  const classSlug = classSpecIdentity.classSlug;
  const specSlug = classSpecIdentity.specSlug;

  const needShared = requiresSharedEventEvidence(datasetRequirements);
  const needRanking = requiresRankingParse(datasetRequirements);
  const sharedKeys = sharedEvidenceKeysFromRequirements(datasetRequirements);

  for (const candidate of input.candidates) {
    if (await input.shouldCancel()) {
      throw new ScoringV2CancelledError();
    }

    const identity = candidate.discoveryIdentity;
    const discoveryKey = discoveryIdentityKey(identity);

    if (input.excludeDiscoveryKeys?.has(discoveryKey)) {
      recordInvalidCandidateReason("DUPLICATE_REPORT_FIGHT");
      rejectedAttempts.push({
        discoveryIdentity: identity,
        acquisitionStatus: "REJECTED",
        reportRevision: null,
        rejectionReason: "DUPLICATE_REPORT_FIGHT",
        rejectionDetail: "already selected for another slot",
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

    let reserved = false;
    if (input.reserveDiscoveryIdentity) {
      reserved = await input.reserveDiscoveryIdentity(discoveryKey);
      if (!reserved) {
        recordInvalidCandidateReason("DUPLICATE_REPORT_FIGHT");
        rejectedAttempts.push({
          discoveryIdentity: identity,
          acquisitionStatus: "REJECTED",
          reportRevision: null,
          rejectionReason: "DUPLICATE_REPORT_FIGHT",
          rejectionDetail: "identity reserved by another slot",
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
    }

    const releaseReservation = async () => {
      if (!reserved || !input.releaseDiscoveryIdentity) return;
      reserved = false;
      await input.releaseDiscoveryIdentity(discoveryKey);
    };

    const ctx: ProviderFetchContext = {
      region: input.region as ProviderFetchContext["region"],
      requestId: `v2-slot-${identity.reportCode}-${identity.fightId}-${Date.now()}`,
      correlationId: input.correlationId ?? `v2-slot-${identity.reportCode}`,
      forceRefresh: false,
      now: new Date().toISOString(),
      targetCharacter: input.targetCharacter,
    };

    let holdReservation = false;
    try {
      const details = await input.transport.getReportFightDetails({
        reportCode: identity.reportCode,
        fightId: identity.fightId,
        ctx,
        expectedActorId: candidate.actorId,
      });
      providerCallTotal += details.providerCalls;
      if (details.providerCalls > 0) {
        providerAccounting = {
          ...providerAccounting,
          providerCalls: providerAccounting.providerCalls + details.providerCalls,
        };
      } else {
        providerAccounting = {
          ...providerAccounting,
          cacheHits: providerAccounting.cacheHits + 1,
          avoidedRequests: providerAccounting.avoidedRequests + 1,
        };
      }

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

      // Independent acquisition gate: never fetch shared event evidence without fight-roster proof.
      if (details.targetInFight === false || details.ownershipRejectionReason) {
        const rawReason =
          details.ownershipRejectionReason ?? ("TARGET_NOT_IN_FIGHT" as const);
        const reason: CandidateRejectionReason =
          rawReason === "FIGHT_INCOMPLETE" ? "INCOMPLETE_FIGHT" : rawReason;
        recordInvalidCandidateReason(reason);
        rejectedAttempts.push({
          discoveryIdentity: identity,
          acquisitionStatus: "REJECTED",
          reportRevision,
          rejectionReason: reason,
          rejectionDetail:
            reason === "TARGET_NOT_IN_FIGHT"
              ? `target actor not in fight.friendlyPlayers (actor=${playerActorId ?? "unresolved"})`
              : rawReason,
          datasetHashes: [],
          factSetHash: null,
          dimensionValidity: null,
          keyLevel: candidate.keyLevel,
          timed: candidate.timed,
          runScore: candidate.runScore,
          completedAt: candidate.completedAt,
          actorId: playerActorId,
          evidenceCompleteness: candidate.evidenceCompleteness,
        });
        continue;
      }
      if (
        playerActorId != null &&
        Array.isArray(details.fightFriendlyPlayerActorIds) &&
        details.fightFriendlyPlayerActorIds.length > 0 &&
        !details.fightFriendlyPlayerActorIds.includes(playerActorId)
      ) {
        recordInvalidCandidateReason("TARGET_NOT_IN_FIGHT");
        rejectedAttempts.push({
          discoveryIdentity: identity,
          acquisitionStatus: "REJECTED",
          reportRevision,
          rejectionReason: "TARGET_NOT_IN_FIGHT",
          rejectionDetail: `playerActorId=${playerActorId} absent from fightFriendlyPlayerActorIds`,
          datasetHashes: [],
          factSetHash: null,
          dimensionValidity: null,
          keyLevel: candidate.keyLevel,
          timed: candidate.timed,
          runScore: candidate.runScore,
          completedAt: candidate.completedAt,
          actorId: playerActorId,
          evidenceCompleteness: candidate.evidenceCompleteness,
        });
        continue;
      }

      // Timer tri-state is ordering-only — do not reject timed===false/null here.
      // Prefer fight-details keystoneBonus when the plan candidate still has timed=null.
      let resolvedTimed = candidate.timed;
      const bonusFromDetails = keystoneBonusFromFightDetails(details.data);
      if (resolvedTimed == null && bonusFromDetails != null) {
        resolvedTimed = bonusFromDetails;
      }

      if (playerActorId == null) {
        recordInvalidCandidateReason("ACTOR_UNRESOLVED");
        rejectedAttempts.push({
          discoveryIdentity: identity,
          acquisitionStatus: "REJECTED",
          reportRevision,
          rejectionReason: "ACTOR_UNRESOLVED",
          rejectionDetail: "player actor not resolved",
          datasetHashes: [],
          factSetHash: null,
          dimensionValidity: null,
          keyLevel: candidate.keyLevel,
          timed: candidate.timed,
          runScore: candidate.runScore,
          completedAt: candidate.completedAt,
          actorId: null,
          evidenceCompleteness: candidate.evidenceCompleteness,
        });
        continue;
      }
      if (!Number.isFinite(reportRevision) || reportRevision < 0) {
        recordInvalidCandidateReason("REPORT_REVISION_UNRESOLVED");
        rejectedAttempts.push({
          discoveryIdentity: identity,
          acquisitionStatus: "REJECTED",
          reportRevision: null,
          rejectionReason: "REPORT_REVISION_UNRESOLVED",
          rejectionDetail: "report revision unresolved",
          datasetHashes: [],
          factSetHash: null,
          dimensionValidity: null,
          keyLevel: candidate.keyLevel,
          timed: candidate.timed,
          runScore: candidate.runScore,
          completedAt: candidate.completedAt,
          actorId: playerActorId,
          evidenceCompleteness: candidate.evidenceCompleteness,
        });
        continue;
      }
      if (
        details.startTime == null ||
        details.endTime == null ||
        details.endTime <= details.startTime
      ) {
        recordInvalidCandidateReason("INCOMPLETE_FIGHT");
        rejectedAttempts.push({
          discoveryIdentity: identity,
          acquisitionStatus: "REJECTED",
          reportRevision,
          rejectionReason: "INCOMPLETE_FIGHT",
          rejectionDetail: "fight start/end metadata incoherent",
          datasetHashes: [],
          factSetHash: null,
          dimensionValidity: null,
          keyLevel: candidate.keyLevel,
          timed: candidate.timed,
          runScore: candidate.runScore,
          completedAt: candidate.completedAt,
          actorId: playerActorId,
          evidenceCompleteness: candidate.evidenceCompleteness,
        });
        continue;
      }

      const artifactIds: string[] = [];
      const datasetHashes: EvidenceCandidateAcquisitionResult["datasetHashes"] = [];
      const datasetCompatibilityKeys: string[] = [];
      const datasetDescriptors: AcquiredEvidenceDatasetDescriptor[] = [];

      // Persist fight-details artifact before extraction.
      const fightArtifact = await persistArtifactBytes({
        artifacts: input.artifacts,
        provider: "WARCRAFT_LOGS",
        artifactClass: "wcl-fight-details-v2",
        payload: details.data,
      });
      artifactIds.push(fightArtifact.artifactId);
      providerAccounting = {
        ...providerAccounting,
        bytes: providerAccounting.bytes + fightArtifact.bytes,
      };

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
        const sharedSf = shared.singleflightReuse ?? 0;
        const sharedPages = shared.pages ?? bundle?.accounting.pages ?? 0;
        const sharedPoints =
          shared.pointsConsumed ?? bundle?.accounting.pointsConsumed ?? null;
        if (shared.providerCalls > 0) {
          providerAccounting = {
            ...providerAccounting,
            providerCalls: providerAccounting.providerCalls + shared.providerCalls,
            pages: providerAccounting.pages + sharedPages,
            pointsConsumed:
              sharedPoints != null
                ? (providerAccounting.pointsConsumed ?? 0) + sharedPoints
                : providerAccounting.pointsConsumed,
            singleflightReuse: providerAccounting.singleflightReuse + sharedSf,
          };
        } else if (shared.cacheHits > 0 || sharedSf > 0) {
          providerAccounting = {
            ...providerAccounting,
            cacheHits: providerAccounting.cacheHits + shared.cacheHits,
            avoidedRequests: providerAccounting.avoidedRequests + Math.max(1, shared.cacheHits),
            pages: providerAccounting.pages + sharedPages,
            pointsConsumed:
              sharedPoints != null
                ? (providerAccounting.pointsConsumed ?? 0) + sharedPoints
                : providerAccounting.pointsConsumed,
            singleflightReuse: providerAccounting.singleflightReuse + sharedSf,
          };
        }

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
          providerAccounting = {
            ...providerAccounting,
            bytes: providerAccounting.bytes + sharedArtifact.bytes,
          };
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
          // Permanent neutral digest + roster from persisted source evidence (not scores).
          try {
            await persistWclRunDigestAndRoster({
              wclSource: container.repositories.wclSource,
              bundle,
              region: input.region,
              dungeonSlug,
              keyLevel: candidate.keyLevel,
              timed: candidate.timed,
              fightFriendlyPlayerActorIds: details.fightFriendlyPlayerActorIds,
              targetActorId: playerActorId,
              resolveTarget: {
                characterId: input.characterId,
                characterName: input.targetCharacter.name,
                realmSlug: input.targetCharacter.realmSlug,
                regionCode: input.targetCharacter.region,
              },
              startTimeMs: details.startTime,
              endTimeMs: details.endTime,
            });
          } catch (digestError) {
            container.logger.warn(
              {
                event: "wcl_run_digest_persist_failed",
                reportCode: identity.reportCode,
                fightId: identity.fightId,
                reportRevision,
                error:
                  digestError instanceof Error ? digestError.message : String(digestError),
              },
              "wcl run digest persist failed; continuing acquisition",
            );
          }

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
            const payloadFingerprint =
              ds.pages[0]?.payloadFingerprint ?? buildDatasetContentHash(ds.events);
            datasetHashes.push({
              dataset: kind,
              contentHash: payloadFingerprint,
            });

            const descriptor: AcquiredEvidenceDatasetDescriptor = {
              datasetKey: kind.toLowerCase(),
              datasetKind: kind,
              compatibilityKey,
              artifactId: artifactIds[artifactIds.length - 1] ?? fightArtifact.artifactId,
              schemaVersion: SCORING_V2_DATASET_SCHEMA_VERSION,
              providerContractVersion: EVIDENCE_PLANNER_PROVIDER_CONTRACT,
              state: "READY",
              eventCount: ds.eventCount,
              pageCount: ds.pageCount,
              truncated: ds.truncated,
              payloadFingerprint,
              fetchedAt: new Date().toISOString(),
              costSource: ds.costSource ?? null,
              reportCode: identity.reportCode,
              fightId: identity.fightId,
              reportRevision,
            };
            datasetDescriptors.push(descriptor);

            if (input.manifestSlotIdForPersistence) {
              try {
                await input.evidence.createDataset({
                  manifestSlotId: input.manifestSlotIdForPersistence,
                  datasetKey: descriptor.datasetKey,
                  compatibilityKey: descriptor.compatibilityKey,
                  artifactId: descriptor.artifactId,
                  schemaVersion: descriptor.schemaVersion,
                  providerContractVersion: descriptor.providerContractVersion,
                  state: descriptor.state,
                  eventCount: descriptor.eventCount,
                  pageCount: descriptor.pageCount,
                  truncated: descriptor.truncated,
                  payloadFingerprint: descriptor.payloadFingerprint,
                  fetchedAt: new Date(descriptor.fetchedAt),
                  costSource: descriptor.costSource,
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
        let rankingEvidence: Awaited<
          ReturnType<ScoringV2EvidenceTransport["getRankingParse"]>
        >["evidence"] = null;
        let rankingUnavailableReason: string | null = null;
        let rankingTransportFailed = false;
        let rankingArtifactId: string | null = null;
        let rankingProviderCalls = 0;

        if (needRanking) {
          try {
            const ranking = await input.transport.getRankingParse({
              reportCode: identity.reportCode,
              fightId: identity.fightId,
              reportRevision,
              dungeonSlug,
              keyLevel: candidate.keyLevel,
              ctx,
            });
            rankingProviderCalls = ranking.providerCalls;
            providerCallTotal += ranking.providerCalls;
            rankingEvidence = ranking.evidence;
            rankingUnavailableReason = ranking.unavailableReason;
            if (ranking.providerCalls === 0 && ranking.evidence) {
              providerAccounting = {
                ...providerAccounting,
                cacheHits: providerAccounting.cacheHits + 1,
                avoidedRequests: providerAccounting.avoidedRequests + 1,
              };
              recordDatasetOutcome({ outcome: "cache_hit", datasetKey: "ranking-parse" });
            } else if (ranking.providerCalls > 0) {
              providerAccounting = {
                ...providerAccounting,
                providerCalls: providerAccounting.providerCalls + ranking.providerCalls,
              };
              recordDatasetOutcome({ outcome: "fetched", datasetKey: "ranking-parse" });
            }
            if (rankingEvidence) {
              const rankingArtifact = await persistArtifactBytes({
                artifacts: input.artifacts,
                provider: "WARCRAFT_LOGS",
                artifactClass: RANKING_PARSE_ARTIFACT_CLASS,
                payload: rankingEvidence,
              });
              rankingArtifactId = rankingArtifact.artifactId;
              providerAccounting = {
                ...providerAccounting,
                bytes: providerAccounting.bytes + rankingArtifact.bytes,
              };
              datasetHashes.push({
                dataset: "RANKING_PARSE",
                contentHash: rankingArtifact.contentHash,
              });
            }
          } catch (error) {
            rankingTransportFailed = true;
            rankingEvidence = null;
            rankingArtifactId = null;
            rankingUnavailableReason =
              error instanceof Error
                ? `ranking_parse_transport_failed:${error.message}`
                : "ranking_parse_transport_failed";
          }
        } else {
          rankingUnavailableReason = "ranking_parse_not_requested";
        }

        try {
          if (rankingTransportFailed) {
            typedFactPayloads.push({
              dimension: "PERFORMANCE",
              status: "FAILED",
              extractorFamily: PERFORMANCE_V2_EXTRACTOR_FAMILY,
              extractorVersion: PERFORMANCE_V2_EXTRACTOR_VERSION,
              schemaVersion: PERFORMANCE_V2_FACT_SCHEMA_VERSION,
              facts: null,
              limitations: ["ranking_parse_transport_failed"],
              category: "analysis_failed",
              reason: rankingUnavailableReason ?? "ranking_parse_transport_failed",
              artifactIds: [],
              coverage: { rankingParse: false, rankingArtifactId: null },
            });
            if (needRanking) {
              await persistRankingParseDescriptor({
                evidence: input.evidence,
                manifestSlotId: input.manifestSlotIdForPersistence ?? null,
                datasetDescriptors,
                descriptor: buildRankingParseDescriptor({
                  reportCode: identity.reportCode,
                  fightId: identity.fightId,
                  reportRevision,
                  state: "FAILED",
                  rankingArtifactId: null,
                  payloadFingerprint: `ranking-parse:FAILED:transport`,
                  eventCount: 0,
                }),
              });
            }
          } else {
            const rankingAbsentReason =
              rankingEvidence != null
                ? null
                : needRanking
                  ? rankingUnavailableReason ?? "RANKING_PARSE_PUBLIC_API_UNAVAILABLE"
                  : "ranking_parse_not_requested";
            const outcome = extractPerformanceRunParseFactV2({
              slot: slotBinding,
              evidence: rankingEvidence,
              absentReason: rankingAbsentReason,
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
              artifactIds: rankingArtifactId != null ? [rankingArtifactId] : [],
              coverage: {
                rankingParse: rankingEvidence != null,
                rankingArtifactId,
                rankingProviderCalls,
              },
            });

            if (needRanking) {
              const rankingState =
                outcome.status === "WRITTEN"
                  ? "READY"
                  : outcome.status === "UNAVAILABLE"
                    ? "UNAVAILABLE"
                    : "FAILED";
              const rankingFp =
                rankingEvidence != null
                  ? hashFactDocumentContent(rankingEvidence)
                  : `ranking-parse:${outcome.status}:${outcome.reason ?? "n/a"}`;
              await persistRankingParseDescriptor({
                evidence: input.evidence,
                manifestSlotId: input.manifestSlotIdForPersistence ?? null,
                datasetDescriptors,
                descriptor: buildRankingParseDescriptor({
                  reportCode: identity.reportCode,
                  fightId: identity.fightId,
                  reportRevision,
                  state: rankingState,
                  rankingArtifactId,
                  payloadFingerprint: rankingFp,
                  eventCount: rankingEvidence != null ? 1 : 0,
                }),
              });
            }
          }
        } catch (error) {
          typedFactPayloads.push({
            dimension: "PERFORMANCE",
            status: "FAILED",
            extractorFamily: PERFORMANCE_V2_EXTRACTOR_FAMILY,
            extractorVersion: PERFORMANCE_V2_EXTRACTOR_VERSION,
            schemaVersion: PERFORMANCE_V2_FACT_SCHEMA_VERSION,
            facts: null,
            limitations: ["performance_extraction_failed"],
            category: "analysis_failed",
            reason:
              error instanceof Error
                ? error.message
                : "performance_extractor_threw",
            artifactIds: rankingArtifactId != null ? [rankingArtifactId] : [],
            coverage: { rankingParse: false, rankingArtifactId },
          });
          if (needRanking) {
            await persistRankingParseDescriptor({
              evidence: input.evidence,
              manifestSlotId: input.manifestSlotIdForPersistence ?? null,
              datasetDescriptors,
              descriptor: buildRankingParseDescriptor({
                reportCode: identity.reportCode,
                fightId: identity.fightId,
                reportRevision,
                state: "FAILED",
                rankingArtifactId,
                payloadFingerprint: "ranking-parse:FAILED:extractor_threw",
                eventCount: 0,
              }),
            });
          }
        }
      }

      // --- Survival ---
      if (consumers.has("SURVIVAL")) {
        try {
          if (classSpecIdentity.catalogDependentFailClosed) {
            typedFactPayloads.push({
              dimension: "SURVIVAL",
              status: "UNAVAILABLE",
              extractorFamily: SURVIVAL_V2_EXTRACTOR_FAMILY,
              extractorVersion: SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
              schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
              facts: null,
              limitations: classSpecIdentity.limitations,
              category: "identity_incomplete",
              reason: "class_spec_identity_incompatible",
              artifactIds,
              coverage: {},
            });
          } else if (!bundle || playerActorId == null) {
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
                ...classSpecIdentity.limitations,
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
              classSlug,
              specSlug,
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
              classSlug,
              specSlug,
              keyLevel: candidate.keyLevel,
            });
            const identityLimitations =
              !catalog.supported || classSpecIdentity.state === "UNKNOWN"
                ? [
                    ...classSpecIdentity.limitations,
                    ...(catalog.unsupportedReason
                      ? [`ability_catalog:${catalog.unsupportedReason}`]
                      : []),
                  ]
                : classSpecIdentity.limitations;
            typedFactPayloads.push({
              dimension: "SURVIVAL",
              status: outcome.status,
              extractorFamily: SURVIVAL_V2_EXTRACTOR_FAMILY,
              extractorVersion: SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
              schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
              facts: outcome.fact
                ? {
                    ...outcome.fact,
                    limitations: [
                      ...new Set([
                        ...(outcome.fact.limitations ?? []),
                        ...identityLimitations,
                      ]),
                    ].slice(0, 32),
                  }
                : null,
              limitations: [
                ...new Set([...outcome.limitations, ...identityLimitations]),
              ].slice(0, 32),
              category: outcome.category,
              reason: outcome.reason,
              artifactIds,
              coverage: {
                sharedEvidence: true,
                abilityCatalogSupported: catalog.supported,
              },
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
          if (classSpecIdentity.catalogDependentFailClosed) {
            typedFactPayloads.push({
              dimension: "UTILITY",
              status: "UNAVAILABLE",
              extractorFamily: UTILITY_V2_EXTRACTOR_FAMILY,
              extractorVersion: UTILITY_V2_EXTRACTOR_VERSION,
              schemaVersion: UTILITY_V2_SCHEMA_VERSION,
              facts: null,
              limitations: classSpecIdentity.limitations,
              category: "identity_incomplete",
              reason: "class_spec_identity_incompatible",
              artifactIds,
              coverage: {},
            });
          } else if (!bundle) {
            typedFactPayloads.push({
              dimension: "UTILITY",
              status: "UNAVAILABLE",
              extractorFamily: UTILITY_V2_EXTRACTOR_FAMILY,
              extractorVersion: UTILITY_V2_EXTRACTOR_VERSION,
              schemaVersion: UTILITY_V2_SCHEMA_VERSION,
              facts: null,
              limitations: [
                "incomplete_utility_shared_evidence",
                ...classSpecIdentity.limitations,
              ],
              category: "incomplete_shared_evidence",
              reason: "required_utility_datasets_absent",
              artifactIds,
              coverage: {},
            });
          } else {
            const outcome = extractUtilityV2RunFactSetFromSharedEvidence({
              bundle,
              slot: slotBinding,
              classSlug,
              specSlug,
            });
            typedFactPayloads.push({
              dimension: "UTILITY",
              status: outcome.status,
              extractorFamily: UTILITY_V2_EXTRACTOR_FAMILY,
              extractorVersion: UTILITY_V2_EXTRACTOR_VERSION,
              schemaVersion: UTILITY_V2_SCHEMA_VERSION,
              facts: outcome.fact,
              limitations: [
                ...new Set([
                  ...outcome.limitations,
                  ...classSpecIdentity.limitations,
                ]),
              ].slice(0, 32),
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
            classSlug,
            specSlug,
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
      // Never invent a binding hash without WRITTEN RunFactSet members — that
      // freezes SELECTED slots whose expected hash has no rows (actual=missing).
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
                  classSlug,
                  specSlug,
                }),
                facts: p.facts,
              })),
            )
          : null;

      const dimValidity = {
        performance: mapValidity(typedFactPayloads, "PERFORMANCE"),
        survival: mapValidity(typedFactPayloads, "SURVIVAL"),
        utility: mapValidity(typedFactPayloads, "UTILITY"),
        reasons: typedFactPayloads
          .filter((p) => p.status !== "WRITTEN")
          .map((p) => `${p.dimension}:${p.status}:${p.reason ?? "n/a"}`)
          .slice(0, 16),
      };

      holdReservation = true;
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
          timed: resolvedTimed,
          runScore: candidate.runScore,
          completedAt: candidate.completedAt,
          actorId: playerActorId,
          evidenceCompleteness: candidate.evidenceCompleteness,
        },
        datasetCompatibilityKeys,
        datasetDescriptors,
        factSetFingerprint,
        typedFactPayloads,
        rejectedAttempts,
        providerCallTotal,
        providerAccounting,
      };
    } catch (error) {
      if (error instanceof ScoringV2CancelledError || error instanceof ScoringV2SupersededError) {
        throw error;
      }
      const ownership = ownershipRejectionFromError(error);
      if (ownership) {
        // Surface ownership failures explicitly — never collapse into FALLBACK_EXHAUSTED.
        recordInvalidCandidateReason(ownership.reason);
        rejectedAttempts.push({
          discoveryIdentity: identity,
          acquisitionStatus: "REJECTED",
          reportRevision: null,
          rejectionReason: ownership.reason,
          rejectionDetail: ownership.detail,
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
    } finally {
      if (!holdReservation) {
        await releaseReservation();
      }
    }
  }

  const last = input.candidates[input.candidates.length - 1];
  const chainDetail =
    rejectedAttempts.length > 0
      ? rejectedAttempts
          .map(
            (r) =>
              `${r.discoveryIdentity.reportCode}#${r.discoveryIdentity.fightId}:${r.rejectionReason ?? "UNKNOWN"}${
                r.rejectionDetail ? `(${r.rejectionDetail})` : ""
              }`,
          )
          .join(" → ")
      : "no candidate attempts recorded";
  return {
    result: {
      discoveryIdentity: last?.discoveryIdentity ?? { reportCode: "none", fightId: 0 },
      acquisitionStatus: "REJECTED",
      reportRevision: null,
      rejectionReason: "FALLBACK_EXHAUSTED",
      rejectionDetail: `exhausted ${input.candidates.length} candidates; chain: ${chainDetail}`,
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
    datasetDescriptors: [],
    factSetFingerprint: null,
    typedFactPayloads: [],
    rejectedAttempts,
    providerCallTotal,
    providerAccounting,
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
  slots: Array<{
    acquisitionResult: EvidenceCandidateAcquisitionResult | null;
    rejectedAttempts?: EvidenceCandidateAcquisitionResult[] | null;
  }>,
): EvidenceCandidateAcquisitionResult[] {
  const out: EvidenceCandidateAcquisitionResult[] = [];
  const byKey = new Map<string, EvidenceCandidateAcquisitionResult>();

  const consider = (result: EvidenceCandidateAcquisitionResult | null | undefined) => {
    if (!result) return;
    const key = discoveryIdentityKey(result.discoveryIdentity);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, result);
      return;
    }
    // Prefer ACQUIRED over REJECTED for the same identity.
    if (
      existing.acquisitionStatus !== "ACQUIRED" &&
      result.acquisitionStatus === "ACQUIRED"
    ) {
      byKey.set(key, result);
    }
  };

  for (const slot of slots) {
    for (const rejected of slot.rejectedAttempts ?? []) {
      consider(rejected);
    }
    consider(slot.acquisitionResult);
  }

  for (const result of byKey.values()) {
    out.push(result);
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
