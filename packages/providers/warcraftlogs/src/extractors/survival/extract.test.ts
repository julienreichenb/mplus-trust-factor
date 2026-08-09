import { describe, expect, it } from "vitest";
import {
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
  type CapabilityCompactEvent,
  type CapabilityCoverageV1,
  type CapabilityEvidencePackageV1,
  type EvidenceCapability,
} from "@mplus/contracts";
import {
  evaluateSurvivalCapabilities,
  extractSurvivalFromCapabilityPackage,
  type SurvivalProbeParticipant,
  type SurvivalProbeSourceIdentity,
} from "./index.js";

const FIGHT_START = 1_000_000;

function coverageRow(
  capability: EvidenceCapability,
  overrides: Partial<CapabilityCoverageV1> = {},
): CapabilityCoverageV1 {
  return {
    capability,
    requiredDatasets: overrides.requiredDatasets ?? ["Casts", "Buffs"],
    filterIdentity: "test",
    pageCount: overrides.pageCount ?? 1,
    eventCount: overrides.eventCount ?? 10,
    firstTimestampMs: null,
    lastTimestampMs: null,
    nextPageTimestamp: overrides.nextPageTimestamp ?? null,
    stopReason: overrides.stopReason ?? "NEXT_PAGE_NULL",
    complete: overrides.complete ?? true,
    limitations: overrides.limitations ?? [],
    sourceArtifactIds: [],
  };
}

function basePackage(
  events: CapabilityCompactEvent[],
  coverageOverrides: Partial<Record<EvidenceCapability, Partial<CapabilityCoverageV1>>> = {},
): CapabilityEvidencePackageV1 {
  const capabilities: EvidenceCapability[] = [
    "SURVIVAL_DAMAGE_TAKEN",
    "SURVIVAL_DEATHS",
    "SURVIVAL_DEFENSIVE_ACTIVATIONS",
    "SURVIVAL_RECOVERY_ACTIVATIONS",
    "UTILITY_EXTERNAL_CASTS",
    "UTILITY_EXTERNAL_TARGET_CONTEXT",
    "PARTICIPANT_METADATA",
    "ACTOR_OWNERSHIP",
  ];
  const coverage = capabilities.map((capability) => {
    const required =
      capability === "SURVIVAL_DAMAGE_TAKEN"
        ? ["DamageTaken"]
        : capability === "SURVIVAL_DEATHS"
          ? ["Deaths"]
          : capability === "PARTICIPANT_METADATA"
            ? ["masterData", "CombatantInfo"]
            : capability === "ACTOR_OWNERSHIP"
              ? ["masterData"]
              : ["Casts", "Buffs"];
    return coverageRow(capability, {
      requiredDatasets: required,
      ...(coverageOverrides[capability] ?? {}),
    });
  });

  return {
    schemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION",
    sourceKey: { reportCode: "TESTCODE", fightId: 1, reportRevision: 1 },
    compatibilityIdentity: {
      reportCode: "TESTCODE",
      fightId: 1,
      reportRevision: 1,
      dataset: "PACKAGE",
      capabilitySet: capabilities,
      actorSetHash: "actorshash123456",
      abilityFilterHash: "abilityhash12345",
      catalogVersion: "test-catalog",
      packageSchemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
      acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
      graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
    },
    compatibilityKey: "test-compat-key",
    acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
    catalogVersion: "test-catalog",
    graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
    friendlyPlayerActorIds: [10, 11, 12, 13, 14],
    ownedPetActorIds: [20],
    actorSetHash: "actorshash123456",
    abilityFilterHash: "abilityhash12345",
    capabilitySet: capabilities,
    coverage,
    compactEvents: events,
    participantLoadouts: [],
    unknownAbilitySummaries: [],
    retention: {
      rawPages: "EPHEMERAL_RAW_PAGE",
      packageClass: "CANONICAL_CAPABILITY_EVIDENCE",
      diagnosticClass: "PINNED_DIAGNOSTIC",
    },
    accounting: {
      graphqlRequestCount: 0,
      pagesFetched: 0,
      eventsBeforeRelevanceFilter: events.length,
      eventsAfterRelevanceFilter: events.length,
      filterBatchCount: 0,
      providerCalls: 0,
    },
    verifiedFilters: [],
    sourceArtifactIds: [],
    complete: true,
    limitations: [],
    contentHash: "a".repeat(64),
  };
}

function source(): SurvivalProbeSourceIdentity {
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

function participants(): SurvivalProbeParticipant[] {
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

function evt(
  partial: Partial<CapabilityCompactEvent> &
    Pick<CapabilityCompactEvent, "eventId" | "timestampMs" | "dataset" | "capabilities">,
): CapabilityCompactEvent {
  return {
    eventType: partial.eventType ?? "cast",
    spellId: partial.spellId ?? null,
    rawName: partial.rawName ?? null,
    sourceActorId: partial.sourceActorId ?? null,
    sourceOwnerPlayerActorId: partial.sourceOwnerPlayerActorId ?? null,
    targetActorId: partial.targetActorId ?? null,
    targetPlayerActorId: partial.targetPlayerActorId ?? null,
    amount: partial.amount,
    ...partial,
  };
}

describe("survival-one-fight extraction", () => {
  it("1. cast plus buff lifecycle becomes one defensive activation", () => {
    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage([
        evt({
          eventId: "c1",
          timestampMs: FIGHT_START + 1000,
          dataset: "Casts",
          eventType: "cast",
          spellId: 104773,
          rawName: "Unending Resolve",
          sourceActorId: 10,
          sourceOwnerPlayerActorId: 10,
          capabilities: ["SURVIVAL_DEFENSIVE_ACTIVATIONS"],
        }),
        evt({
          eventId: "b1",
          timestampMs: FIGHT_START + 1010,
          dataset: "Buffs",
          eventType: "applybuff",
          spellId: 104773,
          rawName: "Unending Resolve",
          sourceActorId: 10,
          sourceOwnerPlayerActorId: 10,
          targetActorId: 10,
          targetPlayerActorId: 10,
          capabilities: ["SURVIVAL_DEFENSIVE_ACTIVATIONS", "UTILITY_EXTERNAL_TARGET_CONTEXT"],
        }),
      ]),
    });
    const defs = timeline.activations.filter((a) => a.activationKind === "PERSONAL_DEFENSIVE");
    expect(defs).toHaveLength(1);
    expect(defs[0]!.canonicalName).toBe("Unending Resolve");
    expect(defs[0]!.activationSource).toBe("CAST_AND_BUFF");
    expect(defs[0]!.evidenceEventTypes.sort()).toEqual(["applybuff", "cast"]);
  });

  it("2. buff refresh/removal does not create extra uses", () => {
    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage([
        evt({
          eventId: "c1",
          timestampMs: FIGHT_START + 2000,
          dataset: "Casts",
          eventType: "cast",
          spellId: 22812,
          rawName: "Barkskin",
          sourceActorId: 14,
          sourceOwnerPlayerActorId: 14,
          capabilities: ["SURVIVAL_DEFENSIVE_ACTIVATIONS"],
        }),
        evt({
          eventId: "b1",
          timestampMs: FIGHT_START + 2010,
          dataset: "Buffs",
          eventType: "applybuff",
          spellId: 22812,
          sourceActorId: 14,
          sourceOwnerPlayerActorId: 14,
          targetActorId: 14,
          targetPlayerActorId: 14,
          capabilities: ["SURVIVAL_DEFENSIVE_ACTIVATIONS"],
        }),
        evt({
          eventId: "b2",
          timestampMs: FIGHT_START + 2500,
          dataset: "Buffs",
          eventType: "refreshbuff",
          spellId: 22812,
          sourceActorId: 14,
          sourceOwnerPlayerActorId: 14,
          targetActorId: 14,
          targetPlayerActorId: 14,
          capabilities: ["SURVIVAL_DEFENSIVE_ACTIVATIONS"],
        }),
        evt({
          eventId: "b3",
          timestampMs: FIGHT_START + 8000,
          dataset: "Buffs",
          eventType: "removebuff",
          spellId: 22812,
          sourceActorId: 14,
          sourceOwnerPlayerActorId: 14,
          targetActorId: 14,
          targetPlayerActorId: 14,
          capabilities: ["SURVIVAL_DEFENSIVE_ACTIVATIONS"],
        }),
      ]),
    });
    expect(
      timeline.activations.filter((a) => a.primarySpellId === 22812),
    ).toHaveLength(1);
  });

  it("3. recovery actions are separated from defensives", () => {
    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage([
        evt({
          eventId: "d1",
          timestampMs: FIGHT_START + 3000,
          dataset: "Casts",
          eventType: "cast",
          spellId: 104773,
          rawName: "Unending Resolve",
          sourceActorId: 10,
          sourceOwnerPlayerActorId: 10,
          capabilities: ["SURVIVAL_DEFENSIVE_ACTIVATIONS"],
        }),
        evt({
          eventId: "r1",
          timestampMs: FIGHT_START + 3100,
          dataset: "Casts",
          eventType: "cast",
          spellId: 6262,
          rawName: "Healthstone",
          sourceActorId: 10,
          sourceOwnerPlayerActorId: 10,
          capabilities: ["SURVIVAL_RECOVERY_ACTIVATIONS"],
        }),
      ]),
    });
    expect(timeline.activations.filter((a) => a.activationKind === "PERSONAL_DEFENSIVE")).toHaveLength(1);
    expect(timeline.activations.filter((a) => a.activationKind === "RECOVERY")).toHaveLength(1);
    expect(timeline.activations.find((a) => a.activationKind === "RECOVERY")!.canonicalName).toBe(
      "Healthstone",
    );
  });

  it("4. external defensives preserve caster and recipient", () => {
    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage([
        evt({
          eventId: "e1",
          timestampMs: FIGHT_START + 4000,
          dataset: "Casts",
          eventType: "cast",
          spellId: 102342,
          rawName: "Ironbark",
          sourceActorId: 14,
          sourceOwnerPlayerActorId: 14,
          targetActorId: 10,
          targetPlayerActorId: 10,
          capabilities: ["UTILITY_EXTERNAL_CASTS"],
        }),
        evt({
          eventId: "e2",
          timestampMs: FIGHT_START + 4010,
          dataset: "Buffs",
          eventType: "applybuff",
          spellId: 102342,
          rawName: "Ironbark",
          sourceActorId: 14,
          sourceOwnerPlayerActorId: 14,
          targetActorId: 10,
          targetPlayerActorId: 10,
          capabilities: ["UTILITY_EXTERNAL_CASTS", "UTILITY_EXTERNAL_TARGET_CONTEXT"],
        }),
      ]),
    });
    const ext = timeline.activations.find((a) => a.primarySpellId === 102342);
    expect(ext).toBeTruthy();
    expect(ext!.activationKind).toBe("EXTERNAL_DEFENSIVE_RECEIVED");
    expect(ext!.casterActorId).toBe(14);
    expect(ext!.recipientActorId).toBe(10);
    expect(ext!.casterCharacterName).toBe("DruidFriend");
    expect(ext!.recipientCharacterName).toBe("WarlockMain");
    expect(ext!.creditsCasterForUtility).toBe(true);
  });

  it("5. received externals are not credited as personal defensive usage", () => {
    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage([
        evt({
          eventId: "e1",
          timestampMs: FIGHT_START + 5000,
          dataset: "Buffs",
          eventType: "applybuff",
          spellId: 102342,
          rawName: "Ironbark",
          sourceActorId: 14,
          sourceOwnerPlayerActorId: 14,
          targetActorId: 10,
          targetPlayerActorId: 10,
          capabilities: ["UTILITY_EXTERNAL_CASTS", "UTILITY_EXTERNAL_TARGET_CONTEXT"],
        }),
      ]),
    });
    const recipient = timeline.participants.find((p) => p.playerActorId === 10)!;
    expect(recipient.canonicalPersonalDefensiveCount).toBe(0);
    expect(recipient.externalDefensiveReceivedCount).toBe(1);
    const ext = timeline.activations.find((a) => a.primarySpellId === 102342)!;
    expect(ext.creditsSurvivalUsageToRecipient).toBe(false);
  });

  it("6. pet-owned actions are attributed correctly", () => {
    // Dark Pact is player-owned; use Unending Resolve cast from pet actor id mapped to owner.
    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage([
        evt({
          eventId: "p1",
          timestampMs: FIGHT_START + 6000,
          dataset: "Casts",
          eventType: "cast",
          spellId: 108416,
          rawName: "Dark Pact",
          sourceActorId: 20,
          sourceOwnerPlayerActorId: 10,
          capabilities: ["SURVIVAL_DEFENSIVE_ACTIVATIONS"],
        }),
      ]),
    });
    expect(timeline.activations).toHaveLength(1);
    expect(timeline.activations[0]!.participantActorId).toBe(10);
    expect(timeline.activations[0]!.attributedToPet).toBe(true);
    expect(timeline.activations[0]!.petActorId).toBe(20);
    expect(timeline.activations[0]!.casterCharacterName).toBe("WarlockMain");
  });

  it("7. damage is grouped into deterministic pressure windows", () => {
    const damageEvents: CapabilityCompactEvent[] = [];
    for (let i = 0; i < 5; i += 1) {
      damageEvents.push(
        evt({
          eventId: `dmg${i}`,
          timestampMs: FIGHT_START + 10_000 + i * 200,
          dataset: "DamageTaken",
          eventType: "damage",
          spellId: 1,
          sourceActorId: 99,
          targetActorId: 10,
          targetPlayerActorId: 10,
          amount: 150_000,
          capabilities: ["SURVIVAL_DAMAGE_TAKEN"],
        }),
      );
    }
    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage(damageEvents),
    });
    const sustained = timeline.pressureWindows.filter(
      (w) => w.participantActorId === 10 && w.windowClass === "SUSTAINED_PRESSURE",
    );
    expect(sustained.length).toBeGreaterThanOrEqual(1);
    expect(sustained[0]!.derivation.hitCount).toBeGreaterThanOrEqual(3);
    expect(sustained[0]!.derivation.totalDamage).toBe(750_000);
  });

  it("8. isolated low damage does not become sustained pressure", () => {
    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage([
        evt({
          eventId: "tiny",
          timestampMs: FIGHT_START + 20_000,
          dataset: "DamageTaken",
          eventType: "damage",
          spellId: 1,
          sourceActorId: 99,
          targetActorId: 10,
          targetPlayerActorId: 10,
          amount: 5_000,
          capabilities: ["SURVIVAL_DAMAGE_TAKEN"],
        }),
      ]),
    });
    expect(
      timeline.pressureWindows.filter(
        (w) => w.participantActorId === 10 && w.windowClass === "SUSTAINED_PRESSURE",
      ),
    ).toHaveLength(0);
    expect(
      timeline.pressureWindows.filter((w) => w.participantActorId === 10),
    ).toHaveLength(0);
    expect(timeline.participants.find((p) => p.playerActorId === 10)!.damageTakenTotal).toBe(5_000);
  });

  it("9. death events are associated with the relevant pressure window", () => {
    const events: CapabilityCompactEvent[] = [];
    for (let i = 0; i < 4; i += 1) {
      events.push(
        evt({
          eventId: `d${i}`,
          timestampMs: FIGHT_START + 30_000 + i * 300,
          dataset: "DamageTaken",
          eventType: "damage",
          spellId: 1,
          sourceActorId: 99,
          targetActorId: 12,
          targetPlayerActorId: 12,
          amount: 200_000,
          capabilities: ["SURVIVAL_DAMAGE_TAKEN"],
        }),
      );
    }
    events.push(
      evt({
        eventId: "death1",
        timestampMs: FIGHT_START + 30_000 + 3 * 300 + 200,
        dataset: "Deaths",
        eventType: "death",
        spellId: 1,
        rawName: "Crush",
        sourceActorId: 99,
        targetActorId: 12,
        targetPlayerActorId: 12,
        capabilities: ["SURVIVAL_DEATHS"],
      }),
    );
    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage(events),
    });
    expect(timeline.deaths).toHaveLength(1);
    expect(timeline.deaths[0]!.relatedPressureWindowId).toBeTruthy();
    const window = timeline.pressureWindows.find(
      (w) => w.pressureWindowId === timeline.deaths[0]!.relatedPressureWindowId,
    );
    expect(window).toBeTruthy();
    expect(window!.response.deathEventIds).toContain(timeline.deaths[0]!.deathEventId);
    expect(window!.windowClass).toBe("FATAL_PRESSURE");
  });

  it("10. incomplete optional evidence does not invalidate complete DamageTaken", () => {
    const caps = evaluateSurvivalCapabilities([
      coverageRow("SURVIVAL_DAMAGE_TAKEN", {
        requiredDatasets: ["DamageTaken"],
        complete: true,
        stopReason: "NEXT_PAGE_NULL",
      }),
      coverageRow("SURVIVAL_DEATHS", {
        requiredDatasets: ["Deaths"],
        complete: true,
      }),
      coverageRow("SURVIVAL_DEFENSIVE_ACTIVATIONS", {
        complete: true,
      }),
      coverageRow("SURVIVAL_RECOVERY_ACTIVATIONS", {
        complete: true,
      }),
      coverageRow("UTILITY_EXTERNAL_TARGET_CONTEXT", {
        requiredDatasets: ["Buffs"],
        complete: false,
        truncated: true,
        stopReason: "MAX_PAGES",
        limitations: ["DATASET_INCOMPLETE:Buffs:MAX_PAGES"],
      }),
    ]);
    expect(caps.find((c) => c.capability === "SURVIVAL_DAMAGE_TAKEN")?.status).toBe("COMPLETE");
    expect(caps.find((c) => c.capability === "UTILITY_EXTERNAL_TARGET_CONTEXT")?.status).toBe(
      "INCOMPLETE",
    );

    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage(
        [
          evt({
            eventId: "dmg",
            timestampMs: FIGHT_START + 100,
            dataset: "DamageTaken",
            eventType: "damage",
            amount: 1000,
            sourceActorId: 99,
            targetActorId: 10,
            targetPlayerActorId: 10,
            capabilities: ["SURVIVAL_DAMAGE_TAKEN"],
          }),
        ],
        {
          UTILITY_EXTERNAL_TARGET_CONTEXT: {
            complete: false,
            stopReason: "MAX_PAGES",
            limitations: ["DATASET_INCOMPLETE:Buffs:MAX_PAGES"],
          },
        },
      ),
    });
    const damageCap = timeline.capabilityCompleteness.find(
      (c) => c.capability === "SURVIVAL_DAMAGE_TAKEN",
    );
    expect(damageCap?.status).toBe("COMPLETE");
    expect(
      timeline.participants.every((p) =>
        p.limitations.every((l) => !l.includes("INVALIDATE_DAMAGE_TAKEN")),
      ),
    ).toBe(true);
  });

  it("11. all five participants use one shared evidence package", () => {
    const { timeline } = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage([]),
    });
    expect(timeline.participants).toHaveLength(5);
    const hashes = new Set(
      timeline.participants.map((p) => p.capabilityEvidencePackageContentHash),
    );
    expect(hashes.size).toBe(1);
    expect([...hashes][0]).toBe(timeline.capabilityEvidencePackageContentHash);
  });

  it("12. extraction / capability rebuild path performs zero provider calls", () => {
    const result = extractSurvivalFromCapabilityPackage({
      source: source(),
      participants: participants(),
      capabilityPackage: basePackage([]),
    });
    expect(result.providerCallsDuringExtract).toBe(0);
  });
});
