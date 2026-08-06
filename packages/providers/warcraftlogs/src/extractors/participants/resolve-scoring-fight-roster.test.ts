/**
 * Shared resolveScoringFightRoster — Tests A, E, G and failure cases.
 */
import { describe, expect, it } from "vitest";
import {
  buildCapabilityPackageCompatibilityKey,
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
  hashCapabilityEvidencePayload,
  type CapabilityEvidencePackageV1,
  type EvidenceCapability,
} from "@mplus/contracts";
import {
  resolveScoringFightRoster,
  resolveScoringFightRosterOrThrow,
} from "./resolve-scoring-fight-roster.js";

const CAPABILITIES: EvidenceCapability[] = [
  "PERFORMANCE_OFFENSIVE_ACTIVATIONS",
  "SURVIVAL_DEFENSIVE_ACTIVATIONS",
  "SURVIVAL_RECOVERY_ACTIVATIONS",
  "SURVIVAL_DAMAGE_TAKEN",
  "SURVIVAL_DEATHS",
  "UTILITY_INTERRUPTS",
  "UTILITY_DISPELS",
  "UTILITY_CROWD_CONTROL",
  "UTILITY_EXTERNAL_CASTS",
  "UTILITY_EXTERNAL_TARGET_CONTEXT",
  "PARTICIPANT_METADATA",
  "ACTOR_OWNERSHIP",
];

const TARGET_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function buildPackage(input: {
  friendlyPlayerActorIds: number[];
  ownedPetActorIds?: number[];
}): CapabilityEvidencePackageV1 {
  const actorSetHash = "actors0123456789";
  const abilityFilterHash = "abilities0123456";
  const catalogVersion = "catalog-test-v1";
  const sourceKey = { reportCode: "AbCdEf", fightId: 12, reportRevision: 3 };
  const compatibilityKey = buildCapabilityPackageCompatibilityKey({
    ...sourceKey,
    capabilitySet: CAPABILITIES,
    actorSetHash,
    abilityFilterHash,
    catalogVersion,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION",
  });
  const withoutHash = {
    schemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION" as const,
    sourceKey,
    compatibilityIdentity: {
      ...sourceKey,
      dataset: "PACKAGE",
      capabilitySet: [...CAPABILITIES].sort() as EvidenceCapability[],
      actorSetHash,
      abilityFilterHash,
      catalogVersion,
      acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
      graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
      mode: "PRODUCTION_CAPABILITY_ACQUISITION" as const,
    },
    compatibilityKey,
    acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
    catalogVersion,
    graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
    friendlyPlayerActorIds: input.friendlyPlayerActorIds,
    ownedPetActorIds: input.ownedPetActorIds ?? [],
    actorSetHash,
    abilityFilterHash,
    capabilitySet: [...CAPABILITIES].sort() as EvidenceCapability[],
    coverage: CAPABILITIES.map((capability) => ({
      capability,
      requiredDatasets: ["Buffs"],
      filterIdentity: "test",
      pageCount: 1,
      eventCount: 1,
      firstTimestampMs: 0,
      lastTimestampMs: 1000,
      nextPageTimestamp: null,
      stopReason: "NEXT_PAGE_NULL" as const,
      complete: true,
      limitations: [] as string[],
      sourceArtifactIds: [] as string[],
    })),
    compactEvents: [],
    unknownAbilitySummaries: [],
    retention: {
      rawPages: "EPHEMERAL_RAW_PAGE" as const,
      packageClass: "CANONICAL_CAPABILITY_EVIDENCE" as const,
      diagnosticClass: "PINNED_DIAGNOSTIC" as const,
    },
    accounting: {
      graphqlRequestCount: 0,
      pagesFetched: 0,
      eventsBeforeRelevanceFilter: 0,
      eventsAfterRelevanceFilter: 0,
      filterBatchCount: 0,
      providerCalls: 0,
    },
    verifiedFilters: [],
    sourceArtifactIds: [],
    complete: true,
    limitations: [] as string[],
  };
  return {
    ...withoutHash,
    contentHash: hashCapabilityEvidencePayload(withoutHash),
  };
}

const fivePlayerMasterData = {
  actors: [
    { id: 1, name: "Wallidrixe", type: "Player", server: "Archimonde", subType: "Warlock" },
    { id: 2, name: "HealerOne", type: "Player", server: "Archimonde", subType: "Priest" },
    { id: 3, name: "TankOne", type: "Player", server: "Archimonde", subType: "Paladin" },
    { id: 4, name: "DpsTwo", type: "Player", server: "Illidan", subType: "Hunter" },
    { id: 5, name: "DpsThree", type: "Player", server: "Archimonde", subType: "Mage" },
    { id: 50, name: "Imp", type: "Pet", petOwner: 1 },
    { id: 51, name: "Dog", type: "Pet", petOwner: 4 },
    { id: 99, name: "Boss", type: "NPC" },
  ],
};

describe("resolveScoringFightRoster", () => {
  it("A: resolves five players, attaches pets, links target safely", () => {
    const pkg = buildPackage({
      friendlyPlayerActorIds: [5, 1, 3, 2, 4],
      ownedPetActorIds: [50, 51],
    });
    const result = resolveScoringFightRosterOrThrow({
      capabilityPackage: pkg,
      masterData: fivePlayerMasterData,
      regionCode: "EU",
      target: {
        characterId: TARGET_ID,
        characterName: "Wallidrixe",
        realmSlug: "archimonde",
        regionCode: "EU",
        classSlug: "warlock",
        specSlug: "demonology",
        role: "DPS",
      },
    });

    expect(result.participants).toHaveLength(5);
    expect(result.participants.map((p) => p.participantActorId)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(
      result.participants.every((p) => !/^Actor\d+$/i.test(p.characterName)),
    ).toBe(true);
    expect(result.participants.some((p) => p.characterName === "Imp")).toBe(
      false,
    );
    expect(result.participants.find((p) => p.participantActorId === 1)).toEqual(
      expect.objectContaining({
        characterId: TARGET_ID,
        characterName: "Wallidrixe",
        realmSlug: "archimonde",
        ownedPetActorIds: [50],
        classSlug: "warlock",
        specSlug: "demonology",
      }),
    );
    expect(result.participants.find((p) => p.participantActorId === 4)).toEqual(
      expect.objectContaining({
        characterId: null,
        ownedPetActorIds: [51],
      }),
    );
    expect(
      result.participants.filter((p) => p.characterId != null),
    ).toHaveLength(1);
  });

  it("E: same-name cross-realm does not link the wrong actor", () => {
    const masterData = {
      actors: [
        {
          id: 1,
          name: "Twinsie",
          type: "Player",
          server: "Archimonde",
          subType: "Mage",
        },
        {
          id: 2,
          name: "Twinsie",
          type: "Player",
          server: "Illidan",
          subType: "Mage",
        },
        { id: 3, name: "Tank", type: "Player", server: "Archimonde", subType: "Warrior" },
        { id: 4, name: "Heal", type: "Player", server: "Archimonde", subType: "Priest" },
        { id: 5, name: "Dps", type: "Player", server: "Archimonde", subType: "Rogue" },
      ],
    };
    const pkg = buildPackage({ friendlyPlayerActorIds: [1, 2, 3, 4, 5] });
    const result = resolveScoringFightRosterOrThrow({
      capabilityPackage: pkg,
      masterData,
      regionCode: "EU",
      target: {
        characterId: TARGET_ID,
        characterName: "Twinsie",
        realmSlug: "illidan",
        regionCode: "EU",
      },
    });
    expect(result.targetActorId).toBe(2);
    expect(result.participants.find((p) => p.participantActorId === 2)?.characterId).toBe(
      TARGET_ID,
    );
    expect(result.participants.find((p) => p.participantActorId === 1)?.characterId).toBeNull();
  });

  it("G: partial optional metadata stays null (no unknown sentinel)", () => {
    const masterData = {
      actors: [
        { id: 1, name: "NamedOnly", type: "Player", subType: "Mage" },
        { id: 2, name: "Target", type: "Player", server: "Archimonde", subType: "Warlock" },
        { id: 3, name: "A", type: "Player", server: "Archimonde", subType: "Priest" },
        { id: 4, name: "B", type: "Player", server: "Archimonde", subType: "Warrior" },
        { id: 5, name: "C", type: "Player", server: "Archimonde", subType: "Hunter" },
      ],
    };
    const pkg = buildPackage({ friendlyPlayerActorIds: [1, 2, 3, 4, 5] });
    const result = resolveScoringFightRosterOrThrow({
      capabilityPackage: pkg,
      masterData,
      regionCode: "EU",
      target: {
        characterId: TARGET_ID,
        characterName: "Target",
        realmSlug: "archimonde",
        regionCode: "EU",
      },
      requireTarget: false,
    });
    const partial = result.participants.find((p) => p.participantActorId === 1)!;
    expect(partial.realmSlug).toBeNull();
    expect(partial.specSlug).toBeNull();
    expect(partial.characterName).toBe("NamedOnly");
    expect(JSON.stringify(partial)).not.toMatch(/unknown/i);
  });

  it("fails when masterData is missing", () => {
    const pkg = buildPackage({ friendlyPlayerActorIds: [1, 2, 3, 4, 5] });
    const result = resolveScoringFightRoster({
      capabilityPackage: pkg,
      masterData: null,
      regionCode: "EU",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("RAW_PACKAGE_MISSING_FIGHT_ROSTER");
    }
  });

  it("fails on duplicate friendly actor IDs", () => {
    const pkg = buildPackage({ friendlyPlayerActorIds: [1, 2, 2, 3, 4] });
    // Package schema maxes uniqueness loosely; force duplicate into resolver.
    (pkg as { friendlyPlayerActorIds: number[] }).friendlyPlayerActorIds = [
      1, 2, 2, 3, 4,
    ];
    const result = resolveScoringFightRoster({
      capabilityPackage: pkg,
      masterData: fivePlayerMasterData,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DUPLICATE_FRIENDLY_ACTOR_IDS");
    }
  });

  it("fails when friendly actor is absent from masterData", () => {
    const pkg = buildPackage({ friendlyPlayerActorIds: [1, 2, 3, 4, 77] });
    const result = resolveScoringFightRoster({
      capabilityPackage: pkg,
      masterData: fivePlayerMasterData,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FRIENDLY_ACTOR_ABSENT_FROM_MASTER_DATA");
    }
  });

  it("F: missing target does not select another player when required", () => {
    const pkg = buildPackage({ friendlyPlayerActorIds: [1, 2, 3, 4, 5] });
    const result = resolveScoringFightRoster({
      capabilityPackage: pkg,
      masterData: fivePlayerMasterData,
      regionCode: "EU",
      target: {
        characterId: TARGET_ID,
        characterName: "Nobody",
        realmSlug: "archimonde",
        regionCode: "EU",
      },
      requireTarget: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TARGET_PARTICIPANT_NOT_FOUND");
    }
  });
});
