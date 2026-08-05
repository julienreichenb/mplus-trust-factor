import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import {
  normalizeWclEventFields,
  sanitizeUnresolvedEventShape,
} from "../../normalize/wcl-event-normalizer.js";
import { buildOffensiveProbeReport } from "./activations.js";
import type { OffensiveProbeDataLoad, OffensiveProbeFightSelection } from "./types.js";

function persistedDataLoad(): OffensiveProbeDataLoad {
  return {
    mode: "PERSISTED_EVIDENCE",
    datasets: ["Casts", "Buffs", "CombatantInfo", "masterData"],
    castsSource: "PERSISTED_EVIDENCE",
    buffsSource: "PERSISTED_EVIDENCE",
    storageSchemesRead: ["pg"],
    totalProviderCalls: 0,
    providerCallsDuringReload: 0,
    wclRequests: 0,
  };
}

function baseSelection(
  overrides: Partial<OffensiveProbeFightSelection> = {},
): OffensiveProbeFightSelection {
  return {
    manifestId: "manifest-1",
    slotId: "slot-1",
    characterId: "char-1",
    reportCode: "abc123",
    fightId: 2,
    reportRevision: 1,
    dungeonSlug: "everbloom",
    keyLevel: 15,
    playerActorId: 10,
    ownedPetActorIds: [20],
    fightStartMs: 1_000_000,
    fightEndMs: 1_900_000,
    classSlug: "warlock",
    specSlug: "demonology",
    ...overrides,
  };
}

describe("normalizeWclEventFields", () => {
  it("1. resolves top-level abilityGameID", () => {
    const fields = normalizeWclEventFields({
      timestamp: 1_000_100,
      type: "cast",
      sourceID: 10,
      targetID: 99,
      abilityGameID: 111898,
      ability: { name: "Immolate" },
    });
    expect(fields.abilityId).toEqual({ value: 111898, sourcePath: "abilityGameID" });
    expect(fields.sourceActorId).toEqual({ value: 10, sourcePath: "sourceID" });
    expect(fields.targetActorId).toEqual({ value: 99, sourcePath: "targetID" });
  });

  it("2. resolves nested ability.gameID", () => {
    const fields = normalizeWclEventFields({
      timestamp: 1_000_200,
      type: "cast",
      source: { id: 10 },
      target: { id: 99 },
      ability: { gameID: 265187, name: "Demonic Calling" },
    });
    expect(fields.abilityId).toEqual({ value: 265187, sourcePath: "ability.gameID" });
    expect(fields.sourceActorId).toEqual({ value: 10, sourcePath: "source.id" });
    expect(fields.targetActorId).toEqual({ value: 99, sourcePath: "target.id" });
  });

  it("3. resolves nested ability.guid", () => {
    const fields = normalizeWclEventFields({
      timestamp: 1_000_300,
      type: "apply",
      sourceID: 10,
      ability: { guid: 267171, name: "Demonic Strength" },
    });
    expect(fields.abilityId).toEqual({ value: 267171, sourcePath: "ability.guid" });
  });

  it("5. resolves extraAbility.gameID", () => {
    const fields = normalizeWclEventFields({
      timestamp: 1_000_400,
      type: "cast",
      sourceID: 10,
      abilityGameID: 2139,
      extraAbility: { gameID: 116, name: "Counterspell" },
    });
    expect(fields.extraAbilityId).toEqual({ value: 116, sourcePath: "extraAbility.gameID" });
  });
});

describe("buildOffensiveProbeReport", () => {
  const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });

  it("4. resolves mixed top-level and nested actor IDs", () => {
    const report = buildOffensiveProbeReport({
      selection: baseSelection(),
      casts: [
        { timestamp: 1_000_100, type: "cast", sourceID: 10, abilityGameID: 1001 },
        { timestamp: 1_000_200, type: "cast", source: { id: 20 }, ability: { guid: 1002 } },
      ],
      buffs: [],
      catalog,
      dataLoad: persistedDataLoad(),
    });
    expect(report.diagnostics.sourceActorIdSourcePathCounts.sourceID).toBe(1);
    expect(report.diagnostics.sourceActorIdSourcePathCounts["source.id"]).toBe(1);
    expect(report.summary.normalizedEventCount).toBe(2);
  });

  it("6. keeps localized raw names with identical spell IDs separate in inventory names list", () => {
    const report = buildOffensiveProbeReport({
      selection: baseSelection(),
      casts: [
        {
          timestamp: 1_000_100,
          type: "cast",
          sourceID: 10,
          abilityGameID: 111898,
          ability: { name: "Immolation" },
        },
        {
          timestamp: 1_000_150,
          type: "cast",
          sourceID: 10,
          abilityGameID: 111898,
          ability: { name: "Brandglut" },
        },
      ],
      buffs: [],
      catalog,
      dataLoad: persistedDataLoad(),
    });
    const row = report.abilityInventory.find((r) => r.spellId === 111898);
    expect(row?.observedRawNames.sort()).toEqual(["Brandglut", "Immolation"]);
    expect(report.summary.distinctObservedSpellIds).toBe(1);
  });

  it("7. preserves two different spells at the same timestamp", () => {
    const report = buildOffensiveProbeReport({
      selection: baseSelection(),
      casts: [
        { timestamp: 1_000_500, type: "cast", sourceID: 10, abilityGameID: 1001 },
        { timestamp: 1_000_500, type: "cast", sourceID: 10, abilityGameID: 1002 },
      ],
      buffs: [],
      catalog,
      dataLoad: persistedDataLoad(),
    });
    expect(report.abilityInventory.map((r) => r.spellId).sort()).toEqual([1001, 1002]);
    expect(report.timeline.filter((e) => e.rawTimestampMs === 1_000_500)).toHaveLength(2);
  });

  it("8. attributes player, owned pet and unrelated actor events", () => {
    const report = buildOffensiveProbeReport({
      selection: baseSelection({ ownedPetActorIds: [20] }),
      casts: [
        { timestamp: 1_000_100, type: "cast", sourceID: 10, abilityGameID: 1001 },
        { timestamp: 1_000_200, type: "cast", sourceID: 20, abilityGameID: 1002 },
        { timestamp: 1_000_300, type: "cast", sourceID: 99, abilityGameID: 1003 },
      ],
      buffs: [],
      catalog,
      dataLoad: persistedDataLoad(),
    });
    expect(report.diagnostics.playerEventCount).toBe(1);
    expect(report.diagnostics.ownedPetOrGuardianEventCount).toBe(1);
    expect(report.diagnostics.otherActorEventCount).toBe(1);
    expect(report.summary.distinctObservedSpellIds).toBe(2);
    expect(report.abilityInventory.map((r) => r.spellId).sort()).toEqual([1001, 1002]);
  });

  it("9. sorts timeline deterministically by timestamp, dataset and spell ID", () => {
    const report = buildOffensiveProbeReport({
      selection: baseSelection(),
      casts: [{ timestamp: 1_000_300, type: "cast", sourceID: 10, abilityGameID: 2000 }],
      buffs: [
        { timestamp: 1_000_300, type: "apply", sourceID: 10, abilityGameID: 1000 },
        { timestamp: 1_000_200, type: "apply", sourceID: 10, abilityGameID: 1500 },
      ],
      catalog,
      dataLoad: persistedDataLoad(),
    });
    expect(report.timeline.map((e) => `${e.rawTimestampMs}:${e.dataset}:${e.spellId}`)).toEqual([
      "1000200:Buffs:1500",
      "1000300:Buffs:1000",
      "1000300:Casts:2000",
    ]);
    for (const entry of report.timeline) {
      expect(entry.fightOffsetMs).toBe(entry.rawTimestampMs - 1_000_000);
    }
  });

  it("10. reports bounded unresolved-event output", () => {
    const casts = Array.from({ length: 12 }, (_, index) => ({
      timestamp: 1_000_100 + index,
      type: "cast",
      sourceID: 10,
      ability: { name: "Unknown" },
      extra: "strip-me",
    }));
    const report = buildOffensiveProbeReport({
      selection: baseSelection(),
      casts,
      buffs: [],
      catalog,
      dataLoad: persistedDataLoad(),
    });
    expect(report.summary.unresolvedEventCount).toBe(12);
    expect(report.diagnostics.unresolvedEventSamples).toHaveLength(10);
    expect(report.diagnostics.unresolvedEventSamples[0]?.shape.extra).toBeUndefined();
    expect(
      sanitizeUnresolvedEventShape({
        ability: { name: "X", guid: 1, huge: "x".repeat(500) },
        source: { id: 2, server: "secret" },
      }),
    ).toEqual({
      ability: { guid: 1, name: "X" },
      source: { id: 2 },
    });
  });

  it("does not classify unmatched abilities as offensive automatically", () => {
    const report = buildOffensiveProbeReport({
      selection: baseSelection(),
      casts: [{ timestamp: 1_000_100, type: "cast", sourceID: 10, abilityGameID: 999_999_999 }],
      buffs: [],
      catalog,
      dataLoad: persistedDataLoad(),
    });
    const row = report.abilityInventory[0];
    expect(row?.catalogMatch.matched).toBe(false);
    expect(row?.catalogMatch.catalogCategory).toBeNull();
  });

  it("labels pg://-backed loads as PERSISTED_EVIDENCE, not CAS", () => {
    const report = buildOffensiveProbeReport({
      selection: baseSelection(),
      casts: [
        { timestamp: 1_000_100, type: "begincast", sourceID: 10, abilityGameID: 265187 },
        { timestamp: 1_000_200, type: "cast", sourceID: 10, abilityGameID: 265187 },
      ],
      buffs: [],
      catalog,
      dataLoad: persistedDataLoad(),
      participants: [
        {
          playerActorId: 10,
          characterName: "Wallidrixe",
          classSlug: "warlock",
          specSlug: "demonology",
          ownedPetActorIds: [20],
        },
      ],
      evidenceIntegrity: {
        totalProviderCalls: 0,
        providerCallsDuringReload: 0,
        storageSchemesRead: ["pg"],
        fillersExcluded: true,
        allFiveParticipantsResolved: false,
        participantCount: 1,
      },
    });
    expect(report.dataLoad.mode).toBe("PERSISTED_EVIDENCE");
    expect(report.dataLoad.mode).not.toBe("PERSISTED_CAS");
    expect(report.dataLoad.storageSchemesRead).toEqual(["pg"]);
    expect(report.evidenceIntegrity.storageSchemesRead).toEqual(["pg"]);
    expect(report.summary.totalProviderCalls).toBe(0);
    expect(report.summary.providerCallsDuringReload).toBe(0);
  });

  it("reports deduplicated activations per participant and keeps providerCallsDuringReload at 0", () => {
    const report = buildOffensiveProbeReport({
      selection: baseSelection(),
      casts: [
        { timestamp: 1_000_100, type: "begincast", sourceID: 10, abilityGameID: 265187 },
        { timestamp: 1_000_200, type: "cast", sourceID: 10, abilityGameID: 265187 },
        { timestamp: 1_000_300, type: "cast", sourceID: 11, abilityGameID: 375087 },
      ],
      buffs: [{ timestamp: 1_000_250, type: "applybuff", sourceID: 10, abilityGameID: 265187 }],
      catalog,
      dataLoad: persistedDataLoad(),
      participants: [
        {
          playerActorId: 10,
          characterName: "Wallidrixe",
          classSlug: "warlock",
          specSlug: "demonology",
          ownedPetActorIds: [],
        },
        {
          playerActorId: 11,
          characterName: "Evoker",
          classSlug: "evoker",
          specSlug: "devastation",
          ownedPetActorIds: [],
        },
      ],
      evidenceIntegrity: {
        totalProviderCalls: 0,
        providerCallsDuringReload: 0,
        storageSchemesRead: ["pg"],
        fillersExcluded: true,
        allFiveParticipantsResolved: false,
        participantCount: 2,
      },
    });

    const warlock = report.participants.find((p) => p.playerActorId === 10)!;
    expect(warlock.rawMatchedActivationEventCount).toBeGreaterThan(1);
    expect(warlock.deduplicatedActivationCount).toBe(1);
    expect(warlock.canonicalKeysActivated).toContain("warlock.offensive.demonic-tyrant");
    expect(report.summary.providerCallsDuringReload).toBe(0);
    expect(report.evidenceIntegrity.fillersExcluded).toBe(true);
  });

  it("normalizes deathknight → death-knight and enforces guardian spec (excludes balance CDs)", () => {
    const report = buildOffensiveProbeReport({
      selection: baseSelection({ classSlug: "deathknight", specSlug: null }),
      casts: [
        { timestamp: 1_000_100, type: "cast", sourceID: 39, abilityGameID: 42650 },
        { timestamp: 1_000_100, type: "cast", sourceID: 39, abilityGameID: 42650 },
        { timestamp: 1_100_100, type: "cast", sourceID: 37, abilityGameID: 202770 },
        { timestamp: 1_200_100, type: "cast", sourceID: 37, abilityGameID: 102558 },
      ],
      buffs: [],
      catalog,
      dataLoad: persistedDataLoad(),
      participants: [
        {
          playerActorId: 39,
          characterName: "Missmygrip",
          classSlug: "deathknight",
          specSlug: "unholy",
          role: "DPS",
          ownedPetActorIds: [],
        },
        {
          playerActorId: 37,
          characterName: "Lowkytaz",
          classSlug: "druid",
          specSlug: "guardian",
          role: "TANK",
          ownedPetActorIds: [],
        },
      ],
      evidenceIntegrity: {
        totalProviderCalls: 0,
        providerCallsDuringReload: 0,
        storageSchemesRead: ["pg"],
        fillersExcluded: true,
        allFiveParticipantsResolved: false,
        participantCount: 2,
      },
    });

    const dk = report.participants.find((p) => p.playerActorId === 39)!;
    expect(dk.classSlug).toBe("death-knight");
    expect(dk.canonicalKeysActivated).toContain("death-knight.offensive.army-of-the-dead");
    expect(dk.deduplicatedActivationCount).toBe(1);

    const bear = report.participants.find((p) => p.playerActorId === 37)!;
    expect(bear.canonicalKeysActivated).toContain(
      "druid.offensive.incarnation-guardian-of-ursoc",
    );
    expect(bear.canonicalKeysActivated).not.toContain("druid.offensive.fury-of-elune");
  });
});
