/**
 * Guarded single-fight capability package repair.
 * Supersedes one incorrect package for a frozen manifest slot.
 * Never runs discovery. Never publishes. Never reacquires a cohort.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import {
  assertCapabilityEvidencePackageV1,
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
} from "@mplus/contracts";
import { buildParticipantScoringDigestsFromPackage } from "@mplus/provider-warcraftlogs";
import type { WorkerContainer } from "../../../container.js";
import { assertPublicationBlocked } from "../acquisition.js";
import {
  assertOperatorRepositoryMode,
  assertNotSentinelCharacterId,
  type CanaryCharacterResolution,
} from "./canary-deps.js";
import { loadCompatibleFrozenManifest } from "./canary-live.js";
import type { CanarySeasonResolution } from "./canary-season.js";
import {
  evaluateLiveCapabilityPermission,
  type LiveCapabilityAcquireResult,
} from "../run-orchestration/live-capability-adapter.js";
import {
  diagnosePackageRosterCompatibility,
  isPackageRosterIncompatible,
} from "../run-orchestration/package-roster-diagnosis.js";
import {
  resolveTargetActorIdFromRoster,
  selectTargetCharacterDigest,
  type StableCharacterIdentity,
} from "../run-orchestration/target-character-identity.js";
import { absentRankingParseFact } from "../run-orchestration/ranking-hydrate.js";
import { persistParticipantDigestWithRowOwner } from "../run-orchestration/persist-digest-artifact.js";
import type {
  OrchestrationParticipant,
  SourceFightIdentity,
} from "../run-orchestration/orchestrator.js";

export const CANARY_REPAIR_PACKAGE_SCHEMA =
  "scoring-v2-canary-repair-package-v1" as const;

export type TargetedRepairAcquire = (input: {
  sourceFight: SourceFightIdentity;
  dungeonSlug: string | null;
  keyLevel: number | null;
  participants: OrchestrationParticipant[];
  supersedesCompatibilityKey: string;
}) => Promise<LiveCapabilityAcquireResult>;

export interface CanaryRepairPackageReport {
  schemaVersion: typeof CANARY_REPAIR_PACKAGE_SCHEMA;
  manifestId: string;
  slotId: string;
  sourceFight: SourceFightIdentity;
  diagnosisStatus: string;
  priorPackageCompatibilityKey: string | null;
  priorPackageContentHash: string | null;
  priorPackageMutated: false;
  priorPackageDeleted: false;
  newPackageCompatibilityKey: string | null;
  newPackageContentHash: string | null;
  supersedesCompatibilityKey: string | null;
  capabilityAcquisitions: number;
  packagesCreated: number;
  packagesReused: number;
  digestsCreated: number;
  digestsReused: number;
  wallidrixeDigestResolved: boolean;
  wallidrixeDigestId: string | null;
  otherPackagesPreserved: true;
  discoveryRun: false;
  scoreCalculated: false;
  publicationEnabled: false;
  publicScorePointerMutated: false;
  providerCalls: number;
  estimatedPoints: number | null;
  measuredPoints: number | null;
  outcome: "REPAIRED" | "ALREADY_COMPATIBLE" | "REFUSED";
  refusalReasons: string[];
}

function slotLabel(dungeonSlug: string, slotIndex: number): string {
  return `${dungeonSlug}:${slotIndex}`;
}

export function evaluateTargetedRepairGates(input: {
  env: Pick<
    AppEnv,
    | "PROVIDER_MODE"
    | "WCL_ENABLED"
    | "ALLOW_LIVE_PROVIDER_CALLS"
    | "SCORING_V2_PUBLICATION_ENABLED"
    | "WCL_CLIENT_ID"
    | "WCL_CLIENT_SECRET"
  >;
  confirmTargetedReacquire: boolean;
  repositoryMode: CanaryCharacterResolution["repositoryMode"];
  hasWclCredentials: boolean;
}): { allowed: true } | { allowed: false; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.confirmTargetedReacquire) {
    reasons.push("MISSING_CONFIRM_TARGETED_REACQUIRE");
  }
  if (input.repositoryMode !== "PRODUCTION") {
    reasons.push("REPOSITORY_MODE_FORBIDDEN");
  }
  const live = evaluateLiveCapabilityPermission({
    providerMode: input.env.PROVIDER_MODE,
    wclEnabled: input.env.WCL_ENABLED,
    allowLiveProviderCalls: input.env.ALLOW_LIVE_PROVIDER_CALLS,
    liveProviderPermissionGranted: true,
    scoringV2PublicationEnabled: input.env.SCORING_V2_PUBLICATION_ENABLED,
    hasWclCredentials: input.hasWclCredentials,
  });
  if (!live.allowed) reasons.push(...live.reasons);
  try {
    assertPublicationBlocked(input.env as never);
  } catch {
    reasons.push("PUBLICATION_ENABLED");
  }
  if (reasons.length > 0) return { allowed: false, reasons };
  return { allowed: true };
}

export async function runScoringV2CanaryRepairPackage(input: {
  prisma: PrismaClient;
  container: WorkerContainer;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  classSlug: string | null;
  specSlug: string | null;
  role: string | null;
  season: CanarySeasonResolution;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  confirmTargetedReacquire: boolean;
  repositoryMode: CanaryCharacterResolution["repositoryMode"];
  env: AppEnv;
  targetedAcquire: TargetedRepairAcquire;
  outputDir?: string;
}): Promise<{ report: CanaryRepairPackageReport; reportPath: string }> {
  assertNotSentinelCharacterId(input.characterId);
  assertOperatorRepositoryMode(input.repositoryMode);

  const gate = evaluateTargetedRepairGates({
    env: input.env,
    confirmTargetedReacquire: input.confirmTargetedReacquire,
    repositoryMode: input.repositoryMode,
    hasWclCredentials: Boolean(
      input.env.WCL_CLIENT_ID && input.env.WCL_CLIENT_SECRET,
    ),
  });

  const baseRefusal = (
    reasons: string[],
  ): CanaryRepairPackageReport => ({
    schemaVersion: CANARY_REPAIR_PACKAGE_SCHEMA,
    manifestId: "",
    slotId: "",
    sourceFight: {
      reportCode: input.reportCode,
      fightId: input.fightId,
      reportRevision: input.reportRevision,
    },
    diagnosisStatus: "REFUSED",
    priorPackageCompatibilityKey: null,
    priorPackageContentHash: null,
    priorPackageMutated: false,
    priorPackageDeleted: false,
    newPackageCompatibilityKey: null,
    newPackageContentHash: null,
    supersedesCompatibilityKey: null,
    capabilityAcquisitions: 0,
    packagesCreated: 0,
    packagesReused: 0,
    digestsCreated: 0,
    digestsReused: 0,
    wallidrixeDigestResolved: false,
    wallidrixeDigestId: null,
    otherPackagesPreserved: true,
    discoveryRun: false,
    scoreCalculated: false,
    publicationEnabled: false,
    publicScorePointerMutated: false,
    providerCalls: 0,
    estimatedPoints: null,
    measuredPoints: null,
    outcome: "REFUSED",
    refusalReasons: reasons,
  });

  if (!gate.allowed) {
    const report = baseRefusal(gate.reasons);
    const outDir =
      input.outputDir ?? join(process.cwd(), "artifacts", "scoring-v2-canary");
    await mkdir(outDir, { recursive: true });
    const reportPath = join(outDir, "repair-package-report.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    throw Object.assign(new Error(`repair_package_refused:${gate.reasons.join(",")}`), {
      code: "REPAIR_PACKAGE_REFUSED",
      reasons: gate.reasons,
      report,
      reportPath,
    });
  }

  if (!input.season.seasonId || !input.season.dungeonPoolHash) {
    throw Object.assign(new Error("repair_package_season_invalid"), {
      code: "SEASON_CATALOG_MISMATCH",
    });
  }

  const frozen = await loadCompatibleFrozenManifest({
    prisma: input.prisma,
    characterId: input.characterId,
    seasonId: input.season.seasonId,
    expectedDungeonSlugs: input.season.activeDungeonSlugs,
    dungeonPoolHash: input.season.dungeonPoolHash,
  });
  if (!frozen) {
    throw Object.assign(new Error("repair_package_manifest_missing"), {
      code: "MANIFEST_NOT_FOUND",
    });
  }

  const slot = await input.prisma.evidenceManifestSlot.findFirst({
    where: {
      manifestId: frozen.rowId,
      state: "SELECTED",
      reportCode: input.reportCode,
      fightId: input.fightId,
      reportRevision: input.reportRevision,
    },
    include: { dungeon: { select: { slug: true } } },
  });
  if (!slot) {
    throw Object.assign(
      new Error(
        `repair_package_source_not_in_manifest:${input.reportCode}:${input.fightId}:${input.reportRevision}`,
      ),
      { code: "SOURCE_NOT_IN_FROZEN_MANIFEST" },
    );
  }

  const sourceFight: SourceFightIdentity = {
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
  };
  const slotId = slotLabel(slot.dungeon.slug, slot.slotIndex);

  const packages = input.container.repositories.capabilityEvidencePackages;
  const priorHit = await packages.findCompleteBySourceFight(sourceFight);

  const rosterRow = await input.prisma.wclRunSourceDigest.findFirst({
    where: {
      reportCode: sourceFight.reportCode,
      fightId: sourceFight.fightId,
      reportRevision: sourceFight.reportRevision,
    },
  });
  const rosterParticipants = (
    (rosterRow?.digest as {
      participants?: Array<{
        wclActorId: number;
        characterName: string;
        realmSlug: string;
        regionCode: string;
        classSlug?: string | null;
        specSlug?: string | null;
        role?: string | null;
        ownedPetActorIds?: number[];
      }>;
    } | null)?.participants ?? []
  );

  const identity: StableCharacterIdentity = {
    characterId: input.characterId,
    characterName: input.characterName,
    regionCode: input.region,
    realmSlug: input.realm,
  };
  const targetResolved = resolveTargetActorIdFromRoster({
    roster: rosterParticipants,
    identity,
  });
  const expectedRosterActorIds = rosterParticipants.map((p) => p.wclActorId);

  const diagnosis = diagnosePackageRosterCompatibility({
    packageActorIds: priorHit?.package.friendlyPlayerActorIds ?? [],
    expectedFightRosterActorIds: expectedRosterActorIds,
    targetActorId: targetResolved.actorId,
  });

  if (priorHit && !isPackageRosterIncompatible(diagnosis)) {
    const report: CanaryRepairPackageReport = {
      schemaVersion: CANARY_REPAIR_PACKAGE_SCHEMA,
      manifestId: frozen.rowId,
      slotId,
      sourceFight,
      diagnosisStatus: diagnosis.status,
      priorPackageCompatibilityKey: priorHit.package.compatibilityKey,
      priorPackageContentHash: priorHit.contentHash,
      priorPackageMutated: false,
      priorPackageDeleted: false,
      newPackageCompatibilityKey: priorHit.package.compatibilityKey,
      newPackageContentHash: priorHit.contentHash,
      supersedesCompatibilityKey: null,
      capabilityAcquisitions: 0,
      packagesCreated: 0,
      packagesReused: 1,
      digestsCreated: 0,
      digestsReused: 0,
      wallidrixeDigestResolved: true,
      wallidrixeDigestId: null,
      otherPackagesPreserved: true,
      discoveryRun: false,
      scoreCalculated: false,
      publicationEnabled: false,
      publicScorePointerMutated: false,
      providerCalls: 0,
      estimatedPoints: null,
      measuredPoints: null,
      outcome: "ALREADY_COMPATIBLE",
      refusalReasons: [],
    };
    const outDir =
      input.outputDir ?? join(process.cwd(), "artifacts", "scoring-v2-canary");
    await mkdir(outDir, { recursive: true });
    const reportPath = join(outDir, "repair-package-report.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    return { report, reportPath };
  }

  if (targetResolved.actorId == null || rosterParticipants.length === 0) {
    throw Object.assign(
      new Error(
        `repair_package_roster_unavailable:${slotId}:${targetResolved.reason}`,
      ),
      { code: "FIGHT_ROSTER_UNAVAILABLE", diagnosis },
    );
  }

  const participants: OrchestrationParticipant[] = rosterParticipants.map((p) => {
    const isTarget = p.wclActorId === targetResolved.actorId;
    return {
      playerActorId: p.wclActorId,
      characterName: isTarget ? input.characterName : p.characterName,
      realmSlug: p.realmSlug ?? input.realm,
      regionCode: p.regionCode ?? input.region,
      classSlug: isTarget ? input.classSlug : (p.classSlug ?? null),
      specSlug: isTarget ? input.specSlug : (p.specSlug ?? null),
      role: isTarget ? input.role : (p.role ?? null),
      ownedPetActorIds: p.ownedPetActorIds ?? [],
      characterId: isTarget ? input.characterId : null,
    };
  });

  const priorKey = priorHit?.package.compatibilityKey ?? null;
  if (!priorKey) {
    throw Object.assign(
      new Error(`repair_package_prior_missing:${slotId}`),
      { code: "PRIOR_PACKAGE_MISSING" },
    );
  }

  const acquired = await input.targetedAcquire({
    sourceFight,
    dungeonSlug: slot.dungeon.slug,
    keyLevel: slot.keyLevel,
    participants,
    supersedesCompatibilityKey: priorKey,
  });

  const pkg = assertCapabilityEvidencePackageV1(acquired.package);
  const postDiagnosis = diagnosePackageRosterCompatibility({
    packageActorIds: pkg.friendlyPlayerActorIds,
    expectedFightRosterActorIds: expectedRosterActorIds,
    targetActorId: targetResolved.actorId,
  });
  if (isPackageRosterIncompatible(postDiagnosis)) {
    throw Object.assign(
      new Error(`repair_package_still_incompatible:${postDiagnosis.status}`),
      { code: "REPAIR_STILL_INCOMPATIBLE", diagnosis: postDiagnosis },
    );
  }

  // Prior row must still exist unchanged.
  const priorStillThere = await packages.findByCompatibilityKey(priorKey);
  if (!priorStillThere) {
    throw Object.assign(new Error("repair_package_prior_row_deleted"), {
      code: "PRIOR_PACKAGE_DELETED",
    });
  }

  const manifestSlot = frozen.document.slots.find(
    (s) =>
      s.state === "SELECTED" &&
      s.identity?.reportCode === sourceFight.reportCode &&
      s.identity?.fightId === sourceFight.fightId &&
      s.identity?.reportRevision === sourceFight.reportRevision,
  );

  const rankingByActorId = new Map(
    participants.map((p) => [p.playerActorId, absentRankingParseFact()] as const),
  );

  const built = buildParticipantScoringDigestsFromPackage({
    capabilityPackage: pkg,
    packageArtifactId: acquired.packageArtifactId,
    participants,
    dungeonSlug: slot.dungeon.slug,
    keyLevel: slot.keyLevel ?? manifestSlot?.keyLevel ?? null,
    timed: manifestSlot?.timed ?? true,
    runScore: manifestSlot?.runScore ?? null,
    completedAt: manifestSlot?.completedAt ?? null,
    fightStartMs: 0,
    fightEndMs: null,
    catalogVersion: pkg.catalogVersion,
    rankingByActorId,
  });

  let digestsCreated = 0;
  let digestsReused = 0;
  const digestViews = [];
  for (const digest of built) {
    const existing =
      await input.container.repositories.participantScoringDigests.findCompatible({
        reportCode: digest.reportCode,
        fightId: digest.fightId,
        reportRevision: digest.reportRevision,
        participantActorId: digest.participantActorId,
        digestSchemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
        extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
        capabilityPackageContentHash: digest.capabilityPackageContentHash,
        catalogVersion: digest.catalogVersion,
      });
    if (existing && existing.digest.contentHash === digest.contentHash) {
      digestsReused += 1;
      digestViews.push({
        participantActorId: existing.digest.participantActorId,
        characterId: existing.digest.characterId,
        characterName: existing.digest.characterName,
        digest: existing.digest,
        digestArtifactId: existing.artifactId,
      });
      continue;
    }
    const write = await persistParticipantDigestWithRowOwner({
      artifacts: input.container.repositories.artifacts,
      digests: input.container.repositories.participantScoringDigests,
      digest,
    });
    if (write.created) digestsCreated += 1;
    else digestsReused += 1;
    digestViews.push({
      participantActorId: digest.participantActorId,
      characterId: digest.characterId,
      characterName: digest.characterName,
      digest,
      digestArtifactId: write.artifactId,
    });
  }

  const wallidrixe = selectTargetCharacterDigest({
    slotId,
    digests: digestViews,
    identity,
    targetActorId: targetResolved.actorId,
  });

  const report: CanaryRepairPackageReport = {
    schemaVersion: CANARY_REPAIR_PACKAGE_SCHEMA,
    manifestId: frozen.rowId,
    slotId,
    sourceFight,
    diagnosisStatus: diagnosis.status,
    priorPackageCompatibilityKey: priorKey,
    priorPackageContentHash: priorHit?.contentHash ?? null,
    priorPackageMutated: false,
    priorPackageDeleted: false,
    newPackageCompatibilityKey: pkg.compatibilityKey,
    newPackageContentHash: pkg.contentHash,
    supersedesCompatibilityKey: priorKey,
    capabilityAcquisitions: 1,
    packagesCreated: acquired.created ? 1 : 0,
    packagesReused: acquired.created ? 0 : 1,
    digestsCreated,
    digestsReused,
    wallidrixeDigestResolved: true,
    wallidrixeDigestId: wallidrixe.digestArtifactId,
    otherPackagesPreserved: true,
    discoveryRun: false,
    scoreCalculated: false,
    publicationEnabled: false,
    publicScorePointerMutated: false,
    providerCalls: acquired.providerCalls,
    estimatedPoints: acquired.accounting.estimatedPointsConsumed,
    measuredPoints: acquired.accounting.pointsConsumed,
    outcome: "REPAIRED",
    refusalReasons: [],
  };

  const outDir =
    input.outputDir ?? join(process.cwd(), "artifacts", "scoring-v2-canary");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "repair-package-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { report, reportPath };
}
