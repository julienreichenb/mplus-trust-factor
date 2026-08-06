/**
 * Provider-free Scoring V2 canary preflight.
 * Zero WCL calls. Reports package/digest/ranking cache and readiness.
 *
 * Operator path must pass a real persisted manifest or null (MANIFEST_NOT_FOUND).
 * Synthetic manifests from empty candidates are test-only.
 */
import {
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  expectedEvidenceSlotCount,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceCandidateMetadataV2,
  type EvidenceSelectionScope,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
} from "@mplus/scoring";
import {
  uniqueSourceFightsFromManifest,
  sourceFightKey,
  type RunOrchestrationPorts,
  type SourceFightIdentity,
} from "./orchestrator.js";
import {
  buildCanaryCostProjection,
  type CanaryCostProjection,
} from "./cost-admission.js";
import type { RateBudgetConfig } from "@mplus/provider-warcraftlogs";
import type { WclRateLimitSnapshot } from "@mplus/provider-warcraftlogs";
import type { CanaryCharacterResolution, CanaryRepositoryMode } from "../canary/canary-deps.js";
import type { CanarySeasonResolution } from "../canary/canary-season.js";
import {
  containsObsoleteDungeonSlug,
  normalizeCanaryDungeonSlug,
} from "../canary/canary-catalog.js";
import {
  computeScoringConfidenceV1,
  evidenceManifestAnalysisStatus,
} from "@mplus/scoring";

export type CacheStatus = "HIT" | "MISS" | "ABSENT" | "NOT_EVALUATED";

export type CanaryManifestStatus =
  | "FOUND"
  | "MANIFEST_NOT_FOUND"
  | "STALE_POOL_REJECTED"
  | "SYNTHETIC_TEST_ONLY";

export interface CanaryPreflightSafetyChecks {
  providerFree: true;
  publicationDisabled: true;
  publicPointerUntouched: true;
}

export interface CanarySlotPreflight {
  slotId: string;
  dungeonSlug: string;
  slotIndex: 0 | 1;
  state: string;
  sourceFight: SourceFightIdentity | null;
  packageCache: CacheStatus;
  digestCache: CacheStatus;
  rankingParse: CacheStatus;
  performanceReady: boolean;
  utilityReady: boolean;
  survivalReady: boolean;
  wouldRequireWcl: boolean | null;
  wouldRebuildDigestWithoutWcl: boolean;
  rankingMissing: boolean | null;
}

/** Exact explanation when cost.rateLimit.admission is DEFER (provider-free). */
export interface CostAdmissionDeferExplanation {
  snapshotSource: "PERSISTED" | "ABSENT" | "INLINE";
  snapshotAgeMs: number | null;
  ttlSeconds: number | null;
  projectedPoints: number | null;
  /** Threshold or gate that caused DEFER (not utilization % when snapshot absent). */
  thresholdResponsible: string;
  reasons: string[];
}

export function explainCostAdmissionDefer(input: {
  cost: CanaryCostProjection;
  snapshotSource?: CostAdmissionDeferExplanation["snapshotSource"];
  snapshotAgeMs?: number | null;
  ttlSeconds?: number | null;
}): CostAdmissionDeferExplanation | null {
  if (input.cost.rateLimit.admission !== "DEFER") return null;
  const reasons = input.cost.rateLimit.reasons;
  let thresholdResponsible = reasons[0] ?? "unknown";
  if (reasons.includes("no_snapshot_blocks_cold_live")) {
    thresholdResponsible = "no_snapshot_blocks_cold_live";
  } else if (reasons.includes("budget_reserve_floor")) {
    thresholdResponsible = "budget_reserve_floor";
  } else if (reasons.some((r) => r.startsWith("rate_budget_"))) {
    thresholdResponsible =
      reasons.find((r) => r.startsWith("rate_budget_")) ?? thresholdResponsible;
  }
  const snap = input.cost.rateLimit.snapshot;
  return {
    snapshotSource:
      input.snapshotSource ??
      (snap ? "INLINE" : "ABSENT"),
    snapshotAgeMs:
      input.snapshotAgeMs !== undefined
        ? input.snapshotAgeMs
        : snap?.fetchedAt
          ? Math.max(0, Date.now() - Date.parse(snap.fetchedAt))
          : null,
    ttlSeconds: input.ttlSeconds ?? null,
    projectedPoints: input.cost.estimatedPointsTotal,
    thresholdResponsible,
    reasons: [...reasons],
  };
}

export interface CanaryPreflightReport {
  schemaVersion: "scoring-v2-canary-preflight-v1";
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  zoneId: number;
  seasonId: string;
  providerCalls: 0;
  repositoryMode: CanaryRepositoryMode;
  characterResolutionSource: CanaryCharacterResolution["characterResolutionSource"] | "unknown";
  characterCanonicalIdentity: CanaryCharacterResolution["characterCanonicalIdentity"] | null;
  seasonResolution: CanarySeasonResolution | null;
  manifestStatus: CanaryManifestStatus;
  manifestComplete: boolean;
  expectedSlotCount: number;
  selectedSlotCount: number;
  uniqueFightCount: number;
  slots: CanarySlotPreflight[];
  /** null when MANIFEST_NOT_FOUND — not yet evaluable. */
  fightsRequiringWcl: string[] | null;
  digestsRebuildableWithoutWcl: string[];
  rankingFactsMissing: string[];
  cost: CanaryCostProjection;
  /** Present when admission is DEFER — exact gate, not a utilization threshold guess. */
  costAdmissionDefer: CostAdmissionDeferExplanation | null;
  /** EMPTY / PARTIAL / COMPLETE — analysis eligibility separate from publication. */
  analysisStatus: "EMPTY" | "PARTIAL" | "COMPLETE";
  /** Target evidence volume (dungeons × 2). */
  targetRunCount: number;
  representedDungeonCount: number;
  projectedConfidence: {
    policyVersion: "scoring-confidence-v1";
    confidenceScore: number;
    confidenceBand: "HIGH" | "MEDIUM" | "LOW" | "NONE";
    runCoverage: number;
    dungeonCoverage: number;
    usableRunCount: number;
    missingRunCount: number;
    missingDungeons: string[];
  };
  /** Warnings that do not block capability acquisition / dimension calculation. */
  warnings: string[];
  publicationEligible: false;
  publicationEnabled: false;
  publicScorePointerMutated: false;
  safetyChecks: CanaryPreflightSafetyChecks;
  blockers: string[];
}

export function manifestDungeonSlugs(
  manifest: CharacterSeasonEvidenceManifestV2,
): string[] {
  return [
    ...new Set(manifest.slots.map((s) => normalizeCanaryDungeonSlug(s.dungeonSlug))),
  ].sort();
}

export function isManifestCompatibleWithSeasonPool(
  manifest: CharacterSeasonEvidenceManifestV2,
  expectedSlugs: readonly string[],
): boolean {
  const actual = manifestDungeonSlugs(manifest);
  if (expectedSlugs.length === 0) return false;
  if (actual.length === 0) return false;
  if (containsObsoleteDungeonSlug(actual).length > 0) return false;
  const expected = new Set(expectedSlugs.map(normalizeCanaryDungeonSlug));
  // Stale pools (wrong season) must not be reused; subset of expected is OK.
  return actual.every((s) => expected.has(s));
}

function expectedAbsentSlots(activeDungeonSlugs: readonly string[]): CanarySlotPreflight[] {
  const slots: CanarySlotPreflight[] = [];
  for (const dungeonSlug of activeDungeonSlugs) {
    for (const slotIndex of [0, 1] as const) {
      slots.push({
        slotId: `${dungeonSlug}:${slotIndex}`,
        dungeonSlug,
        slotIndex,
        state: "ABSENT",
        sourceFight: null,
        packageCache: "NOT_EVALUATED",
        digestCache: "NOT_EVALUATED",
        rankingParse: "NOT_EVALUATED",
        performanceReady: false,
        utilityReady: false,
        survivalReady: false,
        wouldRequireWcl: null,
        wouldRebuildDigestWithoutWcl: false,
        rankingMissing: null,
      });
    }
  }
  return slots;
}

export async function runScoringV2CanaryPreflight(input: {
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  zoneId: number;
  seasonId: string;
  scoringModelId: string;
  scope: EvidenceSelectionScope;
  candidates: readonly EvidenceCandidateMetadataV2[];
  ports: RunOrchestrationPorts;
  existingManifest?: CharacterSeasonEvidenceManifestV2 | null;
  /**
   * When true and no existingManifest, build a test-only synthetic manifest from
   * candidates. Operator path must leave this false.
   */
  allowSyntheticManifest?: boolean;
  repositoryMode?: CanaryRepositoryMode;
  characterResolution?: CanaryCharacterResolution | null;
  seasonResolution?: CanarySeasonResolution | null;
  rateBudgetConfig: RateBudgetConfig;
  rateLimitSnapshot?: WclRateLimitSnapshot | null;
  rateLimitSnapshotIsProviderCall?: boolean;
}): Promise<CanaryPreflightReport> {
  const repositoryMode = input.repositoryMode ?? "MEMORY";
  const expectedSlugs = input.scope.activeDungeonSlugs.map(normalizeCanaryDungeonSlug);
  const expectedSlotCount = expectedEvidenceSlotCount(expectedSlugs.length);

  let manifest: CharacterSeasonEvidenceManifestV2 | null =
    input.existingManifest ?? null;
  let manifestStatus: CanaryManifestStatus = manifest ? "FOUND" : "MANIFEST_NOT_FOUND";

  if (
    manifest &&
    expectedSlugs.length > 0 &&
    !isManifestCompatibleWithSeasonPool(manifest, expectedSlugs)
  ) {
    manifestStatus = "STALE_POOL_REJECTED";
    manifest = null;
  }

  if (!manifest && input.allowSyntheticManifest) {
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope: input.scope,
      candidates: input.candidates,
      plannedAt: new Date().toISOString(),
    });
    const seen = new Set<string>();
    const acquisitionResults = [];
    for (const slot of plan.slots) {
      for (const c of slot.orderedCandidates) {
        const k = `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const meta = input.candidates.find(
          (cand) =>
            cand.discoveryIdentity.reportCode === c.discoveryIdentity.reportCode &&
            cand.discoveryIdentity.fightId === c.discoveryIdentity.fightId,
        );
        const reportRevision = meta?.reportRevision;
        if (
          reportRevision == null ||
          !Number.isFinite(reportRevision) ||
          reportRevision < 0
        ) {
          throw Object.assign(
            new Error(
              `REPORT_REVISION_UNRESOLVED:${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`,
            ),
            { code: "REPORT_REVISION_UNRESOLVED" },
          );
        }
        acquisitionResults.push({
          discoveryIdentity: { ...c.discoveryIdentity },
          acquisitionStatus: "ACQUIRED" as const,
          reportRevision,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes: [],
          factSetHash: `preflight-${k}`,
          dimensionValidity: {
            performance: "VALID" as const,
            survival: "VALID" as const,
            utility: "VALID" as const,
            reasons: [] as string[],
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
    manifest = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults,
      selectedAt: new Date().toISOString(),
    }).manifest;
    manifestStatus = "SYNTHETIC_TEST_ONLY";
  }

  const slots: CanarySlotPreflight[] = [];
  const fightsRequiringWcl: string[] = [];
  const digestsRebuildableWithoutWcl: string[] = [];
  const rankingFactsMissing: string[] = [];
  const costFights: Array<{
    sourceFightKey: string;
    packageCacheHit: boolean;
    historicalMeasuredPoints?: number | null;
  }> = [];

  if (!manifest) {
    slots.push(...expectedAbsentSlots(expectedSlugs));
    const cost = buildCanaryCostProjection({
      fights: costFights,
      rateLimitSnapshot: input.rateLimitSnapshot ?? null,
      rateLimitSnapshotIsProviderCall: input.rateLimitSnapshotIsProviderCall,
      rateBudgetConfig: input.rateBudgetConfig,
    });
    const blockers = [
      manifestStatus === "STALE_POOL_REJECTED"
        ? "stale_manifest_pool_rejected"
        : "MANIFEST_NOT_FOUND",
    ];
    return {
      schemaVersion: "scoring-v2-canary-preflight-v1",
      characterId: input.characterId,
      characterName: input.characterName,
      region: input.region,
      realm: input.realm,
      zoneId: input.zoneId,
      seasonId: input.seasonId,
      providerCalls: 0,
      repositoryMode,
      characterResolutionSource:
        input.characterResolution?.characterResolutionSource ?? "unknown",
      characterCanonicalIdentity:
        input.characterResolution?.characterCanonicalIdentity ?? null,
      seasonResolution: input.seasonResolution ?? null,
      manifestStatus,
      manifestComplete: false,
      expectedSlotCount,
      selectedSlotCount: 0,
      uniqueFightCount: 0,
      slots,
      fightsRequiringWcl: null,
      digestsRebuildableWithoutWcl: [],
      rankingFactsMissing: [],
      cost,
      costAdmissionDefer: explainCostAdmissionDefer({ cost }),
      analysisStatus: "EMPTY",
      targetRunCount: expectedSlotCount,
      representedDungeonCount: 0,
      projectedConfidence: {
        policyVersion: "scoring-confidence-v1",
        confidenceScore: 0,
        confidenceBand: "NONE",
        runCoverage: 0,
        dungeonCoverage: 0,
        usableRunCount: 0,
        missingRunCount: expectedSlotCount,
        missingDungeons: [...expectedSlugs],
      },
      warnings: [],
      publicationEligible: false,
      publicationEnabled: false,
      publicScorePointerMutated: false,
      safetyChecks: {
        providerFree: true,
        publicationDisabled: true,
        publicPointerUntouched: true,
      },
      blockers,
    };
  }

  const uniqueFights = uniqueSourceFightsFromManifest(manifest);
  const packageByFight = new Map<
    string,
    Awaited<ReturnType<RunOrchestrationPorts["findCompatibleCapabilityPackage"]>>
  >();

  for (const fight of uniqueFights) {
    const hit = await input.ports.findCompatibleCapabilityPackage({
      sourceFight: fight,
    });
    packageByFight.set(sourceFightKey(fight), hit);
    costFights.push({
      sourceFightKey: sourceFightKey(fight),
      packageCacheHit: hit != null,
    });
  }

  for (const slot of manifest.slots) {
    const sourceFight = slot.identity
      ? {
          reportCode: slot.identity.reportCode,
          fightId: slot.identity.fightId,
          reportRevision: slot.identity.reportRevision,
        }
      : null;
    const fightKey = sourceFight ? sourceFightKey(sourceFight) : null;
    const pkg = fightKey ? packageByFight.get(fightKey) ?? null : null;

    let digestCache: CacheStatus = "ABSENT";
    let rankingParse: CacheStatus = "ABSENT";
    let wouldRebuildDigestWithoutWcl = false;
    let rankingMissing = true;
    let performanceReady = false;
    let utilityReady = false;
    let survivalReady = false;

    if (sourceFight && pkg) {
      const actorId = slot.actorId ?? 1;
      const existingDigest = await input.ports.findCompatibleDigest({
        reportCode: sourceFight.reportCode,
        fightId: sourceFight.fightId,
        reportRevision: sourceFight.reportRevision,
        participantActorId: actorId,
        digestSchemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
        extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
        capabilityPackageContentHash: pkg.contentHash,
        catalogVersion: pkg.package.catalogVersion,
      });
      digestCache = existingDigest ? "HIT" : "MISS";
      if (!existingDigest) {
        wouldRebuildDigestWithoutWcl = true;
        digestsRebuildableWithoutWcl.push(`${fightKey}:actor:${actorId}`);
      } else {
        performanceReady =
          existingDigest.digest.performance.completeness === "COMPLETE";
        utilityReady =
          existingDigest.digest.utility.completeness !== "UNAVAILABLE";
        survivalReady =
          existingDigest.digest.survival.completeness !== "UNAVAILABLE";
        rankingMissing =
          existingDigest.digest.performance.rankingProvenance?.source !==
            "PERSISTED_RANKING_PARSE" ||
          existingDigest.digest.performance.completeness === "UNAVAILABLE";
        rankingParse = rankingMissing ? "ABSENT" : "HIT";
      }

      if (!existingDigest || rankingMissing) {
        const ranking = await input.ports.resolveRankingParseForParticipant({
          sourceFight,
          participantActorId: actorId,
          dungeonSlug: slot.dungeonSlug,
          keyLevel: slot.keyLevel,
        });
        if (
          ranking &&
          ranking.parseSemantic !== "UNAVAILABLE" &&
          ranking.parsePercentile != null
        ) {
          rankingParse = "HIT";
          rankingMissing = false;
          performanceReady = true;
        } else {
          rankingParse = "ABSENT";
          rankingMissing = true;
          // Cold-cache miss: ranking is required to materialize a digest without WCL.
          // When a digest already exists, record slot-level rankingMissing but do not
          // treat it as a provider-free preflight cache gap (digest is reusable).
          if (!existingDigest) {
            performanceReady = false;
            rankingFactsMissing.push(`${fightKey}:actor:${actorId}`);
          }
        }
      }

      if (!existingDigest) {
        utilityReady = pkg.package.complete === true;
        survivalReady = pkg.package.complete === true;
      }
    }

    const wouldRequireWcl =
      slot.state === "SELECTED" && sourceFight != null && pkg == null;
    if (wouldRequireWcl && fightKey) {
      fightsRequiringWcl.push(fightKey);
    }

    slots.push({
      slotId: slot.slotId,
      dungeonSlug: slot.dungeonSlug,
      slotIndex: slot.slotIndex,
      state: slot.state,
      sourceFight,
      packageCache: pkg ? "HIT" : sourceFight ? "MISS" : "ABSENT",
      digestCache,
      rankingParse,
      performanceReady,
      utilityReady,
      survivalReady,
      wouldRequireWcl,
      wouldRebuildDigestWithoutWcl,
      rankingMissing,
    });
  }

  const cost = buildCanaryCostProjection({
    fights: costFights,
    rateLimitSnapshot: input.rateLimitSnapshot ?? null,
    rateLimitSnapshotIsProviderCall: input.rateLimitSnapshotIsProviderCall,
    rateBudgetConfig: input.rateBudgetConfig,
  });

  const incomplete =
    manifest.selectedSlotCount < expectedSlotCount ||
    manifest.slots.some((s) => s.state !== "SELECTED");

  const selectedSlots = manifest.slots.filter((s) => s.state === "SELECTED");
  const represented = new Set(selectedSlots.map((s) => s.dungeonSlug.toLowerCase()));
  const missingDungeons = expectedSlugs.filter((s) => !represented.has(s.toLowerCase()));
  const analysisStatus = evidenceManifestAnalysisStatus({
    selectedSlotCount: selectedSlots.length,
    targetRunCount: expectedSlotCount,
  });
  const projectedConfidence = computeScoringConfidenceV1({
    usableRunCount: selectedSlots.length,
    targetRunCount: expectedSlotCount,
    representedDungeonCount: represented.size,
    activeDungeonCount: expectedSlugs.length,
    missingDungeons,
  });

  const warnings: string[] = [];
  const blockers: string[] = [];
  if (analysisStatus === "EMPTY") {
    blockers.push("manifest_empty");
  } else if (analysisStatus === "PARTIAL" || incomplete) {
    warnings.push("PARTIAL_EVIDENCE_SET");
  }
  if (fightsRequiringWcl.length > 0) {
    blockers.push(`wcl_required_for_${fightsRequiringWcl.length}_fights`);
  }
  if (rankingFactsMissing.length > 0) {
    blockers.push(`ranking_parse_missing_${rankingFactsMissing.length}`);
  }
  if (cost.rateLimit.admission === "STOP" || cost.rateLimit.admission === "DEFER") {
    if (fightsRequiringWcl.length > 0) {
      blockers.push(`cost_admission_${cost.rateLimit.admission}`);
    }
  }

  return {
    schemaVersion: "scoring-v2-canary-preflight-v1",
    characterId: input.characterId,
    characterName: input.characterName,
    region: input.region,
    realm: input.realm,
    zoneId: input.zoneId,
    seasonId: input.seasonId,
    providerCalls: 0,
    repositoryMode,
    characterResolutionSource:
      input.characterResolution?.characterResolutionSource ?? "unknown",
    characterCanonicalIdentity:
      input.characterResolution?.characterCanonicalIdentity ?? null,
    seasonResolution: input.seasonResolution ?? null,
    manifestStatus,
    manifestComplete: !incomplete,
    expectedSlotCount,
    selectedSlotCount: manifest.selectedSlotCount,
    uniqueFightCount: uniqueFights.length,
    slots,
    fightsRequiringWcl: [...new Set(fightsRequiringWcl)],
    digestsRebuildableWithoutWcl,
    rankingFactsMissing,
    cost,
    costAdmissionDefer: explainCostAdmissionDefer({ cost }),
    analysisStatus,
    targetRunCount: expectedSlotCount,
    representedDungeonCount: represented.size,
    projectedConfidence: {
      policyVersion: "scoring-confidence-v1",
      confidenceScore: projectedConfidence.confidenceScore,
      confidenceBand: projectedConfidence.confidenceBand,
      runCoverage: projectedConfidence.runCoverage,
      dungeonCoverage: projectedConfidence.dungeonCoverage,
      usableRunCount: projectedConfidence.usableRunCount,
      missingRunCount: projectedConfidence.missingRunCount,
      missingDungeons: projectedConfidence.missingDungeons,
    },
    warnings,
    publicationEligible: false,
    publicationEnabled: false,
    publicScorePointerMutated: false,
    safetyChecks: {
      providerFree: true,
      publicationDisabled: true,
      publicPointerUntouched: true,
    },
    blockers,
  };
}
