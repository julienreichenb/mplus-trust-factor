/**
 * Racial race-gating, Gateway groupSupport credit, Circle movement, interrupt profiles.
 */
import { describe, expect, it } from "vitest";
import {
  getAllRegisteredRules,
  resolveAbilityCapability,
  resolveInterruptProfile,
} from "@mplus/abilities";
import {
  computeUtilityV2,
  resolveUtilityToolkitFromCatalog,
  scoreSupportCredit,
  UTILITY_V2_MODEL_CONFIG,
  type UtilityV2FrozenManifestRef,
  type UtilityV2RunFactSet,
  type UtilityV2SupportAction,
} from "./index.js";
import { normalizeInterruptRatePerHour } from "./interrupt-capability.js";

function manifestOneSlot(): UtilityV2FrozenManifestRef {
  return {
    contentHash: "sys-correct-1",
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

function baseFact(
  partial: Partial<UtilityV2RunFactSet> = {},
): UtilityV2RunFactSet {
  return {
    schemaVersion: "utility-v2-facts",
    extractorFamily: "utility",
    extractorVersion: "utility-v2.0.0",
    slotId: "skyreach:0",
    runId: "AAA:1",
    dungeonSlug: "skyreach",
    keyLevel: 10,
    slotIndex: 0,
    reportCode: "AAA",
    fightId: 1,
    reportRevision: 1,
    fightDurationMs: 1_800_000,
    activeCombatMs: 900_000,
    activeCombatHours: 0.25,
    hostileBegincastCount: 40,
    hostileObservability: "PRESENT",
    toolkit: {
      hasInterrupt: true,
      hasSupport: true,
      hasStrategicCc: true,
      families: {
        interrupt: { state: "applicable" },
        crowdControl: { state: "applicable" },
        dispelPurge: { state: "applicable" },
        groupSupport: { state: "applicable" },
        movement: { state: "not_applicable" },
        combatRes: { state: "optional" },
        bloodlust: { state: "not_applicable" },
      },
    },
    interruptAttempts: [],
    ccActions: [],
    supportActions: [],
    dispelPurgeSuccessCount: 0,
    bloodlustSuccessCount: 0,
    catalogCoverage: { abilityCatalogCoverage: 1, mechanicCatalogCoverage: 1 },
    limitations: [],
    ...partial,
  };
}

describe("racial race-scoped capability", () => {
  const stoneform = getAllRegisteredRules().find(
    (r) => r.canonicalKey === "shared.racial.stoneform",
  )!;
  const shadowmeld = getAllRegisteredRules().find(
    (r) => r.canonicalKey === "shared.racial.shadowmeld",
  )!;
  const escapeArtist = getAllRegisteredRules().find(
    (r) => r.canonicalKey === "shared.racial.escape-artist",
  )!;

  it("wrong race → NOT_AVAILABLE", () => {
    expect(
      resolveAbilityCapability(stoneform, { raceSlug: "orc" }).state,
    ).toBe("NOT_AVAILABLE");
    expect(
      resolveAbilityCapability(shadowmeld, { raceSlug: "dwarf" }).state,
    ).toBe("NOT_AVAILABLE");
  });

  it("correct race → AVAILABLE", () => {
    expect(
      resolveAbilityCapability(stoneform, { raceSlug: "dwarf" }).state,
    ).toBe("AVAILABLE");
    expect(
      resolveAbilityCapability(shadowmeld, { raceSlug: "night-elf" }).state,
    ).toBe("AVAILABLE");
  });

  it("race unknown + no observation → UNKNOWN", () => {
    expect(resolveAbilityCapability(stoneform, {}).state).toBe("UNKNOWN");
    expect(resolveAbilityCapability(escapeArtist, {}).state).toBe("UNKNOWN");
  });

  it("race unknown + observed racial → AVAILABLE", () => {
    expect(
      resolveAbilityCapability(stoneform, { observedSpellIds: [20594] }).state,
    ).toBe("AVAILABLE");
  });

  it("includeRacials expands candidates but does not auto-AVAILABLE Escape Artist", () => {
    const toolkit = resolveUtilityToolkitFromCatalog({
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
      includeRacials: true,
      talentDataAvailable: true,
      knownTalentSpellIds: [],
      // no race, no Escape Artist observation
    });
    // Without Circle talent and without gnome race, movement must not be applicable.
    expect(toolkit.toolkit.families?.movement.state).not.toBe("applicable");
  });

  it("Stoneform is dispelPurge family, Shadowmeld is not Utility movement", () => {
    expect(stoneform.category).toBe("DISPEL");
    expect(shadowmeld.category).toBe("DEFENSIVE_MINOR");
    expect(escapeArtist.category).toBe("MOVEMENT_UTILITY");
  });
});

describe("Demonic Gateway groupSupport credit", () => {
  it("A. placement → non-zero groupSupport credit", () => {
    const placement: UtilityV2SupportAction = {
      id: "gw-1",
      timestampMs: 1000,
      abilityGameId: 111771,
      abilityName: "Demonic Gateway",
      sourceActorId: 1,
      sourceKind: "PLAYER",
      targetActorId: null,
      semantic: "PROVIDED_GROUP_UTILITY",
      tier: "CONFIRMED_APPLICATION",
    };
    const credit = scoreSupportCredit([placement]);
    expect(credit.rawCredit).toBeGreaterThan(0);

    const result = computeUtilityV2({
      manifest: manifestOneSlot(),
      factSets: [
        baseFact({
          supportActions: [placement],
          toolkit: {
            hasInterrupt: false,
            hasSupport: true,
            hasStrategicCc: false,
            families: {
              interrupt: { state: "not_applicable" },
              crowdControl: { state: "not_applicable" },
              dispelPurge: { state: "not_applicable" },
              groupSupport: { state: "applicable" },
              movement: { state: "not_applicable" },
              combatRes: { state: "not_applicable" },
              bloodlust: { state: "not_applicable" },
            },
          },
        }),
      ],
    });
    const gs = result.domainBreakdown.find((d) => d.domain === "groupSupport");
    expect(gs?.applicable).toBe(true);
    expect(gs?.creditedEvents).toBeGreaterThan(0);
    expect(gs?.rawScore).toBeGreaterThan(0);
  });

  it("B. placement + traversal-like second row does not explode credit unboundedly", () => {
    const actions: UtilityV2SupportAction[] = [
      {
        id: "gw-place",
        timestampMs: 1000,
        abilityGameId: 111771,
        abilityName: "Demonic Gateway",
        sourceActorId: 1,
        sourceKind: "PLAYER",
        targetActorId: null,
        semantic: "PROVIDED_GROUP_UTILITY",
        tier: "CONFIRMED_APPLICATION",
      },
      {
        id: "gw-trav",
        timestampMs: 5000,
        abilityGameId: 113942,
        abilityName: "Demonic Gateway",
        sourceActorId: 2,
        sourceKind: "PLAYER",
        targetActorId: null,
        semantic: "PROVIDED_GROUP_UTILITY",
        tier: "CONFIRMED_APPLICATION",
      },
    ];
    const one = scoreSupportCredit([actions[0]!]).rawCredit;
    const two = scoreSupportCredit(actions).rawCredit;
    // Traversal may add credit if present as a separate action, but diminishing applies.
    expect(two).toBeGreaterThanOrEqual(one);
    expect(two).toBeLessThanOrEqual(one * 2);
  });

  it("C. teammate never traverses — placement still credits", () => {
    const credit = scoreSupportCredit([
      {
        id: "gw-only",
        timestampMs: 1000,
        abilityGameId: 111771,
        abilityName: "Demonic Gateway",
        sourceActorId: 1,
        sourceKind: "PLAYER",
        targetActorId: null,
        semantic: "PROVIDED_GROUP_UTILITY",
        tier: "CONFIRMED_APPLICATION",
      },
    ]);
    expect(credit.rawCredit).toBeGreaterThan(0);
  });

  it("D. UNVERIFIED_EXTERNAL remains zero (conservative)", () => {
    const credit = scoreSupportCredit([
      {
        id: "bad",
        timestampMs: 1000,
        abilityGameId: 111771,
        abilityName: "Demonic Gateway",
        sourceActorId: 1,
        sourceKind: "PLAYER",
        targetActorId: null,
        semantic: "UNVERIFIED_EXTERNAL",
        tier: "UNVERIFIED",
      },
    ]);
    expect(credit.rawCredit).toBe(0);
  });
});

describe("Demonic Circle movement applicability", () => {
  it("Circle talent absent → movement not applicable for warlock", () => {
    const toolkit = resolveUtilityToolkitFromCatalog({
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
      includeRacials: true,
      talentDataAvailable: true,
      knownTalentSpellIds: [],
      raceSlug: null,
    });
    expect(toolkit.toolkit.families?.movement.state).toBe("not_applicable");
  });

  it("Circle talent selected → movement applicable", () => {
    const toolkit = resolveUtilityToolkitFromCatalog({
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
      includeRacials: true,
      talentDataAvailable: true,
      knownTalentSpellIds: [48018],
      raceSlug: null,
    });
    expect(toolkit.toolkit.families?.movement.state).toBe("applicable");
  });

  it("Circle observed without talent list → AVAILABLE movement", () => {
    const toolkit = resolveUtilityToolkitFromCatalog({
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
      includeRacials: true,
      talentDataAvailable: false,
      observedSpellIds: [48020],
      observedFamilies: { movement: true },
    });
    expect(toolkit.toolkit.families?.movement.state).toBe("applicable");
  });
});

describe("capability-aware interrupt normalization", () => {
  it("Axe Toss is CONSTRAINED_CONTROL", () => {
    const axe = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "warlock.interrupt.axe-toss",
    )!;
    expect(resolveInterruptProfile(axe)).toBe("CONSTRAINED_CONTROL");
    expect(axe.cooldownSeconds).toBe(30);
  });

  it("same raw rate scores higher for constrained/long CD than short CD", () => {
    const config = UTILITY_V2_MODEL_CONFIG;
    const raw = 6; // credited / hour
    const short = normalizeInterruptRatePerHour(
      raw,
      {
        canonicalKeys: ["warrior.interrupt.pummel"],
        cooldownSeconds: 15,
        profile: "STANDARD",
        sourceOwnership: "PLAYER",
      },
      config,
    );
    const constrained = normalizeInterruptRatePerHour(
      raw,
      {
        canonicalKeys: ["warlock.interrupt.axe-toss"],
        cooldownSeconds: 30,
        profile: "CONSTRAINED_CONTROL",
        sourceOwnership: "PET",
      },
      config,
    );
    expect(constrained).toBeGreaterThan(short);
  });

  it("short-CD kick still requires meaningful usage (low rate stays low)", () => {
    const config = UTILITY_V2_MODEL_CONFIG;
    const low = normalizeInterruptRatePerHour(
      2,
      {
        canonicalKeys: ["rogue.interrupt.kick"],
        cooldownSeconds: 15,
        profile: "STANDARD",
        sourceOwnership: "PLAYER",
      },
      config,
    );
    expect(low).toBe(2);
  });

  it("no-interrupt toolkit stays not_applicable", () => {
    const toolkit = resolveUtilityToolkitFromCatalog({
      classSlug: "monk",
      specSlug: "mistweaver",
      role: "HEALER",
      talentDataAvailable: true,
      knownTalentSpellIds: [],
    });
    expect(toolkit.toolkit.families?.interrupt.state).toBe("not_applicable");
  });
});
