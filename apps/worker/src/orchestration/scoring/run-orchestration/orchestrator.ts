/**
 * Production Scoring V2 run orchestration — 16 selected runs → capability
 * packages → participant digests → dimension calculators.
 *
 * Provider calls occur only when liveProviderPermission is explicitly enabled
 * and a compatible capability package is missing.
 */
import { createHash } from "node:crypto";
import {
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  expectedEvidenceSlotCount,
  type CapabilityEvidencePackageV1,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceCandidateAcquisitionResult,
  type EvidenceCandidateMetadataV2,
  type EvidenceSelectionScope,
  type ParticipantScoringDigestV1,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
  computePerformancePhase2,
  computeSurvivalV2,
  computeUtilityV2,
  DigestDimensionIncompleteError,
  performanceRunParseFactFromDigest,
  cooldownRunEvidenceFromDigest,
  survivalFactDocumentFromDigest,
  utilityRunFactSetFromDigest,
  buildDigestScoreLineage,
  resolveTunableWeights,
  resolvePerformancePhase2CombineWeights,
  applyTunableWeightsToPerformanceConfig,
  applyTunableWeightsToSurvivalConfig,
  applyTunableWeightsToUtilityConfig,
  type SeasonDifficultyPolicyV2,
  type PerformanceProfileAggregateFactV2,
  type PerformancePhase2ComputeResult,
} from "@mplus/scoring";
import {
  buildParticipantScoringDigestsFromPackage,
  inferFightBoundsFromCompactEvents,
  type RankingParseFactInput,
} from "@mplus/provider-warcraftlogs";
import { absentRankingParseFact } from "./ranking-hydrate.js";
import {
  isUsablePerformanceDigest,
  resolveTargetActorIdFromRoster,
  selectTargetCharacterDigest,
  TargetCharacterDigestError,
  type RosterParticipantIdentity,
} from "./target-character-identity.js";

export type LiveProviderPermission = "FORBIDDEN" | "ALLOWED";
export {
  TargetCharacterDigestError,
  selectTargetCharacterDigest,
  resolveTargetActorIdFromRoster,
  isUsablePerformanceDigest,
} from "./target-character-identity.js";

export interface SourceFightIdentity {
  reportCode: string;
  fightId: number;
  reportRevision: number;
}

export function sourceFightKey(id: SourceFightIdentity): string {
  return `${id.reportCode}:${id.fightId}:${id.reportRevision}`;
}

export interface OrchestrationParticipant {
  playerActorId: number;
  characterName: string;
  realmSlug?: string;
  regionCode?: string;
  classSlug: string | null;
  specSlug: string | null;
  role?: string | null;
  ownedPetActorIds: number[];
  characterId?: string | null;
}

export interface CompatiblePackageHit {
  package: CapabilityEvidencePackageV1;
  packageArtifactId: string;
  contentHash: string;
  providerCalls: 0;
}

export interface ProviderEvidenceCacheMiss {
  code: "PROVIDER_EVIDENCE_CACHE_MISS";
  sourceFight: SourceFightIdentity;
  compatibilityKey: string;
  liveProviderPermission: LiveProviderPermission;
}

export interface AcquireCapabilityPackageResult {
  package: CapabilityEvidencePackageV1;
  packageArtifactId: string;
  contentHash: string;
  providerCalls: number;
  created: boolean;
}

export interface PersistedDigestRecord {
  digest: ParticipantScoringDigestV1;
  artifactId: string;
  created: boolean;
}

/** Injectable ports — production wires DB/WCL; tests use fakes. */
export interface RunOrchestrationPorts {
  findCompatibleCapabilityPackage(input: {
    sourceFight: SourceFightIdentity;
    compatibilityKey?: string;
  }): Promise<CompatiblePackageHit | null>;

  /**
   * Acquire once under source-fight singleflight. Must be idempotent.
   * Only called when liveProviderPermission === "ALLOWED".
   */
  acquireAndPersistCapabilityPackage(input: {
    sourceFight: SourceFightIdentity;
    dungeonSlug: string | null;
    keyLevel: number | null;
    participants: OrchestrationParticipant[];
  }): Promise<AcquireCapabilityPackageResult>;

  findCompatibleDigest(input: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
    participantActorId: number;
    digestSchemaVersion: string;
    extractorCompatVersion: string;
    capabilityPackageContentHash: string;
    catalogVersion: string;
  }): Promise<PersistedDigestRecord | null>;

  persistDigest(digest: ParticipantScoringDigestV1): Promise<PersistedDigestRecord>;

  /**
   * Cross-worker singleflight for one source fight acquisition.
   * Waiters must observe the completed package without a second WCL call.
   */
  withSourceFightLock<T>(
    sourceFight: SourceFightIdentity,
    work: () => Promise<T>,
  ): Promise<T>;

  resolveParticipantsForFight(input: {
    sourceFight: SourceFightIdentity;
  }): Promise<OrchestrationParticipant[]>;

  resolveFightBounds?(input: {
    sourceFight: SourceFightIdentity;
  }): Promise<{ fightStartMs: number; fightEndMs: number | null }>;

  /**
   * Load persisted ranking/parse evidence for one participant.
   * Must not call WCL — provider-free only. Return null when absent.
   */
  resolveRankingParseForParticipant(input: {
    sourceFight: SourceFightIdentity;
    participantActorId: number;
    dungeonSlug: string | null;
    keyLevel: number | null;
  }): Promise<RankingParseFactInput | null>;

  /**
   * Optional roster from persisted WCL run source digest / master data.
   * Used for stable target-character identity (not stale discovery actor IDs).
   */
  resolveFightRoster?(input: {
    sourceFight: SourceFightIdentity;
  }): Promise<RosterParticipantIdentity[] | null>;

  /**
   * Resolve authoritative report.revision for a discovery identity when candidate
   * metadata still lacks it (cold MythicRun sources). Must not fabricate a revision.
   * Return null when WCL / persistence cannot establish a finite revision.
   */
  resolveReportRevision?(input: {
    reportCode: string;
    fightId: number;
    actorId?: number | null;
  }): Promise<{ reportRevision: number; providerCalls: number } | null>;

  /**
   * Load already-persisted digests for a source fight (all participants).
   * Used when the raw package lacks embedded roster/masterData so scoring can
   * still reuse digests without a live WCL re-acquire.
   */
  listPersistedDigestsForSourceFight?(input: {
    sourceFight: SourceFightIdentity;
  }): Promise<PersistedDigestRecord[]>;
}

export interface RunOrchestrationInput {
  characterId: string;
  region: string;
  realm: string;
  characterName: string;
  seasonId: string;
  scoringModelId: string;
  scoringModelVersion?: string | null;
  liveProviderPermission: LiveProviderPermission;
  /** Pre-built selection scope (dungeons, cutoff, role, …). */
  scope: EvidenceSelectionScope;
  /** Discovered candidate metadata for the character/season. */
  candidates: readonly EvidenceCandidateMetadataV2[];
  /**
   * Optional existing frozen manifest. When provided, selection is skipped and
   * slots are taken from the manifest (provider-free replay path).
   */
  existingManifest?: CharacterSeasonEvidenceManifestV2 | null;
  /** Simulated acquisition results when finalizing a new plan (tests / offline). */
  acquisitionResultsForFinalize?: Parameters<
    typeof finalizeEvidenceManifestV2
  >[0]["acquisitionResults"];
  difficultyPolicy?: SeasonDifficultyPolicyV2 | null;
  /**
   * Character/season points_and_damage profile fact for Performance Phase 1 stabilizer.
   * Null when aggregate unavailable — Performance may still score from detailed parses.
   */
  profileAggregate?: PerformanceProfileAggregateFactV2 | null;
  /**
   * Persisted ScoreModel.config JSON. When omitted, calculators use package defaults
   * (identical to pre-tunable-weights production behaviour).
   */
  scoreModelConfig?: Record<string, unknown> | null;
  ports: RunOrchestrationPorts;
  plannedAt?: string;
  selectedAt?: string;
}

export interface FightProcessingAccounting {
  sourceFight: SourceFightIdentity;
  packageCreated: boolean;
  providerCalls: number;
  digestsCreated: number;
  digestsReused: number;
  participantDigestCount: number;
}

export interface RunOrchestrationResult {
  manifest: CharacterSeasonEvidenceManifestV2;
  expectedSlotCount: number;
  selectedSlotCount: number;
  incomplete: boolean;
  incompleteSlotIds: string[];
  uniqueSourceFights: SourceFightIdentity[];
  characterDigests: Array<{
    slotId: string;
    dungeonSlug: string;
    slotIndex: 0 | 1;
    digest: ParticipantScoringDigestV1;
    digestArtifactId: string;
  }>;
  /** Slots where target-character digest resolution failed (structured). */
  targetDigestFailures: Array<{
    slotId: string;
    code: "TARGET_CHARACTER_DIGEST_MISSING" | "TARGET_CHARACTER_DIGEST_AMBIGUOUS";
    message: string;
    matchCount: number;
  }>;
  allParticipantDigests: PersistedDigestRecord[];
  accounting: {
    providerCalls: number;
    packagesCreated: number;
    packagesReused: number;
    digestsCreated: number;
    digestsReused: number;
    fights: FightProcessingAccounting[];
  };
  cacheMisses: ProviderEvidenceCacheMiss[];
  fightFailures: Array<{
    sourceFight: SourceFightIdentity;
    code: string;
    message: string;
  }>;
  dimensions: {
    performance: PerformancePhase2ComputeResult | null;
    utility: ReturnType<typeof computeUtilityV2> | null;
    survival: ReturnType<typeof computeSurvivalV2> | null;
    /** Per-digest Performance unusable reasons (ranking absent, etc.). */
    performanceDigestDiagnostics: Array<{
      slotId: string;
      digestArtifactId: string;
      usable: boolean;
      reason: string | null;
    }>;
    /** Per-digest Utility skip reasons (dataset missing, etc.). */
    utilityDigestDiagnostics: Array<{
      slotId: string;
      digestArtifactId: string;
      usable: boolean;
      reason: string | null;
    }>;
    /** Per-digest Survival skip reasons (death/timing evidence missing, etc.). */
    survivalDigestDiagnostics: Array<{
      slotId: string;
      digestArtifactId: string;
      usable: boolean;
      reason: string | null;
    }>;
    blocked: Array<{
      dimension: "PERFORMANCE" | "UTILITY" | "SURVIVAL";
      reason: string;
    }>;
    lineage: ReturnType<typeof buildDigestScoreLineage>[];
  };
  publicationAllowed: boolean;
}

/** Concrete product unavailable reasons — never collapse to a single generic UNAVAILABLE. */
export type DimensionUnavailableReason =
  | "performance_parse_missing"
  | "performance_profile_aggregate_missing"
  | "performance_catalogue_incompatible"
  | "utility_dataset_missing"
  | "utility_actor_unresolved"
  | "survival_death_evidence_missing"
  | "survival_timing_evidence_missing";

function mapPerformanceUnavailableReason(input: {
  hasParseFacts: boolean;
  hasProfileAggregate: boolean;
  detail: string | null;
}): string {
  const detail = (input.detail ?? "").toLowerCase();
  if (
    detail.includes("catalogue") ||
    detail.includes("catalog") ||
    detail.includes("incompatible")
  ) {
    return "performance_catalogue_incompatible";
  }
  if (!input.hasParseFacts && input.hasProfileAggregate) {
    return "performance_parse_missing";
  }
  if (input.hasParseFacts && !input.hasProfileAggregate) {
    return "performance_profile_aggregate_missing";
  }
  if (!input.hasParseFacts) {
    return "performance_parse_missing";
  }
  return detail || "performance_parse_missing";
}

function mapUtilityUnavailableReason(detail: string | null): string {
  const d = (detail ?? "").toLowerCase();
  if (d.includes("actor") || d.includes("unresolved") || d.includes("target_character")) {
    return "utility_actor_unresolved";
  }
  return "utility_dataset_missing";
}

function mapSurvivalUnavailableReason(detail: string | null): string {
  const d = (detail ?? "").toLowerCase();
  if (
    d.includes("timing") ||
    d.includes("defensive") ||
    d.includes("pressure") ||
    d.includes("recovery") ||
    d.includes("damage_taken")
  ) {
    return "survival_timing_evidence_missing";
  }
  if (d.includes("death")) {
    return "survival_death_evidence_missing";
  }
  return "survival_death_evidence_missing";
}

function defaultDifficultyPolicy(
  scope: EvidenceSelectionScope,
): SeasonDifficultyPolicyV2 {
  return {
    id: "orchestrator-default-difficulty",
    seasonId: scope.seasonId,
    region: "unknown",
    role: scope.role,
    specSlug: scope.specSlug,
    effectiveFrom: "2020-01-01T00:00:00.000Z",
    k50: 10,
    k90: 15,
    k99: 20,
    source: "MANUAL",
    sampleSize: null,
    confidence: 0.5,
    version: "orchestrator-default-v1",
  };
}

export function createInMemorySourceFightLock(): RunOrchestrationPorts["withSourceFightLock"] {
  const tails = new Map<string, Promise<unknown>>();
  return async (sourceFight, work) => {
    const key = sourceFightKey(sourceFight);
    const prev = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => gate);
    tails.set(
      key,
      chained.then(
        () => undefined,
        () => undefined,
      ),
    );
    await prev.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
    }
  };
}

/**
 * Deduplicate frozen selected slots to unique source fights.
 */
export function uniqueSourceFightsFromManifest(
  manifest: CharacterSeasonEvidenceManifestV2,
): SourceFightIdentity[] {
  const seen = new Set<string>();
  const out: SourceFightIdentity[] = [];
  for (const slot of manifest.slots) {
    if (slot.state !== "SELECTED" || !slot.identity) continue;
    const id: SourceFightIdentity = {
      reportCode: slot.identity.reportCode,
      fightId: slot.identity.fightId,
      reportRevision: slot.identity.reportRevision,
    };
    const key = sourceFightKey(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

async function ensurePackageAndDigests(input: {
  sourceFight: SourceFightIdentity;
  dungeonSlug: string | null;
  keyLevel: number | null;
  timed: boolean | null;
  runScore: number | null;
  completedAt: string | null;
  liveProviderPermission: LiveProviderPermission;
  ports: RunOrchestrationPorts;
  /** When replaying, package may already be known. */
  knownPackage?: CompatiblePackageHit | null;
}): Promise<{
  packageHit: CompatiblePackageHit;
  digests: PersistedDigestRecord[];
  accounting: FightProcessingAccounting;
  cacheMiss: ProviderEvidenceCacheMiss | null;
}> {
  const { ports, sourceFight } = input;

  return ports.withSourceFightLock(sourceFight, async () => {
    let packageHit = input.knownPackage ?? null;
    let providerCalls = 0;
    let packageCreated = false;
    let cacheMiss: ProviderEvidenceCacheMiss | null = null;

    if (!packageHit) {
      packageHit = await ports.findCompatibleCapabilityPackage({
        sourceFight,
      });
      // Incomplete packages must never be treated as compatible cache hits.
      if (packageHit && packageHit.package.complete !== true) {
        packageHit = null;
      }
    }

    // Warm reuse: digests already persist for bare/legacy raw packages that lack
    // embedded masterData. Prefer them over forcing a live roster re-acquire.
    if (!packageHit && ports.listPersistedDigestsForSourceFight) {
      const persisted = await ports.listPersistedDigestsForSourceFight({
        sourceFight,
      });
      if (persisted.length > 0) {
        return {
          packageHit: null as unknown as CompatiblePackageHit,
          digests: persisted,
          accounting: {
            sourceFight,
            packageCreated: false,
            providerCalls: 0,
            digestsCreated: 0,
            digestsReused: persisted.length,
            participantDigestCount: persisted.length,
          },
          cacheMiss: null,
        };
      }
    }

    if (!packageHit) {
      if (input.liveProviderPermission === "FORBIDDEN") {
        cacheMiss = {
          code: "PROVIDER_EVIDENCE_CACHE_MISS",
          sourceFight,
          compatibilityKey: sourceFightKey(sourceFight),
          liveProviderPermission: "FORBIDDEN",
        };
        return {
          packageHit: null as unknown as CompatiblePackageHit,
          digests: [],
          accounting: {
            sourceFight,
            packageCreated: false,
            providerCalls: 0,
            digestsCreated: 0,
            digestsReused: 0,
            participantDigestCount: 0,
          },
          cacheMiss,
        };
      }

      // Bare raw rows (no masterData) resolve to [] so live acquire can embed roster.
      const participants = await ports.resolveParticipantsForFight({
        sourceFight,
      });

      const acquired = await ports.acquireAndPersistCapabilityPackage({
        sourceFight,
        dungeonSlug: input.dungeonSlug,
        keyLevel: input.keyLevel,
        participants,
      });
      if (acquired.package.complete !== true) {
        throw new Error(
          `incomplete_capability_package:${sourceFightKey(sourceFight)}`,
        );
      }
      packageHit = {
        package: acquired.package,
        packageArtifactId: acquired.packageArtifactId,
        contentHash: acquired.contentHash,
        providerCalls: 0,
      };
      providerCalls = acquired.providerCalls;
      packageCreated = acquired.created;
    }

    const bounds = (await ports.resolveFightBounds?.({ sourceFight })) ??
      inferFightBoundsFromCompactEvents(packageHit.package.compactEvents);

    const participants = await ports.resolveParticipantsForFight({
      sourceFight,
    });

    const rankingByActorId = new Map<number, RankingParseFactInput>();
    for (const participant of participants) {
      const ranking = await ports.resolveRankingParseForParticipant({
        sourceFight,
        participantActorId: participant.playerActorId,
        dungeonSlug: input.dungeonSlug,
        keyLevel: input.keyLevel,
      });
      rankingByActorId.set(
        participant.playerActorId,
        ranking ?? absentRankingParseFact(),
      );
    }

    const built = buildParticipantScoringDigestsFromPackage({
      capabilityPackage: packageHit.package,
      packageArtifactId: packageHit.packageArtifactId,
      participants,
      dungeonSlug: input.dungeonSlug,
      keyLevel: input.keyLevel,
      timed: input.timed,
      runScore: input.runScore,
      completedAt: input.completedAt,
      fightStartMs: bounds.fightStartMs,
      fightEndMs: bounds.fightEndMs,
      catalogVersion: packageHit.package.catalogVersion,
      rankingByActorId,
    });

    const digests: PersistedDigestRecord[] = [];
    let digestsCreated = 0;
    let digestsReused = 0;

    for (const digest of built) {
      const existing = await ports.findCompatibleDigest({
        reportCode: digest.reportCode,
        fightId: digest.fightId,
        reportRevision: digest.reportRevision,
        participantActorId: digest.participantActorId,
        digestSchemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
        extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
        capabilityPackageContentHash: digest.capabilityPackageContentHash,
        catalogVersion: digest.catalogVersion,
      });
      // Reuse only on exact content match. Ranking facts may change without a
      // package hash change; do not skip digest refresh in that case.
      if (existing && existing.digest.contentHash === digest.contentHash) {
        digests.push(existing);
        digestsReused += 1;
        continue;
      }
      const persisted = await ports.persistDigest(digest);
      digests.push(persisted);
      if (persisted.created) digestsCreated += 1;
      else digestsReused += 1;
    }

    return {
      packageHit,
      digests,
      accounting: {
        sourceFight,
        packageCreated,
        providerCalls,
        digestsCreated,
        digestsReused,
        participantDigestCount: digests.length,
      },
      cacheMiss: null,
    };
  });
}

function isResolvedReportRevision(
  value: number | null | undefined,
): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

/**
 * Build finalize acquisition rows from plan candidates.
 * Plan-time revision may be null (cold MythicRun sources). Establish revision via
 * ports.resolveReportRevision when live is allowed; otherwise reject the candidate
 * with REPORT_REVISION_UNRESOLVED so finalize can fall back to the next ranked
 * candidate. Never aborts the whole character for one unresolved revision.
 */
async function buildSyntheticAcquisitionResults(input: {
  plan: ReturnType<typeof buildEvidenceAcquisitionPlanV2>["plan"];
  candidates: readonly EvidenceCandidateMetadataV2[];
  liveProviderPermission: LiveProviderPermission;
  ports: RunOrchestrationPorts;
}): Promise<{
  results: EvidenceCandidateAcquisitionResult[];
  providerCalls: number;
}> {
  const results: EvidenceCandidateAcquisitionResult[] = [];
  const seenAcq = new Set<string>();
  let providerCalls = 0;

  for (const slot of input.plan.slots) {
    for (const c of slot.orderedCandidates) {
      const k = `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;
      if (seenAcq.has(k)) continue;
      seenAcq.add(k);

      const meta = input.candidates.find(
        (cand) =>
          cand.discoveryIdentity.reportCode ===
            c.discoveryIdentity.reportCode &&
          cand.discoveryIdentity.fightId === c.discoveryIdentity.fightId,
      );

      // Defense-in-depth: never resolve revision / detailed-fetch non-timed evidence.
      const timed = meta?.timed ?? c.timed;
      if (timed !== true) {
        results.push({
          discoveryIdentity: { ...c.discoveryIdentity },
          acquisitionStatus: "REJECTED",
          reportRevision: meta?.reportRevision ?? null,
          rejectionReason: timed === false ? "UNTIMED_RUN" : "TIMED_STATE_UNKNOWN",
          rejectionDetail: `SCORING_REQUIRES_TIMED:${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}:timed=${String(timed)}`,
          datasetHashes: [],
          factSetHash: null,
          dimensionValidity: null,
          keyLevel: c.keyLevel,
          timed,
          runScore: c.runScore,
          completedAt: c.completedAt,
          actorId: c.actorId,
          evidenceCompleteness: c.evidenceCompleteness,
        });
        continue;
      }

      let reportRevision = meta?.reportRevision ?? null;
      if (
        !isResolvedReportRevision(reportRevision) &&
        input.liveProviderPermission === "ALLOWED" &&
        input.ports.resolveReportRevision
      ) {
        const observed = await input.ports.resolveReportRevision({
          reportCode: c.discoveryIdentity.reportCode,
          fightId: c.discoveryIdentity.fightId,
          actorId: c.actorId ?? meta?.actorId ?? null,
        });
        providerCalls += observed?.providerCalls ?? 0;
        reportRevision = observed?.reportRevision ?? null;
      }

      if (!isResolvedReportRevision(reportRevision)) {
        results.push({
          discoveryIdentity: { ...c.discoveryIdentity },
          acquisitionStatus: "REJECTED",
          reportRevision: null,
          rejectionReason: "REPORT_REVISION_UNRESOLVED",
          rejectionDetail: `REPORT_REVISION_UNRESOLVED:${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`,
          datasetHashes: [],
          factSetHash: null,
          dimensionValidity: null,
          keyLevel: c.keyLevel,
          timed: c.timed,
          runScore: c.runScore,
          completedAt: c.completedAt,
          actorId: c.actorId,
          evidenceCompleteness: c.evidenceCompleteness,
        });
        continue;
      }

      results.push({
        discoveryIdentity: { ...c.discoveryIdentity },
        acquisitionStatus: "ACQUIRED",
        reportRevision,
        rejectionReason: null,
        rejectionDetail: null,
        datasetHashes: [],
        factSetHash: `facts-${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`,
        dimensionValidity: {
          performance: "VALID",
          survival: "VALID",
          utility: "VALID",
          reasons: [],
        },
        keyLevel: c.keyLevel,
        timed: c.timed,
        runScore: c.runScore,
        completedAt: c.completedAt,
        actorId: c.actorId,
        evidenceCompleteness: c.evidenceCompleteness,
      });
    }
  }

  return { results, providerCalls };
}

/**
 * Main production entry: select 16 runs (or load manifest), ensure evidence +
 * digests, score Performance / Utility / Survival from digests only.
 */
export async function orchestrateScoringRuns(
  input: RunOrchestrationInput,
): Promise<RunOrchestrationResult> {
  let manifest = input.existingManifest ?? null;
  let revisionResolveProviderCalls = 0;

  if (!manifest) {
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope: input.scope,
      candidates: input.candidates,
      plannedAt: input.plannedAt ?? new Date().toISOString(),
    });
    let uniqueAcq = input.acquisitionResultsForFinalize;
    if (!uniqueAcq) {
      const built = await buildSyntheticAcquisitionResults({
        plan,
        candidates: input.candidates,
        liveProviderPermission: input.liveProviderPermission,
        ports: input.ports,
      });
      uniqueAcq = built.results;
      revisionResolveProviderCalls = built.providerCalls;
    } else {
      // Deduplicate caller-supplied acquisition results by discovery identity.
      const seenAcq = new Set<string>();
      const deduped = [];
      for (const r of uniqueAcq) {
        const k = `${r.discoveryIdentity.reportCode}:${r.discoveryIdentity.fightId}`;
        if (seenAcq.has(k)) continue;
        seenAcq.add(k);
        deduped.push(r);
      }
      uniqueAcq = deduped;
    }
    const finalized = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults: uniqueAcq,
      selectedAt: input.selectedAt ?? new Date().toISOString(),
    });
    manifest = finalized.manifest;
  }

  const expectedSlotCount = expectedEvidenceSlotCount(
    input.scope.activeDungeonSlugs.length,
  );
  const incompleteSlotIds = manifest.slots
    .filter((s) => s.state !== "SELECTED")
    .map((s) => s.slotId);
  const incomplete = incompleteSlotIds.length > 0 || manifest.selectedSlotCount < expectedSlotCount;

  const uniqueFights = uniqueSourceFightsFromManifest(manifest);
  // Structured phase markers (no behavior change) — SELECTED before any ReportEvents.
  console.info(
    JSON.stringify({
      event: "wcl_acquisition_phase",
      phase: "SELECTED",
      selectedSlotCount: manifest.selectedSlotCount,
      expectedSlotCount,
      uniqueSourceFights: uniqueFights.length,
      candidateCount: input.candidates.length,
    }),
  );
  console.info(
    JSON.stringify({
      event: "wcl_acquisition_phase",
      phase: "DETAILED_ACQUISITION",
      uniqueSourceFights: uniqueFights.length,
      liveProviderPermission: input.liveProviderPermission,
    }),
  );
  const fightMeta = new Map<string, {
    dungeonSlug: string | null;
    keyLevel: number | null;
    timed: boolean | null;
    runScore: number | null;
    completedAt: string | null;
  }>();
  for (const slot of manifest.slots) {
    if (!slot.identity) continue;
    const key = sourceFightKey({
      reportCode: slot.identity.reportCode,
      fightId: slot.identity.fightId,
      reportRevision: slot.identity.reportRevision,
    });
    if (!fightMeta.has(key)) {
      fightMeta.set(key, {
        dungeonSlug: slot.dungeonSlug,
        keyLevel: slot.keyLevel,
        timed: slot.timed,
        runScore: slot.runScore,
        completedAt: slot.completedAt,
      });
    }
  }

  const accountingFights: FightProcessingAccounting[] = [];
  const cacheMisses: ProviderEvidenceCacheMiss[] = [];
  const fightFailures: RunOrchestrationResult["fightFailures"] = [];
  const allParticipantDigests: PersistedDigestRecord[] = [];
  const digestsByFightActor = new Map<string, PersistedDigestRecord>();
  let providerCalls = revisionResolveProviderCalls;
  let packagesCreated = 0;
  let packagesReused = 0;
  let digestsCreated = 0;
  let digestsReused = 0;

  for (const sourceFight of uniqueFights) {
    const meta = fightMeta.get(sourceFightKey(sourceFight)) ?? {
      dungeonSlug: null,
      keyLevel: null,
      timed: null,
      runScore: null,
      completedAt: null,
    };
    // Defense-in-depth: SELECTED fights must be timed before ensurePackageAndDigests.
    if (meta.timed !== true) {
      fightFailures.push({
        sourceFight,
        code: meta.timed === false ? "UNTIMED_RUN" : "TIMED_STATE_UNKNOWN",
        message: `Scoring evidence requires timed===true before detailed acquisition (${sourceFight.reportCode}:${sourceFight.fightId})`,
      });
      accountingFights.push({
        sourceFight,
        packageCreated: false,
        providerCalls: 0,
        digestsCreated: 0,
        digestsReused: 0,
        participantDigestCount: 0,
      });
      continue;
    }
    try {
      const result = await ensurePackageAndDigests({
        sourceFight,
        ...meta,
        liveProviderPermission: input.liveProviderPermission,
        ports: input.ports,
      });
      if (result.cacheMiss) {
        cacheMisses.push(result.cacheMiss);
        accountingFights.push(result.accounting);
        continue;
      }
      accountingFights.push(result.accounting);
      providerCalls += result.accounting.providerCalls;
      if (result.accounting.packageCreated) packagesCreated += 1;
      else packagesReused += 1;
      digestsCreated += result.accounting.digestsCreated;
      digestsReused += result.accounting.digestsReused;
      for (const d of result.digests) {
        allParticipantDigests.push(d);
        digestsByFightActor.set(
          `${sourceFightKey(sourceFight)}:${d.digest.participantActorId}`,
          d,
        );
      }
    } catch (err) {
      // One failed fight must not corrupt completed fights.
      fightFailures.push({
        sourceFight,
        code:
          err instanceof Error && "code" in err
            ? String((err as { code?: string }).code ?? "FIGHT_PROCESSING_FAILED")
            : "FIGHT_PROCESSING_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
      accountingFights.push({
        sourceFight,
        packageCreated: false,
        providerCalls: 0,
        digestsCreated: 0,
        digestsReused: 0,
        participantDigestCount: 0,
      });
    }
  }

  // Select the requested character's digest per selected slot (16 when complete).
  // Prefer stable roster identity; never rely on stale discovery actor IDs alone.
  const characterDigests: RunOrchestrationResult["characterDigests"] = [];
  const targetDigestFailures: RunOrchestrationResult["targetDigestFailures"] = [];
  const identity = {
    characterId: input.characterId,
    characterName: input.characterName,
    regionCode: input.region,
    realmSlug: input.realm,
  };

  for (const slot of manifest.slots) {
    if (slot.state !== "SELECTED" || !slot.identity) continue;
    const sourceFight = {
      reportCode: slot.identity.reportCode,
      fightId: slot.identity.fightId,
      reportRevision: slot.identity.reportRevision,
    };
    const fightKey = sourceFightKey(sourceFight);
    const fightDigests = [...digestsByFightActor.entries()]
      .filter(([k]) => k.startsWith(`${fightKey}:`))
      .map(([, rec]) => ({
        participantActorId: rec.digest.participantActorId,
        characterId: rec.digest.characterId,
        characterName: rec.digest.characterName,
        realmSlug: rec.digest.realmSlug,
        regionCode: rec.digest.regionCode,
        digest: rec.digest,
        digestArtifactId: rec.artifactId,
      }));

    let targetActorId: number | null = null;
    if (input.ports.resolveFightRoster) {
      const roster = await input.ports.resolveFightRoster({ sourceFight });
      if (roster && roster.length > 0) {
        const resolved = resolveTargetActorIdFromRoster({ roster, identity });
        if (resolved.reason === "RESOLVED") {
          targetActorId = resolved.actorId;
        }
      }
    }

    try {
      const match = selectTargetCharacterDigest({
        slotId: slot.slotId,
        digests: fightDigests,
        identity,
        targetActorId,
      });
      characterDigests.push({
        slotId: slot.slotId,
        dungeonSlug: slot.dungeonSlug,
        slotIndex: slot.slotIndex,
        digest: match.digest,
        digestArtifactId: match.digestArtifactId,
      });
    } catch (err) {
      if (err instanceof TargetCharacterDigestError) {
        targetDigestFailures.push({
          slotId: slot.slotId,
          code: err.code,
          message: err.message,
          matchCount: err.matchCount,
        });
        continue;
      }
      throw err;
    }
  }

  const blocked: RunOrchestrationResult["dimensions"]["blocked"] = [];
  const lineage: ReturnType<typeof buildDigestScoreLineage>[] = [];
  const performanceDigestDiagnostics: RunOrchestrationResult["dimensions"]["performanceDigestDiagnostics"] =
    [];
  const utilityDigestDiagnostics: RunOrchestrationResult["dimensions"]["utilityDigestDiagnostics"] =
    [];
  const survivalDigestDiagnostics: RunOrchestrationResult["dimensions"]["survivalDigestDiagnostics"] =
    [];
  const difficultyPolicy =
    input.difficultyPolicy ?? defaultDifficultyPolicy(input.scope);
  const usingDefaultDifficultyPolicy = input.difficultyPolicy == null;

  const { weights: tunableWeights } = resolveTunableWeights(input.scoreModelConfig);
  const performanceCombineWeights =
    resolvePerformancePhase2CombineWeights(tunableWeights);
  const performanceModelConfig =
    applyTunableWeightsToPerformanceConfig(tunableWeights);
  const survivalModelConfig = applyTunableWeightsToSurvivalConfig(tunableWeights);
  const utilityModelConfig = applyTunableWeightsToUtilityConfig(tunableWeights);

  let performance: PerformancePhase2ComputeResult | null = null;
  let utility: ReturnType<typeof computeUtilityV2> | null = null;
  let survival: ReturnType<typeof computeSurvivalV2> | null = null;

  if (characterDigests.length > 0) {
    try {
      const runParseFacts = [];
      const cooldownRuns = [];
      for (const row of characterDigests) {
        cooldownRuns.push(
          cooldownRunEvidenceFromDigest({
            digest: row.digest,
            slotId: row.slotId,
          }),
        );
        if (!isUsablePerformanceDigest(row.digest)) {
          performanceDigestDiagnostics.push({
            slotId: row.slotId,
            digestArtifactId: row.digestArtifactId,
            usable: false,
            reason:
              row.digest.performance.limitations.join(",") ||
              "performance_parse_missing",
          });
          continue;
        }
        try {
          runParseFacts.push(
            performanceRunParseFactFromDigest(row.digest, row.slotId),
          );
          performanceDigestDiagnostics.push({
            slotId: row.slotId,
            digestArtifactId: row.digestArtifactId,
            usable: true,
            reason: null,
          });
        } catch (err) {
          performanceDigestDiagnostics.push({
            slotId: row.slotId,
            digestArtifactId: row.digestArtifactId,
            usable: false,
            reason:
              err instanceof DigestDimensionIncompleteError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "performance_parse_missing",
          });
        }
      }

      if (runParseFacts.length === 0 && input.profileAggregate == null) {
        const sampleReason =
          performanceDigestDiagnostics.find((d) => !d.usable)?.reason ?? null;
        blocked.push({
          dimension: "PERFORMANCE",
          reason: mapPerformanceUnavailableReason({
            hasParseFacts: false,
            hasProfileAggregate: false,
            detail: sampleReason,
          }),
        });
      } else {
        performance = computePerformancePhase2(
          {
            phase1: {
              manifest: {
                contentHash: manifest.contentHash,
                schemaVersion: manifest.schemaVersion,
                selectorVersion: manifest.selectorVersion,
                characterId: manifest.characterId,
                seasonId: manifest.seasonId,
                seasonSlug: manifest.seasonSlug,
                specSlug: manifest.specSlug,
                role: manifest.role,
                highKeyPolicyId: manifest.highKeyPolicyId,
                activeDungeonSlugs: manifest.activeDungeonSlugs,
                expectedSlotCount: manifest.expectedSlotCount,
                selectedSlotCount: manifest.selectedSlotCount,
                evidenceCutoffAt: manifest.evidenceCutoffAt,
              },
              runParseFacts,
              profileAggregate: input.profileAggregate ?? null,
              difficultyPolicy,
              expectedPartition: null,
              logFreshness: 1,
              computedAt: input.selectedAt ?? new Date().toISOString(),
            },
            cooldownRuns,
          },
          {
            phase1: { modelConfig: performanceModelConfig },
            combineWeights: performanceCombineWeights,
          },
        );
        if (
          usingDefaultDifficultyPolicy &&
          !performance.limitations.includes(
            "difficulty_policy_orchestrator_default",
          )
        ) {
          performance.limitations.push(
            "difficulty_policy_orchestrator_default",
          );
        }
        if (performance.score == null) {
          blocked.push({
            dimension: "PERFORMANCE",
            reason: mapPerformanceUnavailableReason({
              hasParseFacts: runParseFacts.length > 0,
              hasProfileAggregate: input.profileAggregate != null,
              detail: performance.limitations.join(",") || null,
            }),
          });
        }
        for (const row of characterDigests) {
          if (
            !performanceDigestDiagnostics.some(
              (d) => d.slotId === row.slotId && d.usable,
            )
          ) {
            continue;
          }
          lineage.push(
            buildDigestScoreLineage({
              digest: row.digest,
              digestArtifactId: row.digestArtifactId,
              scoreModelId: input.scoringModelId,
              scoreModelVersion: input.scoringModelVersion,
              dimension: "PERFORMANCE",
            }),
          );
        }
      }
    } catch (err) {
      blocked.push({
        dimension: "PERFORMANCE",
        reason: mapPerformanceUnavailableReason({
          hasParseFacts: false,
          hasProfileAggregate: input.profileAggregate != null,
          detail:
            err instanceof DigestDimensionIncompleteError
              ? err.message
              : err instanceof Error
                ? err.message
                : null,
        }),
      });
    }

    try {
      const factSets = [];
      for (const row of characterDigests) {
        try {
          factSets.push(
            utilityRunFactSetFromDigest(row.digest, {
              slotId: row.slotId,
              slotIndex: row.slotIndex,
            }),
          );
          utilityDigestDiagnostics.push({
            slotId: row.slotId,
            digestArtifactId: row.digestArtifactId,
            usable: true,
            reason: null,
          });
        } catch (err) {
          utilityDigestDiagnostics.push({
            slotId: row.slotId,
            digestArtifactId: row.digestArtifactId,
            usable: false,
            reason:
              err instanceof DigestDimensionIncompleteError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "utility_dataset_missing",
          });
        }
      }

      if (factSets.length === 0) {
        const sampleReason =
          utilityDigestDiagnostics.find((d) => !d.usable)?.reason ?? null;
        const actorUnresolved = targetDigestFailures.some(
          (f) =>
            f.code === "TARGET_CHARACTER_DIGEST_MISSING" ||
            f.code === "TARGET_CHARACTER_DIGEST_AMBIGUOUS",
        );
        blocked.push({
          dimension: "UTILITY",
          reason: actorUnresolved
            ? "utility_actor_unresolved"
            : mapUtilityUnavailableReason(sampleReason),
        });
      } else {
        utility = computeUtilityV2(
          {
            manifest,
            factSets,
          },
          { modelConfig: utilityModelConfig },
        );
        if (utility.score == null) {
          blocked.push({
            dimension: "UTILITY",
            reason: mapUtilityUnavailableReason(
              utility.explanation?.notes?.join(",") ??
                utility.availabilityState,
            ),
          });
        }
        for (const row of characterDigests) {
          if (
            !utilityDigestDiagnostics.some(
              (d) => d.slotId === row.slotId && d.usable,
            )
          ) {
            continue;
          }
          lineage.push(
            buildDigestScoreLineage({
              digest: row.digest,
              digestArtifactId: row.digestArtifactId,
              scoreModelId: input.scoringModelId,
              scoreModelVersion: input.scoringModelVersion,
              dimension: "UTILITY",
            }),
          );
        }
      }
    } catch (err) {
      blocked.push({
        dimension: "UTILITY",
        reason: mapUtilityUnavailableReason(
          err instanceof DigestDimensionIncompleteError
            ? err.message
            : err instanceof Error
              ? err.message
              : null,
        ),
      });
    }

    try {
      const factSets = [];
      for (const row of characterDigests) {
        try {
          factSets.push(
            survivalFactDocumentFromDigest(row.digest, row.slotIndex),
          );
          survivalDigestDiagnostics.push({
            slotId: row.slotId,
            digestArtifactId: row.digestArtifactId,
            usable: true,
            reason: null,
          });
        } catch (err) {
          survivalDigestDiagnostics.push({
            slotId: row.slotId,
            digestArtifactId: row.digestArtifactId,
            usable: false,
            reason:
              err instanceof DigestDimensionIncompleteError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "survival_death_evidence_missing",
          });
        }
      }

      if (factSets.length === 0) {
        const sampleReason =
          survivalDigestDiagnostics.find((d) => !d.usable)?.reason ?? null;
        blocked.push({
          dimension: "SURVIVAL",
          reason: mapSurvivalUnavailableReason(sampleReason),
        });
      } else {
        survival = computeSurvivalV2(
          {
            manifest,
            factSets,
            scoreModelId: input.scoringModelId,
          },
          { modelConfig: survivalModelConfig },
        );
        if (survival.score == null) {
          blocked.push({
            dimension: "SURVIVAL",
            reason: mapSurvivalUnavailableReason(
              survival.explanation?.limitations?.join(",") ?? survival.state,
            ),
          });
        }
        for (const row of characterDigests) {
          if (
            !survivalDigestDiagnostics.some(
              (d) => d.slotId === row.slotId && d.usable,
            )
          ) {
            continue;
          }
          lineage.push(
            buildDigestScoreLineage({
              digest: row.digest,
              digestArtifactId: row.digestArtifactId,
              scoreModelId: input.scoringModelId,
              scoreModelVersion: input.scoringModelVersion,
              dimension: "SURVIVAL",
            }),
          );
        }
      }
    } catch (err) {
      blocked.push({
        dimension: "SURVIVAL",
        reason: mapSurvivalUnavailableReason(
          err instanceof DigestDimensionIncompleteError
            ? err.message
            : err instanceof Error
              ? err.message
              : null,
        ),
      });
    }
  } else if (characterDigests.length === 0) {
    const actorUnresolved = targetDigestFailures.length > 0;
    const sharedReason =
      cacheMisses.length > 0
        ? "provider_evidence_cache_miss"
        : fightFailures.length > 0
          ? "fight_processing_failed"
          : "zero_usable_digests";
    blocked.push({
      dimension: "PERFORMANCE",
      reason: "performance_parse_missing",
    });
    blocked.push({
      dimension: "UTILITY",
      reason: actorUnresolved
        ? "utility_actor_unresolved"
        : sharedReason === "zero_usable_digests"
          ? "utility_dataset_missing"
          : sharedReason,
    });
    blocked.push({
      dimension: "SURVIVAL",
      reason: "survival_death_evidence_missing",
    });
  }

  const publicationAllowed =
    !incomplete &&
    cacheMisses.length === 0 &&
    fightFailures.length === 0 &&
    blocked.length === 0 &&
    characterDigests.length === expectedSlotCount &&
    performance != null &&
    utility != null &&
    survival != null;

  return {
    manifest,
    expectedSlotCount,
    selectedSlotCount: manifest.selectedSlotCount,
    incomplete,
    incompleteSlotIds,
    uniqueSourceFights: uniqueFights,
    characterDigests,
    targetDigestFailures,
    allParticipantDigests,
    accounting: {
      providerCalls,
      packagesCreated,
      packagesReused,
      digestsCreated,
      digestsReused,
      fights: accountingFights,
    },
    cacheMisses,
    fightFailures,
    dimensions: {
      performance,
      utility,
      survival,
      performanceDigestDiagnostics,
      utilityDigestDiagnostics,
      survivalDigestDiagnostics,
      blocked,
      lineage,
    },
    publicationAllowed,
  };
}

/**
 * Provider-free replay: load existing manifest + packages, rebuild outdated
 * digests, recalculate dimensions. liveProviderPermission is forced FORBIDDEN.
 */
export async function replayScoringFromPersistedEvidence(
  input: Omit<RunOrchestrationInput, "liveProviderPermission" | "candidates"> & {
    candidates?: readonly EvidenceCandidateMetadataV2[];
    existingManifest: CharacterSeasonEvidenceManifestV2;
  },
): Promise<RunOrchestrationResult> {
  return orchestrateScoringRuns({
    ...input,
    candidates: input.candidates ?? [],
    liveProviderPermission: "FORBIDDEN",
    existingManifest: input.existingManifest,
  });
}

/** Deterministic fingerprint of dimension scores for replay assertions. */
export function fingerprintDimensionResults(
  result: Pick<RunOrchestrationResult, "dimensions">,
): string {
  const payload = {
    performance: result.dimensions.performance?.score ?? null,
    utility: result.dimensions.utility?.score ?? null,
    survival: result.dimensions.survival?.score ?? null,
    blocked: result.dimensions.blocked,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
