/**
 * Opt-in live example for previous-season regional class rank.
 *   EXPERIENCE_LIVE_SMOKE=1 pnpm exec vitest run apps/worker/src/orchestration/scoring/experience-class-rank.live.example.test.ts
 */
import { describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createRaiderIoProvider } from "@mplus/provider-raiderio";
import {
  calculateExperiencePhase1,
  scoreRegionalClassRankFloor,
  usablePreviousRegionalClassRank,
} from "@mplus/scoring";
import { previousRegionalClassRankFromRioProfile } from "./experience-phase1.js";

const RUN = process.env.EXPERIENCE_LIVE_SMOKE === "1";
const REALM = process.env.EXPERIENCE_SMOKE_REALM ?? "ysondre";
const NAME = process.env.EXPERIENCE_SMOKE_NAME ?? "Lfgmasochist";

describe.runIf(RUN)("live previous-season regional class rank", () => {
  it(
    "fetches previousRanks.classRank.region on the existing profile call",
    async () => {
      resetEnvCache();
      loadEnv();
      const rio = createRaiderIoProvider("live");
      const result = await rio.getCharacterProfile(
        { region: "EU", realmSlug: REALM, name: NAME },
        {
          region: "EU",
          requestId: `class-rank-live:${Date.now()}`,
          correlationId: "class-rank-live",
          forceRefresh: true,
          now: new Date().toISOString(),
        },
      );

      const profile = result.data;
      const usable = usablePreviousRegionalClassRank(profile.previousRanks);
      const fromHelper = previousRegionalClassRankFromRioProfile(profile);
      const floor = scoreRegionalClassRankFloor(usable);
      const experience = calculateExperiencePhase1({
        previous: { state: "UNAVAILABLE", reason: "LIVE_EXAMPLE_STANDING_SKIPPED" },
        elite: { confirmedCount: 0 },
        previousRegionalClassRank: usable,
      });

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            character: `${NAME}-${REALM}`,
            schemaVersion: result.metadata.schemaVersion,
            previousSeasonSlug: profile.previousSeason?.seasonSlug ?? null,
            previousSeasonScore: profile.previousSeason?.scores.all ?? null,
            previousOverallRegion: profile.previousRanks?.region ?? null,
            previousClassRegion: profile.previousRanks?.classRank.region ?? null,
            usableClassRegion: usable,
            classRankFloor: floor,
            experienceFromClassRankAlone: experience.score,
          },
          null,
          2,
        ),
      );

      expect(fromHelper).toBe(usable);
      expect(profile.previousRanks).not.toBeNull();
      expect(profile.previousRanks?.classRank.region).toBeTypeOf("number");
      // Must not confuse overall regional rank with class regional rank.
      expect(profile.previousRanks?.region).not.toBe(
        profile.previousRanks?.classRank.region,
      );
    },
    60_000,
  );
});
