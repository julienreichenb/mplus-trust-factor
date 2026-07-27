import { describe, expect, it } from "vitest";
import type { RaiderIoBoostSupportFacts } from "@mplus/contracts";
import { mapBoostFactsToAuthenticity } from "./boost-authenticity.js";

const sampleFacts: RaiderIoBoostSupportFacts = {
  targetCharacterKey: "EU:tarren-mill:fixtureplayer",
  snapshotAt: "2026-07-27T12:00:00.000Z",
  currentSeasonScore: 2800,
  previousSeasonScore: 1200,
  currentRanks: null,
  runs: [],
  teammateRecurrence: [
    { providerCharacterKey: "ally-1", sharedRunCount: 6, averageTeammateScore: 3200 },
  ],
  representedRunCount: 8,
  historyIncomplete: true,
  attribution: {
    provider: "raiderio",
    displayText: "Data from Raider.IO",
    homepageUrl: "https://raider.io",
    profileUrl: null,
    sourceUrl: "https://raider.io",
  },
};

describe("mapBoostFactsToAuthenticity", () => {
  it("maps teammate recurrence and low volume into authenticity features", () => {
    const features = mapBoostFactsToAuthenticity(sampleFacts);
    expect(features.repeatedStrongerTeammates).toBeGreaterThan(0);
    expect(features.lowVolumeForScore).toBeGreaterThan(0);
    expect(features.progressionKeyJump).toBeGreaterThan(0);
    expect(features.lackIntermediateProgression).toBeGreaterThan(0);
  });
});
