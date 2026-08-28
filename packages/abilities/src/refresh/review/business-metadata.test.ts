import { describe, expect, it } from "vitest";
import { getAllRegisteredRules } from "../../registry.js";
import {
  applyBusinessMetadataToCuratedDraft,
  applyBusinessMetadataToReviewDraft,
  dimensionTagsForBusinessMetadataEdit,
} from "./business-metadata.js";
import { projectCurrentRuleBindings } from "../bindings.js";
import type { CuratedDraftRuleInput } from "./draft-validation.js";

function draftFromRule(canonicalKey: string): CuratedDraftRuleInput {
  const rule = getAllRegisteredRules().find((r) => r.canonicalKey === canonicalKey)!;
  const bindings = projectCurrentRuleBindings(rule).map((b) => ({
    spellId: b.spellId,
    role: b.role,
  }));
  return {
    canonicalKey: rule.canonicalKey,
    name: rule.name,
    spellIds: [...rule.spellIds],
    bindings,
    iconName: rule.iconName ?? null,
    classSlug: rule.classSlug,
    specSlugs: [...rule.specSlugs],
    raceSlugs: [...(rule.raceSlugs ?? [])],
    category: rule.category,
    availability: rule.availability,
    cooldownSeconds: rule.cooldownSeconds ?? null,
    charges: rule.charges ?? null,
    sourceOwnership: rule.sourceOwnership,
    provenance: { ...rule.provenance },
    validFromBuild: rule.validFromBuild ?? null,
    validToBuild: rule.validToBuild ?? null,
    notes: rule.provenance.notes ?? null,
  };
}

describe("business metadata ownership", () => {
  it("preserves explicit multi-tag rules when category is unchanged", () => {
    const pi = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "priest.group-utility.power-infusion",
    )!;
    expect(dimensionTagsForBusinessMetadataEdit(pi, pi.category)).toEqual([
      "UTILITY_EXTERNAL",
      "PERFORMANCE_OFFENSIVE_COOLDOWN",
    ]);
  });

  it("derives dimension tags when category changes", () => {
    const stormkeeper = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "shaman.offensive.stormkeeper",
    )!;
    expect(
      dimensionTagsForBusinessMetadataEdit(stormkeeper!, "INTERRUPT"),
    ).toEqual(["UTILITY_INTERRUPT"]);
  });

  it("keeps source facts from prefill when applying business metadata", () => {
    const stormkeeper = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "shaman.offensive.stormkeeper",
    )!;
    const prefill = draftFromRule(stormkeeper!.canonicalKey);
    const merged = applyBusinessMetadataToCuratedDraft(
      prefill,
      { category: "OFFENSIVE_MAJOR", availability: "BASELINE" },
      stormkeeper!,
    );
    expect(merged.cooldownSeconds).toBe(stormkeeper!.cooldownSeconds);
    expect(merged.name).toBe(stormkeeper!.name);
    expect(merged.spellIds).toEqual(stormkeeper!.spellIds);
    expect(merged.classSlug).toBe(stormkeeper!.classSlug);
    expect(merged.provenance).toEqual(prefill.provenance);
    expect(merged.dimensionTags).toEqual(["PERFORMANCE_OFFENSIVE_COOLDOWN"]);
  });

  it("keeps source facts from review prefill when applying business metadata", () => {
    const stormkeeper = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "shaman.offensive.stormkeeper",
    )!;
    const prefill = draftFromRule(stormkeeper!.canonicalKey);
    const merged = applyBusinessMetadataToReviewDraft(prefill, {
      category: "OFFENSIVE_MAJOR",
      availability: "BASELINE",
    });
    expect(merged.cooldownSeconds).toBe(stormkeeper!.cooldownSeconds);
    expect(merged.name).toBe(stormkeeper!.name);
    expect(merged.spellIds).toEqual(stormkeeper!.spellIds);
    expect(merged.classSlug).toBe(stormkeeper!.classSlug);
    expect(merged.provenance).toEqual(prefill.provenance);
    expect(merged.dimensionTags).toEqual(["PERFORMANCE_OFFENSIVE_COOLDOWN"]);
  });

  it("maps representative categories to expected dimension tags", () => {
    const stormkeeper = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "shaman.offensive.stormkeeper",
    )!;
    const stoneform = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "shared.racial.stoneform",
    )!;
  const counterspell = getAllRegisteredRules().find(
      (r) => r.category === "INTERRUPT" && r.classSlug === "mage",
    )!;

    expect(dimensionTagsForBusinessMetadataEdit(stormkeeper!, "OFFENSIVE_MAJOR")).toEqual([
      "PERFORMANCE_OFFENSIVE_COOLDOWN",
    ]);
    expect(dimensionTagsForBusinessMetadataEdit(stoneform!, "DISPEL")).toEqual(["UTILITY_DISPEL"]);
    expect(dimensionTagsForBusinessMetadataEdit(counterspell, "INTERRUPT")).toEqual([
      "UTILITY_INTERRUPT",
    ]);
    expect(dimensionTagsForBusinessMetadataEdit(stoneform!, "BATTLE_REZ")).toEqual([
      "UTILITY_COMBAT_RES",
    ]);
    expect(dimensionTagsForBusinessMetadataEdit(stormkeeper!, "DEFENSIVE_MAJOR")).toEqual([
      "SURVIVAL_PERSONAL_DEFENSIVE",
    ]);
  });
});
