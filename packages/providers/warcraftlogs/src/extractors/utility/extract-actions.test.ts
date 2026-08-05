import { describe, expect, it } from "vitest";
import {
  extractUtilityActionTimeline,
  evaluateUtilityCapabilities,
  type UtilityDatasetCoverageRow,
  type UtilityProbeParticipant,
  type UtilityProbeSourceIdentity,
} from "./index.js";

const FIGHT_START = 1_000_000;

function coverage(rows: Partial<Record<string, Partial<UtilityDatasetCoverageRow>>>): UtilityDatasetCoverageRow[] {
  const keys = [
    "Casts",
    "Buffs",
    "Interrupts",
    "Dispels",
    "Debuffs",
    "Deaths",
    "CombatantInfo",
    "masterData",
  ];
  return keys.map((datasetKey) => {
    const override = rows[datasetKey] ?? {};
    return {
      datasetKey,
      pageCount: override.pageCount ?? 1,
      eventCount: override.eventCount ?? 10,
      complete: override.complete ?? true,
      truncated: override.truncated ?? false,
      stopReason: override.stopReason ?? null,
      coverageRatio: override.coverageRatio ?? 1,
    };
  });
}

function source(): UtilityProbeSourceIdentity {
  return {
    reportCode: "TESTCODE",
    fightId: 1,
    reportRevision: 1,
    dungeonSlug: "everbloom",
    keyLevel: 12,
    fightStartMs: FIGHT_START,
    fightEndMs: FIGHT_START + 600_000,
    region: "EU",
  };
}

function participants(): UtilityProbeParticipant[] {
  return [
    {
      playerActorId: 10,
      characterName: "WarlockMain",
      realmSlug: "archimonde",
      regionCode: "EU",
      classSlug: "warlock",
      specSlug: "demonology",
      ownedPetActorIds: [20],
    },
    {
      playerActorId: 11,
      characterName: "PriestFriend",
      realmSlug: "archimonde",
      regionCode: "EU",
      classSlug: "priest",
      specSlug: "discipline",
      ownedPetActorIds: [],
    },
    {
      playerActorId: 12,
      characterName: "DkFriend",
      realmSlug: "archimonde",
      regionCode: "EU",
      classSlug: "death-knight",
      specSlug: "blood",
      ownedPetActorIds: [],
    },
    {
      playerActorId: 13,
      characterName: "MageFriend",
      realmSlug: "archimonde",
      regionCode: "EU",
      classSlug: "mage",
      specSlug: "frost",
      ownedPetActorIds: [],
    },
    {
      playerActorId: 14,
      characterName: "DruidFriend",
      realmSlug: "archimonde",
      regionCode: "EU",
      classSlug: "druid",
      specSlug: "restoration",
      ownedPetActorIds: [],
    },
  ];
}

describe("utility-one-fight extraction", () => {
  it("1. interrupt events produce one canonical action", () => {
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: participants(),
      coverage: coverage({}),
      eventsByDataset: {
        Interrupts: [
          {
            timestamp: FIGHT_START + 1000,
            type: "interrupt",
            sourceID: 10,
            targetID: 99,
            abilityGameID: 19647,
            ability: { name: "Spell Lock" },
          },
        ],
        Casts: [
          {
            timestamp: FIGHT_START + 990,
            type: "begincast",
            sourceID: 20,
            abilityGameID: 19647,
          },
          {
            timestamp: FIGHT_START + 1000,
            type: "cast",
            sourceID: 20,
            targetID: 99,
            abilityGameID: 19647,
          },
        ],
      },
    });
    const interrupts = timeline.actions.filter((a) => a.utilityCategory === "INTERRUPT");
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0]!.abilityKey).toBe("warlock.interrupt.spell-lock");
    expect(interrupts[0]!.ownerActorId).toBe(10);
  });

  it("2. cast plus debuff application produces one crowd-control action", () => {
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: participants(),
      coverage: coverage({}),
      eventsByDataset: {
        Casts: [
          {
            timestamp: FIGHT_START + 2000,
            type: "cast",
            sourceID: 10,
            targetID: 99,
            abilityGameID: 5782,
            ability: { name: "Fear" },
          },
        ],
        Debuffs: [
          {
            timestamp: FIGHT_START + 2050,
            type: "applydebuff",
            sourceID: 10,
            targetID: 99,
            abilityGameID: 5782,
          },
        ],
      },
    });
    const cc = timeline.actions.filter((a) => a.utilityCategory === "CROWD_CONTROL");
    expect(cc).toHaveLength(1);
    expect(cc[0]!.canonicalName).toBe("Fear");
    expect(cc[0]!.evidenceEventTypes.sort()).toEqual(["applydebuff", "cast"]);
  });

  it("3. buff refresh/removal does not create additional actions", () => {
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: participants(),
      coverage: coverage({}),
      eventsByDataset: {
        Casts: [
          {
            timestamp: FIGHT_START + 3000,
            type: "cast",
            sourceID: 11,
            targetID: 10,
            abilityGameID: 33206,
            ability: { name: "Pain Suppression" },
          },
        ],
        Buffs: [
          {
            timestamp: FIGHT_START + 3010,
            type: "applybuff",
            sourceID: 11,
            targetID: 10,
            abilityGameID: 33206,
          },
          {
            timestamp: FIGHT_START + 3500,
            type: "refreshbuff",
            sourceID: 11,
            targetID: 10,
            abilityGameID: 33206,
          },
          {
            timestamp: FIGHT_START + 8000,
            type: "removebuff",
            sourceID: 11,
            targetID: 10,
            abilityGameID: 33206,
          },
        ],
      },
    });
    // Pain Suppression may or may not be in catalog as EXTERNAL_DEFENSIVE for priest.
    // If catalog has it, exactly one action; refresh/remove never open new ones.
    const externals = timeline.actions.filter(
      (a) => a.primarySpellId === 33206 || a.observedSpellIds.includes(33206),
    );
    expect(externals.length).toBeLessThanOrEqual(1);
    expect(
      timeline.actions.filter((a) =>
        a.evidenceEventTypes.every((t) => t === "refreshbuff" || t === "removebuff"),
      ),
    ).toHaveLength(0);
  });

  it("4. pet utility is attributed to the owner", () => {
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: participants(),
      coverage: coverage({}),
      eventsByDataset: {
        Interrupts: [
          {
            timestamp: FIGHT_START + 4000,
            type: "interrupt",
            sourceID: 20,
            targetID: 99,
            abilityGameID: 89766,
            ability: { name: "Axe Toss" },
          },
        ],
      },
    });
    expect(timeline.actions).toHaveLength(1);
    expect(timeline.actions[0]!.ownerActorId).toBe(10);
    expect(timeline.actions[0]!.attributedToPet).toBe(true);
    expect(timeline.actions[0]!.petActorId).toBe(20);
    expect(timeline.actions[0]!.sourceCharacterName).toBe("WarlockMain");
  });

  it("5. dispels preserve caster and target", () => {
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: participants(),
      coverage: coverage({}),
      eventsByDataset: {
        Dispels: [
          {
            timestamp: FIGHT_START + 5000,
            type: "dispel",
            sourceID: 20,
            targetID: 11,
            abilityGameID: 89808,
            ability: { name: "Singe Magic" },
          },
        ],
      },
    });
    expect(timeline.actions).toHaveLength(1);
    const action = timeline.actions[0]!;
    expect(action.utilityCategory).toBe("DEFENSIVE_DISPEL");
    expect(action.ownerActorId).toBe(10);
    expect(action.targetActorId).toBe(11);
    expect(action.targetCharacterName).toBe("PriestFriend");
  });

  it("6. external casts preserve caster and known recipient", () => {
    // Use warlock Demonic Gateway as OTHER_UTILITY; for external support use a known external.
    // Ironbark (druid) 102342 is EXTERNAL_DEFENSIVE.
    const five = participants();
    five[4]!.ownedPetActorIds = [];
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: five,
      coverage: coverage({}),
      eventsByDataset: {
        Casts: [
          {
            timestamp: FIGHT_START + 6000,
            type: "cast",
            sourceID: 14,
            targetID: 10,
            abilityGameID: 102342,
            ability: { name: "Ironbark" },
          },
        ],
        Buffs: [
          {
            timestamp: FIGHT_START + 6010,
            type: "applybuff",
            sourceID: 14,
            targetID: 10,
            abilityGameID: 102342,
          },
        ],
      },
    });
    const action = timeline.actions.find((a) => a.primarySpellId === 102342);
    expect(action).toBeTruthy();
    expect(action!.ownerActorId).toBe(14);
    expect(action!.targetActorId).toBe(10);
    expect(action!.targetCharacterName).toBe("WarlockMain");
    expect(action!.utilityCategory).toBe("EXTERNAL_SUPPORT");
  });

  it("7. unknown recipient remains explicit rather than invented", () => {
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: participants(),
      coverage: coverage({
        Buffs: { complete: false, truncated: true, stopReason: "MAX_PAGES", coverageRatio: 0.5 },
      }),
      eventsByDataset: {
        Casts: [
          {
            timestamp: FIGHT_START + 7000,
            type: "cast",
            sourceID: 14,
            // no targetID
            abilityGameID: 102342,
            ability: { name: "Ironbark" },
          },
        ],
        Buffs: [],
      },
    });
    const action = timeline.actions.find((a) => a.primarySpellId === 102342);
    expect(action).toBeTruthy();
    expect(action!.targetActorId).toBeNull();
    expect(action!.targetCharacterName).toBeNull();
    expect(action!.limitations).toContain("EXTERNAL_TARGET_CONTEXT_INCOMPLETE");
  });

  it("8. incomplete Buffs does not invalidate complete interrupt capability", () => {
    const caps = evaluateUtilityCapabilities(
      coverage({
        Buffs: { complete: false, truncated: true, stopReason: "MAX_PAGES" },
        Interrupts: { complete: true, truncated: false },
      }),
    );
    expect(caps.find((c) => c.capability === "UTILITY_INTERRUPTS")?.status).toBe("COMPLETE");
    expect(
      caps.find((c) => c.capability === "UTILITY_EXTERNAL_TARGET_CONTEXT")?.status,
    ).toBe("INCOMPLETE");
  });

  it("9. incomplete required evidence marks only the affected capability incomplete", () => {
    const caps = evaluateUtilityCapabilities(
      coverage({
        Dispels: { complete: false, truncated: true, stopReason: "MAX_PAGES" },
        Interrupts: { complete: true },
        Casts: { complete: true },
        Debuffs: { complete: true },
        Buffs: { complete: true },
      }),
    );
    expect(caps.find((c) => c.capability === "UTILITY_DISPELS")?.status).toBe("INCOMPLETE");
    expect(caps.find((c) => c.capability === "UTILITY_INTERRUPTS")?.status).toBe("COMPLETE");
    expect(caps.find((c) => c.capability === "UTILITY_EXTERNAL_CASTS")?.status).toBe("COMPLETE");
  });

  it("10. all five participants are projected from one shared evidence set", () => {
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: participants(),
      coverage: coverage({}),
      eventsByDataset: {
        Interrupts: [
          {
            timestamp: FIGHT_START + 100,
            type: "interrupt",
            sourceID: 10,
            targetID: 99,
            abilityGameID: 19647,
          },
        ],
      },
    });
    expect(timeline.participants).toHaveLength(5);
    expect(timeline.participants.map((p) => p.characterName).sort()).toEqual([
      "DkFriend",
      "DruidFriend",
      "MageFriend",
      "PriestFriend",
      "WarlockMain",
    ]);
    // Zero actions for some participants is legitimate.
    expect(
      timeline.participants.filter((p) => p.characterName !== "WarlockMain").every(
        (p) => p.canonicalActionCount === 0,
      ),
    ).toBe(true);
  });

  it("11. extraction performs zero provider calls", () => {
    const result = extractUtilityActionTimeline({
      source: source(),
      participants: participants(),
      coverage: coverage({}),
      eventsByDataset: { Interrupts: [] },
    });
    expect(result.providerCallsDuringExtract).toBe(0);
  });

  it("12. filler rotational casts are absent", () => {
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: participants(),
      coverage: coverage({}),
      eventsByDataset: {
        Casts: [
          // Shadow Bolt / Hand of Gul'dan style filler — not in utility catalog tags
          {
            timestamp: FIGHT_START + 9000,
            type: "cast",
            sourceID: 10,
            targetID: 99,
            abilityGameID: 686,
            ability: { name: "Shadow Bolt" },
          },
          {
            timestamp: FIGHT_START + 9100,
            type: "cast",
            sourceID: 10,
            targetID: 99,
            abilityGameID: 105174,
            ability: { name: "Hand of Gul'dan" },
          },
          // Real utility
          {
            timestamp: FIGHT_START + 9200,
            type: "cast",
            sourceID: 10,
            targetID: 99,
            abilityGameID: 30283,
            ability: { name: "Shadowfury" },
          },
        ],
      },
    });
    expect(timeline.actions.every((a) => a.primarySpellId !== 686)).toBe(true);
    expect(timeline.actions.every((a) => a.primarySpellId !== 105174)).toBe(true);
    expect(timeline.actions.some((a) => a.canonicalName === "Shadowfury")).toBe(true);
  });

  it("13. proven aliases resolve Axe Toss 119914 and Singe Magic 1276623", () => {
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: participants(),
      coverage: coverage({}),
      eventsByDataset: {
        Casts: [
          {
            timestamp: FIGHT_START + 10_000,
            type: "cast",
            sourceID: 10,
            targetID: 99,
            abilityGameID: 119914,
            ability: { name: "Axe Toss" },
          },
        ],
        Interrupts: [
          {
            timestamp: FIGHT_START + 10_010,
            type: "interrupt",
            sourceID: 20,
            targetID: 99,
            abilityGameID: 347008,
            ability: { name: "Axe Toss" },
          },
        ],
        Dispels: [
          {
            timestamp: FIGHT_START + 11_000,
            type: "dispel",
            sourceID: 20,
            targetID: 11,
            abilityGameID: 132411,
            ability: { name: "Singe Magic" },
          },
        ],
        Buffs: [
          {
            timestamp: FIGHT_START + 11_050,
            type: "applybuff",
            sourceID: 10,
            targetID: 10,
            abilityGameID: 1276623,
            ability: { name: "Singe Magic" },
          },
        ],
      },
    });
    const axe = timeline.actions.filter((a) => a.abilityKey === "warlock.interrupt.axe-toss");
    expect(axe).toHaveLength(1);
    expect(axe[0]!.observedSpellIds).toEqual(expect.arrayContaining([119914, 347008]));
    const singe = timeline.actions.filter((a) => a.abilityKey === "warlock.dispel.singe-magic");
    expect(singe).toHaveLength(1);
    // Buff aura alone must not invent an extra dispel use.
    expect(singe[0]!.observedSpellIds).toContain(132411);
  });

  it("14. Soulstone and Cauterizing Flame produce combat-res / defensive-dispel actions", () => {
    const five = participants();
    five[1] = {
      playerActorId: 1,
      characterName: "Litonfire",
      realmSlug: "archimonde",
      regionCode: "EU",
      classSlug: "evoker",
      specSlug: "augmentation",
      ownedPetActorIds: [],
    };
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: five,
      coverage: coverage({}),
      eventsByDataset: {
        Casts: [
          {
            timestamp: FIGHT_START + 12_000,
            type: "begincast",
            sourceID: 10,
            targetID: -1,
            abilityGameID: 20707,
            ability: { name: "Soulstone" },
          },
          {
            timestamp: FIGHT_START + 12_900,
            type: "cast",
            sourceID: 10,
            targetID: 12,
            abilityGameID: 20707,
            ability: { name: "Soulstone" },
          },
        ],
        Dispels: [
          {
            timestamp: FIGHT_START + 13_000,
            type: "dispel",
            sourceID: 1,
            targetID: 14,
            abilityGameID: 374251,
            ability: { name: "Cauterizing Flame" },
          },
        ],
      },
    });
    const soulstones = timeline.actions.filter(
      (a) => a.abilityKey === "warlock.battle-rez.soulstone",
    );
    expect(soulstones).toHaveLength(1);
    expect(soulstones[0]!.utilityCategory).toBe("COMBAT_RES");
    expect(soulstones[0]!.targetActorId).toBe(12);
    expect(soulstones[0]!.evidenceEventTypes.sort()).toEqual(["begincast", "cast"]);
    const flame = timeline.actions.find(
      (a) => a.abilityKey === "evoker.dispel.cauterizing-flame",
    );
    expect(flame).toBeTruthy();
    expect(flame!.utilityCategory).toBe("DEFENSIVE_DISPEL");
    expect(flame!.ownerActorId).toBe(1);
    expect(flame!.targetActorId).toBe(14);
  });

  it("15. Typhoon 61391 merges cast+debuff; Terror 372245 stays unresolved", () => {
    const five = participants();
    five[0] = {
      ...five[0]!,
      playerActorId: 1,
      characterName: "Litonfire",
      classSlug: "evoker",
      specSlug: "augmentation",
      ownedPetActorIds: [],
    };
    five[3] = {
      ...five[3]!,
      playerActorId: 37,
      characterName: "Lowkytaz",
      classSlug: "druid",
      specSlug: "restoration",
    };
    const { timeline } = extractUtilityActionTimeline({
      source: source(),
      participants: five,
      coverage: coverage({}),
      eventsByDataset: {
        Casts: [
          {
            timestamp: FIGHT_START + 14_000,
            type: "cast",
            sourceID: 37,
            abilityGameID: 61391,
            ability: { name: "Typhoon" },
          },
        ],
        Interrupts: [
          {
            timestamp: FIGHT_START + 14_000,
            type: "applydebuff",
            sourceID: 37,
            targetID: 99,
            abilityGameID: 61391,
            ability: { name: "Typhoon" },
          },
          {
            timestamp: FIGHT_START + 15_000,
            type: "applydebuff",
            sourceID: 1,
            targetID: 99,
            abilityGameID: 372245,
            ability: { name: "Terror of the Skies" },
          },
        ],
      },
    });
    const typhoon = timeline.actions.filter((a) => a.abilityKey === "druid.soft-cc.typhoon");
    expect(typhoon).toHaveLength(1);
    expect(typhoon[0]!.utilityCategory).toBe("CROWD_CONTROL");
    expect(timeline.actions.every((a) => !a.observedSpellIds.includes(372245))).toBe(true);
    expect(
      timeline.utilityCatalogGapSummary.some((g) => g.spellId === 372245),
    ).toBe(true);
  });
});
