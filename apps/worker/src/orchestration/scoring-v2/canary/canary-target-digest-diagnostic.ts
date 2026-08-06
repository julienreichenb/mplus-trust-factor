/**
 * Provider-free diagnostic: join 16 manifest slots → packages → digests →
 * target-character resolution. Zero WCL calls.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@mplus/database";
import {
  assertCapabilityEvidencePackageV1,
  assertParticipantScoringDigestV1,
  type CharacterSeasonEvidenceManifestV2,
} from "@mplus/contracts";
import {
  nameRealmMatches,
  normalizeWclRealmSlug,
  resolveFightOwnership,
} from "@mplus/provider-warcraftlogs";
import { rankingParseCompatibilityKey } from "../run-orchestration/ranking-hydrate.js";
import { RANKING_PARSE_DATASET_KEY } from "./canary-ranking-lineage.js";

export const CANARY_TARGET_DIGEST_DIAG_SCHEMA =
  "scoring-v2-canary-target-digest-diagnostic-v1" as const;

export type TargetDigestProblemClass =
  | "TARGET_ACTOR_NOT_FOUND"
  | "TARGET_ACTOR_AMBIGUOUS"
  | "STALE_ACTOR_ID_AFTER_REPORT_REVISION"
  | "CHARACTER_ID_NOT_PROPAGATED"
  | "DIGEST_CHARACTER_LINK_MISSING"
  | "DIGEST_LOOKUP_KEY_MISMATCH"
  | "DUPLICATE_TARGET_DIGEST"
  | "OTHER_EXPLICIT_REASON"
  | null;

export interface TargetDigestSlotDiagnostic {
  slotId: string;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  packageId: string | null;
  packageContentHash: string | null;
  packageParticipants: Array<{
    actorId: number;
    name: string | null;
    realm: string | null;
    region: string | null;
    nameRealmMatch: boolean;
  }>;
  digests: Array<{
    digestId: string;
    participantActorId: number;
    characterId: string | null;
    characterName: string;
    rankingProvenanceSource: string | null;
    performanceCompleteness: string;
    performanceLimitations: string[];
    isWallidrixeByCharacterId: boolean;
    isWallidrixeByName: boolean;
    isWallidrixeByStableIdentity: boolean;
  }>;
  targetActorIdFromPackageMasterData: number | null;
  targetActorResolution:
    | "NAME_REALM_IN_PACKAGE"
    | "OWNERSHIP_AMBIGUOUS"
    | "OWNERSHIP_NOT_FOUND"
    | "PACKAGE_ABSENT";
  stampedTargetDigestCount: number;
  stableIdentityTargetDigestCount: number;
  recognizedAsWallidrixe: boolean;
  problemClass: TargetDigestProblemClass;
  rejectionOrMismatchReason: string | null;
  rankingLookupKey: string;
  rankingDatasetId: string | null;
  rankingDatasetState: string | null;
  rankingCompatibleWithSlot: boolean;
  performanceUsable: boolean;
  performanceUnusableReason: string | null;
}

export interface TargetDigestDiagnosticReport {
  schemaVersion: typeof CANARY_TARGET_DIGEST_DIAG_SCHEMA;
  manifestId: string;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  selectedSlotCount: number;
  targetDigestCountByStamp: number;
  targetDigestCountByStableIdentity: number;
  problematicSlots: TargetDigestSlotDiagnostic[];
  problemClassSummary: Partial<
    Record<Exclude<TargetDigestProblemClass, null>, number>
  >;
  performance: {
    targetDigests: number;
    performanceDigestsUsable: number;
    rankingFactsReady: number;
    rankingFactsAbsent: number;
    rankingFactsIncompatible: number;
    rankingFactsAttachedToStaleRevision: number;
  };
  slots: TargetDigestSlotDiagnostic[];
  providerCalls: 0;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function slotLabel(dungeonSlug: string, slotIndex: number): string {
  return `${dungeonSlug}:${slotIndex}`;
}

export async function runTargetDigestDiagnostic(input: {
  prisma: PrismaClient;
  manifestId: string;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  /** Optional artifact reader; when omitted, only index columns are used. */
  readArtifactBytes?: (artifactId: string) => Promise<Buffer>;
  outputDir?: string;
}): Promise<{ report: TargetDigestDiagnosticReport; reportPath: string }> {
  const manifestRow = await input.prisma.evidenceManifest.findUnique({
    where: { id: input.manifestId },
    include: {
      slots: {
        where: { state: "SELECTED" },
        include: {
          dungeon: { select: { slug: true } },
          datasets: {
            where: { datasetKey: RANKING_PARSE_DATASET_KEY },
          },
        },
      },
    },
  });
  if (!manifestRow) {
    throw Object.assign(new Error(`manifest_not_found:${input.manifestId}`), {
      code: "MANIFEST_NOT_FOUND",
    });
  }

  const doc = manifestRow.document as CharacterSeasonEvidenceManifestV2;
  const slots: TargetDigestSlotDiagnostic[] = [];
  let targetDigestCountByStamp = 0;
  let targetDigestCountByStableIdentity = 0;
  let performanceDigestsUsable = 0;
  let rankingFactsReady = 0;
  let rankingFactsAbsent = 0;
  let rankingFactsIncompatible = 0;
  let rankingFactsAttachedToStaleRevision = 0;

  const targetName = normalizeName(input.characterName);
  const targetRealm = normalizeWclRealmSlug(input.realm);

  for (const slot of manifestRow.slots) {
    const reportCode = slot.reportCode!;
    const fightId = slot.fightId!;
    const reportRevision = slot.reportRevision!;
    const slotId = slotLabel(slot.dungeon.slug, slot.slotIndex);
    const rankingLookupKey = rankingParseCompatibilityKey({
      reportCode,
      fightId,
      reportRevision,
    });

    const pkg = await input.prisma.capabilityEvidencePackageRecord.findFirst({
      where: { reportCode, fightId, reportRevision, complete: true },
      orderBy: { updatedAt: "desc" },
    });

    const digestRows = await input.prisma.participantScoringDigest.findMany({
      where: { reportCode, fightId, reportRevision },
      orderBy: { participantActorId: "asc" },
    });

    let packageParticipants: TargetDigestSlotDiagnostic["packageParticipants"] = [];
    let targetActorIdFromPackageMasterData: number | null = null;
    let targetActorResolution: TargetDigestSlotDiagnostic["targetActorResolution"] =
      "PACKAGE_ABSENT";

    if (pkg && input.readArtifactBytes) {
      try {
        const bytes = await input.readArtifactBytes(pkg.artifactId);
        const packageDoc = assertCapabilityEvidencePackageV1(
          JSON.parse(bytes.toString("utf8")),
        );
        // Capability packages do not embed masterData; use fight-friendly IDs only.
        packageParticipants = packageDoc.friendlyPlayerActorIds.map((actorId) => ({
          actorId,
          name: null,
          realm: null,
          region: input.region,
          nameRealmMatch: false,
        }));
      } catch {
        packageParticipants = (
          Array.isArray(pkg.participantActorIds)
            ? (pkg.participantActorIds as number[])
            : []
        ).map((actorId) => ({
          actorId,
          name: null,
          realm: null,
          region: input.region,
          nameRealmMatch: false,
        }));
      }
    } else if (pkg) {
      packageParticipants = (
        Array.isArray(pkg.participantActorIds)
          ? (pkg.participantActorIds as number[])
          : []
      ).map((actorId) => ({
        actorId,
        name: null,
        realm: null,
        region: input.region,
        nameRealmMatch: false,
      }));
    }

    // Prefer WCL run source digest roster for stable identity (provider-free).
    const runRow = await input.prisma.wclRunSourceDigest.findFirst({
      where: { reportCode, fightId, reportRevision },
    });
    const rosterParticipants = (
      runRow?.digest as {
        participants?: Array<{
          wclActorId: number;
          characterName: string;
          realmSlug: string;
          regionCode: string;
        }>;
      } | null
    )?.participants;
    if (rosterParticipants && rosterParticipants.length > 0) {
      const ownership = resolveFightOwnership({
        actors: rosterParticipants.map((p) => ({
          id: p.wclActorId,
          name: p.characterName,
          type: "Player",
          server: p.realmSlug,
        })),
        friendlyPlayers: rosterParticipants.map((p) => p.wclActorId),
        characterName: input.characterName,
        realmSlug: input.realm,
        requireMythicPlus: false,
      });
      if (ownership.ok) {
        targetActorIdFromPackageMasterData = ownership.targetActorId;
        targetActorResolution = "NAME_REALM_IN_PACKAGE";
      } else if (ownership.reason === "TARGET_AMBIGUOUS") {
        targetActorResolution = "OWNERSHIP_AMBIGUOUS";
      } else {
        targetActorResolution = "OWNERSHIP_NOT_FOUND";
      }
      packageParticipants = rosterParticipants.map((p) => ({
        actorId: p.wclActorId,
        name: p.characterName,
        realm: p.realmSlug,
        region: p.regionCode,
        nameRealmMatch: nameRealmMatches(
          p.characterName,
          p.realmSlug,
          input.characterName,
          input.realm,
        ),
      }));
    } else if (!pkg) {
      targetActorResolution = "PACKAGE_ABSENT";
    } else {
      targetActorResolution = "OWNERSHIP_NOT_FOUND";
    }

    const digests: TargetDigestSlotDiagnostic["digests"] = [];
    for (const row of digestRows) {
      let characterName = `Actor${row.participantActorId}`;
      let rankingProvenanceSource: string | null = null;
      let performanceCompleteness = "UNKNOWN";
      let performanceLimitations: string[] = [];
      let isWallidrixeByName = false;
      let isWallidrixeByStableIdentity = false;

      if (input.readArtifactBytes) {
        try {
          const bytes = await input.readArtifactBytes(row.artifactId);
          const digest = assertParticipantScoringDigestV1(
            JSON.parse(bytes.toString("utf8")),
          );
          characterName = digest.characterName;
          rankingProvenanceSource =
            digest.performance.rankingProvenance?.source ?? null;
          performanceCompleteness = digest.performance.completeness;
          performanceLimitations = [...digest.performance.limitations];
          isWallidrixeByName = normalizeName(digest.characterName) === targetName;
          // Stable identity: characterId OR (name match AND not ActorN placeholder)
          // Realm/region are on participants at build; digest may only carry name.
          isWallidrixeByStableIdentity =
            row.characterId === input.characterId ||
            (isWallidrixeByName &&
              !/^Actor\d+$/i.test(digest.characterName) &&
              (targetActorIdFromPackageMasterData == null ||
                row.participantActorId === targetActorIdFromPackageMasterData));
          if (
            targetActorIdFromPackageMasterData != null &&
            row.participantActorId === targetActorIdFromPackageMasterData
          ) {
            isWallidrixeByStableIdentity = true;
          }
        } catch {
          /* index-only fallback below */
        }
      }

      if (
        targetActorIdFromPackageMasterData != null &&
        row.participantActorId === targetActorIdFromPackageMasterData
      ) {
        isWallidrixeByStableIdentity = true;
      }

      const isWallidrixeByCharacterId = row.characterId === input.characterId;
      digests.push({
        digestId: row.id,
        participantActorId: row.participantActorId,
        characterId: row.characterId,
        characterName,
        rankingProvenanceSource,
        performanceCompleteness,
        performanceLimitations,
        isWallidrixeByCharacterId,
        isWallidrixeByName,
        isWallidrixeByStableIdentity,
      });
    }

    const stamped = digests.filter(
      (d) => d.isWallidrixeByCharacterId || d.isWallidrixeByName,
    );
    const stable = digests.filter((d) => d.isWallidrixeByStableIdentity);
    if (stamped.length === 1) targetDigestCountByStamp += 1;
    if (stable.length === 1) targetDigestCountByStableIdentity += 1;

    const rankingOnSlot = slot.datasets.find((d) => d.state === "READY") ?? null;
    const rankingByKey = await input.prisma.evidenceDataset.findFirst({
      where: {
        compatibilityKey: rankingLookupKey,
        datasetKey: RANKING_PARSE_DATASET_KEY,
        state: "READY",
      },
      orderBy: { fetchedAt: "desc" },
    });
    const rankingDataset = rankingOnSlot ?? rankingByKey;
    const rankingCompatibleWithSlot =
      rankingDataset != null &&
      rankingDataset.compatibilityKey === rankingLookupKey &&
      rankingDataset.state === "READY";

    let performanceUsable = false;
    let performanceUnusableReason: string | null = null;
    const targetDigest =
      stable.length === 1
        ? stable[0]!
        : stamped.length === 1
          ? stamped[0]!
          : null;
    if (!targetDigest) {
      performanceUnusableReason = "TARGET_CHARACTER_DIGEST_MISSING";
    } else if (targetDigest.performanceCompleteness === "UNAVAILABLE") {
      performanceUnusableReason =
        targetDigest.performanceLimitations.join(",") || "ranking_parse_absent";
    } else if (targetDigest.performanceCompleteness === "COMPLETE") {
      performanceUsable = true;
    } else if (targetDigest.performanceCompleteness === "UNKNOWN") {
      performanceUnusableReason = rankingCompatibleWithSlot
        ? "DIGEST_RANKING_NOT_LOADED"
        : "ranking_parse_absent";
    } else {
      performanceUnusableReason = `performance_completeness:${targetDigest.performanceCompleteness}`;
    }

    if (performanceUsable) performanceDigestsUsable += 1;
    if (rankingCompatibleWithSlot) rankingFactsReady += 1;
    else if (rankingDataset && rankingDataset.compatibilityKey !== rankingLookupKey) {
      rankingFactsIncompatible += 1;
      rankingFactsAttachedToStaleRevision += 1;
    } else rankingFactsAbsent += 1;

    let problemClass: TargetDigestProblemClass = null;
    let rejectionOrMismatchReason: string | null = null;

    if (!pkg) {
      problemClass = "OTHER_EXPLICIT_REASON";
      rejectionOrMismatchReason = "PACKAGE_ABSENT";
    } else if (targetActorResolution === "OWNERSHIP_AMBIGUOUS") {
      problemClass = "TARGET_ACTOR_AMBIGUOUS";
      rejectionOrMismatchReason = "TARGET_ACTOR_AMBIGUOUS";
    } else if (targetActorResolution === "OWNERSHIP_NOT_FOUND") {
      problemClass = "TARGET_ACTOR_NOT_FOUND";
      rejectionOrMismatchReason = "TARGET_ACTOR_NOT_FOUND";
    } else if (stable.length > 1 || stamped.length > 1) {
      problemClass = "DUPLICATE_TARGET_DIGEST";
      rejectionOrMismatchReason = `matches=${Math.max(stable.length, stamped.length)}`;
    } else if (stable.length === 1 && stamped.length === 0) {
      problemClass =
        digests.some(
          (d) =>
            d.participantActorId === targetActorIdFromPackageMasterData &&
            d.characterId == null,
        )
          ? "CHARACTER_ID_NOT_PROPAGATED"
          : "DIGEST_CHARACTER_LINK_MISSING";
      rejectionOrMismatchReason =
        targetActorIdFromPackageMasterData != null
          ? `stable_actor=${targetActorIdFromPackageMasterData}; stamped_name_miss`
          : "stable_match_without_stamp";
    } else if (stable.length === 0 && stamped.length === 0) {
      // Digests exist for all actors but none stamped / matched.
      if (
        targetActorIdFromPackageMasterData != null &&
        digests.some((d) => d.participantActorId === targetActorIdFromPackageMasterData)
      ) {
        problemClass = "CHARACTER_ID_NOT_PROPAGATED";
        rejectionOrMismatchReason = `digest_exists_for_actor=${targetActorIdFromPackageMasterData}_but_not_stamped`;
      } else if (
        targetActorIdFromPackageMasterData != null &&
        pkg &&
        Array.isArray(pkg.participantActorIds) &&
        !(pkg.participantActorIds as number[]).includes(
          targetActorIdFromPackageMasterData,
        )
      ) {
        problemClass = "STALE_ACTOR_ID_AFTER_REPORT_REVISION";
        rejectionOrMismatchReason = `PACKAGE_FRIENDLY_SET_EXCLUDES_TARGET:targetActor=${targetActorIdFromPackageMasterData};packageActors=${JSON.stringify(pkg.participantActorIds)}`;
      } else if (digests.length === 5 || digests.length > 0) {
        problemClass = "STALE_ACTOR_ID_AFTER_REPORT_REVISION";
        rejectionOrMismatchReason =
          "five_or_more_digests_present_but_target_not_linked";
      } else {
        problemClass = "DIGEST_LOOKUP_KEY_MISMATCH";
        rejectionOrMismatchReason = "no_digests_for_source_identity";
      }
    }

    const recognizedAsWallidrixe = stamped.length === 1 || stable.length === 1;

    slots.push({
      slotId,
      reportCode,
      fightId,
      reportRevision,
      packageId: pkg?.id ?? null,
      packageContentHash: pkg?.contentHash ?? null,
      packageParticipants,
      digests,
      targetActorIdFromPackageMasterData,
      targetActorResolution,
      stampedTargetDigestCount: stamped.length,
      stableIdentityTargetDigestCount: stable.length,
      recognizedAsWallidrixe,
      problemClass: recognizedAsWallidrixe && stamped.length === 1 ? null : problemClass,
      rejectionOrMismatchReason:
        recognizedAsWallidrixe && stamped.length === 1
          ? null
          : rejectionOrMismatchReason,
      rankingLookupKey,
      rankingDatasetId: rankingDataset?.id ?? null,
      rankingDatasetState: rankingDataset?.state ?? null,
      rankingCompatibleWithSlot,
      performanceUsable,
      performanceUnusableReason,
    });
  }

  // Prefer slots where stamp failed but digests exist — the linkage bug.
  const problematicSlots = slots.filter((s) => s.problemClass != null);
  const problemClassSummary: TargetDigestDiagnosticReport["problemClassSummary"] =
    {};
  for (const s of problematicSlots) {
    if (!s.problemClass) continue;
    problemClassSummary[s.problemClass] =
      (problemClassSummary[s.problemClass] ?? 0) + 1;
  }

  const report: TargetDigestDiagnosticReport = {
    schemaVersion: CANARY_TARGET_DIGEST_DIAG_SCHEMA,
    manifestId: input.manifestId,
    characterId: input.characterId,
    characterName: input.characterName,
    region: input.region,
    realm: input.realm,
    selectedSlotCount: slots.length,
    targetDigestCountByStamp,
    targetDigestCountByStableIdentity,
    problematicSlots,
    problemClassSummary,
    performance: {
      targetDigests: targetDigestCountByStableIdentity,
      performanceDigestsUsable,
      rankingFactsReady,
      rankingFactsAbsent,
      rankingFactsIncompatible,
      rankingFactsAttachedToStaleRevision,
    },
    slots,
    providerCalls: 0,
  };

  // Silence unused — keep targetRealm for future realm-strict digest payload checks.
  void targetRealm;
  void doc;

  const outDir =
    input.outputDir ?? join(process.cwd(), "artifacts", "scoring-v2-canary");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "target-digest-diagnostic.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { report, reportPath };
}
