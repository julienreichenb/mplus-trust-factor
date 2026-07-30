import { describe, expect, it } from "vitest";
import type { AccountOwnedCharacterDTO } from "@mplus/contracts";
import {
  accountCharacterPortraitSrc,
  formatAccountMythicScore,
  isOwnedAccountCharacter,
  switcherCharactersExcludingCurrent,
} from "./accountCharacters";

function makeChar(
  overrides: Partial<AccountOwnedCharacterDTO> &
    Pick<AccountOwnedCharacterDTO, "ownershipId" | "name" | "realmSlug" | "region">,
): AccountOwnedCharacterDTO {
  return {
    characterId: null,
    level: 90,
    isPrimary: false,
    realmName: null,
    characterClass: { id: 8, slug: "mage", name: "Mage", color: "#3FC7EB" },
    media: { portraitUrl: null },
    currentSeasonMythic: {
      rating: null,
      seasonId: null,
      fetchedAt: null,
      source: null,
      state: null,
    },
    trustScore: {
      status: "NOT_REQUESTED",
      jobId: null,
      score: null,
      grade: null,
      confidence: null,
      modelVersion: null,
      calculatedAt: null,
      errorCode: null,
      errorMessage: null,
    },
    relevance: {
      policyVersion: "v1",
      eligible: true,
      reasons: [],
      evaluatedAt: null,
    },
    ...overrides,
  };
}

describe("accountCharacters helpers", () => {
  it("falls back portrait to class icon when media is missing", () => {
    const src = accountCharacterPortraitSrc(
      makeChar({ ownershipId: "1", name: "A", realmSlug: "kazzak", region: "EU" }),
    );
    expect(src).toContain("classicon_mage");
  });

  it("formats missing Mythic+ score as Non calculé", () => {
    expect(formatAccountMythicScore(null)).toBe("Non calculé");
    expect(formatAccountMythicScore(2145.6)).toBe("2146");
  });

  it("detects owned vs unrelated current character", () => {
    const roster = [
      makeChar({ ownershipId: "1", name: "Aleria", realmSlug: "tarren-mill", region: "EU" }),
    ];
    expect(
      isOwnedAccountCharacter(roster, {
        region: "eu",
        realmSlug: "tarren-mill",
        name: "aleria",
      }),
    ).toBe(true);
    expect(
      isOwnedAccountCharacter(roster, {
        region: "EU",
        realmSlug: "kazzak",
        name: "Carryme",
      }),
    ).toBe(false);
  });

  it("excludes current character and sorts by Mythic+ descending with missing last", () => {
    const roster = [
      makeChar({
        ownershipId: "1",
        name: "Current",
        realmSlug: "tarren-mill",
        region: "EU",
        currentSeasonMythic: {
          rating: 3000,
          seasonId: "s1",
          fetchedAt: null,
          source: null,
          state: "OK",
        },
      }),
      makeChar({
        ownershipId: "2",
        name: "Low",
        realmSlug: "kazzak",
        region: "EU",
        currentSeasonMythic: {
          rating: 1500,
          seasonId: "s1",
          fetchedAt: null,
          source: null,
          state: "OK",
        },
      }),
      makeChar({
        ownershipId: "3",
        name: "High",
        realmSlug: "silvermoon",
        region: "EU",
        currentSeasonMythic: {
          rating: 2800,
          seasonId: "s1",
          fetchedAt: null,
          source: null,
          state: "OK",
        },
      }),
      makeChar({
        ownershipId: "4",
        name: "Unscored",
        realmSlug: "archimonde",
        region: "EU",
      }),
    ];

    const options = switcherCharactersExcludingCurrent(roster, {
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Current",
    });

    expect(options.map((c) => c.name)).toEqual(["High", "Low", "Unscored"]);
  });
});
