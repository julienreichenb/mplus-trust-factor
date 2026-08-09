/**
 * Provider-free evidence conservation:
 * synthetic compact/WCL events → page processor → package → participant digest.
 */
import { describe, expect, it } from "vitest";
import {
  CURRENT_CATALOG_VERSION_ID,
  getAllRegisteredRules,
  isDigestRelevantRule,
  ruleResolvableSpellIds,
  type AbilityRule,
} from "@mplus/abilities";
import {
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
  buildCapabilityPackageCompatibilityKey,
  hashCapabilityEvidencePayload,
  type CapabilityCompactEvent,
  type CapabilityEvidencePackageV1,
  type EvidenceCapability,
} from "@mplus/contracts";
import {
  createPageProcessorState,
  extractCompactHitPoints,
  processCapabilityEvidencePage,
} from "../../evidence/capability/page-processor.js";
import { collectProductionRelevantAbilityIds } from "../../evidence/capability/relevant-ability-ids.js";
import { buildParticipantScoringDigestsFromPackage } from "./build-participant-scoring-digest.js";

const FIGHT_START = 1_000_000;
const ACTOR = 10;

function pickRule(
  predicate: (rule: AbilityRule) => boolean,
): AbilityRule {
  const rule = getAllRegisteredRules().find(
    (r) => isDigestRelevantRule(r) && predicate(r),
  );
  if (!rule) throw new Error("catalog_rule_not_found");
  return rule;
}

function packageFromCompact(
  events: CapabilityCompactEvent[],
  capabilities: EvidenceCapability[],
): CapabilityEvidencePackageV1 {
  const actorSetHash = "actorshash123456";
  const abilityFilterHash = "abilityhash12345";
  const capabilitySet = [...capabilities].sort() as EvidenceCapability[];
  const compatibilityKey = buildCapabilityPackageCompatibilityKey({
    reportCode: "CONSERVE1",
    fightId: 1,
    reportRevision: 1,
    capabilitySet,
    actorSetHash,
    abilityFilterHash,
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION",
  });
  const withoutHash: Omit<CapabilityEvidencePackageV1, "contentHash"> = {
    schemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION",
    sourceKey: { reportCode: "CONSERVE1", fightId: 1, reportRevision: 1 },
    compatibilityIdentity: {
      reportCode: "CONSERVE1",
      fightId: 1,
      reportRevision: 1,
      dataset: "PACKAGE",
      capabilitySet,
      actorSetHash,
      abilityFilterHash,
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      packageSchemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
      acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
      graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
    },
    compatibilityKey,
    acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
    friendlyPlayerActorIds: [ACTOR],
    ownedPetActorIds: [],
    actorSetHash,
    abilityFilterHash,
    capabilitySet,
    coverage: capabilitySet.map((capability) => ({
      capability,
      requiredDatasets: ["Casts"],
      filterIdentity: "test",
      pageCount: 1,
      eventCount: events.filter((e) => e.capabilities.includes(capability)).length,
      firstTimestampMs: FIGHT_START,
      lastTimestampMs: FIGHT_START + 60_000,
      nextPageTimestamp: null,
      stopReason: "NEXT_PAGE_NULL" as const,
      complete: true,
      limitations: [],
      sourceArtifactIds: [],
    })),
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
      pagesFetched: 1,
      eventsBeforeRelevanceFilter: events.length,
      eventsAfterRelevanceFilter: events.length,
      filterBatchCount: 1,
      providerCalls: 0,
    },
    verifiedFilters: [],
    sourceArtifactIds: [],
    complete: true,
    limitations: [],
  };
  return {
    ...withoutHash,
    contentHash: hashCapabilityEvidencePayload(withoutHash),
  };
}

describe("evidence conservation — catalog IDs through digest", () => {
  it("preserves offensive, defensive, and utility activations with timestamps", () => {
    const offensive = pickRule((r) =>
      r.dimensionTags?.includes("PERFORMANCE_OFFENSIVE_COOLDOWN") ||
      r.category === "OFFENSIVE_MAJOR",
    );
    const defensive = pickRule(
      (r) => r.category === "DEFENSIVE_MAJOR" || r.category === "IMMUNITY",
    );
    const interrupt = pickRule((r) => r.category === "INTERRUPT");

    const offensiveId = ruleResolvableSpellIds(offensive)[0]!;
    const defensiveId = ruleResolvableSpellIds(defensive)[0]!;
    const interruptId = ruleResolvableSpellIds(interrupt)[0]!;

    const state = createPageProcessorState();
    const relevant = new Set(collectProductionRelevantAbilityIds());
    processCapabilityEvidencePage({
      state,
      dataset: "Casts",
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      capabilitySet: [
        "PERFORMANCE_OFFENSIVE_ACTIVATIONS",
        "SURVIVAL_DEFENSIVE_ACTIVATIONS",
        "UTILITY_INTERRUPTS",
      ],
      friendlyPlayerActorIds: [ACTOR],
      ownerByActor: new Map(),
      relevantAbilityIds: relevant,
      rawEvents: [
        {
          timestamp: FIGHT_START + 5_000,
          type: "cast",
          source: { id: ACTOR },
          target: { id: ACTOR },
          ability: { guid: offensiveId, name: offensive.name },
        },
        {
          timestamp: FIGHT_START + 12_000,
          type: "cast",
          source: { id: ACTOR },
          target: { id: ACTOR },
          ability: { guid: defensiveId, name: defensive.name },
        },
        {
          timestamp: FIGHT_START + 20_000,
          type: "cast",
          source: { id: ACTOR },
          target: { id: 99 },
          ability: { guid: interruptId, name: interrupt.name },
        },
      ],
    });
    processCapabilityEvidencePage({
      state,
      dataset: "Interrupts",
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      capabilitySet: ["UTILITY_INTERRUPTS"],
      friendlyPlayerActorIds: [ACTOR],
      ownerByActor: new Map(),
      relevantAbilityIds: relevant,
      rawEvents: [
        {
          timestamp: FIGHT_START + 20_050,
          type: "interrupt",
          source: { id: ACTOR },
          target: { id: 99 },
          ability: { guid: interruptId, name: interrupt.name },
        },
      ],
    });

    const pkg = packageFromCompact(state.compactEvents, [
      "PERFORMANCE_OFFENSIVE_ACTIVATIONS",
      "SURVIVAL_DEFENSIVE_ACTIVATIONS",
      "SURVIVAL_DAMAGE_TAKEN",
      "SURVIVAL_DEATHS",
      "SURVIVAL_RECOVERY_ACTIVATIONS",
      "UTILITY_INTERRUPTS",
      "UTILITY_DISPELS",
      "UTILITY_CROWD_CONTROL",
      "UTILITY_EXTERNAL_CASTS",
      "UTILITY_EXTERNAL_TARGET_CONTEXT",
      "UTILITY_HOSTILE_CASTS",
      "PARTICIPANT_METADATA",
      "ACTOR_OWNERSHIP",
    ]);

    const digests = buildParticipantScoringDigestsFromPackage({
      capabilityPackage: pkg,
      packageArtifactId: "pkg-conserve-1",
      participants: [
        {
          playerActorId: ACTOR,
          characterName: "Conserve",
          realmSlug: "archimonde",
          regionCode: "EU",
          classSlug: offensive.classSlug ?? defensive.classSlug,
          specSlug: offensive.specSlugs[0] ?? defensive.specSlugs[0] ?? null,
          role: "DPS",
          ownedPetActorIds: [],
        },
      ],
      dungeonSlug: "skyreach",
      keyLevel: 15,
      timed: true,
      runScore: 400,
      completedAt: "2026-08-01T00:00:00.000Z",
      fightStartMs: FIGHT_START,
      fightEndMs: FIGHT_START + 180_000,
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
    });

    expect(digests).toHaveLength(1);
    const digest = digests[0]!;

    const off = digest.performance.offensiveActivations.find(
      (a) => a.canonicalKey === offensive.canonicalKey,
    );
    expect(off).toBeTruthy();
    expect(off!.observedSpellIds).toContain(offensiveId);
    expect(off!.fightOffsetMs).toBe(5_000);
    expect(off!.timestampMs).toBe(FIGHT_START + 5_000);

    const def = digest.survival.personalDefensiveActivations.find(
      (a) => a.abilityKey === defensive.canonicalKey,
    );
    expect(def).toBeTruthy();
    expect(def!.observedSpellIds).toContain(defensiveId);
    expect(def!.fightOffsetMs).toBe(12_000);
    expect(def!.rawTimestampMs).toBe(FIGHT_START + 12_000);

    const util = digest.utility.actions.find(
      (a) => a.abilityKey === interrupt.canonicalKey,
    );
    expect(util).toBeTruthy();
    expect(util!.observedSpellIds).toContain(interruptId);
    expect(util!.fightOffsetMs).toBeGreaterThanOrEqual(20_000);
    expect(util!.outcome).toBe("SUCCESS");
  });

  it("conserves max-HP from DamageTaken includeResources into pressure windows", () => {
    const state = createPageProcessorState();
    processCapabilityEvidencePage({
      state,
      dataset: "DamageTaken",
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      capabilitySet: ["SURVIVAL_DAMAGE_TAKEN"],
      friendlyPlayerActorIds: [ACTOR],
      ownerByActor: new Map(),
      relevantAbilityIds: new Set(),
      rawEvents: [
        {
          timestamp: FIGHT_START + 1_000,
          type: "damage",
          source: { id: 99 },
          target: { id: ACTOR },
          ability: { guid: 1 },
          amount: 400_000,
          hitPoints: 600_000,
          maxHitPoints: 1_000_000,
        },
        {
          timestamp: FIGHT_START + 1_200,
          type: "damage",
          source: { id: 99 },
          target: { id: ACTOR },
          ability: { guid: 1 },
          amount: 350_000,
          hitPoints: 250_000,
          maxHitPoints: 1_000_000,
        },
      ],
    });

    expect(state.compactEvents[0]!.maxHitPoints).toBe(1_000_000);
    expect(state.compactEvents[0]!.hitPoints).toBe(600_000);
    expect(extractCompactHitPoints({ maxHitPoints: 2, hitPoints: 1 })).toEqual({
      hitPoints: 1,
      maxHitPoints: 2,
    });

    const pkg = packageFromCompact(state.compactEvents, [
      "SURVIVAL_DAMAGE_TAKEN",
      "SURVIVAL_DEATHS",
      "SURVIVAL_DEFENSIVE_ACTIVATIONS",
      "SURVIVAL_RECOVERY_ACTIVATIONS",
      "PERFORMANCE_OFFENSIVE_ACTIVATIONS",
      "UTILITY_INTERRUPTS",
      "UTILITY_DISPELS",
      "UTILITY_CROWD_CONTROL",
      "UTILITY_EXTERNAL_CASTS",
      "UTILITY_EXTERNAL_TARGET_CONTEXT",
      "UTILITY_HOSTILE_CASTS",
      "PARTICIPANT_METADATA",
      "ACTOR_OWNERSHIP",
    ]);

    const [digest] = buildParticipantScoringDigestsFromPackage({
      capabilityPackage: pkg,
      packageArtifactId: "pkg-hp",
      participants: [
        {
          playerActorId: ACTOR,
          characterName: "HpTarget",
          classSlug: "mage",
          specSlug: "fire",
          role: "DPS",
          ownedPetActorIds: [],
        },
      ],
      dungeonSlug: "skyreach",
      keyLevel: 15,
      timed: true,
      runScore: 400,
      completedAt: null,
      fightStartMs: FIGHT_START,
      fightEndMs: FIGHT_START + 180_000,
    });

    expect(digest!.survival.damageTakenTotal).toBe(750_000);
    const windowWithHp = digest!.survival.pressureWindows.find(
      (w) => w.derivation.maxHpUsed != null,
    );
    expect(windowWithHp?.derivation.maxHpUsed).toBe(1_000_000);
    expect(digest!.survival.limitations).not.toContain("MAX_HP_CONTEXT_UNAVAILABLE");
  });

  it("conserves hostile cast timestamps into the utility digest", () => {
    const state = createPageProcessorState();
    processCapabilityEvidencePage({
      state,
      dataset: "HostileCasts",
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      capabilitySet: ["UTILITY_HOSTILE_CASTS"],
      friendlyPlayerActorIds: [ACTOR],
      ownerByActor: new Map(),
      relevantAbilityIds: new Set(),
      rawEvents: [
        {
          timestamp: FIGHT_START + 3_000,
          type: "begincast",
          source: { id: 55 },
          target: { id: ACTOR },
          ability: { guid: 12345, name: "Enemy Kickable" },
        },
        {
          timestamp: FIGHT_START + 8_000,
          type: "cast",
          source: { id: 55 },
          target: { id: ACTOR },
          ability: { guid: 12346, name: "Enemy Cast" },
        },
      ],
    });

    expect(state.compactEvents).toHaveLength(2);
    expect(state.compactEvents.every((e) => e.dataset === "HostileCasts")).toBe(true);

    const pkg = packageFromCompact(state.compactEvents, [
      "UTILITY_HOSTILE_CASTS",
      "UTILITY_INTERRUPTS",
      "UTILITY_DISPELS",
      "UTILITY_CROWD_CONTROL",
      "UTILITY_EXTERNAL_CASTS",
      "UTILITY_EXTERNAL_TARGET_CONTEXT",
      "SURVIVAL_DAMAGE_TAKEN",
      "SURVIVAL_DEATHS",
      "SURVIVAL_DEFENSIVE_ACTIVATIONS",
      "SURVIVAL_RECOVERY_ACTIVATIONS",
      "PERFORMANCE_OFFENSIVE_ACTIVATIONS",
      "PARTICIPANT_METADATA",
      "ACTOR_OWNERSHIP",
    ]);

    const [digest] = buildParticipantScoringDigestsFromPackage({
      capabilityPackage: pkg,
      packageArtifactId: "pkg-hostile",
      participants: [
        {
          playerActorId: ACTOR,
          characterName: "KickTarget",
          classSlug: "mage",
          specSlug: "fire",
          role: "DPS",
          ownedPetActorIds: [],
        },
      ],
      dungeonSlug: "skyreach",
      keyLevel: 15,
      timed: true,
      runScore: null,
      completedAt: null,
      fightStartMs: FIGHT_START,
      fightEndMs: FIGHT_START + 180_000,
    });

    expect(digest!.utility.hostileCastEvents).toHaveLength(2);
    expect(digest!.utility.hostileCastEvents[0]!.fightOffsetMs).toBe(3_000);
    expect(digest!.utility.hostileCastEvents[0]!.spellId).toBe(12345);
    expect(digest!.utility.limitations).not.toContain(
      "hostile_cast_events_absent_in_package",
    );
  });

  it("keeps digest contentHash stable across createdAt for identical evidence", () => {
    const pkg = packageFromCompact([], [
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
      "UTILITY_HOSTILE_CASTS",
      "PARTICIPANT_METADATA",
      "ACTOR_OWNERSHIP",
    ]);
    const participants = [
      {
        playerActorId: ACTOR,
        characterName: "Stable",
        classSlug: "mage" as const,
        specSlug: "fire",
        role: "DPS" as const,
        ownedPetActorIds: [] as number[],
      },
    ];
    const a = buildParticipantScoringDigestsFromPackage({
      capabilityPackage: pkg,
      packageArtifactId: "pkg-a",
      participants,
      dungeonSlug: "skyreach",
      keyLevel: 10,
      timed: true,
      runScore: 1,
      completedAt: null,
      fightStartMs: FIGHT_START,
      fightEndMs: FIGHT_START + 60_000,
      createdAt: "2026-08-01T00:00:00.000Z",
    })[0]!;
    const b = buildParticipantScoringDigestsFromPackage({
      capabilityPackage: pkg,
      packageArtifactId: "pkg-b",
      participants,
      dungeonSlug: "skyreach",
      keyLevel: 10,
      timed: true,
      runScore: 1,
      completedAt: null,
      fightStartMs: FIGHT_START,
      fightEndMs: FIGHT_START + 60_000,
      createdAt: "2026-08-02T00:00:00.000Z",
    })[0]!;
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.extractorCompatVersion).toBe("participant-digest-extractors-v3");
  });
});
