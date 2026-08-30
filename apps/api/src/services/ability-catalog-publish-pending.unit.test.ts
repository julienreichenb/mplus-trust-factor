import { describe, expect, it } from "vitest";
import { getAllRegisteredRules } from "@mplus/abilities";
import { compileBootstrapRelease0 } from "@mplus/abilities/release";
import {
  isDraftRuleSemanticallyPendingAgainstActive,
} from "./ability-catalog-publish-service.js";
import { draftRuleRowToAbilityRule } from "./ability-catalog-release-service.js";

describe("isDraftRuleSemanticallyPendingAgainstActive", () => {
  it("treats stale NEW_ABILITY ACCEPT already live in ACTIVE as not pending", () => {
    const active = compileBootstrapRelease0().artifact;
    const live = active.rules.find((rule) => !rule.validToBuild) ?? getAllRegisteredRules()[0]!;
    expect(live).toBeTruthy();

    const rule = draftRuleRowToAbilityRule({
      canonicalKey: live.canonicalKey,
      name: live.name,
      spellIds: live.spellIds,
      bindings: live.bindings,
      iconName: live.iconName ?? null,
      classSlug: live.classSlug,
      specSlugs: live.specSlugs,
      raceSlugs: live.raceSlugs ?? [],
      category: live.category,
      dimensionTags: live.dimensionTags ?? [],
      availability: live.availability,
      cooldownSeconds: live.cooldownSeconds ?? null,
      charges: live.charges ?? null,
      sourceOwnership: live.sourceOwnership,
      provenance: live.provenance,
      validityBuild: null,
    });

    expect(
      isDraftRuleSemanticallyPendingAgainstActive(
        {
          status: "READY_FOR_PUBLISH_REVIEW",
          reviewItem: { kind: "NEW_ABILITY_CANDIDATE", decisionAction: "ACCEPT" },
        },
        rule,
        active,
      ),
    ).toBe(false);
  });

  it("keeps genuinely new READY drafts pending", () => {
    const active = compileBootstrapRelease0().artifact;
    const rule = draftRuleRowToAbilityRule({
      canonicalKey: `test.pending.${Date.now()}.ability`,
      name: "Pending New Ability",
      spellIds: [99_000_099],
      bindings: [{ spellId: 99_000_099, role: "PRIMARY_ACTIVATION" }],
      iconName: null,
      classSlug: "mage",
      specSlugs: ["frost"],
      raceSlugs: [],
      category: "OFFENSIVE_MINOR",
      dimensionTags: ["PERFORMANCE_OFFENSIVE_COOLDOWN"],
      availability: "BASELINE",
      cooldownSeconds: 60,
      charges: null,
      sourceOwnership: "PLAYER",
      provenance: {
        source: "CURATED_OVERRIDE",
        verifiedAt: "2026-08-16",
        gameVersion: "12.0.0",
        certainty: "verified",
      },
      validityBuild: null,
    });

    expect(
      isDraftRuleSemanticallyPendingAgainstActive(
        {
          status: "READY_FOR_PUBLISH_REVIEW",
          reviewItem: { kind: "NEW_ABILITY_CANDIDATE", decisionAction: "ACCEPT" },
        },
        rule,
        active,
      ),
    ).toBe(true);
  });

  it("drops redundant heroism NEW_ABILITY when bloodlust already owns spell 32182", () => {
    const active = compileBootstrapRelease0().artifact;
    const bloodlust = active.rules.find((rule) => rule.canonicalKey === "shaman.bloodlust.bloodlust");
    expect(bloodlust).toBeTruthy();
    const heroism = draftRuleRowToAbilityRule({
      canonicalKey: "shared.racial.heroism",
      name: "Heroism",
      spellIds: [32182],
      bindings: [{ spellId: 32182, role: "PRIMARY_ACTIVATION" }],
      iconName: null,
      classSlug: null,
      specSlugs: [],
      raceSlugs: ["human"],
      category: "BLOODLUST",
      dimensionTags: ["UTILITY_EXTERNAL"],
      availability: "BASELINE",
      cooldownSeconds: 300,
      charges: null,
      sourceOwnership: "PLAYER",
      provenance: {
        source: "SIMC_ADVISORY",
        verifiedAt: "2026-08-30",
        gameVersion: "69299",
        certainty: "verified",
      },
      validityBuild: "69299",
    });
    expect(
      isDraftRuleSemanticallyPendingAgainstActive(
        {
          status: "READY_FOR_PUBLISH_REVIEW",
          reviewItem: { kind: "NEW_ABILITY_CANDIDATE", decisionAction: "ACCEPT" },
        },
        heroism,
        active,
      ),
    ).toBe(false);
  });

  it("projects holy-prism races against ACTIVE topology before pending check", () => {
    const active = compileBootstrapRelease0().artifact;
    const holyPrism = draftRuleRowToAbilityRule(
      {
        canonicalKey: "shared.racial.holy-prism",
        name: "Holy Prism",
        spellIds: [114165],
        bindings: [{ spellId: 114165, role: "PRIMARY_ACTIVATION" }],
        iconName: null,
        classSlug: null,
        specSlugs: [],
        raceSlugs: ["human", "haranir"],
        category: "GROUP_UTILITY",
        dimensionTags: ["UTILITY_EXTERNAL"],
        availability: "TALENT",
        cooldownSeconds: 45,
        charges: null,
        sourceOwnership: "PLAYER",
        provenance: {
          source: "SIMC_ADVISORY",
          verifiedAt: "2026-08-30",
          gameVersion: "69299",
          certainty: "verified",
        },
        validityBuild: "69299",
      },
      { topology: active.topology },
    );
    expect(holyPrism.raceSlugs).not.toContain("haranir");
    expect(
      isDraftRuleSemanticallyPendingAgainstActive(
        {
          status: "READY_FOR_PUBLISH_REVIEW",
          reviewItem: { kind: "NEW_ABILITY_CANDIDATE", decisionAction: "ACCEPT" },
        },
        holyPrism,
        active,
      ),
    ).toBe(true);
  });
});
