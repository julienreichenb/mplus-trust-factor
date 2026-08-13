/**
 * Agent 05 — live Wallidrixe Experience acceptance probe.
 *
 *   node tools/scripts/with-env.mjs pnpm --filter @mplus/worker exec tsx src/orchestration/scoring/experience-agent05-live-probe.ts
 *
 * Destructive evidence reset is OFF by default. To force cold mode:
 *   EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET=true
 * and APP_ENV must not be production/staging.
 */
import { loadEnv, resetEnvCache } from "@mplus/config";
import {
  createPrismaClient,
  createCharacterExperienceEvidenceRepository,
} from "@mplus/database";
import { LiveBlizzardProvider } from "@mplus/provider-blizzard";
import { createRaiderIoProvider } from "@mplus/provider-raiderio";
import { bootstrapExperienceSeasonMetadata } from "./experience-season-bootstrap.js";
import { buildExperiencePhase1Result } from "./experience-phase1.js";
import { readExperiencePopulationPolicyMetadata } from "./experience-season-population-policy-metadata.js";
import { resolvePreviousMythicSeason } from "./experience-previous-season-evidence.js";
import { assertExperienceLiveProbeDestructiveResetAllowed } from "./experience-agent05-live-probe-guards.js";
import { peekEffectiveScoringSeasonRow } from "../active-mplus-season/effective-season-peek.js";

resetEnvCache();
const env = loadEnv();
const REGION = "EU" as const;
const REALM = "archimonde";
const NAME = "Wallidrixe";

const prisma = createPrismaClient(env.DATABASE_URL!);
const blizzard = new LiveBlizzardProvider({
  clientId: env.BLIZZARD_CLIENT_ID!,
  clientSecret: env.BLIZZARD_CLIENT_SECRET!,
  defaultRegion: "eu",
});
const raiderIo = createRaiderIoProvider("live");
const regions = await prisma.region.findMany({ select: { id: true, code: true } });

const bootstrap = await bootstrapExperienceSeasonMetadata({
  prisma,
  regions,
  blizzard,
  raiderIo,
  persistProviderResult: async () => null,
  logger: { info: () => undefined, warn: () => undefined },
  allowProviderCalls: true,
});

const region = regions.find((r) => r.code.toUpperCase() === REGION);
if (!region) throw new Error("EU region missing");

const seasonRows = await prisma.season.findMany({
  where: { regionId: region.id },
  select: {
    id: true,
    slug: true,
    blizzardSeasonId: true,
    startsAt: true,
    endsAt: true,
    providerSeasonId: true,
    isCurrent: true,
    metadata: true,
    regionId: true,
  },
  orderBy: { startsAt: "asc" },
});

const euBoot = bootstrap.regions.find((r) => r.region === REGION);
const peek = await peekEffectiveScoringSeasonRow(prisma, { regionId: region.id });
const current =
  (peek ? seasonRows.find((s) => s.id === peek.id) : null) ?? null;

let previous =
  (euBoot?.previousSeasonId
    ? seasonRows.find((s) => s.id === euBoot.previousSeasonId)
    : null) ?? null;

if (!previous && current) {
  const binding = resolvePreviousMythicSeason(
    {
      id: current.id,
      regionId: current.regionId,
      slug: current.slug,
      blizzardSeasonId: current.blizzardSeasonId,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
    },
    seasonRows.map((s) => ({
      id: s.id,
      regionId: s.regionId,
      slug: s.slug,
      blizzardSeasonId: s.blizzardSeasonId,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    })),
  );
  if (binding.ok) previous = seasonRows.find((s) => s.id === binding.season.id) ?? null;
}

const policy = previous ? readExperiencePopulationPolicyMetadata(previous.metadata) : null;

const character = await prisma.character.findFirst({
  where: {
    OR: [
      { id: "cbbbd732-8c82-4364-b63c-a94a548765e0" },
      { normalizedName: "wallidrixe", realm: { slug: REALM, region: { code: REGION } } },
      { displayName: { equals: NAME, mode: "insensitive" }, realm: { slug: REALM } },
    ],
  },
  select: { id: true, displayName: true, normalizedName: true },
});

const evidenceStore = createCharacterExperienceEvidenceRepository(prisma);
const ctxBase = {
  region: REGION,
  requestId: `agent05-live:${Date.now()}`,
  correlationId: null as string | null,
  forceRefresh: false,
  now: new Date().toISOString(),
};

const counts = { blizzardHistorical: 0, achievements: 0, rioHistorical: 0 };

async function runOnce(label: string, allowProviderCalls: boolean) {
  if (!character || !current) {
    return { label, error: "missing character or current season" as const };
  }
  const built = await buildExperiencePhase1Result({
    prisma,
    characterId: character.id,
    identity: { region: REGION, realmSlug: REALM, name: NAME },
    currentSeasonId: current.id,
    regionCode: REGION,
    blizzard: {
      getMythicKeystoneSeasonProfile: async (identity, seasonId, fetchCtx) => {
        counts.blizzardHistorical += 1;
        return blizzard.getMythicKeystoneSeasonProfile(identity, seasonId, fetchCtx);
      },
      getCharacterAchievements: async (identity, fetchCtx) => {
        counts.achievements += 1;
        return blizzard.getCharacterAchievements(identity, fetchCtx);
      },
    },
    ctx: { ...ctxBase, requestId: `${ctxBase.requestId}:${label}` },
    persistProviderResult: async () => null,
    allowProviderCalls,
    evidenceStore,
    boundPreviousRaiderIoSlug:
      previous?.providerSeasonId ?? euBoot?.previousRaiderIoSlug ?? null,
    raiderIoExactSeason: {
      getCharacterExactSeasonHistoricalRating: async (identity, seasonSlug, fetchCtx) => {
        counts.rioHistorical += 1;
        return raiderIo.getCharacterExactSeasonHistoricalRating(
          identity,
          seasonSlug,
          fetchCtx,
        );
      },
    },
  });
  return {
    label,
    previousSeasonProfileCalls: built.previousSeasonProfileCalls,
    achievementsCalls: built.achievementsCalls,
    raiderIoHistoricalRatingCalls: built.raiderIoHistoricalRatingCalls,
    previousSeasonRatingFromCache: built.previousSeasonRatingFromCache,
    eliteFromCache: built.eliteFromCache,
    diagnostics: built.diagnostics,
    experience: built.experience,
  };
}

const destructiveResetRequested =
  String(process.env.EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET ?? "")
    .trim()
    .toLowerCase() === "true" ||
  String(process.env.EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET ?? "")
    .trim() === "1";

let destructiveResetApplied = false;
if (destructiveResetRequested && character && previous && current) {
  assertExperienceLiveProbeDestructiveResetAllowed({
    EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET:
      process.env.EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET,
    APP_ENV: env.APP_ENV ?? process.env.APP_ENV,
  });
  await prisma.characterExperienceEvidence.deleteMany({
    where: { characterId: character.id, seasonId: previous.id },
  });
  await prisma.characterExperienceEvidence.deleteMany({
    where: {
      characterId: character.id,
      seasonId: current.id,
      evidenceKind: "ELITE_CUTOFF_HISTORY",
    },
  });
  destructiveResetApplied = true;
}

counts.blizzardHistorical = 0;
counts.achievements = 0;
counts.rioHistorical = 0;
const cold = await runOnce("cold", true);
const coldCounts = { ...counts };

counts.blizzardHistorical = 0;
counts.achievements = 0;
counts.rioHistorical = 0;
const warm = await runOnce("warm", true);
const warmCounts = { ...counts };

counts.blizzardHistorical = 0;
counts.achievements = 0;
counts.rioHistorical = 0;
const replay = await runOnce("replay", false);
const replayCounts = { ...counts };

const persistedEvidence = character
  ? await prisma.characterExperienceEvidence.findMany({
      where: { characterId: character.id },
      select: {
        seasonId: true,
        evidenceKind: true,
        compatibilityVersion: true,
        state: true,
        source: true,
        blizzardSeasonId: true,
        raiderIoSeasonSlug: true,
      },
    })
  : [];

const score = character
  ? await prisma.characterScore.findFirst({
      where: { characterId: character.id, seasonId: current?.id },
      orderBy: { calculatedAt: "desc" },
      select: {
        id: true,
        performance: true,
        survival: true,
        utility: true,
        experience: true,
        composite: true,
        confidence: true,
        tier: true,
        dimensionDetails: true,
      },
    })
  : null;

const details =
  score?.dimensionDetails && typeof score.dimensionDetails === "object"
    ? (score.dimensionDetails as Record<string, unknown>)
    : null;

console.log(
  JSON.stringify(
    {
      character: { region: REGION, realm: REALM, name: NAME, id: character?.id ?? null },
      bootstrap: {
        reasons: euBoot?.reasons ?? [],
        previousSeasonId: euBoot?.previousSeasonId ?? null,
        previousRaiderIoSlug: euBoot?.previousRaiderIoSlug ?? null,
        policySync: euBoot?.policySync ?? null,
        seasonIndexCalls: bootstrap.seasonIndexCalls,
        staticDataCalls: bootstrap.staticDataCalls,
        seasonCutoffsCalls: bootstrap.seasonCutoffsCalls,
        wclCalls: bootstrap.wclCalls,
      },
      seasons: {
        current: current && {
          id: current.id,
          slug: current.slug,
          blizzardSeasonId: current.blizzardSeasonId,
          startsAt: current.startsAt,
          endsAt: current.endsAt,
          providerSeasonId: current.providerSeasonId,
          isCurrent: current.isCurrent,
        },
        previous: previous && {
          id: previous.id,
          slug: previous.slug,
          blizzardSeasonId: previous.blizzardSeasonId,
          startsAt: previous.startsAt,
          endsAt: previous.endsAt,
          providerSeasonId: previous.providerSeasonId,
        },
      },
      populationPolicy: policy && {
        version: policy.policy.version,
        schemaVersion: policy.schemaVersion,
        region: policy.policy.region,
        seasonSlug: policy.policy.seasonSlug,
        quality: policy.policy.quality,
        anchors: policy.policy.anchors.map((a) => ({
          quantile: a.nativeQuantile,
          score: a.score,
        })),
      },
      cold,
      warm,
      replay,
      callMatrix: { cold: coldCounts, warm: warmCounts, replay: replayCounts },
      destructiveResetApplied,
      persistedEvidence,
      characterScore: score && {
        id: score.id,
        performance: score.performance,
        survival: score.survival,
        utility: score.utility,
        experience: score.experience,
        composite: score.composite,
        confidence: score.confidence,
        tier: score.tier,
        experienceDetails: details?.experience ?? null,
      },
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
