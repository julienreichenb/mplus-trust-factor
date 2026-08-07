/**
 * Live acceptance: pick one unlinked companion from Wallidrixe's selected runs,
 * resolve via production path, verify CharacterRunDigest backfill + reuse.
 *
 * Usage (repo root, no DB reset):
 *   node tools/scripts/with-env.mjs pnpm --filter @mplus/worker exec tsx src/orchestration/scoring/live-digest-backfill-validate.cli.ts
 */
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createWorkerContainer } from "../../container.js";
import { resolveOrDiscoverPublicCharacter } from "../character-public-bootstrap.js";
import { backfillCharacterRunDigestLinks } from "../character-run-digest-backfill.js";
import { requireVerifiedSeasonAuthority } from "../season-authority.js";
import { ensureRegion } from "../../persistence/realm-repository.js";
import { buildCandidatesFromPersistedDigests } from "./digest-candidates.js";

async function main() {
  resetEnvCache();
  const env = loadEnv();
  const container = createWorkerContainer(env);
  const { prisma, providers, logger } = container;

  const wall = await prisma.character.findFirst({
    where: {
      normalizedName: "wallidrixe",
      region: { code: "EU" },
      realm: { slug: "archimonde" },
    },
    select: { id: true, displayName: true },
  });
  if (!wall) {
    throw new Error("Wallidrixe Character not found — run cold smoke first");
  }

  const wallDigests = await prisma.characterRunDigest.findMany({
    where: { characterId: wall.id },
    select: {
      id: true,
      rawRunId: true,
      characterName: true,
      realmSlug: true,
      regionCode: true,
      participantActorId: true,
    },
  });
  const rawRunIds = [...new Set(wallDigests.map((d) => d.rawRunId))];
  console.log(
    JSON.stringify(
      {
        wallidrixe: {
          characterId: wall.id,
          digestCount: wallDigests.length,
          uniqueRawRuns: rawRunIds.length,
        },
      },
      null,
      2,
    ),
  );

  const companions = await prisma.characterRunDigest.groupBy({
    by: ["characterName", "realmSlug", "regionCode"],
    where: {
      rawRunId: { in: rawRunIds },
      characterId: null,
      NOT: {
        AND: [
          { characterName: { equals: "Wallidrixe", mode: "insensitive" } },
          { realmSlug: { equals: "archimonde", mode: "insensitive" } },
        ],
      },
    },
    _count: { _all: true },
    orderBy: { _count: { characterName: "desc" } },
  });

  console.log(
    JSON.stringify(
      {
        unlinkedCompanionIdentities: companions.slice(0, 15).map((c) => ({
          characterName: c.characterName,
          realmSlug: c.realmSlug,
          regionCode: c.regionCode,
          digestCount: c._count._all,
        })),
      },
      null,
      2,
    ),
  );

  const pick = companions.find(
    (c) =>
      Boolean(c.characterName?.trim()) &&
      Boolean(c.realmSlug?.trim()) &&
      Boolean(c.regionCode?.trim()),
  );
  if (!pick) {
    throw new Error("No suitable unlinked companion with full identity");
  }

  const existingChar = await prisma.character.findFirst({
    where: {
      normalizedName: pick.characterName.trim().toLowerCase(),
      region: { code: { equals: pick.regionCode!, mode: "insensitive" } },
      realm: { slug: { equals: pick.realmSlug!, mode: "insensitive" } },
    },
    select: { id: true, displayName: true },
  });
  // Character may already exist from a prior partial validation run — still
  // exercise the production resolve path (already_complete → backfill).
  if (existingChar) {
    console.log(
      JSON.stringify(
        {
          note: "Companion Character already exists; will resolve + backfill",
          existingCharacterId: existingChar.id,
        },
        null,
        2,
      ),
    );
  }

  const beforeDigests = await prisma.characterRunDigest.findMany({
    where: {
      characterId: null,
      characterName: { equals: pick.characterName, mode: "insensitive" },
      realmSlug: { equals: pick.realmSlug!, mode: "insensitive" },
      regionCode: { equals: pick.regionCode!, mode: "insensitive" },
    },
    select: { id: true, rawRunId: true },
  });

  const allParticipantShape = await prisma.characterRunDigest.groupBy({
    by: ["rawRunId"],
    where: { rawRunId: { in: rawRunIds } },
    _count: { _all: true },
  });
  const participantCounts = allParticipantShape.map((r) => r._count._all);
  console.log(
    JSON.stringify(
      {
        selectedCompanion: {
          characterName: pick.characterName,
          realmSlug: pick.realmSlug,
          regionCode: pick.regionCode,
          unlinkedDigestCountBefore: beforeDigests.length,
          rawRunIdsSample: beforeDigests.slice(0, 5).map((d) => d.rawRunId),
        },
        participantDigestCountsPerWallRun: {
          min: Math.min(...participantCounts),
          max: Math.max(...participantCounts),
          distinct: [...new Set(participantCounts)].sort((a, b) => a - b),
          wallRawRuns: rawRunIds.length,
        },
      },
      null,
      2,
    ),
  );

  const regionRow = await ensureRegion(
    prisma,
    pick.regionCode!.toUpperCase() as "EU" | "US" | "KR" | "TW" | "CN",
  );
  const authority = await requireVerifiedSeasonAuthority(
    { prisma, blizzard: providers.blizzard, logger },
    regionRow.code,
    regionRow.id,
    { allowProviderSync: true, correlationId: null },
  );
  const resolveStarted = Date.now();
  const resolved = await resolveOrDiscoverPublicCharacter({
    prisma,
    characterRepository: container.repositories.character,
    blizzard: providers.blizzard,
    identity: {
      region: pick.regionCode!.toUpperCase() as "EU" | "US" | "KR" | "TW" | "CN",
      realmSlug: pick.realmSlug!,
      name: pick.characterName,
    },
    authority,
    correlationId: `live-digest-backfill-${Date.now()}`,
  });
  const resolveMs = Date.now() - resolveStarted;

  const linkedAfter = await prisma.characterRunDigest.findMany({
    where: { characterId: resolved.character.id },
    select: { id: true, rawRunId: true, characterName: true, realmSlug: true },
  });

  const unexpectedLinks = linkedAfter.filter(
    (d) =>
      d.characterName.trim().toLowerCase() !==
        pick.characterName.trim().toLowerCase() ||
      (d.realmSlug ?? "").toLowerCase() !== (pick.realmSlug ?? "").toLowerCase(),
  );

  const second = await backfillCharacterRunDigestLinks({
    prisma,
    characterId: resolved.character.id,
  });

  const candidates = await buildCandidatesFromPersistedDigests({
    prisma,
    characterId: resolved.character.id,
  });

  console.log(
    JSON.stringify(
      {
        resolve: {
          characterId: resolved.character.id,
          reason: resolved.reason,
          bootstrapPerformed: resolved.bootstrapPerformed,
          blizzardProviderCalls: resolved.providerCalls,
          resolveMs,
        },
        linking: {
          digestsLinkedToCharacter: linkedAfter.length,
          expectedAtLeast: beforeDigests.length,
          unexpectedForeignNameOrRealm: unexpectedLinks.length,
          secondBackfill: {
            linked: second.linked,
            matched: second.matched,
            alreadyLinked: second.alreadyLinked,
          },
          reusableCandidatesFromDigests: candidates.length,
        },
        note:
          "Detailed WCL ReportEvents for already-persisted matching runs should be 0 on a subsequent refresh when digests are reusable; measure via normal warm/replay smoke with provider instrumentation.",
      },
      null,
      2,
    ),
  );

  if (linkedAfter.length < beforeDigests.length) {
    throw new Error(
      `Backfill incomplete: linked ${linkedAfter.length} < before ${beforeDigests.length}`,
    );
  }
  if (unexpectedLinks.length > 0) {
    throw new Error(`Linked unrelated digests: ${unexpectedLinks.length}`);
  }
  if (second.linked !== 0) {
    throw new Error(`Idempotency failed: second backfill linked ${second.linked}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
});
