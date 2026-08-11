/**
 * Discovery-only Scoring V2 canary runner.
 * Selects + freezes a V2 evidence manifest; never acquires capability packages.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import type { ArtifactRepository, EvidenceRepository } from "@mplus/database";
import {
  EVIDENCE_SELECTOR_VERSION,
  expectedEvidenceSlotCount,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceCandidateMetadataV2,
  type EvidenceRole,
  type EvidenceSelectionScope,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
} from "@mplus/scoring";
import {
  RANKING_PARSE_PROVIDER_CONTRACT,
  RANKING_PARSE_SCHEMA_VERSION,
  type RankingParseEvidenceV2,
  type RateBudgetConfig,
} from "@mplus/provider-warcraftlogs";
import { isManifestCompatibleWithSeasonPool } from "../run-orchestration/canary-preflight.js";
import { rankingParseCompatibilityKey } from "../run-orchestration/ranking-hydrate.js";
import { ensureDungeon } from "../../../persistence/run-repository.js";
import { assertNotSentinelCharacterId } from "./canary-deps.js";
import type { CanaryCharacterResolution } from "./canary-deps.js";
import type { CanarySeasonResolution } from "./canary-season.js";
import {
  assertDiscoveryAdmissionAllows,
  evaluateDiscoveryAdmissionAfterBootstrap,
  resolveBootstrapPointCost,
  type CanaryRateSnapshotBootstrapReport,
} from "./canary-rate-snapshot.js";
import {
  assertNoDuplicateSelectedIdentities,
  mergeDiscoveryCandidates,
  selectedSlotsAsCandidates,
} from "./canary-manifest-reconcile.js";
import { evidenceManifestAnalysisStatus } from "@mplus/scoring";
import {
  CANARY_DISCOVERY_REPORT_SCHEMA,
  type CanaryDiscoveryCandidateSource,
  type CanaryDiscoveryForbiddenEffects,
  type CanaryDiscoveryReport,
} from "./canary-discover-types.js";

export type {
  CanaryDiscoveryCandidateSource,
  CanaryDiscoveryForbiddenEffects,
  CanaryDiscoveryReport,
} from "./canary-discover-types.js";
export { CANARY_DISCOVERY_REPORT_SCHEMA } from "./canary-discover-types.js";

export interface RunCanaryDiscoveryInput {
  prisma: PrismaClient;
  artifacts: ArtifactRepository;
  evidence: EvidenceRepository;
  characterId: string;
  characterResolution: CanaryCharacterResolution;
  seasonResolution: CanarySeasonResolution;
  role: EvidenceRole;
  classSlug: string | null;
  specSlug: string | null;
  rateBudgetConfig: RateBudgetConfig;
  discover: () => Promise<CanaryDiscoveryCandidateSource>;
  /**
   * Resolve authoritative report.revision for a discovery identity when candidate
   * metadata lacks it (encounterRankings path). Never fabricates a default.
   */
  resolveReportRevision?: (input: {
    reportCode: string;
    fightId: number;
  }) => Promise<{ reportRevision: number; providerCalls: number } | null>;
  /**
   * Two-stage bootstrap: may perform at most one RateLimitData call when cache miss.
   * Must not call character/report discovery.
   */
  ensureRateLimitSnapshot: () => Promise<CanaryRateSnapshotBootstrapReport>;
  now?: Date;
}

function isResolvedReportRevision(
  value: number | null | undefined,
): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

function mapRoleForDb(role: EvidenceRole): "DPS" | "TANK" | "HEALER" {
  if (role === "TANK" || role === "HEALER" || role === "DPS") return role;
  return "DPS";
}

function manifestCompatibilityFingerprint(input: {
  seasonId: string;
  dungeonPoolHash: string;
  contentHash: string;
  catalogVersion: string;
}): string {
  return createHash("sha256")
    .update(
      [input.seasonId, input.dungeonPoolHash, input.catalogVersion, input.contentHash].join("|"),
      "utf8",
    )
    .digest("hex");
}

function countByDungeon(
  candidates: readonly EvidenceCandidateMetadataV2[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of candidates) {
    const slug = c.dungeonSlug.trim().toLowerCase();
    out[slug] = (out[slug] ?? 0) + 1;
  }
  return out;
}

function assertForbiddenEffectsZero(effects: CanaryDiscoveryForbiddenEffects): void {
  if (
    effects.capabilityPackageAcquisitions !== 0 ||
    effects.capabilityPackagesCreated !== 0 ||
    effects.participantDigestsCreated !== 0 ||
    effects.scoreCalculations !== 0 ||
    effects.publicScorePointerMutated !== false
  ) {
    throw Object.assign(new Error("discovery_forbidden_effect"), {
      code: "DISCOVERY_FORBIDDEN_EFFECT",
      effects,
    });
  }
}

/** Hard proof: capability acquire must throw if ever referenced. */
export function createDiscoveryForbiddenAcquireHook(): never {
  throw Object.assign(
    new Error(
      "DISCOVERY_FORBIDDEN_EFFECT: acquireCapabilityEvidencePackage is unreachable in discovery-only canary",
    ),
    { code: "DISCOVERY_CAPABILITY_ACQUIRE_UNREACHABLE" },
  );
}

async function loadCompatibleManifest(input: {
  prisma: PrismaClient;
  characterId: string;
  seasonId: string;
  expectedDungeonSlugs: readonly string[];
  dungeonPoolHash: string;
}): Promise<{ rowId: string; document: CharacterSeasonEvidenceManifestV2 } | null> {
  const row = await input.prisma.evidenceManifest.findFirst({
    where: { characterId: input.characterId, seasonId: input.seasonId },
    orderBy: { frozenAt: "desc" },
  });
  if (!row?.document || typeof row.document !== "object") return null;
  const doc = row.document as CharacterSeasonEvidenceManifestV2 & {
    dungeonPoolHash?: string;
  };
  if (!Array.isArray(doc.slots)) return null;
  if (!isManifestCompatibleWithSeasonPool(doc, input.expectedDungeonSlugs)) return null;
  if (doc.dungeonPoolHash != null && doc.dungeonPoolHash !== input.dungeonPoolHash) {
    return null;
  }
  return { rowId: row.id, document: doc };
}

function isCompleteManifest(
  doc: CharacterSeasonEvidenceManifestV2,
  expectedSlotCount: number,
): boolean {
  const selected = doc.slots.filter((s) => s.state === "SELECTED").length;
  return selected === expectedSlotCount && doc.selectedSlotCount === expectedSlotCount;
}

async function persistRankingEvidence(input: {
  artifacts: ArtifactRepository;
  evidence: EvidenceRepository;
  manifestSlotId: string;
  evidenceRow: RankingParseEvidenceV2;
}): Promise<"created" | "reused" | "skipped"> {
  const compatibilityKey = rankingParseCompatibilityKey(input.evidenceRow);
  const existing = await input.evidence.findDatasetByCompatibilityKey(compatibilityKey);
  if (existing && existing.state === "READY" && existing.artifactId) return "reused";

  const bytes = Buffer.from(JSON.stringify(input.evidenceRow), "utf8");
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const write = await input.artifacts.persist({
    provider: "WARCRAFT_LOGS",
    bytes,
    compression: "GZIP",
    artifactClass: "ranking_parse_evidence_v2",
    owner: { ownerType: "EvidenceDataset", ownerId: randomUUID() },
  });
  try {
    await input.evidence.createDataset({
      manifestSlotId: input.manifestSlotId,
      datasetKey: "ranking_parse",
      compatibilityKey,
      artifactId: write.artifactId,
      schemaVersion: RANKING_PARSE_SCHEMA_VERSION,
      providerContractVersion: RANKING_PARSE_PROVIDER_CONTRACT,
      state: "READY",
      eventCount: 0,
      pageCount: 0,
      truncated: false,
      pointsConsumed: null,
      costSource: "discovery_zone_rankings",
      payloadFingerprint: contentHash,
      fetchedAt: new Date(),
    });
    return "created";
  } catch {
    return "skipped";
  }
}

export async function runScoringCanaryDiscovery(
  input: RunCanaryDiscoveryInput,
): Promise<{
  report: CanaryDiscoveryReport;
  manifest: CharacterSeasonEvidenceManifestV2 | null;
  effects: CanaryDiscoveryForbiddenEffects;
}> {
  assertNotSentinelCharacterId(input.characterId);
  if (input.characterResolution.repositoryMode !== "PRODUCTION") {
    throw Object.assign(
      new Error(
        `operator_discovery_refuses_non_production_repositories: ${input.characterResolution.repositoryMode}`,
      ),
      { code: "CANARY_REPOSITORY_MODE_FORBIDDEN" },
    );
  }
  const season = input.seasonResolution;
  if (
    season.validationStatus !== "OK" ||
    !season.seasonId ||
    !season.seasonSlug ||
    season.activeDungeonSlugs.length === 0 ||
    !season.dungeonPoolHash
  ) {
    throw Object.assign(new Error("discovery_requires_validated_active_season_authority"), {
      code: "SEASON_CATALOG_MISMATCH",
    });
  }
  if (
    season.catalogSource !== "season_dungeon_bindings" &&
    season.catalogSource !== "synchronized_metadata"
  ) {
    throw Object.assign(
      new Error(`discovery_refuses_catalog_source:${season.catalogSource}`),
      { code: "CANARY_CATALOG_SOURCE_FORBIDDEN" },
    );
  }

  const effects: CanaryDiscoveryForbiddenEffects = {
    capabilityPackageAcquisitions: 0,
    capabilityPackagesCreated: 0,
    participantDigestsCreated: 0,
    scoreCalculations: 0,
    publicationEnabled: false,
    publicScorePointerMutated: false,
  };

  const seasonId = season.seasonId;
  const dungeonSlugs = [...season.activeDungeonSlugs];
  const expectedSlotCount = expectedEvidenceSlotCount(dungeonSlugs.length);
  const dungeonPoolHash = season.dungeonPoolHash;

  const existing = await loadCompatibleManifest({
    prisma: input.prisma,
    characterId: input.characterId,
    seasonId,
    expectedDungeonSlugs: dungeonSlugs,
    dungeonPoolHash,
  });

  if (existing && isCompleteManifest(existing.document, expectedSlotCount)) {
    assertForbiddenEffectsZero(effects);
    const selectedRunsPerDungeon: Record<string, number> = {};
    for (const slot of existing.document.slots) {
      if (slot.state !== "SELECTED") continue;
      const slug = slot.dungeonSlug.toLowerCase();
      selectedRunsPerDungeon[slug] = (selectedRunsPerDungeon[slug] ?? 0) + 1;
    }
    const report: CanaryDiscoveryReport = {
      schemaVersion: CANARY_DISCOVERY_REPORT_SCHEMA,
      repositoryMode: "PRODUCTION",
      characterId: input.characterId,
      characterResolutionSource: input.characterResolution.characterResolutionSource,
      seasonResolutionMode: season.resolutionMode,
      applicationSeasonId: seasonId,
      seasonSlug: season.seasonSlug,
      wclZoneId: season.configuredZoneId ?? 0,
      catalogVersion: season.catalogVersion,
      dungeonPoolHash,
      dungeonSlugs,
      fightsExamined: 0,
      discoveredCandidateCount: existing.document.selectedSlotCount,
      candidateCount: existing.document.selectedSlotCount,
      eligibleCandidateCount: existing.document.selectedSlotCount,
      uniqueEligibleCandidateCount: existing.document.selectedSlotCount,
      selectedSourceFightCount: existing.document.selectedSlotCount,
      rejectedCandidateCount: 0,
      candidateCountPerDungeon: {},
      eligibleCandidateCountPerDungeon: {},
      selectedRunsPerDungeon,
      selectedSlotCount: existing.document.selectedSlotCount,
      expectedSlotCount,
      missingSlots: [],
      counterDefinitions: {
        discoveredCandidateCount: "unique_discovered_candidates",
        uniqueEligibleCandidateCount: "unique_eligible_plan_identities",
        selectedSourceFightCount: "selected_distinct_source_fights",
        rejectedCandidateCount: "rejected_candidates",
        candidateCountPerDungeon: "unique_discovered_candidates_per_dungeon",
        eligibleCandidateCountPerDungeon: "unique_eligible_plan_identities_per_dungeon",
      },
      analysisStatus: "COMPLETE",
      supersedesManifestId: null,
      rankingEvidenceFound: 0,
      rankingEvidenceFetched: 0,
      rankingEvidencePersisted: 0,
      manifestId: existing.rowId,
      manifestStatus: "REUSED",
      manifestCompatibilityFingerprint: manifestCompatibilityFingerprint({
        seasonId,
        dungeonPoolHash,
        contentHash: existing.document.contentHash,
        catalogVersion: season.catalogVersion,
      }),
      graphqlRequestCount: 0,
      bootstrapProviderCalls: 0,
      eventPageRequestCount: 0,
      measuredWclPoints: 0,
      estimatedWclPoints: 0,
      rateLimitSnapshot: null,
      rateAdmission: "NOT_EVALUATED",
      rateAdmissionReasons: ["complete_manifest_reuse_skip_provider"],
      bootstrap: null,
      discoveryAdmission: null,
      forbiddenEffects: { ...effects },
      publicationEnabled: false,
      publicScorePointerMutated: false,
    };
    return { report, manifest: existing.document, effects };
  }

  const incompletePrior = existing && !isCompleteManifest(existing.document, expectedSlotCount)
    ? existing
    : null;

  const bootstrap = await input.ensureRateLimitSnapshot();
  if (!bootstrap.succeeded || !bootstrap.snapshot) {
    throw Object.assign(
      new Error("canary_discovery_rate_limit_snapshot_unavailable"),
      {
        code: "RATE_LIMIT_SNAPSHOT_UNAVAILABLE",
        bootstrap,
        providerCalls: bootstrap.providerCalls,
      },
    );
  }

  const bootstrapCostResolved = resolveBootstrapPointCost({
    providerCalls: bootstrap.providerCalls,
    measuredPoints: bootstrap.measuredPoints,
  });
  const bootstrapCost =
    bootstrapCostResolved.measuredPoints ??
    bootstrapCostResolved.estimatedPoints ??
    0;

  const discoveryAdmission = evaluateDiscoveryAdmissionAfterBootstrap({
    snapshot: bootstrap.snapshot,
    rateBudgetConfig: input.rateBudgetConfig,
    bootstrapCost,
  });
  try {
    assertDiscoveryAdmissionAllows(discoveryAdmission);
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      code: "CANARY_DISCOVERY_RATE_ADMISSION_REFUSED",
      bootstrap,
      discoveryAdmission,
      providerCalls: bootstrap.providerCalls,
    });
  }

  const rateAdmission: CanaryDiscoveryReport["rateAdmission"] =
    discoveryAdmission.action === "WARN"
      ? "WARN"
      : discoveryAdmission.action === "OK"
        ? "ALLOW"
        : discoveryAdmission.action;
  const rateAdmissionReasons = discoveryAdmission.reasons;

  const discovered = await input.discover();
  if (discovered.capabilityEventPageRequestCount !== 0) {
    throw Object.assign(
      new Error(
        `discovery_forbidden_effect:capabilityEventPageRequestCount=${discovered.capabilityEventPageRequestCount}`,
      ),
      { code: "DISCOVERY_FORBIDDEN_EFFECT" },
    );
  }

  const priorCandidates = incompletePrior
    ? selectedSlotsAsCandidates(incompletePrior.document)
    : [];
  const mergedCandidates = mergeDiscoveryCandidates({
    prior: priorCandidates,
    discovered: discovered.candidates,
  });

  const refreshContractHash = createHash("sha256")
    .update(`${input.characterId}|${seasonId}|${dungeonPoolHash}|discovery-only`)
    .digest("hex");

  const scope: EvidenceSelectionScope = {
    characterId: input.characterId,
    seasonId,
    seasonSlug: season.seasonSlug,
    specializationId: null,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    role: input.role,
    refreshContractHash,
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
    highKeyPolicyId: "canary-discovery-v1",
    activeDungeonSlugs: dungeonSlugs,
  };

  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope,
    candidates: mergedCandidates,
    plannedAt: (input.now ?? new Date()).toISOString(),
  });

  /**
   * eligibleCandidateCountPerDungeon = unique eligible identities per dungeon
   * from the plan (slot0 chain length). Must NOT sum across both slots — both
   * slots share the same ordered chain.
   */
  const eligibleCandidateCountPerDungeon: Record<string, number> = {};
  for (const d of plan.diagnostics.perDungeon) {
    eligibleCandidateCountPerDungeon[d.dungeonSlug.toLowerCase()] = d.eligibleCount;
  }

  const acquisitionResults = [];
  const seen = new Set<string>();
  let revisionResolveProviderCalls = 0;
  // Resolve revision lazily per slot until one ACQUIRED candidate — do not mass-fetch
  // revisions for every eligible encounterRankings row.
  for (const slot of plan.slots) {
    for (const c of slot.orderedCandidates) {
      const k = `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;
      if (seen.has(k)) {
        // Already resolved for an earlier slot; finalize skips duplicates.
        continue;
      }
      seen.add(k);
      const meta = mergedCandidates.find(
        (cand) =>
          cand.discoveryIdentity.reportCode === c.discoveryIdentity.reportCode &&
          cand.discoveryIdentity.fightId === c.discoveryIdentity.fightId,
      );
      let reportRevision = meta?.reportRevision ?? null;
      if (
        !isResolvedReportRevision(reportRevision) &&
        input.resolveReportRevision
      ) {
        const observed = await input.resolveReportRevision({
          reportCode: c.discoveryIdentity.reportCode,
          fightId: c.discoveryIdentity.fightId,
        });
        revisionResolveProviderCalls += observed?.providerCalls ?? 0;
        reportRevision = observed?.reportRevision ?? null;
      }
      if (!isResolvedReportRevision(reportRevision)) {
        acquisitionResults.push({
          discoveryIdentity: { ...c.discoveryIdentity },
          acquisitionStatus: "REJECTED" as const,
          reportRevision: null,
          rejectionReason: "REPORT_REVISION_UNRESOLVED" as const,
          rejectionDetail: `REPORT_REVISION_UNRESOLVED:${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`,
          datasetHashes: [] as Array<{
            dataset:
              | "RANKING_PARSE"
              | "MASTER_DATA"
              | "CASTS"
              | "HOSTILE_CASTS"
              | "INTERRUPTS"
              | "DEATHS"
              | "DAMAGE_TAKEN"
              | "BUFFS"
              | "DEBUFFS"
              | "DISPELS"
              | "HEALING"
              | "COMBATANT_INFO"
              | "DAMAGE_DONE";
            contentHash: string;
          }>,
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
      acquisitionResults.push({
        discoveryIdentity: { ...c.discoveryIdentity },
        acquisitionStatus: "ACQUIRED" as const,
        reportRevision,
        rejectionReason: null,
        rejectionDetail: null,
        datasetHashes: [] as Array<{
          dataset:
            | "RANKING_PARSE"
            | "MASTER_DATA"
            | "CASTS"
            | "HOSTILE_CASTS"
            | "INTERRUPTS"
            | "DEATHS"
            | "DAMAGE_TAKEN"
            | "BUFFS"
            | "DEBUFFS"
            | "DISPELS"
            | "HEALING"
            | "COMBATANT_INFO"
            | "DAMAGE_DONE";
          contentHash: string;
        }>,
        factSetHash: `discovery-${k}`,
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
      // Slot can finalize with this identity; further chain rows stay unresolved.
      break;
    }
  }

  const { manifest } = finalizeEvidenceManifestV2({
    plan,
    acquisitionResults,
    selectedAt: (input.now ?? new Date()).toISOString(),
  });
  assertNoDuplicateSelectedIdentities(manifest);

  const documentForPersist = {
    ...manifest,
    dungeonPoolHash,
    catalogVersion: season.catalogVersion,
    ...(incompletePrior
      ? { supersedesManifestId: incompletePrior.rowId }
      : {}),
  } as CharacterSeasonEvidenceManifestV2 & {
    dungeonPoolHash: string;
    catalogVersion: string;
    supersedesManifestId?: string;
  };

  const selectedRunsPerDungeon: Record<string, number> = {};
  const missingSlots: Array<{ slotId: string; reason: string }> = [];
  for (const slot of manifest.slots) {
    if (slot.state === "SELECTED") {
      const slug = slot.dungeonSlug.toLowerCase();
      selectedRunsPerDungeon[slug] = (selectedRunsPerDungeon[slug] ?? 0) + 1;
    }
  }
  for (const slot of manifest.slots) {
    if (slot.state === "SELECTED") continue;
    const slug = slot.dungeonSlug.toLowerCase();
    const selectedForDungeon = selectedRunsPerDungeon[slug] ?? 0;
    const eligibleForDungeon = eligibleCandidateCountPerDungeon[slug] ?? 0;
    let reason: string;
    if (
      slot.state === "MISSING_NO_CANDIDATE" &&
      selectedForDungeon === 1 &&
      eligibleForDungeon <= 1
    ) {
      reason = "INSUFFICIENT_CHARACTER_HISTORY:only_one_distinct_run_for_dungeon";
    } else if (slot.fallbackReason) {
      reason = `fallback:${slot.fallbackReason}`;
    } else {
      reason = `state:${slot.state}`;
    }
    missingSlots.push({ slotId: slot.slotId, reason });
  }

  for (const slug of dungeonSlugs) {
    await ensureDungeon(input.prisma, slug);
  }
  const dungeonRows = await input.prisma.dungeon.findMany({
    where: { slug: { in: dungeonSlugs } },
    select: { id: true, slug: true },
  });
  const dungeonIdBySlug = new Map(dungeonRows.map((d) => [d.slug, d.id]));

  const {
    manifest: persistedManifest,
    slots: persistedSlots,
    created,
  } = await input.evidence.createFrozenManifest({
    characterId: input.characterId,
    seasonId,
    specializationId: null,
    role: mapRoleForDb(input.role),
    refreshContractHash: documentForPersist.refreshContractHash,
    selectorVersion: documentForPersist.selectorVersion,
    highKeyPolicyId: documentForPersist.highKeyPolicyId,
    evidenceCutoffAt: new Date(documentForPersist.evidenceCutoffAt),
    expectedSlotCount: documentForPersist.expectedSlotCount,
    selectedSlotCount: documentForPersist.selectedSlotCount,
    coverageState: documentForPersist.coverage.state,
    schemaVersion: documentForPersist.schemaVersion,
    contentHash: documentForPersist.contentHash,
    document: documentForPersist as unknown as object,
    frozenAt: new Date(documentForPersist.selectedAt),
    slots: documentForPersist.slots.map((slot) => ({
      dungeonId: dungeonIdBySlug.get(slot.dungeonSlug)!,
      slotIndex: slot.slotIndex,
      reportCode: slot.identity?.reportCode ?? null,
      fightId: slot.identity?.fightId ?? null,
      reportRevision: slot.identity?.reportRevision ?? null,
      keyLevel: slot.keyLevel,
      candidateRank: slot.selectedRank,
      state: slot.state,
      selectionReason:
        slot.state === "SELECTED"
          ? slot.fallbackReason
            ? "SELECTED_WITH_FALLBACK"
            : "SELECTED"
          : slot.state,
      dimensionValidity: slot.dimensionValidity ?? {},
      invalidReasons: slot.fallbackReason ? [`fallbackReason:${slot.fallbackReason}`] : [],
      providerDataAsOf: null,
    })),
  });

  let rankingPersisted = 0;
  // Match by fight identity only — encounterRankings often lack revision until resolve.
  const rankingByFight = new Map(
    discovered.rankingEvidence.map((r) => [`${r.reportCode}:${r.fightId}`, r]),
  );
  for (const dbSlot of persistedSlots) {
    if (dbSlot.state !== "SELECTED" || dbSlot.reportCode == null || dbSlot.fightId == null) {
      continue;
    }
    const rev = dbSlot.reportRevision;
    if (rev == null) continue;
    const row = rankingByFight.get(`${dbSlot.reportCode}:${dbSlot.fightId}`);
    if (!row) continue;
    const outcome = await persistRankingEvidence({
      artifacts: input.artifacts,
      evidence: input.evidence,
      manifestSlotId: dbSlot.id,
      evidenceRow: {
        ...row,
        reportRevision: rev,
        // EncounterRankings are character-scoped — never party-wide.
        characterId: input.characterId,
      },
    });
    if (outcome === "created" || outcome === "reused") rankingPersisted += 1;
  }

  assertForbiddenEffectsZero(effects);
  const incomplete =
    documentForPersist.selectedSlotCount < expectedSlotCount || missingSlots.length > 0;
  const uniqueEligibleCandidateCount = Object.values(
    eligibleCandidateCountPerDungeon,
  ).reduce((a, b) => a + b, 0);
  const analysisStatus = evidenceManifestAnalysisStatus({
    selectedSlotCount: documentForPersist.selectedSlotCount,
    targetRunCount: expectedSlotCount,
  });
  const candidateCountPerDungeon = countByDungeon(mergedCandidates);

  const report: CanaryDiscoveryReport = {
    schemaVersion: CANARY_DISCOVERY_REPORT_SCHEMA,
    repositoryMode: "PRODUCTION",
    characterId: input.characterId,
    characterResolutionSource: input.characterResolution.characterResolutionSource,
    seasonResolutionMode: season.resolutionMode,
    applicationSeasonId: seasonId,
    seasonSlug: season.seasonSlug,
    wclZoneId: season.configuredZoneId ?? 0,
    catalogVersion: season.catalogVersion,
    dungeonPoolHash,
    dungeonSlugs,
    fightsExamined: discovered.fightsExamined,
    candidateNormalization: discovered.candidateNormalization,
    discoveredCandidateCount: mergedCandidates.length,
    candidateCount: mergedCandidates.length,
    eligibleCandidateCount: uniqueEligibleCandidateCount,
    uniqueEligibleCandidateCount,
    selectedSourceFightCount: documentForPersist.selectedSlotCount,
    rejectedCandidateCount: documentForPersist.rejectedCandidates?.length ?? 0,
    candidateCountPerDungeon,
    eligibleCandidateCountPerDungeon,
    selectedRunsPerDungeon,
    selectedSlotCount: documentForPersist.selectedSlotCount,
    expectedSlotCount,
    missingSlots,
    counterDefinitions: {
      discoveredCandidateCount: "unique_discovered_candidates",
      uniqueEligibleCandidateCount: "unique_eligible_plan_identities",
      selectedSourceFightCount: "selected_distinct_source_fights",
      rejectedCandidateCount: "rejected_candidates",
      candidateCountPerDungeon: "unique_discovered_candidates_per_dungeon",
      eligibleCandidateCountPerDungeon: "unique_eligible_plan_identities_per_dungeon",
    },
    analysisStatus,
    supersedesManifestId: incompletePrior?.rowId ?? null,
    rankingEvidenceFound: discovered.rankingEvidence.length,
    rankingEvidenceFetched: discovered.rankingEvidence.length,
    rankingEvidencePersisted: rankingPersisted,
    manifestId: persistedManifest.id,
    manifestStatus: incomplete ? "INCOMPLETE" : created ? "CREATED" : "REUSED",
    manifestCompatibilityFingerprint: manifestCompatibilityFingerprint({
      seasonId,
      dungeonPoolHash,
      contentHash: documentForPersist.contentHash,
      catalogVersion: season.catalogVersion,
    }),
    graphqlRequestCount:
      discovered.graphqlRequestCount + revisionResolveProviderCalls,
    bootstrapProviderCalls: bootstrap.providerCalls,
    eventPageRequestCount: discovered.capabilityEventPageRequestCount,
    measuredWclPoints:
      discovered.measuredPoints != null || bootstrap.measuredPoints != null
        ? (discovered.measuredPoints ?? 0) + (bootstrap.measuredPoints ?? 0)
        : null,
    estimatedWclPoints:
      (discovered.estimatedPoints ?? 0) +
      (bootstrap.estimatedPoints ?? bootstrapCost),
    rateLimitSnapshot: bootstrap.snapshot,
    rateAdmission,
    rateAdmissionReasons,
    bootstrap,
    discoveryAdmission,
    forbiddenEffects: { ...effects },
    publicationEnabled: false,
    publicScorePointerMutated: false,
  };

  return { report, manifest: documentForPersist, effects };
}
