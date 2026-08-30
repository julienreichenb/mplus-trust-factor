import { describe, expect, it } from "vitest";
import {
  filterReviewImportItems,
  resolveMplusRelevance,
  stableAbilityIdentity,
} from "./mplus-relevance.js";
import type { ReviewImportItemDraft } from "./review/import-plan.js";

const ctx = {
  activeCanonicalKeys: new Set(["mage.offensive.icy-veins"]),
  activeSpellIds: new Set([12472]),
  excludedIdentities: new Set<string>(),
};

describe("mplus relevance", () => {
  it("resolves INCLUDED for active catalog rules", () => {
    expect(
      resolveMplusRelevance({
        canonicalKey: "mage.offensive.icy-veins",
        primarySpellId: 12472,
        ...ctx,
      }),
    ).toBe("INCLUDED");
  });

  it("resolves UNCLASSIFIED for new discoveries", () => {
    expect(
      resolveMplusRelevance({
        canonicalKey: null,
        primarySpellId: 15286,
        ...ctx,
      }),
    ).toBe("UNCLASSIFIED");
  });

  it("resolves EXCLUDED when durable exclusion exists", () => {
    expect(
      resolveMplusRelevance({
        canonicalKey: null,
        primarySpellId: 15286,
        ...ctx,
        excludedIdentities: new Set(["spell:15286"]),
      }),
    ).toBe("EXCLUDED");
  });

  it("prefers canonical exclusion identity for active rules", () => {
    expect(
      resolveMplusRelevance({
        canonicalKey: "mage.offensive.icy-veins",
        primarySpellId: 12472,
        ...ctx,
        excludedIdentities: new Set(["canonical:mage.offensive.icy-veins"]),
      }),
    ).toBe("EXCLUDED");
  });

  it("stableAbilityIdentity prefers canonical key", () => {
    expect(
      stableAbilityIdentity({ canonicalKey: "priest.shadow.ve", primarySpellId: 15286 }),
    ).toBe("canonical:priest.shadow.ve");
    expect(stableAbilityIdentity({ primarySpellId: 15286 })).toBe("spell:15286");
  });

  it("filters excluded and included new candidates from import items", () => {
    const items: ReviewImportItemDraft[] = [
      {
        kind: "NEW_ABILITY_CANDIDATE",
        identityKey: "NEW_ABILITY_CANDIDATE:15286",
        primarySpellId: 15286,
        name: "Vampiric Embrace",
        matchedCanonicalKey: null,
        classSlug: "priest",
        specSlugs: ["shadow"],
        raceSlugs: [],
        eligibilityState: "STRONG_REVIEW_CANDIDATE",
        eligibilityReasons: [],
        reviewReason: "missing",
        evidence: {},
        sourceProvenance: {},
      },
      {
        kind: "NEW_ABILITY_CANDIDATE",
        identityKey: "NEW_ABILITY_CANDIDATE:12472",
        primarySpellId: 12472,
        name: "Icy Veins",
        matchedCanonicalKey: "mage.offensive.icy-veins",
        classSlug: "mage",
        specSlugs: ["frost"],
        raceSlugs: [],
        eligibilityState: "STRONG_REVIEW_CANDIDATE",
        eligibilityReasons: [],
        reviewReason: "missing",
        evidence: {},
        sourceProvenance: {},
      },
    ];
    const filtered = filterReviewImportItems(items, ctx);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.primarySpellId).toBe(15286);

    const excluded = filterReviewImportItems(items, {
      ...ctx,
      excludedIdentities: new Set(["spell:15286"]),
    });
    expect(excluded).toHaveLength(0);
  });
});
