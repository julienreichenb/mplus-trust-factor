/**
 * Spec- and talent-aware Utility toolkit resolution (capability model).
 *
 * Covers FALSE POSITIVE (family scored when ability not possessed) and
 * FALSE NEGATIVE (observed Utility not credited / talent gates).
 */
import { describe, expect, it } from "vitest";
import {
  getApplicableAbilityCategories,
  getAllRegisteredRules,
  resolveAbilityCapability,
  resolveAbilityCatalog,
  type AbilityRule,
} from "@mplus/abilities";
import { resolveUtilityToolkitFromCatalog } from "./toolkit.js";
import { computeUtilityV2, emptyUtilityV2FactSet } from "./index.js";
import { UTILITY_V2_INTERRUPT_CREDITS, UTILITY_V2_MODEL_CONFIG } from "./constants.js";
import type { UtilityV2ComputeInput, UtilityV2FrozenManifestRef, UtilityV2RunFactSet } from "./types.js";

function categoryState(
  results: ReturnType<typeof getApplicableAbilityCategories>,
  category: string,
) {
  return results.find((r) => r.category === category);
}

const TALENT_RULE: AbilityRule = {
  canonicalKey: "warlock.caster-control.blight-of-tongues",
  name: "Blight of Tongues",
  spellIds: [1271802],
  classSlug: "warlock",
  specSlugs: ["affliction"],
  roles: ["DPS"],
  category: "SOFT_CC",
  sharedAcrossSpecs: true,
  availability: "TALENT",
  provenance: {
    source: "CURATED_OVERRIDE",
    verifiedAt: "2026-01-01",
    gameVersion: "test",
    certainty: "verified",
  },
};

function manifestTwoSlots(): UtilityV2FrozenManifestRef {
  return {
    contentHash: "cap-manifest",
    schemaVersion: "2.0.0",
    selectorVersion: "evidence-selector-v2.0.0",
    expectedSlotCount: 2,
    selectedSlotCount: 2,
    activeDungeonSlugs: ["skyreach", "pit-of-saron"],
    slots: [
      {
        slotId: "skyreach:0",
        dungeonSlug: "skyreach",
        slotIndex: 0,
        state: "SELECTED",
        identity: { reportCode: "AAA", fightId: 1, reportRevision: 1 },
      },
      {
        slotId: "pit-of-saron:0",
        dungeonSlug: "pit-of-saron",
        slotIndex: 0,
        state: "SELECTED",
        identity: { reportCode: "BBB", fightId: 2, reportRevision: 1 },
      },
    ],
  };
}

function manifestOneSlot(): UtilityV2FrozenManifestRef {
  return {
    contentHash: "cap-manifest-1",
    schemaVersion: "2.0.0",
    selectorVersion: "evidence-selector-v2.0.0",
    expectedSlotCount: 1,
    selectedSlotCount: 1,
    activeDungeonSlugs: ["skyreach"],
    slots: [
      {
        slotId: "skyreach:0",
        dungeonSlug: "skyreach",
        slotIndex: 0,
        state: "SELECTED",
        identity: { reportCode: "AAA", fightId: 1, reportRevision: 1 },
      },
    ],
  };
}

function fact(
  slotId: string,
  dungeonSlug: string,
  identity: { reportCode: string; fightId: number; reportRevision: number },
  partial: Partial<UtilityV2RunFactSet>,
): UtilityV2RunFactSet {
  return emptyUtilityV2FactSet({
    slotId,
    runId: `${identity.reportCode}:${identity.fightId}`,
    dungeonSlug,
    slotIndex: 0,
    reportCode: identity.reportCode,
    fightId: identity.fightId,
    reportRevision: identity.reportRevision,
    activeCombatHours: 0.5,
    activeCombatMs: 1_800_000,
    fightDurationMs: 1_800_000,
    hostileBegincastCount: 20,
    hostileObservability: "PRESENT",
    ...partial,
  });
}

describe("Utility toolkit capability model", () => {
  it("A. Mistweaver interrupt is NOT_APPLICABLE (no class kick leak)", () => {
    const cats = getApplicableAbilityCategories({
      classSlug: "monk",
      specSlug: "mistweaver",
      role: "HEALER",
    });
    expect(categoryState(cats, "INTERRUPT")?.state).toBe("not_applicable");
    expect(categoryState(cats, "INTERRUPT")?.reason).toBe("no_rules_for_category");

    const toolkit = resolveUtilityToolkitFromCatalog({
      classSlug: "monk",
      specSlug: "mistweaver",
      role: "HEALER",
      talentDataAvailable: true,
      knownTalentSpellIds: [],
    });
    expect(toolkit.toolkit.families?.interrupt.state).toBe("not_applicable");
    expect(toolkit.toolkit.hasInterrupt).toBe(false);
  });

  it("B. Windwalker / Brewmaster interrupt remains APPLICABLE", () => {
    for (const spec of ["windwalker", "brewmaster"] as const) {
      const role = spec === "brewmaster" ? ("TANK" as const) : ("DPS" as const);
      const toolkit = resolveUtilityToolkitFromCatalog({
        classSlug: "monk",
        specSlug: spec,
        role,
        talentDataAvailable: true,
        knownTalentSpellIds: [],
      });
      expect(toolkit.toolkit.families?.interrupt.state).toBe("applicable");
      expect(toolkit.toolkit.hasInterrupt).toBe(true);
    }
  });

  it("C/D. talent-dependent Soft CC: selected vs not selected", () => {
    expect(resolveAbilityCapability(TALENT_RULE, { knownTalentSpellIds: [] }).state).toBe(
      "NOT_AVAILABLE",
    );
    expect(
      resolveAbilityCapability(TALENT_RULE, { knownTalentSpellIds: [1271802] }).state,
    ).toBe("AVAILABLE");
  });

  it("E. run-scoped applicability differs across two runs → opportunity hours scoped", () => {
    const mw = resolveUtilityToolkitFromCatalog({
      classSlug: "monk",
      specSlug: "mistweaver",
      role: "HEALER",
      talentDataAvailable: true,
      knownTalentSpellIds: [],
    });
    const ww = resolveUtilityToolkitFromCatalog({
      classSlug: "monk",
      specSlug: "windwalker",
      role: "DPS",
      talentDataAvailable: true,
      knownTalentSpellIds: [],
    });

    const input: UtilityV2ComputeInput = {
      manifest: manifestTwoSlots(),
      factSets: [
        fact("skyreach:0", "skyreach", { reportCode: "AAA", fightId: 1, reportRevision: 1 }, {
          toolkit: mw.toolkit,
          interruptAttempts: [],
        }),
        fact(
          "pit-of-saron:0",
          "pit-of-saron",
          { reportCode: "BBB", fightId: 2, reportRevision: 1 },
          {
            toolkit: ww.toolkit,
            interruptAttempts: [
              {
                id: "kick-1",
                timestampMs: 1000,
                abilityGameId: 116705,
                sourceActorId: 1,
                sourceKind: "PLAYER",
                targetActorId: 2,
                classification: "UNMATCHED_ATTEMPT",
                credit: UTILITY_V2_INTERRUPT_CREDITS.UNMATCHED_ATTEMPT,
              },
            ],
          },
        ),
      ],
    };

    const result = computeUtilityV2(input);
    const interrupt = result.domainBreakdown.find((d) => d.domain === "interrupt");
    expect(interrupt?.applicable).toBe(true);
    expect(interrupt?.notes.some((n) => n.includes("opportunity_runs=1/2"))).toBe(true);
    expect(interrupt?.creditedEvents).toBeGreaterThan(0);
  });

  it("F. missing run-scoped talent evidence → UNKNOWN, not automatic zero penalty", () => {
    const cats = getApplicableAbilityCategories({
      classSlug: "warrior",
      specSlug: "arms",
      role: "DPS",
    });
    expect(categoryState(cats, "HARD_CC")?.state).toBe("uncertain");

    const toolkit = resolveUtilityToolkitFromCatalog({
      classSlug: "warrior",
      specSlug: "arms",
      role: "DPS",
      talentDataAvailable: false,
    });
    toolkit.toolkit.families!.crowdControl = {
      state: "uncertain",
      reason: "talent_data_unavailable",
    };

    const result = computeUtilityV2({
      manifest: manifestOneSlot(),
      factSets: [
        fact("skyreach:0", "skyreach", { reportCode: "AAA", fightId: 1, reportRevision: 1 }, {
          toolkit: toolkit.toolkit,
        }),
      ],
    });
    const cc = result.domainBreakdown.find((d) => d.domain === "crowdControl");
    expect(cc?.applicable).toBe(false);
    expect(result.explanation.uncertainDomains.some((d) => d.domain === "crowdControl")).toBe(
      true,
    );
  });

  it("G. observed Utility cast establishes availability despite incomplete talents", () => {
    const resolution = resolveAbilityCapability(TALENT_RULE, {
      knownTalentSpellIds: undefined,
      observedSpellIds: [1271802],
    });
    expect(resolution.state).toBe("AVAILABLE");
    expect(resolution.reason).toBe("observed_usage");
  });

  it("H/I. Curse of Tongues + Blight of Tongues observed → crowdControl contribution", () => {
    const toolkit = resolveUtilityToolkitFromCatalog({
      classSlug: "warlock",
      specSlug: "affliction",
      role: "DPS",
      talentDataAvailable: true,
      knownTalentSpellIds: [1271802],
      observedSpellIds: [1714, 1271802],
    });
    expect(toolkit.toolkit.families?.crowdControl.state).toBe("applicable");

    const result = computeUtilityV2({
      manifest: manifestOneSlot(),
      factSets: [
        fact("skyreach:0", "skyreach", { reportCode: "AAA", fightId: 1, reportRevision: 1 }, {
          toolkit: toolkit.toolkit,
          activeCombatHours: 0.25,
          ccActions: [
            {
              id: "cot-1",
              timestampMs: 1000,
              abilityGameId: 1714,
              sourceActorId: 1,
              sourceKind: "PLAYER",
              targetActorId: 9,
              inActiveCombat: true,
            },
            {
              id: "bot-1",
              timestampMs: 5000,
              abilityGameId: 1271802,
              sourceActorId: 1,
              sourceKind: "PLAYER",
              targetActorId: 9,
              inActiveCombat: true,
            },
          ],
        }),
      ],
    });

    const cc = result.domainBreakdown.find((d) => d.domain === "crowdControl");
    expect(cc?.applicable).toBe(true);
    expect(cc?.creditedEvents).toBe(2);
    expect(cc?.rawScore).not.toBeNull();
    expect(cc?.rawScore ?? 0).toBeGreaterThan(UTILITY_V2_MODEL_CONFIG.scoreFloor);
  });

  it("J. Holy Paladin interrupt not available → no family contribution", () => {
    const toolkit = resolveUtilityToolkitFromCatalog({
      classSlug: "paladin",
      specSlug: "holy",
      role: "HEALER",
      talentDataAvailable: true,
      knownTalentSpellIds: [],
    });
    expect(toolkit.toolkit.families?.interrupt.state).toBe("not_applicable");

    const result = computeUtilityV2({
      manifest: manifestOneSlot(),
      factSets: [
        fact("skyreach:0", "skyreach", { reportCode: "AAA", fightId: 1, reportRevision: 1 }, {
          toolkit: toolkit.toolkit,
        }),
      ],
    });
    const interrupt = result.domainBreakdown.find((d) => d.domain === "interrupt");
    expect(interrupt?.applicable).toBe(false);
    expect(result.explanation.unusedDomains).not.toContain("interrupt");
  });

  it("Mistweaver with zero kicks does not produce interrupt unused zero", () => {
    const toolkit = resolveUtilityToolkitFromCatalog({
      classSlug: "monk",
      specSlug: "mistweaver",
      role: "HEALER",
      talentDataAvailable: true,
      knownTalentSpellIds: [],
    });
    const result = computeUtilityV2({
      manifest: manifestOneSlot(),
      factSets: [
        fact("skyreach:0", "skyreach", { reportCode: "AAA", fightId: 1, reportRevision: 1 }, {
          toolkit: toolkit.toolkit,
        }),
      ],
    });
    expect(result.explanation.unusedDomains).not.toContain("interrupt");
    const interrupt = result.domainBreakdown.find((d) => d.domain === "interrupt");
    expect(interrupt?.applicable).toBe(false);
    expect(interrupt?.rawScore).toBeNull();
  });
});

describe("catalog audit: healer interrupt leaks", () => {
  it("INTERRUPT rules with HEALER role on classes that have healer specs are only Wind Shear", () => {
    const classesWithHealer = new Set([
      "monk",
      "paladin",
      "priest",
      "druid",
      "shaman",
      "evoker",
    ]);
    const healerInterruptRules = getAllRegisteredRules().filter(
      (r) =>
        r.category === "INTERRUPT" &&
        r.classSlug != null &&
        classesWithHealer.has(r.classSlug) &&
        r.roles.includes("HEALER"),
    );
    expect(healerInterruptRules.map((r) => r.canonicalKey).sort()).toEqual([
      "shaman.interrupt.wind-shear",
    ]);
  });

  it("healer specs (except Resto Shaman) resolve zero INTERRUPT catalog rules", () => {
    const healerSpecs: Array<{ classSlug: string; specSlug: string }> = [
      { classSlug: "monk", specSlug: "mistweaver" },
      { classSlug: "paladin", specSlug: "holy" },
      { classSlug: "priest", specSlug: "holy" },
      { classSlug: "priest", specSlug: "discipline" },
      { classSlug: "druid", specSlug: "restoration" },
      { classSlug: "evoker", specSlug: "preservation" },
    ];
    for (const { classSlug, specSlug } of healerSpecs) {
      const catalog = resolveAbilityCatalog({
        classSlug,
        specSlug,
        role: "HEALER",
        includeShared: false,
        includeRacials: false,
      });
      expect(catalog.ok).toBe(true);
      if (!catalog.ok) continue;
      const interrupts = catalog.catalog.rules.filter((r) => r.category === "INTERRUPT");
      expect(interrupts, `${classSlug}/${specSlug}`).toEqual([]);
    }

    const resto = resolveAbilityCatalog({
      classSlug: "shaman",
      specSlug: "restoration",
      role: "HEALER",
      includeShared: false,
      includeRacials: false,
    });
    expect(resto.ok).toBe(true);
    if (resto.ok) {
      expect(
        resto.catalog.rules.some((r) => r.canonicalKey === "shaman.interrupt.wind-shear"),
      ).toBe(true);
    }
  });
});
