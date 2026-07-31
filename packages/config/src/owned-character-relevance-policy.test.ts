import { describe, expect, it } from "vitest";
import { ACTIVE_EXPANSION_METADATA_V1 } from "./game-metadata.js";
import {
  OWNED_CHARACTER_RELEVANCE_POLICY_V1,
  buildOwnedCharacterRelevancePolicy,
  evaluateOwnedCharacterRelevanceV1,
} from "./owned-character-relevance-policy.js";
import { getConfiguredMaxCharacterLevel } from "./character-refresh-eligibility.js";

describe("owned character relevance policy", () => {
  it("resolves max level through the same runtime authority", () => {
    expect(OWNED_CHARACTER_RELEVANCE_POLICY_V1.maxCharacterLevel).toBe(
      getConfiguredMaxCharacterLevel(),
    );
    expect(OWNED_CHARACTER_RELEVANCE_POLICY_V1.maxCharacterLevel).toBe(
      ACTIVE_EXPANSION_METADATA_V1.maxCharacterLevel,
    );
    expect(buildOwnedCharacterRelevancePolicy(91).maxCharacterLevel).toBe(91);
  });

  it("blocks below configured max level", () => {
    const result = evaluateOwnedCharacterRelevanceV1(
      {
        ownershipStatus: "CURRENT",
        characterLevel: 89,
        currentSeasonMythicRating: 2500,
        hasValidPublicScore: false,
        hasActiveOrQueuedRefresh: false,
        isPrimary: false,
      },
      buildOwnedCharacterRelevancePolicy(90),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("BELOW_MAX_LEVEL");
  });
});
