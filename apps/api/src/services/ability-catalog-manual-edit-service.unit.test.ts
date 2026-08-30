import { describe, expect, it } from "vitest";
import {
  applyBusinessMetadataToCuratedDraft,
  dimensionTagsForBusinessMetadataEdit,
  getAllRegisteredRules,
  projectCurrentRuleBindings,
  type AbilityRule,
  type CuratedDraftRuleInput,
} from "@mplus/abilities";
import { saveManualCatalogEditRequestSchema } from "@mplus/contracts";

function draftFromRule(rule: AbilityRule): CuratedDraftRuleInput {
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

describe("manual catalog edit business boundary", () => {
  const stormkeeper = getAllRegisteredRules().find(
    (r) => r.canonicalKey === "shaman.offensive.stormkeeper",
  )!;

  it("rejects admin payloads that include source-owned fields", () => {
    for (const draft of [
      { category: "OFFENSIVE_MAJOR", cooldownSeconds: 1 },
      { category: "OFFENSIVE_MAJOR", availability: "BASELINE" },
    ]) {
      const parsed = saveManualCatalogEditRequestSchema.safeParse({ draft });
      expect(parsed.success).toBe(false);
    }
  });

  it("preserves source availability when only category is edited", () => {
    const prefill = draftFromRule(stormkeeper);
    const merged = applyBusinessMetadataToCuratedDraft(
      prefill,
      { category: "INTERRUPT" },
      stormkeeper,
    );
    expect(merged.cooldownSeconds).toBe(stormkeeper.cooldownSeconds);
    expect(merged.name).toBe(stormkeeper.name);
    expect(merged.spellIds).toEqual(stormkeeper.spellIds);
    expect(merged.classSlug).toBe(stormkeeper.classSlug);
    expect(merged.provenance).toEqual(prefill.provenance);
    expect(merged.category).toBe("INTERRUPT");
    expect(merged.availability).toBe(stormkeeper.availability);
    expect(merged.dimensionTags).toEqual(
      dimensionTagsForBusinessMetadataEdit(stormkeeper, "INTERRUPT"),
    );
  });
});
