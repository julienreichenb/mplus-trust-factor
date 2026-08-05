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
  type WclRateLimitSnapshot,
} from "@mplus/provider-warcraftlogs";
import { isManifestCompatibleWithSeasonPool } from "../run-orchestration/canary-preflight.js";
import { rankingParseCompatibilityKey } from "../run-orchestration/ranking-hydrate.js";
import { ensureDungeon } from "../../../persistence/run-repository.js";
import { assertNotSentinelCharacterId } from "./canary-deps.js";
import type { CanaryCharacterResolution } from "./canary-deps.js";
import type { CanarySeasonResolution } from "./canary-season.js";
import { assertDiscoveryRateAdmission } from "./canary-discovery-gates.js";
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
  getRateLimitSnapshot: () => Promise<WclRateLimitSnapshot | null>;
  requireRateSnapshot?: boolean;
  now?: Date;
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

export async function runScoringV2CanaryDiscovery(
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
      reportsListed: 0,
      reportsHydrated: 0,
      fightsExamined: 0,
      candidateCountPerDungeon: {},
      eligibleCandidateCountPerDungeon: {},
      selectedRunsPerDungeon,
      selectedSlotCount: existing.document.selectedSlotCount,
      expectedSlotCount,
      missingSlots: [],
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
      eventPageRequestCount: 0,
      measuredWclPoints: 0,
      estimatedWclPoints: 0,
      rateLimitSnapshot: null,
      rateAdmission: "NOT_EVALUATED",
      rateAdmissionReasons: ["complete_manifest_reuse_skip_provider"],
      capabilityPackageAcquisitions: 0,
      capabilityPackagesCreated: 0,
      participantDigestsCreated: 0,
      scoreCalculations: 0,
      publicationEnabled: false,
      publicScorePointerMutated: false,
      reusedExistingManifest: true,
      providerCallsBeforeDiscovery: 0,
    };
    return { report, manifest: existing.document, effects };
  }

  const snapshot = await input.getRateLimitSnapshot();
  let rateAdmission: CanaryDiscoveryReport["rateAdmission"] = "ALLOW";
  let rateAdmissionReasons: string[] = [];
  try {
    const admitted = assertDiscoveryRateAdmission({
      snapshot,
      rateBudgetConfig: input.rateBudgetConfig,
      requireSnapshot: input.requireRateSnapshot !== false,
    });
    rateAdmission = admitted.admission;
    rateAdmissionReasons = admitted.reasons;
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      code: "CANARY_DISCOVERY_RATE_ADMISSION_REFUSED",
      providerCalls: 0,
    });
  }

  const discovered = await input.discover();
  if (discovered.capabilityEventPageRequestCount !== 0) {
    throw Object.assign(
      new Error(
        `discovery_forbidden_effect:capabilityEventPageRequestCount=${discovered.capabilityEventPageRequestCount}`,
      ),
      { code: "DISCOVERY_FORBIDDEN_EFFECT" },
    );
  }

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
    candidates: discovered.candidates,
    plannedAt: (input.now ?? new Date()).toISOString(),
  });

  const eligibleCandidateCountPerDungeon: Record<string, number> = {};
  for (const slot of plan.slots) {
    const slug = slot.dungeonSlug.toLowerCase();
    eligibleCandidateCountPerDungeon[slug] =
      (eligibleCandidateCountPerDungeon[slug] ?? 0) + slot.orderedCandidates.length;
  }

  const acquisitionResults = [];
  const seen = new Set<string>();
  for (const slot of plan.slots) {
    for (const c of slot.orderedCandidates) {
      const k = `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const meta = discovered.candidates.find(
        (cand) =>
          cand.discoveryIdentity.reportCode === c.discoveryIdentity.reportCode &&
          cand.discoveryIdentity.fightId === c.discoveryIdentity.fightId,
      );
      acquisitionResults.push({
        discoveryIdentity: { ...c.discoveryIdentity },
        acquisitionStatus: "ACQUIRED" as const,
        reportRevision: meta?.reportRevision ?? 1,
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
    }
  }

  const { manifest } = finalizeEvidenceManifestV2({
    plan,
    acquisitionResults,
    selectedAt: (input.now ?? new Date()).toISOString(),
  });

  const documentForPersist = {
    ...manifest,
    dungeonPoolHash,
    catalogVersion: season.catalogVersion,
  } as CharacterSeasonEvidenceManifestV2 & {
    dungeonPoolHash: string;
    catalogVersion: string;
  };

  const selectedRunsPerDungeon: Record<string, number> = {};
  const missingSlots: Array<{ slotId: string; reason: string }> = [];
  for (const slot of manifest.slots) {
    if (slot.state === "SELECTED") {
      const slug = slot.dungeonSlug.toLowerCase();
      selectedRunsPerDungeon[slug] = (selectedRunsPerDungeon[slug] ?? 0) + 1;
    } else {
      missingSlots.push({
        slotId: slot.slotId,
        reason: slot.fallbackReason
          ? `fallback:${slot.fallbackReason}`
          : `state:${slot.state}`,
      });
    }
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
  const rankingByFight = new Map(
    discovered.rankingEvidence.map((r) => [
      `${r.reportCode}:${r.fightId}:${r.reportRevision}`,
      r,
    ]),
  );
  for (const dbSlot of persistedSlots) {
    if (dbSlot.state !== "SELECTED" || dbSlot.reportCode == null || dbSlot.fightId == null) {
      continue;
    }
    const rev = dbSlot.reportRevision ?? 1;
    const row = rankingByFight.get(`${dbSlot.reportCode}:${dbSlot.fightId}:${rev}`);
    if (!row) continue;
    const outcome = await persistRankingEvidence({
      artifacts: input.artifacts,
      evidence: input.evidence,
      manifestSlotId: dbSlot.id,
      evidenceRow: row,
    });
    if (outcome === "created" || outcome === "reused") rankingPersisted += 1;
  }

  assertForbiddenEffectsZero(effects);
  const incomplete =
    documentForPersist.selectedSlotCount < expectedSlotCount || missingSlots.length > 0;

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
    reportsListed: discovered.reportsListed,
    reportsHydrated: discovered.reportsHydrated,
    fightsExamined: discovered.fightsExamined,
    candidateCountPerDungeon: countByDungeon(discovered.candidates),
    eligibleCandidateCountPerDungeon,
    selectedRunsPerDungeon,
    selectedSlotCount: documentForPersist.selectedSlotCount,
    expectedSlotCount,
    missingSlots,
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
    graphqlRequestCount: discovered.graphqlRequestCount,
    eventPageRequestCount: discovered.capabilityEventPageRequestCount,
    measuredWclPoints: discovered.measuredPoints,
    estimatedWclPoints: discovered.estimatedPoints,
    rateLimitSnapshot: snapshot,
    rateAdmission,
    rateAdmissionReasons,
    capabilityPackageAcquisitions: 0,
    capabilityPackagesCreated: 0,
    participantDigestsCreated: 0,
    scoreCalculations: 0,
    publicationEnabled: false,
    publicScorePointerMutated: false,
    reusedExistingManifest: !created && !incomplete,
    providerCallsBeforeDiscovery: 0,
  };

  return { report, manifest: documentForPersist, effects };
}
