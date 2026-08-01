/**
 * Read-only persisted evidence loader for boost-shadow Phase 2.
 * Uses Prisma find* only — never writes ScoreSnapshot / CharacterRedFlag / authenticity.
 * Verified ownership is intentionally not loaded (Phase 4).
 *
 * CharacterSnapshot fallback is season-bound via authoritative Season.startsAt/endsAt.
 * Production authenticity is selected as-of each member's evaluationCutoff.
 */

import type { PrismaClient } from "@mplus/database";
import type {
  BoostShadowCohortManifestV1,
  BoostShadowEvidenceBundleV1,
  BoostShadowMemberEvidenceV1,
  MutationGuard,
  ProductionAuthenticityCompareV1,
} from "@mplus/scoring";
import {
  BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA,
  createReadOnlyPrismaProxy,
  mapPersistedCharacterSnapshotsToSeasonBound,
} from "@mplus/scoring";

export interface LoadPersistedBoostShadowEvidenceInput {
  prisma: PrismaClient;
  manifest: BoostShadowCohortManifestV1;
  generatedAt: string;
  guard: MutationGuard;
}

function mapAuthenticity(
  snapshot: {
    id: string;
    authenticityScore: { toNumber?: () => number } | number | null;
    explanation: unknown;
    calculatedAt: Date;
  } | null,
): ProductionAuthenticityCompareV1 {
  if (!snapshot) {
    return {
      authenticityScore: null,
      boostSuspected: null,
      atypicalProgression: null,
      redFlagKeys: [],
      snapshotId: null,
      calculatedAt: null,
      source: "none",
    };
  }
  const score =
    snapshot.authenticityScore == null
      ? null
      : typeof snapshot.authenticityScore === "number"
        ? snapshot.authenticityScore
        : snapshot.authenticityScore.toNumber?.() ?? Number(snapshot.authenticityScore);

  const explanation =
    snapshot.explanation && typeof snapshot.explanation === "object"
      ? (snapshot.explanation as { redFlags?: Array<{ key?: string }> })
      : {};
  const redFlagKeys = (explanation.redFlags ?? [])
    .map((f) => f.key)
    .filter((k): k is string => typeof k === "string");

  return {
    authenticityScore: score,
    boostSuspected: redFlagKeys.includes("boost_suspected"),
    atypicalProgression: redFlagKeys.includes("atypical_progression"),
    redFlagKeys,
    snapshotId: snapshot.id,
    calculatedAt: snapshot.calculatedAt.toISOString(),
    source: "score_snapshot_readonly",
  };
}

/**
 * Build a portable evidence bundle from persisted MythicRun / RunParticipant rows.
 * Read-only: mutating Prisma calls are blocked by the proxy.
 */
export async function loadPersistedBoostShadowEvidenceBundle(
  input: LoadPersistedBoostShadowEvidenceInput,
): Promise<BoostShadowEvidenceBundleV1> {
  const prisma = createReadOnlyPrismaProxy(input.prisma, input.guard);
  const evidenceByMemberId: Record<string, BoostShadowMemberEvidenceV1> = {};

  const season = await prisma.season.findUnique({
    where: { id: input.manifest.seasonId },
    select: { id: true, startsAt: true, endsAt: true },
  });

  const seasonBounds = {
    seasonId: input.manifest.seasonId,
    startsAt: season?.startsAt?.toISOString() ?? null,
    endsAt: season?.endsAt?.toISOString() ?? null,
  };

  for (const member of input.manifest.members) {
    input.guard.recordEvidenceRead(member.memberId);
    const cutoff = member.evaluationCutoff ?? input.generatedAt;
    const cutoffDate = new Date(cutoff);

    const character = await prisma.character.findUnique({
      where: { id: member.characterId },
      select: { id: true, regionId: true },
    });
    if (!character) {
      evidenceByMemberId[member.memberId] = {
        memberId: member.memberId,
        characterId: member.characterId,
        seasonId: input.manifest.seasonId,
        regionId: "unknown",
        runs: [],
        productionAuthenticity: {
          authenticityScore: null,
          boostSuspected: null,
          atypicalProgression: null,
          redFlagKeys: [],
          snapshotId: null,
          calculatedAt: null,
          source: "none",
        },
      };
      continue;
    }

    const participations = await prisma.runParticipant.findMany({
      where: {
        characterId: member.characterId,
        run: {
          seasonId: input.manifest.seasonId,
          completedAt: { lte: cutoffDate },
        },
      },
      select: {
        runId: true,
        mythicRatingAtRun: true,
        isTargetCharacter: true,
        providerCharacterKey: true,
        regionCode: true,
        realmSlug: true,
        characterId: true,
        run: {
          select: {
            id: true,
            seasonId: true,
            keyLevel: true,
            timed: true,
            scoreValue: true,
            completedAt: true,
            participants: {
              select: {
                characterId: true,
                providerCharacterKey: true,
                regionCode: true,
                realmSlug: true,
                isTargetCharacter: true,
                mythicRatingAtRun: true,
              },
            },
          },
        },
      },
    });

    // CharacterSnapshot has no seasonId — load candidates then season-bound filter.
    // Prefer RunParticipant.mythicRatingAtRun at feature time; snapshots are fallback only.
    const rawSnapshots = await prisma.characterSnapshot.findMany({
      where: {
        characterId: member.characterId,
        mythicRating: { not: null },
      },
      select: {
        characterId: true,
        mythicRating: true,
        capturedAt: true,
      },
      orderBy: { capturedAt: "desc" },
      take: 500,
    });

    const ratingSnapshots = mapPersistedCharacterSnapshotsToSeasonBound({
      snapshots: rawSnapshots.map((s) => ({
        characterId: s.characterId,
        mythicRating: s.mythicRating,
        capturedAt: s.capturedAt,
      })),
      seasonBounds,
      evaluationCutoff: cutoff,
    });

    // As-of authenticity: latest public ScoreSnapshot at or before cutoff.
    const scoreSnapshot = await prisma.scoreSnapshot.findFirst({
      where: {
        characterId: member.characterId,
        seasonId: input.manifest.seasonId,
        isPublic: true,
        calculatedAt: { lte: cutoffDate },
      },
      orderBy: { calculatedAt: "desc" },
      select: {
        id: true,
        authenticityScore: true,
        explanation: true,
        calculatedAt: true,
      },
    });

    const runsById = new Map<string, BoostShadowMemberEvidenceV1["runs"][number]>();
    for (const part of participations) {
      const run = part.run;
      if (runsById.has(run.id)) continue;
      runsById.set(run.id, {
        runId: run.id,
        seasonId: run.seasonId,
        keyLevel: run.keyLevel,
        timed: run.timed,
        scoreValue: run.scoreValue,
        completedAt: run.completedAt.toISOString(),
        source: "persisted",
        participants: run.participants.map((p) => ({
          characterId: p.characterId,
          providerCharacterKey: p.providerCharacterKey,
          regionCode: p.regionCode,
          realmSlug: p.realmSlug,
          isTargetCharacter:
            p.isTargetCharacter || p.characterId === member.characterId,
          mythicRatingAtRun: p.mythicRatingAtRun,
        })),
      });
    }

    evidenceByMemberId[member.memberId] = {
      memberId: member.memberId,
      characterId: member.characterId,
      seasonId: input.manifest.seasonId,
      regionId: character.regionId,
      runs: [...runsById.values()].sort((a, b) =>
        (a.completedAt ?? "").localeCompare(b.completedAt ?? ""),
      ),
      ratingSnapshots,
      productionAuthenticity: mapAuthenticity(scoreSnapshot),
    };
  }

  input.guard.assertNoWrites();
  input.guard.assertNoProviderCalls();

  return {
    schemaVersion: BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA,
    manifest: input.manifest,
    evidenceByMemberId,
    generatedAt: input.generatedAt,
    source: "persisted_export",
  };
}
