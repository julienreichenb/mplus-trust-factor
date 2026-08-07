/**
 * Build EvidenceCandidateMetadataV2 rows from persisted CharacterRunDigest + WclRunRaw.
 * Used when fused MythicRun WCL sources are too thin / lack reportRevision so that
 * scoreCharacter can reuse already-acquired digests.
 */
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";

export async function buildCandidatesFromPersistedDigests(input: {
  prisma: PrismaClient;
  characterId: string;
}): Promise<EvidenceCandidateMetadataV2[]> {
  const digests = await input.prisma.characterRunDigest.findMany({
    where: { characterId: input.characterId },
    include: {
      rawRun: {
        select: {
          reportCode: true,
          fightId: true,
          reportRevision: true,
        },
      },
    },
  });

  const byFight = new Map<string, EvidenceCandidateMetadataV2>();

  for (const row of digests) {
    const meta = row.sourceMetadata;
    const digest =
      meta && typeof meta === "object" && "digest" in (meta as object)
        ? ((meta as { digest?: Record<string, unknown> }).digest ?? null)
        : meta && typeof meta === "object"
          ? (meta as Record<string, unknown>)
          : null;

    const reportCode = row.rawRun.reportCode;
    const fightId = row.rawRun.fightId;
    const reportRevision = row.rawRun.reportRevision;
    if (!reportCode || !Number.isFinite(fightId) || !Number.isFinite(reportRevision)) {
      continue;
    }

    const dungeonSlugRaw =
      typeof digest?.dungeonSlug === "string" ? digest.dungeonSlug : null;
    const dungeonSlug = dungeonSlugRaw?.trim().toLowerCase() || "unknown";
    const keyLevel =
      typeof digest?.keyLevel === "number" && Number.isFinite(digest.keyLevel)
        ? digest.keyLevel
        : 10;
    const timed =
      typeof digest?.timed === "boolean" ? digest.timed : (null as boolean | null);
    const completedAt =
      typeof digest?.completedAt === "string" ? digest.completedAt : null;
    const fightDurationMs =
      typeof digest?.fightDurationMs === "number" && digest.fightDurationMs > 0
        ? digest.fightDurationMs
        : null;
    const runScore =
      typeof digest?.runScore === "number" ? digest.runScore : null;

    const key = `${reportCode}:${fightId}:${reportRevision}`;
    if (byFight.has(key)) continue;

    byFight.set(key, {
      discoveryIdentity: { reportCode, fightId },
      reportRevision,
      dungeonSlug,
      keyLevel,
      timed,
      runScore,
      evidenceCompleteness: 1,
      completedAt,
      fightDurationMs,
      actorId: row.participantActorId,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: "persisted-digest",
    });
  }

  return [...byFight.values()];
}

/** Prefer higher completeness / resolved revision when merging fight identities. */
export function mergeEvidenceCandidates(
  primary: EvidenceCandidateMetadataV2[],
  supplemental: EvidenceCandidateMetadataV2[],
): EvidenceCandidateMetadataV2[] {
  const byKey = new Map<string, EvidenceCandidateMetadataV2>();
  const keyOf = (c: EvidenceCandidateMetadataV2) =>
    `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;

  for (const c of primary) {
    byKey.set(keyOf(c), c);
  }
  for (const c of supplemental) {
    const k = keyOf(c);
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, c);
      continue;
    }
    // Prefer a concrete reportRevision over null.
    if (existing.reportRevision == null && c.reportRevision != null) {
      byKey.set(k, { ...existing, reportRevision: c.reportRevision });
      continue;
    }
    if (
      (existing.evidenceCompleteness ?? 0) < (c.evidenceCompleteness ?? 0)
    ) {
      byKey.set(k, {
        ...c,
        reportRevision: c.reportRevision ?? existing.reportRevision,
      });
    }
  }
  return [...byKey.values()];
}
