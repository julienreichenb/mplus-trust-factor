/**
 * Read-only DB probes for cohort bootstrap planning.
 */
import type { PrismaClient } from "@mplus/database";
import type { BootstrapIdentity, DbCharacterProbe } from "./cohort-bootstrap-types.js";

function incompleteBootstrap(row: {
  level: number | null;
  blizzardCharacterId: bigint | null;
  classId: string | null;
  activeSpecId: string | null;
  role: string | null;
}): boolean {
  return (
    row.level == null ||
    row.blizzardCharacterId == null ||
    row.classId == null ||
    row.activeSpecId == null ||
    row.role == null
  );
}

function jobErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export async function probeIdentityInDb(
  prisma: PrismaClient,
  identity: BootstrapIdentity,
): Promise<DbCharacterProbe | null> {
  const rows = await prisma.character.findMany({
    where: {
      normalizedName: identity.normalizedName,
      realm: { slug: identity.realmSlug },
      region: { code: identity.region },
    },
    select: {
      id: true,
      level: true,
      blizzardCharacterId: true,
      classId: true,
      activeSpecId: true,
      role: true,
    },
    take: 2,
  });
  if (rows.length === 0) return null;
  const row = rows[0]!;

  const [snapshot, activeJob, latestJob] = await Promise.all([
    prisma.scoreSnapshot.findFirst({
      where: {
        characterId: row.id,
        isPublic: true,
        publicationStatus: { in: ["PUBLIC", "PUBLISHED"] },
        scopeType: "CHARACTER",
      },
      select: { id: true },
      orderBy: { calculatedAt: "desc" },
    }),
    prisma.ingestionJob.findFirst({
      where: {
        characterId: row.id,
        jobType: "refresh-character",
        status: { in: ["QUEUED", "ACTIVE"] },
      },
      select: { id: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ingestionJob.findFirst({
      where: {
        characterId: row.id,
        jobType: "refresh-character",
      },
      select: { id: true, status: true, error: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    characterId: row.id,
    incompleteBootstrap: incompleteBootstrap(row),
    hasPublicSnapshot: snapshot != null,
    activeJobId: activeJob?.id ?? null,
    activeJobStatus:
      activeJob?.status === "ACTIVE" || activeJob?.status === "QUEUED" ? activeJob.status : null,
    latestJobId: latestJob?.id ?? null,
    latestJobStatus: latestJob?.status ?? null,
    latestJobErrorCode: jobErrorCode(latestJob?.error),
  };
}

export async function probeAllIdentities(
  prisma: PrismaClient,
  identities: BootstrapIdentity[],
): Promise<Map<string, DbCharacterProbe | null>> {
  const out = new Map<string, DbCharacterProbe | null>();
  // Sequential reads — planning is read-only and must not stampede the DB.
  for (const identity of identities) {
    out.set(identity.identityKey, await probeIdentityInDb(prisma, identity));
  }
  return out;
}
