import { describe, expect, it } from "vitest";
import {
  BOOST_SHADOW_ISOLATION,
  buildOfflineEvaluation,
  computeVerifiedAltExperienceMitigation,
  extractBoostFeatureFactsV1,
  fixturePostHocOwnership,
  fixtureVerifiedAltMitigation,
  isEligibleVerifiedSubjectAtT,
  isOmittedNotZero,
} from "./index.js";

describe("boost-shadow verified-alt PIT + privacy", () => {
  it("omits mitigation when subject has no verified ownership (never a penalty)", () => {
    const facts = extractBoostFeatureFactsV1({
      ...fixtureVerifiedAltMitigation({ includeAlt: false }),
      ownershipEvidence: [],
    });
    expect(isOmittedNotZero(facts, "verifiedAltExperienceMitigation")).toBe(true);
    expect(
      facts.missing.find((m) => m.featureKey === "verifiedAltExperienceMitigation")
        ?.reasonCode,
    ).toBe("NO_VERIFIED_SUBJECT");
  });

  it("returns value 0 when linked subject has no equal/higher eligible alt", () => {
    const facts = extractBoostFeatureFactsV1(
      fixtureVerifiedAltMitigation({ includeAlt: false }),
    );
    expect(facts.features.verifiedAltExperienceMitigation).toBeDefined();
    expect(facts.features.verifiedAltExperienceMitigation!.value).toBe(0);
    expect(facts.diagnostics?.verifiedAltMitigationPresent).toBe(true);
  });

  it("increases mitigation monotonically with equal/higher verified alt margin", () => {
    const low = extractBoostFeatureFactsV1(
      fixtureVerifiedAltMitigation({ altRating: 2300, subjectRating: 2200 }),
    );
    const high = extractBoostFeatureFactsV1(
      fixtureVerifiedAltMitigation({ altRating: 3200, subjectRating: 2200 }),
    );
    expect(high.features.verifiedAltExperienceMitigation!.value).toBeGreaterThan(
      low.features.verifiedAltExperienceMitigation!.value,
    );
  });

  it("excludes ownership verified after calculation time T (point-in-time)", () => {
    const facts = extractBoostFeatureFactsV1(fixturePostHocOwnership());
    // Subject verified before T, but alt verified after T → no eligible alt → value 0
    // (subject still eligible) OR omit if subject filters fail.
    const mitigation = facts.features.verifiedAltExperienceMitigation;
    expect(mitigation).toBeDefined();
    expect(mitigation!.value).toBe(0);
  });

  it("excludes unlinked / revoked ownership at T", () => {
    const unlinked = extractBoostFeatureFactsV1(
      fixtureVerifiedAltMitigation({ unlinked: true }),
    );
    expect(isOmittedNotZero(unlinked, "verifiedAltExperienceMitigation")).toBe(true);

    const revoked = extractBoostFeatureFactsV1(
      fixtureVerifiedAltMitigation({ revoked: true }),
    );
    expect(isOmittedNotZero(revoked, "verifiedAltExperienceMitigation")).toBe(true);
  });

  it("rejects userId-only linkage — alts must share battleNetAccountId", () => {
    const input = fixtureVerifiedAltMitigation();
    input.ownershipEvidence = [
      input.ownershipEvidence![0]!,
      {
        ...input.ownershipEvidence![1]!,
        battleNetAccountId: "other-bnet",
      },
    ];
    const result = computeVerifiedAltExperienceMitigation({
      subjectCharacterId: input.subjectCharacterId,
      regionId: input.regionId,
      seasonId: input.seasonId,
      calculatedAt: input.calculatedAt,
      ownershipEvidence: input.ownershipEvidence,
    });
    expect(result.status).toBe("computed");
    if (result.status === "computed") {
      expect(result.evidence.value).toBe(0);
    }
  });

  it("does not treat HISTORICAL/STALE/LIKELY ownership as eligible", () => {
    const calculatedAtMs = Date.parse("2026-07-15T12:00:00.000Z");
    expect(
      isEligibleVerifiedSubjectAtT(
        {
          ownershipId: "x",
          battleNetAccountId: "bnet-1",
          characterId: "c1",
          regionId: "region-eu",
          status: "HISTORICAL",
          confidence: "CONFIRMED",
          verifiedAt: "2026-06-01T00:00:00.000Z",
          revokedAt: null,
          accountClaimed: true,
          accountUnlinkedAt: null,
          currentSeasonMythicRating: 3000,
          currentSeasonMythicSeasonId: "season-tww-3",
          currentSeasonMythicFetchedAt: "2026-07-14T00:00:00.000Z",
        },
        calculatedAtMs,
      ),
    ).toBe(false);
  });

  it("private facts never include teammate display names, battletags, or public flags", () => {
    const facts = extractBoostFeatureFactsV1(fixtureVerifiedAltMitigation());
    const blob = JSON.stringify(facts);
    expect(blob).not.toMatch(/Teammate[0-9]|battletag|BattleTag/i);
    expect(blob).not.toContain('"displayName"');
    expect(blob).not.toContain("confirmed_reroll");
    expect(blob).not.toContain("probable_reroll");
    expect(blob).not.toContain("boost_suspected");
    expect(blob).not.toContain("char-alt-main");
  });
});

describe("boost-shadow isolation guarantees", () => {
  it("exposes hard-false production effect markers", () => {
    expect(BOOST_SHADOW_ISOLATION.altersAuthenticityScore).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.writesAuthenticityFeatureInput).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.altersRedFlags).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.altersTrustScore).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.altersGrades).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.altersConfidence).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.altersEligibility).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.affectsRefreshPublication).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.emitsPublicExplanations).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.emitsAddonBits).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.persistsToDatabase).toBe(false);
    expect(BOOST_SHADOW_ISOLATION.infersOwnershipFromNamesGuildsIpsOrRoster).toBe(
      false,
    );
  });

  it("offline evaluation does not map into AuthenticityFeatureInput keys", () => {
    const evalOut = buildOfflineEvaluation(
      extractBoostFeatureFactsV1(fixtureVerifiedAltMitigation()),
    );
    const blob = JSON.stringify(evalOut);
    expect(blob).not.toContain("progressionKeyJump");
    expect(blob).not.toContain("repeatedStrongerTeammates");
    expect(blob).not.toContain("confirmedEliteMain");
    expect(blob).not.toContain("authenticityScore");
  });
});
