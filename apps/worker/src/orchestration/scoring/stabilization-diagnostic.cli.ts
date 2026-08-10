/**
 * Agent 01 — provider-free scoring stabilization diagnostic (read-only).
 *
 * Dumps local Character / eligibility evidence / CharacterScore / Experience
 * season binding for forensic analysis. Never calls providers or mutates rows.
 *
 *   pnpm --filter @mplus/worker exec tsx src/orchestration/scoring/stabilization-diagnostic.cli.ts \
 *     --region EU --realm archimonde --character Wallidrixe
 */
import { loadEnv } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { readExperiencePopulationPolicyMetadata } from "./experience-season-population-policy-metadata.js";

function argValue(argv: string[], name: string): string | null {
  const cleaned = argv.filter((a) => a !== "--");
  const idx = cleaned.indexOf(name);
  if (idx < 0) return null;
  return cleaned[idx + 1] ?? null;
}

function requireArg(argv: string[], name: string, envFallback?: string): string {
  const fromArg = argValue(argv, name);
  if (fromArg && fromArg.trim()) return fromArg.trim();
  if (envFallback && process.env[envFallback]?.trim()) {
    return process.env[envFallback]!.trim();
  }
  throw new Error(`Missing required ${name} (or env ${envFallback ?? "n/a"})`);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const region = requireArg(argv, "--region", "STABILIZATION_DIAG_REGION").toUpperCase();
  const realm = requireArg(argv, "--realm", "STABILIZATION_DIAG_REALM").toLowerCase();
  const characterName = requireArg(argv, "--character", "STABILIZATION_DIAG_CHARACTER");
  const normalizedName = normalizeName(characterName);

  loadEnv();
  const prisma = createPrismaClient();

  try {
    const character = await prisma.character.findFirst({
      where: {
        region: { code: region },
        realm: { slug: realm },
        normalizedName,
      },
      include: {
        region: { select: { code: true } },
        realm: { select: { slug: true, name: true } },
        gameClass: { select: { slug: true, name: true } },
        activeSpec: { select: { slug: true, name: true } },
      },
    });

    if (!character) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            code: "CHARACTER_NOT_FOUND_LOCALLY",
            mutation: false,
            providerCalls: 0,
            identity: { region, realm, characterName },
            hint: "Character must already exist in local DB — this CLI never creates rows.",
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }

    const ownership = await prisma.verifiedCharacterOwnership.findFirst({
      where: { characterId: character.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        currentSeasonMythicRating: true,
        currentSeasonMythicSeasonId: true,
        currentSeasonMythicFetchedAt: true,
        currentSeasonMythicSource: true,
        currentSeasonMythicState: true,
      },
    });

    // Prefer authoritative Blizzard-tagged current season over placeholder isCurrent rows.
    const currentSeason =
      (ownership?.currentSeasonMythicSeasonId
        ? await prisma.season.findUnique({ where: { id: ownership.currentSeasonMythicSeasonId } })
        : null) ??
      (await prisma.season.findFirst({
        where: {
          regionId: character.regionId,
          isCurrent: true,
          blizzardSeasonId: { not: null },
        },
        orderBy: { startsAt: "desc" },
      })) ??
      (await prisma.season.findFirst({
        where: { regionId: character.regionId, isCurrent: true },
      }));

    const previousSeason =
      currentSeason?.startsAt != null
        ? await prisma.season.findFirst({
            where: {
              regionId: character.regionId,
              startsAt: { lt: currentSeason.startsAt },
              blizzardSeasonId: { not: null, lt: 1000 },
              slug: { startsWith: "blizzard-season-" },
            },
            orderBy: { startsAt: "desc" },
          })
        : null;

    const snapshots = await prisma.characterSnapshot.findMany({
      where: { characterId: character.id },
      orderBy: { capturedAt: "desc" },
      take: 12,
      select: {
        id: true,
        capturedAt: true,
        mythicRating: true,
        rawSummary: true,
      },
    });

    const latestJob = await prisma.ingestionJob.findFirst({
      where: { characterId: character.id },
      orderBy: { scheduledAt: "desc" },
      select: {
        id: true,
        jobType: true,
        status: true,
        error: true,
        payload: true,
        scheduledAt: true,
        completedAt: true,
      },
    });

    const score = currentSeason
      ? await prisma.characterScore.findFirst({
          where: { characterId: character.id, seasonId: currentSeason.id },
          orderBy: { calculatedAt: "desc" },
        })
      : null;

    const experienceEvidence = previousSeason
      ? await prisma.characterExperienceEvidence.findMany({
          where: { characterId: character.id, seasonId: previousSeason.id },
          orderBy: { updatedAt: "desc" },
          take: 8,
          select: {
            id: true,
            evidenceKind: true,
            compatibilityVersion: true,
            state: true,
            source: true,
            payload: true,
            updatedAt: true,
          },
        })
      : [];

    const previousPolicy = previousSeason
      ? readExperiencePopulationPolicyMetadata(previousSeason.metadata)
      : null;

    const details =
      score?.dimensionDetails && typeof score.dimensionDetails === "object"
        ? (score.dimensionDetails as Record<string, unknown>)
        : null;

    console.log(
      JSON.stringify(
        {
          ok: true,
          mutation: false,
          providerCalls: 0,
          identity: {
            region,
            realm,
            characterName: character.displayName,
            characterId: character.id,
            level: character.level,
            classSlug: character.gameClass?.slug ?? null,
            specSlug: character.activeSpec?.slug ?? null,
            role: character.role,
            blizzardCharacterId: character.blizzardCharacterId?.toString() ?? null,
            bootstrapComplete:
              character.level != null &&
              character.blizzardCharacterId != null &&
              character.classId != null &&
              character.activeSpecId != null &&
              character.role != null,
          },
          seasons: {
            current: currentSeason
              ? {
                  id: currentSeason.id,
                  slug: currentSeason.slug,
                  blizzardSeasonId: currentSeason.blizzardSeasonId,
                  providerSeasonId: currentSeason.providerSeasonId,
                  startsAt: currentSeason.startsAt,
                  endsAt: currentSeason.endsAt,
                }
              : null,
            previous: previousSeason
              ? {
                  id: previousSeason.id,
                  slug: previousSeason.slug,
                  blizzardSeasonId: previousSeason.blizzardSeasonId,
                  providerSeasonId: previousSeason.providerSeasonId,
                  startsAt: previousSeason.startsAt,
                  endsAt: previousSeason.endsAt,
                  populationPolicyPresent: previousPolicy != null,
                  populationPolicyQuality: previousPolicy?.policy.quality ?? null,
                }
              : null,
          },
          problem1_eligibility: {
            ownership,
            recentSnapshots: snapshots,
            latestJob,
          },
          problem2_3_4_score: {
            scoreMeta: score
              ? {
                  id: score.id,
                  scoringVersion: score.scoringVersion,
                  performance: score.performance,
                  utility: score.utility,
                  survival: score.survival,
                  experience: score.experience,
                  composite: score.composite,
                  confidence: score.confidence,
                  calculatedAt: score.calculatedAt,
                }
              : null,
            dimensionDetails: details,
            explainability: details?.explainability ?? null,
          },
          problem4_experienceEvidence: experienceEvidence,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        mutation: false,
        providerCalls: 0,
        message: err instanceof Error ? err.message : String(err),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
