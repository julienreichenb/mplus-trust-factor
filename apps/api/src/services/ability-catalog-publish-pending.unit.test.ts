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
});
