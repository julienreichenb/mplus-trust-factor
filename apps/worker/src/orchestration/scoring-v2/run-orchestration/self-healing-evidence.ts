/**
 * Generic self-healing for capability packages and ranking evidence.
 * No character names, report codes, or fight IDs are hard-coded.
 * Invalid packages are detected via roster integrity rules and superseded.
 */
import type { PrismaClient } from "@mplus/database";
import {
  assertCapabilityEvidencePackageV1,
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
} from "@mplus/contracts";
import { buildParticipantScoringDigestsFromPackage } from "@mplus/provider-warcraftlogs";
import type { WorkerContainer } from "../../../container.js";
import {
  diagnosePackageRosterCompatibility,
  isPackageRosterIncompatible,
} from "./package-roster-diagnosis.js";
import {
  resolveTargetActorIdFromRoster,
  selectTargetCharacterDigest,
  type StableCharacterIdentity,
} from "./target-character-identity.js";
import { absentRankingParseFact } from "./ranking-hydrate.js";
import type {
  LiveCapabilityAcquireResult,
} from "./live-capability-adapter.js";
import type {
  OrchestrationParticipant,
  SourceFightIdentity,
} from "./orchestrator.js";
import { persistParticipantDigestWithRowOwner } from "./persist-digest-artifact.js";
export type SupersedingAcquire = (input: {
  sourceFight: SourceFightIdentity;
  dungeonSlug: string | null;
  keyLevel: number | null;
  participants: OrchestrationParticipant[];
  supersedesCompatibilityKey: string;
}) => Promise<LiveCapabilityAcquireResult>;

export interface PackageIntegrityRepairItem {
  slotId: string;
  sourceFight: SourceFightIdentity;
  diagnosisStatus: string;
  outcome: "REPAIRED" | "ALREADY_COMPATIBLE" | "SKIPPED_NO_PRIOR" | "SKIPPED_NO_ROSTER";
  priorCompatibilityKey: string | null;
  newCompatibilityKey: string | null;
  priorPackageMutated: false;
  priorPackageDeleted: false;
  capabilityAcquisitions: number;
  digestsCreated: number;
  targetDigestResolved: boolean;
  providerCalls: number;
}

export interface PackageIntegrityRepairReport {
  inspected: number;
  repaired: number;
  alreadyCompatible: number;
  skipped: number;
  capabilityAcquisitions: number;
  providerCalls: number;
  items: PackageIntegrityRepairItem[];
}

function slotLabel(dungeonSlug: string, slotIndex: number): string {
  return `${dungeonSlug}:${slotIndex}`;
}

type RosterParticipant = {
  wclActorId: number;
  characterName: string;
  realmSlug: string;
  regionCode: string;
  classSlug?: string | null;
  specSlug?: string | null;
  role?: string | null;
  ownedPetActorIds?: number[];
};

async function loadFightRoster(
  prisma: PrismaClient,
  sourceFight: SourceFightIdentity,
): Promise<RosterParticipant[]> {
  const row = await prisma.wclRunSourceDigest.findFirst({
    where: {
      reportCode: sourceFight.reportCode,
      fightId: sourceFight.fightId,
      reportRevision: sourceFight.reportRevision,
    },
  });
  return (
    (row?.digest as { participants?: RosterParticipant[] } | null)?.participants ??
    []
  );
}

/**
 * Inspect every selected manifest slot; supersede packages whose fight-roster
 * integrity fails. Never deletes prior packages. Never hard-codes identities.
 */
export async function repairIncompatibleCapabilityPackages(input: {
  prisma: PrismaClient;
  container: WorkerContainer;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  classSlug: string | null;
  specSlug: string | null;
  role: string | null;
  manifestId: string;
  acquire: SupersedingAcquire;
  /** When false, only diagnose — no WCL. */
  liveRepairEnabled: boolean;
}): Promise<PackageIntegrityRepairReport> {
  const slots = await input.prisma.evidenceManifestSlot.findMany({
    where: { manifestId: input.manifestId, state: "SELECTED" },
    include: { dungeon: { select: { slug: true } } },
  });

  const packages = input.container.repositories.capabilityEvidencePackages;
  const identity: StableCharacterIdentity = {
    characterId: input.characterId,
    characterName: input.characterName,
    regionCode: input.region,
    realmSlug: input.realm,
  };

  const items: PackageIntegrityRepairItem[] = [];
  let repaired = 0;
  let alreadyCompatible = 0;
  let skipped = 0;
  let capabilityAcquisitions = 0;
  let providerCalls = 0;

  for (const slot of slots) {
    if (
      slot.reportCode == null ||
      slot.fightId == null ||
      slot.reportRevision == null
    ) {
      continue;
    }
    const sourceFight: SourceFightIdentity = {
      reportCode: slot.reportCode,
      fightId: slot.fightId,
      reportRevision: slot.reportRevision,
    };
    const slotId = slotLabel(slot.dungeon.slug, slot.slotIndex);
    const prior = await packages.findCompleteBySourceFight(sourceFight);
    const roster = await loadFightRoster(input.prisma, sourceFight);
    const targetResolved = resolveTargetActorIdFromRoster({
      roster,
      identity,
    });
    const diagnosis = diagnosePackageRosterCompatibility({
      packageActorIds: prior?.package.friendlyPlayerActorIds ?? [],
      expectedFightRosterActorIds: roster.map((p) => p.wclActorId),
      targetActorId: targetResolved.actorId,
    });

    if (!prior) {
      skipped += 1;
      items.push({
        slotId,
        sourceFight,
        diagnosisStatus: "NO_PRIOR_PACKAGE",
        outcome: "SKIPPED_NO_PRIOR",
        priorCompatibilityKey: null,
        newCompatibilityKey: null,
        priorPackageMutated: false,
        priorPackageDeleted: false,
        capabilityAcquisitions: 0,
        digestsCreated: 0,
        targetDigestResolved: false,
        providerCalls: 0,
      });
      continue;
    }

    if (!isPackageRosterIncompatible(diagnosis)) {
      alreadyCompatible += 1;
      items.push({
        slotId,
        sourceFight,
        diagnosisStatus: diagnosis.status,
        outcome: "ALREADY_COMPATIBLE",
        priorCompatibilityKey: prior.package.compatibilityKey,
        newCompatibilityKey: prior.package.compatibilityKey,
        priorPackageMutated: false,
        priorPackageDeleted: false,
        capabilityAcquisitions: 0,
        digestsCreated: 0,
        targetDigestResolved: true,
        providerCalls: 0,
      });
      continue;
    }

    if (!input.liveRepairEnabled || roster.length === 0 || targetResolved.actorId == null) {
      skipped += 1;
      items.push({
        slotId,
        sourceFight,
        diagnosisStatus: diagnosis.status,
        outcome: "SKIPPED_NO_ROSTER",
        priorCompatibilityKey: prior.package.compatibilityKey,
        newCompatibilityKey: null,
        priorPackageMutated: false,
        priorPackageDeleted: false,
        capabilityAcquisitions: 0,
        digestsCreated: 0,
        targetDigestResolved: false,
        providerCalls: 0,
      });
      continue;
    }

    const participants: OrchestrationParticipant[] = roster.map((p) => {
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

    const acquired = await input.acquire({
      sourceFight,
      dungeonSlug: slot.dungeon.slug,
      keyLevel: slot.keyLevel,
      participants,
      supersedesCompatibilityKey: prior.package.compatibilityKey,
    });
    capabilityAcquisitions += 1;
    providerCalls += acquired.providerCalls;

    const pkg = assertCapabilityEvidencePackageV1(acquired.package);
    const rankingByActorId = new Map(
      participants.map((p) => [p.playerActorId, absentRankingParseFact()] as const),
    );
    const built = buildParticipantScoringDigestsFromPackage({
      capabilityPackage: pkg,
      packageArtifactId: acquired.packageArtifactId,
      participants,
      dungeonSlug: slot.dungeon.slug,
      keyLevel: slot.keyLevel,
      timed: true,
      runScore: null,
      completedAt: null,
      fightStartMs: 0,
      fightEndMs: null,
      catalogVersion: pkg.catalogVersion,
      rankingByActorId,
    });

    let digestsCreated = 0;
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
      digestViews.push({
        participantActorId: digest.participantActorId,
        characterId: digest.characterId,
        characterName: digest.characterName,
        digest,
        digestArtifactId: write.artifactId,
      });
    }

    let targetDigestResolved = false;
    try {
      selectTargetCharacterDigest({
        slotId,
        digests: digestViews,
        identity,
        targetActorId: targetResolved.actorId,
      });
      targetDigestResolved = true;
    } catch {
      targetDigestResolved = false;
    }

    repaired += 1;
    items.push({
      slotId,
      sourceFight,
      diagnosisStatus: diagnosis.status,
      outcome: "REPAIRED",
      priorCompatibilityKey: prior.package.compatibilityKey,
      newCompatibilityKey: pkg.compatibilityKey,
      priorPackageMutated: false,
      priorPackageDeleted: false,
      capabilityAcquisitions: 1,
      digestsCreated,
      targetDigestResolved,
      providerCalls: acquired.providerCalls,
    });
  }

  return {
    inspected: items.length,
    repaired,
    alreadyCompatible,
    skipped,
    capabilityAcquisitions,
    providerCalls,
    items,
  };
}
