/**
 * Live Experience E2E smoke (opt-in).
 *
 *   EXPERIENCE_LIVE_SMOKE=1 pnpm exec vitest run apps/worker/src/orchestration/scoring/experience-phase1.live.smoke.test.ts
 *
 * Note: Raider.IO static-data for Midnight may lack a chronological previous season
 * (only current + future). Previous population policy then stays unset unless LKG exists.
 * Fixture E2E covers the full standing+policy path.
 */
import { describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { LiveBlizzardProvider } from "@mplus/provider-blizzard";
import { createRaiderIoProvider } from "@mplus/provider-raiderio";
import type { EvidenceCandidateMetadataV2, ProviderFetchContext, RegionCode } from "@mplus/contracts";
import { estimatePreviousSeasonStanding } from "@mplus/scoring";
import { bootstrapExperienceSeasonMetadata } from "./experience-season-bootstrap.js";
import { buildExperiencePhase1Result } from "./experience-phase1.js";
import {
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  readExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";
import { scoreCharacter, SCORING_VERSION } from "./score-character.js";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";

const live = process.env.EXPERIENCE_LIVE_SMOKE === "1";

function dungeonCandidates(): EvidenceCandidateMetadataV2[] {
  const dungeons = [
    "ara-kara",
    "city-of-threads",
    "the-dawnbreaker",
    "the-stonevault",
    "mists-of-tirna-scithe",
    "the-necrotic-wake",
    "siege-of-boralus",
    "grim-batol",
  ];
  return dungeons.flatMap((slug, i) => [
    {
      discoveryIdentity: { reportCode: `L${i}A`, fightId: 1 },
      reportRevision: 1,
      dungeonSlug: slug,
      keyLevel: 12,
      timed: true,
      runScore: 200,
      evidenceCompleteness: 1,
      completedAt: "2026-01-01T00:00:00.000Z",
      fightDurationMs: 1_800_000,
      actorId: 1,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: "live-smoke",
    },
    {
      discoveryIdentity: { reportCode: `L${i}B`, fightId: 2 },
      reportRevision: 1,
      dungeonSlug: slug,
      keyLevel: 11,
      timed: true,
      runScore: 180,
      evidenceCompleteness: 1,
      completedAt: "2026-01-02T00:00:00.000Z",
      fightDurationMs: 1_700_000,
      actorId: 1,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: "live-smoke",
    },
  ]);
}

describe.runIf(live)("Experience Phase 1 live smoke", () => {
  it(
    "bootstraps seasons and scores Wallidrixe Experience without per-char RIO/WCL",
    { timeout: 180_000 },
    async () => {
      resetEnvCache();
      const env = loadEnv();
      expect(env.BLIZZARD_CLIENT_ID).toBeTruthy();
      expect(env.BLIZZARD_CLIENT_SECRET).toBeTruthy();

      const REGION = (env.BLIZZARD_DEFAULT_REGION ?? "eu").toUpperCase() as RegionCode;
      const REALM = process.env.EXPERIENCE_SMOKE_REALM ?? "archimonde";
      const NAME = process.env.EXPERIENCE_SMOKE_NAME ?? "Wallidrixe";

      const prisma = createPrismaClient(env.DATABASE_URL);
      const blizzard = new LiveBlizzardProvider({
        clientId: env.BLIZZARD_CLIENT_ID,
        clientSecret: env.BLIZZARD_CLIENT_SECRET,
        defaultRegion: REGION.toLowerCase() as "eu" | "us" | "kr" | "tw",
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

      expect(bootstrap.wclCalls).toBe(0);
      expect(bootstrap.staticDataCalls).toBeGreaterThanOrEqual(1);
      expect(bootstrap.seasonIndexCalls).toBe(regions.length);
      expect(bootstrap.seasonDetailCalls).toBeGreaterThanOrEqual(0);

      const region = regions.find((r) => r.code.toUpperCase() === REGION);
      expect(region).toBeTruthy();

      const seasonRows = await prisma.season.findMany({
        where: { regionId: region!.id },
        select: {
          id: true,
          slug: true,
          blizzardSeasonId: true,
          startsAt: true,
          endsAt: true,
          providerSeasonId: true,
          isCurrent: true,
          metadata: true,
        },
      });

      const current = seasonRows.find((s) => s.isCurrent);
      expect(current).toBeTruthy();
      expect(current!.startsAt).toBeTruthy();
      expect(current!.providerSeasonId).toBeTruthy();

      const prevId =
        bootstrap.regions.find((r) => r.region === REGION)?.previousSeasonId ?? null;
      expect(prevId).toBeTruthy();
      const previous = seasonRows.find((s) => s.id === prevId!);
      expect(previous).toBeTruthy();
      expect(previous!.startsAt).toBeTruthy();
      expect(previous!.providerSeasonId).toBeTruthy();
      const euBoot = bootstrap.regions.find((r) => r.region === REGION);
      expect(euBoot?.previousRaiderIoSlug).toBeTruthy();
      expect(euBoot?.reasons).toContain("PREVIOUS_RIO_BOUND_VIA_PREVIOUS_EXPANSION");
      expect(bootstrap.staticDataCalls).toBeGreaterThanOrEqual(2);
      // Population sync is attempted; historical cutoffs may be incomplete (NO_USABLE_POLICY).
      expect(euBoot?.policySync).not.toBeNull();
      expect(
        ["UPDATED", "RETAINED_LAST_KNOWN_GOOD", "NO_USABLE_POLICY", "PROVIDER_FAILURE", "VALIDATION_FAILED"].includes(
          euBoot!.policySync!.status,
        ),
      ).toBe(true);
      const policy = readExperiencePopulationPolicyMetadata(previous!.metadata);

      const ctx: ProviderFetchContext = {
        region: REGION,
        requestId: `experience-live-smoke:${Date.now()}`,
        correlationId: null,
        forceRefresh: false,
        now: new Date().toISOString(),
      };

      const blizzardCalls = { profile: 0, achievements: 0 };
      const built = await buildExperiencePhase1Result({
        prisma,
        characterId: "live-smoke-character",
        identity: { region: REGION, realmSlug: REALM, name: NAME },
        currentSeasonId: current!.id,
        regionCode: REGION,
        blizzard: {
          getMythicKeystoneSeasonProfile: async (identity, seasonId, fetchCtx) => {
            blizzardCalls.profile += 1;
            return blizzard.getMythicKeystoneSeasonProfile(identity, seasonId, fetchCtx);
          },
          getCharacterAchievements: async (identity, fetchCtx) => {
            blizzardCalls.achievements += 1;
            return blizzard.getCharacterAchievements(identity, fetchCtx);
          },
        },
        ctx,
        persistProviderResult: async () => null,
        allowProviderCalls: true,
      });

      expect(blizzardCalls.profile).toBeLessThanOrEqual(1);
      expect(blizzardCalls.achievements).toBe(1);

      let rating: number | null = null;
      let nativeBand: string | null = null;
      let standingScore: number | null = null;
      if (previous!.blizzardSeasonId != null && built.previousSeasonProfileCalls > 0) {
        try {
          const peek = await blizzard.getMythicKeystoneSeasonProfile(
            { region: REGION, realmSlug: REALM, name: NAME },
            previous!.blizzardSeasonId,
            { ...ctx, requestId: `${ctx.requestId}:peek` },
          );
          rating = peek.data.profile.currentMythicRating;
          if (rating != null && policy) {
            const est = estimatePreviousSeasonStanding(rating, policy.policy);
            if (est.ok) {
              nativeBand = est.standing.nativeBand;
              standingScore = est.standing.standingScore;
            }
          }
        } catch (err) {
          // 404 / privacy is expected for some characters; Experience path already handled it.
          rating = null;
          console.log(
            "previous_rating_peek_failed",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      const saved: Array<Record<string, unknown>> = [];
      const baseline: Array<Record<string, unknown>> = [];
      const fakePrisma = (sink: Array<Record<string, unknown>>) =>
        ({
          scoreModel: { findUnique: async () => ({ config: {} }) },
          characterScore: {
            upsert: async ({ create }: { create: Record<string, unknown> }) => {
              const row = { id: `score-${sink.length + 1}`, ...create };
              sink.push(row);
              return row;
            },
          },
        }) as never;

      const ensureUnavailable = async () => ({
        state: "UNAVAILABLE" as const,
        data: null,
        reason: "live_smoke_no_aggregate",
        cache: "MISS" as const,
        providerCalls: 0,
        created: false as const,
        updated: false as const,
        aggregateRowId: null,
        contentHash: null,
      });

      const baseInput = {
        identity: {
          characterId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          region: REGION,
          realm: REALM,
          characterName: NAME,
        },
        seasonId: current!.id,
        seasonSlug: current!.slug,
        role: "DPS" as const,
        classSlug: "mage",
        specSlug: "fire",
        activeDungeonSlugs: dungeonCandidates().map((c) => c.dungeonSlug),
        candidates: dungeonCandidates(),
        evidenceCutoffAt: new Date().toISOString(),
        highKeyPolicyId: "policy-live",
        scoringModelId: "model-live",
        allowProviderCalls: false,
        zoneId: 47,
        ensurePerformanceAggregate: ensureUnavailable,
        ports: createMemoryOrchestrationPorts(),
        artifacts: {} as never,
        evidence: {} as never,
      };

      await scoreCharacter({ ...baseInput, prisma: fakePrisma(baseline) });
      await scoreCharacter({
        ...baseInput,
        experience: built.experience,
        prisma: fakePrisma(saved),
      });

      expect(saved[0]!.experience).toBe(built.experience.score);
      expect(saved[0]!.performance).toBe(baseline[0]!.performance);
      expect(saved[0]!.survival).toBe(baseline[0]!.survival);
      expect(saved[0]!.utility).toBe(baseline[0]!.utility);
      if (built.experience.available) {
        expect(saved[0]!.composite).not.toBe(baseline[0]!.composite);
      }

      console.log(
        JSON.stringify(
          {
            scenario: `${REGION}/${REALM}/${NAME}`,
            scoringVersion: SCORING_VERSION,
            currentSeason: {
              slug: current!.slug,
              blizzardSeasonId: current!.blizzardSeasonId,
              startsAt: current!.startsAt,
              endsAt: current!.endsAt,
              providerSeasonId: current!.providerSeasonId,
            },
            previousSeason: {
              slug: previous!.slug,
              blizzardSeasonId: previous!.blizzardSeasonId,
              startsAt: previous!.startsAt,
              endsAt: previous!.endsAt,
              providerSeasonId: previous!.providerSeasonId,
              hasPopulationPolicy: !!policy,
              metadataKey: EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
            },
            previousRating: rating,
            nativeBand,
            standingScore,
            experience: built.experience,
            diagnostics: built.diagnostics,
            persistedExperience: saved[0]!.experience,
            compositeWith: saved[0]!.composite,
            compositeWithout: baseline[0]!.composite,
            bootstrapReasons: bootstrap.regions.find((r) => r.region === REGION)?.reasons ?? [],
            providerCalls: {
              bootstrap: {
                staticData: bootstrap.staticDataCalls,
                seasonIndex: bootstrap.seasonIndexCalls,
                seasonDetail: bootstrap.seasonDetailCalls,
                seasonCutoffs: bootstrap.seasonCutoffsCalls,
                wcl: bootstrap.wclCalls,
              },
              character: {
                blizzardProfile: blizzardCalls.profile,
                blizzardAchievements: blizzardCalls.achievements,
                raiderIoCutoffs: 0,
                wcl: 0,
              },
            },
          },
          null,
          2,
        ),
      );

      await prisma.$disconnect();
    },
  );
});
