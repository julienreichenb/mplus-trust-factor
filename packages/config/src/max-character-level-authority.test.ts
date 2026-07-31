import { describe, expect, it } from "vitest";
import {
  ACTIVE_EXPANSION_METADATA_V1,
  buildCharacterRefreshEligibilityPolicy,
  buildOwnedCharacterRelevancePolicy,
  evaluateCharacterRefreshEligibility,
  evaluateOwnedCharacterRelevanceV1,
  getConfiguredMaxCharacterLevel,
  MAX_CHARACTER_LEVEL_CONFIG_KEY,
} from "@mplus/config";

describe("single MAX_CHARACTER_LEVEL runtime authority", () => {
  it("expansion metadata max level is default only — runtime value wins", () => {
    expect(ACTIVE_EXPANSION_METADATA_V1.maxCharacterLevel).toBe(90);
    expect(getConfiguredMaxCharacterLevel()).toBe(90);
    expect(getConfiguredMaxCharacterLevel(91)).toBe(91);
    expect(MAX_CHARACTER_LEVEL_CONFIG_KEY).toBe("MAX_CHARACTER_LEVEL");
  });

  it("eligibility and owned-relevance reach the same decision at max level 91", () => {
    const policy = buildCharacterRefreshEligibilityPolicy(91);
    const owned = buildOwnedCharacterRelevancePolicy(91);
    expect(policy.maxCharacterLevel).toBe(91);
    expect(owned.maxCharacterLevel).toBe(91);
    expect(getConfiguredMaxCharacterLevel(91)).toBe(91);

    const blocked = evaluateCharacterRefreshEligibility(
      {
        characterLevel: 90,
        currentSeasonMythicScore: 2000,
        authoritativeSeasonKnown: true,
      },
      policy,
    );
    expect(blocked.eligible).toBe(false);
    expect(blocked.code).toBe("CHARACTER_BELOW_MAX_LEVEL");
    expect(blocked.maxCharacterLevel).toBe(91);

    const ownedBlocked = evaluateOwnedCharacterRelevanceV1(
      {
        ownershipStatus: "CURRENT",
        characterLevel: 90,
        currentSeasonMythicRating: 2000,
        hasValidPublicScore: false,
        hasActiveOrQueuedRefresh: false,
        isPrimary: false,
      },
      owned,
    );
    expect(ownedBlocked.eligible).toBe(false);
    expect(ownedBlocked.reasons).toContain("BELOW_MAX_LEVEL");

    const pass = evaluateCharacterRefreshEligibility(
      {
        characterLevel: 91,
        currentSeasonMythicScore: 2000,
        authoritativeSeasonKnown: true,
      },
      policy,
    );
    expect(pass.eligible).toBe(true);

    const ownedPass = evaluateOwnedCharacterRelevanceV1(
      {
        ownershipStatus: "CURRENT",
        characterLevel: 91,
        currentSeasonMythicRating: 2000,
        hasValidPublicScore: false,
        hasActiveOrQueuedRefresh: false,
        isPrimary: false,
      },
      owned,
    );
    expect(ownedPass.eligible).toBe(true);
  });
});
