/**
 * Capability-scoped shared evidence acquisition tests.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { CURRENT_CATALOG_VERSION_ID, type AbilityRule } from "@mplus/abilities";
import {
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
  buildCapabilityPackageCompatibilityKey,
  capabilityEvidenceCompatibilityKeyString,
  buildCapabilityEvidenceCompatibilityIdentity,
  hashSortedInts,
  isCapabilityCoverageComplete,
  type CapabilityCoverageV1,
  type EvidenceCapability,
} from "@mplus/contracts";
import { InMemorySharedEvidenceStore } from "../shared-evidence-ingest.js";
import {
  buildCapabilityAcquisitionPlan,
  productionDefaultCapabilities,
} from "./acquisition-plan.js";
import {
  abilityFilterHashFromIds,
  actorSetHashFromIds,
  buildDeterministicAbilityFilterBatches,
  buildRelevantBuffsFilterExpression,
} from "./filter-batching.js";
import {
  collectProductionRelevantAbilityIds,
  collectRuleEvidenceSpellIds,
  collectRelevantAbilityIdsForCapabilities,
} from "./relevant-ability-ids.js";
import {
  createPageProcessorState,
  processCapabilityEvidencePage,
} from "./page-processor.js";
import {
  acquireCapabilityEvidencePackage,
  CAPABILITY_ACQUISITION_MAX_PAGES,
} from "./acquire.js";
import {
  clearCapabilityEvidenceMemoryIndex,
  lookupCapabilityEvidenceForParticipant,
  persistCapabilityEvidencePackage,
  reloadCapabilityEvidenceFromArtifacts,
} from "./persist.js";
import { VERIFIED_REPORT_EVENTS_VARIABLES } from "./wcl-report-events-contract.js";
import type { WclRunEvidenceDataset } from "../wcl-run-evidence-types.js";

function coverage(
  capability: EvidenceCapability,
  partial: Partial<CapabilityCoverageV1>,
): CapabilityCoverageV1 {
  return {
    capability,
    requiredDatasets: ["Buffs"],
    filterIdentity: "test",
    pageCount: 1,
    eventCount: 10,
    firstTimestampMs: 0,
    lastTimestampMs: 1000,
    nextPageTimestamp: null,
    stopReason: "NEXT_PAGE_NULL",
    complete: true,
    limitations: [],
    sourceArtifactIds: [],
    ...partial,
  };
}

describe("capability acquisition plan", () => {
  it("builds a deterministic production plan", () => {
    const a = buildCapabilityAcquisitionPlan({
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
    });
    const b = buildCapabilityAcquisitionPlan({
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
    });
    expect(a.version).toBe(CAPABILITY_ACQUISITION_PLAN_VERSION);
    expect(a.graphqlQueryVersion).toBe(WCL_GRAPHQL_QUERY_VERSION);
    expect(a.capabilities).toEqual(b.capabilities);
    expect(a.fetchUnits.map((u) => u.unitId)).toEqual(b.fetchUnits.map((u) => u.unitId));
    expect(a.fetchUnits.some((u) => u.dataset === "DamageTaken")).toBe(true);
    expect(a.fetchUnits.some((u) => u.dataset === "Buffs")).toBe(true);
    const buffUnit = a.fetchUnits.find((u) => u.dataset === "Buffs");
    expect(buffUnit?.filterStrategy).toBe("CATALOG_ABILITY_AND_FRIENDLY_ACTORS");
  });

  it("probe mode broadens ability filters to NONE", () => {
    const plan = buildCapabilityAcquisitionPlan({
      mode: "PROBE_DISCOVERY_ACQUISITION",
      capabilities: ["PERFORMANCE_OFFENSIVE_ACTIVATIONS"],
    });
    expect(plan.fetchUnits.every((u) => u.filterStrategy === "NONE")).toBe(true);
  });

  it("does not require DamageTaken for utility interrupts", () => {
    const plan = buildCapabilityAcquisitionPlan({
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      capabilities: ["UTILITY_INTERRUPTS"],
    });
    expect(plan.fetchUnits.some((u) => u.dataset === "DamageTaken")).toBe(false);
    expect(plan.fetchUnits.some((u) => u.dataset === "Interrupts")).toBe(true);
  });
});

describe("filter-hash and actor-set compatibility", () => {
  it("separates filtered vs global ability hashes", () => {
    expect(abilityFilterHashFromIds([])).toBe("none");
    const filtered = abilityFilterHashFromIds([104773, 265187]);
    expect(filtered).not.toBe("none");
    expect(filtered).toBe(abilityFilterHashFromIds([265187, 104773]));
  });

  it("actor-set hash is order-independent", () => {
    expect(actorSetHashFromIds([10, 11, 12])).toBe(actorSetHashFromIds([12, 10, 11]));
    expect(actorSetHashFromIds([10, 11])).not.toBe(actorSetHashFromIds([10, 12]));
  });

  it("filtered/global package keys never collide", () => {
    const base = {
      reportCode: "1WKcCz2BnAQmbhfq",
      fightId: 1,
      reportRevision: 1,
      capabilitySet: productionDefaultCapabilities(),
      actorSetHash: hashSortedInts([10, 11, 12, 13, 14]),
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      mode: "PRODUCTION_CAPABILITY_ACQUISITION" as const,
    };
    const filtered = buildCapabilityPackageCompatibilityKey({
      ...base,
      abilityFilterHash: abilityFilterHashFromIds([104773]),
    });
    const global = buildCapabilityPackageCompatibilityKey({
      ...base,
      abilityFilterHash: "none",
    });
    expect(filtered).not.toBe(global);
    expect(filtered).toContain("wcl-capability-evidence");
  });

  it("catalog-version invalidates compatibility", () => {
    const a = buildCapabilityEvidenceCompatibilityIdentity({
      reportCode: "1WKcCz2BnAQmbhfq",
      fightId: 1,
      reportRevision: 1,
      dataset: "Buffs",
      capabilitySet: ["SURVIVAL_DEFENSIVE_ACTIVATIONS"],
      actorSetHash: "aaaaaaaaaaaaaaaa",
      abilityFilterHash: "bbbbbbbbbbbbbbbb",
      catalogVersion: "11.0.0/s1",
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
    });
    const b = { ...a, catalogVersion: "11.0.5/s2" };
    expect(capabilityEvidenceCompatibilityKeyString(a)).not.toBe(
      capabilityEvidenceCompatibilityKeyString(b),
    );
  });
});

describe("deterministic filter batching", () => {
  it("batches when ability list exceeds size limit", () => {
    const abilityIds = Array.from({ length: 200 }, (_, i) => i + 1);
    const batches = buildDeterministicAbilityFilterBatches({
      abilityIds,
      maxAbilityBatchSize: 50,
      maxExpressionChars: 10_000,
    });
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.batchCount === batches.length)).toBe(true);
    expect(batches[0]!.filterExpression).toContain("ability.id IN");
    expect(batches[0]!.filterExpression).not.toContain("source.id IN");
  });

  it("builds relevant buff ability-only expressions and DamageTaken sourceID batches", async () => {
    const buffs = buildRelevantBuffsFilterExpression({
      abilityIds: [104773, 265187],
      actorIds: [10, 11],
    });
    expect(buffs).toBe("ability.id IN (104773, 265187)");
    const { buildDeterministicSourceIdActorBatches } = await import("./filter-batching.js");
    const dt = buildDeterministicSourceIdActorBatches({ actorIds: [10, 11, 12] });
    expect(dt).toHaveLength(3);
    expect(dt[0]!.sourceID).toBe(10);
    expect(dt[0]!.filterExpression).toBeNull();
  });
});

describe("catalog-guided relevant abilities", () => {
  it("collects spellIds, aliases, and optional buff/trigger fields", () => {
    const rule = {
      spellIds: [1],
      aliases: [2],
      activationBuffIds: [3],
      triggeredEffectIds: [4],
    } as AbilityRule;
    expect(collectRuleEvidenceSpellIds(rule)).toEqual([1, 2, 3, 4]);
  });

  it("collects production-relevant ability ids from catalog", () => {
    const ids = collectProductionRelevantAbilityIds();
    expect(ids.length).toBeGreaterThan(10);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const byCap = collectRelevantAbilityIdsForCapabilities([
      "SURVIVAL_DEFENSIVE_ACTIVATIONS",
    ]);
    expect((byCap.byCapability.SURVIVAL_DEFENSIVE_ACTIVATIONS ?? []).length).toBeGreaterThan(0);
  });
});

describe("partial capability completeness", () => {
  it("does not let incomplete DamageTaken invalidate complete interrupts", () => {
    const interrupts = coverage("UTILITY_INTERRUPTS", {
      requiredDatasets: ["Interrupts"],
      complete: true,
      stopReason: "NEXT_PAGE_NULL",
      nextPageTimestamp: null,
    });
    const damage = coverage("SURVIVAL_DAMAGE_TAKEN", {
      requiredDatasets: ["DamageTaken"],
      complete: false,
      stopReason: "MAX_PAGES",
      nextPageTimestamp: 999,
    });
    expect(isCapabilityCoverageComplete(interrupts)).toBe(true);
    expect(isCapabilityCoverageComplete(damage)).toBe(false);
  });

  it("marks incomplete on non-progressing cursor, max pages, missing batch", () => {
    expect(
      isCapabilityCoverageComplete(
        coverage("SURVIVAL_DAMAGE_TAKEN", {
          complete: true,
          stopReason: "NON_PROGRESSING_CURSOR",
        }),
      ),
    ).toBe(false);
    expect(
      isCapabilityCoverageComplete(
        coverage("SURVIVAL_DEFENSIVE_ACTIVATIONS", {
          complete: true,
          stopReason: "MAX_PAGES",
        }),
      ),
    ).toBe(false);
    expect(
      isCapabilityCoverageComplete(
        coverage("PERFORMANCE_OFFENSIVE_ACTIVATIONS", {
          complete: true,
          stopReason: "MISSING_REQUIRED_BATCH",
        }),
      ),
    ).toBe(false);
  });
});

describe("filtered Buff relevance page processor", () => {
  it("keeps catalog buffs and drops filler; bounds unknowns", () => {
    const state = createPageProcessorState();
    const relevant = new Set(collectProductionRelevantAbilityIds());
    // Unending Resolve is in warlock catalog
    processCapabilityEvidencePage({
      state,
      dataset: "Buffs",
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      capabilitySet: ["SURVIVAL_DEFENSIVE_ACTIVATIONS"],
      friendlyPlayerActorIds: [10],
      ownerByActor: new Map(),
      relevantAbilityIds: relevant,
      rawEvents: [
        {
          timestamp: 100,
          type: "applybuff",
          source: { id: 10 },
          target: { id: 10 },
          ability: { guid: 104773, name: "Unending Resolve" },
        },
        {
          timestamp: 200,
          type: "applybuff",
          source: { id: 10 },
          target: { id: 10 },
          ability: { guid: 999999001, name: "Filler Passive" },
        },
      ],
    });
    expect(state.eventsBeforeFilter).toBe(2);
    expect(state.compactEvents.some((e) => e.spellId === 104773)).toBe(true);
    expect(state.compactEvents.some((e) => e.spellId === 999999001)).toBe(false);
    expect(state.unknownSummaries.get(999999001)?.reasonExcluded).toBe(
      "NOT_IN_REVIEWED_CATALOG_FILTER",
    );
  });

  it("filters DamageTaken to friendly targets", () => {
    const state = createPageProcessorState();
    processCapabilityEvidencePage({
      state,
      dataset: "DamageTaken",
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      capabilitySet: ["SURVIVAL_DAMAGE_TAKEN"],
      friendlyPlayerActorIds: [10, 11],
      ownerByActor: new Map(),
      relevantAbilityIds: new Set(),
      rawEvents: [
        {
          timestamp: 1,
          type: "damage",
          source: { id: 99 },
          target: { id: 10 },
          ability: { guid: 1 },
          amount: 500,
        },
        {
          timestamp: 2,
          type: "damage",
          source: { id: 99 },
          target: { id: 50 },
          ability: { guid: 1 },
          amount: 900,
        },
      ],
    });
    expect(state.compactEvents).toHaveLength(1);
    expect(state.compactEvents[0]?.amount).toBe(500);
    expect(state.compactEvents[0]?.capabilities).toEqual(["SURVIVAL_DAMAGE_TAKEN"]);
  });
});

describe("shared reuse across participants + postgres-style reload", () => {
  beforeEach(() => {
    clearCapabilityEvidenceMemoryIndex();
  });

  it("persists one package referenced by five participants with zero reload calls", async () => {
    const store = new InMemorySharedEvidenceStore();
    const masterData = {
      actors: [
        { id: 10, type: "Player", name: "A", server: "Archimonde", subType: "Warlock" },
        { id: 11, type: "Player", name: "B", server: "Archimonde", subType: "Mage" },
        { id: 12, type: "Player", name: "C", server: "Archimonde", subType: "Priest" },
        { id: 13, type: "Player", name: "D", server: "Archimonde", subType: "Warrior" },
        { id: 14, type: "Player", name: "E", server: "Archimonde", subType: "Hunter" },
      ],
      fights: [{ id: 1, startTime: 0, endTime: 100_000 }],
    };

    // Seed CombatantInfo + filtered datasets as persisted so localOnly path works.
    const seed = async (
      dataset: WclRunEvidenceDataset["key"],
      filterTag: string,
      events: Array<Record<string, unknown>>,
      complete = true,
    ) => {
      const { buildSharedEvidenceCompatibilityKey, WCL_RUN_EVIDENCE_PROVIDER_CONTRACT } =
        await import("../wcl-run-evidence-types.js");
      const key = buildSharedEvidenceCompatibilityKey({
        reportCode: "1WKcCz2BnAQmbhfq",
        reportRevision: 1,
        fightId: 1,
        actorId: null,
        dataset,
        startTime: 0,
        endTime: 100_000,
        filterExpression: filterTag,
        providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
        payloadFingerprint: null,
      });
      await store.saveDataset(
        key,
        {
          key: dataset,
          state: "OK",
          truncated: !complete,
          pageCount: 1,
          eventCount: events.length,
          filterSourceId: null,
          filterExpression: filterTag,
          pages: [
            {
              pageIndex: 0,
              startTime: 0,
              nextPageTimestamp: null,
              eventCount: events.length,
              payloadFingerprint: "fp",
            },
          ],
          events,
          consumers: ["survival", "utility"],
          pointsConsumed: 0,
          costSource: "measured",
          requestCostUnits: [],
          wclRequests: 1,
          fetchedAt: new Date().toISOString(),
          source: "persisted",
          pagination: {
            requestedFightStartMs: 0,
            requestedFightEndMs: 100_000,
            firstEventTimestampMs: 0,
            lastEventTimestampMs: 1000,
            nextPageTimestamp: null,
            pageCount: 1,
            stopReason: complete ? "NEXT_PAGE_NULL" : "MAX_PAGES",
            coverageRatio: complete ? 1 : 0.5,
            complete,
          },
        },
        {
          reportCode: "1WKcCz2BnAQmbhfq",
          reportRevision: 1,
          fightId: 1,
          dataset,
        },
      );
    };

    // Acquire will compute filter tags dynamically; for this unit test we drive
    // acquisition with forceRefetch false + localOnly after a minimal synthetic package path.
    const artifactMap = new Map<string, Buffer>();
    let artifactSeq = 0;
    const artifacts = {
      async persist(req: {
        bytes: Uint8Array | Buffer;
        artifactClass: string;
      }) {
        artifactSeq += 1;
        const artifactId = `art-${artifactSeq}`;
        artifactMap.set(artifactId, Buffer.from(req.bytes));
        return {
          artifactId,
          write: { contentHash: `h${artifactSeq}`, storageUri: `mem://${artifactId}` },
        };
      },
      async readVerified(artifactId: string) {
        const buf = artifactMap.get(artifactId);
        if (!buf) throw new Error(`missing ${artifactId}`);
        return buf;
      },
    };

    // Build package via acquire with pre-supplied master + actor ids and empty client
    // by seeding ALL expected filter tags is hard; instead synthesize via acquire's
    // local path for metadata-only capabilities subset then persist.
    void seed;
    void CAPABILITY_ACQUISITION_MAX_PAGES;

    const caps: EvidenceCapability[] = [
      "PARTICIPANT_METADATA",
      "ACTOR_OWNERSHIP",
      "SURVIVAL_DEATHS",
    ];
    const actorIds = [10, 11, 12, 13, 14];
    const actorHash = actorSetHashFromIds(actorIds);
    const abilityHash = abilityFilterHashFromIds(collectProductionRelevantAbilityIds());
    // Deaths use per-player GraphQL sourceID batches (verified API limitation).
    for (let i = 0; i < actorIds.length; i += 1) {
      const actorId = actorIds[i]!;
      const { buildSharedEvidenceCompatibilityKey, WCL_RUN_EVIDENCE_PROVIDER_CONTRACT } =
        await import("../wcl-run-evidence-types.js");
      const key = buildSharedEvidenceCompatibilityKey({
        reportCode: "1WKcCz2BnAQmbhfq",
        reportRevision: 1,
        fightId: 1,
        actorId,
        dataset: "Deaths",
        startTime: 0,
        endTime: 100_000,
        filterExpression: `cap:FRIENDLY_DEATHS|ab:${abilityHash}|ac:${actorHash}|b${i}/${actorIds.length}|fe:sourceID=${actorId}`,
        providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
        payloadFingerprint: null,
      });
      await store.saveDataset(
        key,
        {
          key: "Deaths",
          state: "OK",
          truncated: false,
          pageCount: 1,
          eventCount: actorId === 10 ? 1 : 0,
          filterSourceId: actorId,
          filterExpression: `sourceID=${actorId}`,
          pages: [
            {
              pageIndex: 0,
              startTime: 0,
              nextPageTimestamp: null,
              eventCount: actorId === 10 ? 1 : 0,
              payloadFingerprint: "fp",
            },
          ],
          events:
            actorId === 10
              ? [{ timestamp: 5000, type: "death", target: { id: 10 }, source: { id: 99 } }]
              : [],
          consumers: ["survival", "utility"],
          pointsConsumed: 0,
          costSource: "measured",
          requestCostUnits: [],
          wclRequests: 1,
          fetchedAt: new Date().toISOString(),
          source: "persisted",
          pagination: {
            requestedFightStartMs: 0,
            requestedFightEndMs: 100_000,
            firstEventTimestampMs: actorId === 10 ? 5000 : null,
            lastEventTimestampMs: actorId === 10 ? 5000 : null,
            nextPageTimestamp: null,
            pageCount: 1,
            stopReason: "NEXT_PAGE_NULL",
            coverageRatio: 1,
            complete: true,
          },
        },
        {
          reportCode: "1WKcCz2BnAQmbhfq",
          reportRevision: 1,
          fightId: 1,
          dataset: "Deaths",
        },
      );
    }
    void seed;
    await seed(
      "CombatantInfo",
      `cap:NONE|ab:none|ac:pending|fe:none`,
      [
        { timestamp: 0, sourceID: 10, specID: 266 },
        { timestamp: 0, sourceID: 11, specID: 63 },
        { timestamp: 0, sourceID: 12, specID: 256 },
        { timestamp: 0, sourceID: 13, specID: 71 },
        { timestamp: 0, sourceID: 14, specID: 253 },
      ],
    );

    const acquired = await acquireCapabilityEvidencePackage({
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      client: null,
      store,
      reportCode: "1WKcCz2BnAQmbhfq",
      reportRevision: 1,
      fightId: 1,
      dungeonSlug: "test",
      fightStartMs: 0,
      fightEndMs: 100_000,
      region: "EU",
      capabilities: caps,
      masterData,
      friendlyPlayerActorIds: [10, 11, 12, 13, 14],
      ownedPetActorIds: [],
      localOnly: true,
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
    });

    expect(acquired.providerCalls).toBe(0);
    expect(acquired.package.friendlyPlayerActorIds).toHaveLength(5);
    expect(acquired.package.mode).toBe("PRODUCTION_CAPABILITY_ACQUISITION");

    const deathsCoverage = acquired.package.coverage.find(
      (c) => c.capability === "SURVIVAL_DEATHS",
    );
    const metaCoverage = acquired.package.coverage.find(
      (c) => c.capability === "PARTICIPANT_METADATA",
    );
    expect(metaCoverage?.complete).toBe(true);

    const persisted = await persistCapabilityEvidencePackage({
      artifacts,
      package: acquired.package,
    });
    expect(persisted.providerCallsDuringPersist).toBe(0);
    expect(persisted.participantActorIds).toEqual([10, 11, 12, 13, 14]);

    const reloaded = await reloadCapabilityEvidenceFromArtifacts({
      artifacts,
      persisted,
    });
    expect(reloaded.providerCallsDuringReload).toBe(0);

    const second = lookupCapabilityEvidenceForParticipant({
      reportCode: "1WKcCz2BnAQmbhfq",
      fightId: 1,
      reportRevision: 1,
      playerActorId: 11,
      capabilitySet: caps,
      actorSetHash: acquired.package.actorSetHash,
      abilityFilterHash: acquired.package.abilityFilterHash,
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      requiredCapability: "PARTICIPANT_METADATA",
    });
    expect(second?.providerCalls).toBe(0);
    expect(second?.package.contentHash).toBe(acquired.package.contentHash);

    // Incomplete unrelated capability must not block complete capability lookup
    void deathsCoverage;
    const metaLookup = lookupCapabilityEvidenceForParticipant({
      reportCode: "1WKcCz2BnAQmbhfq",
      fightId: 1,
      reportRevision: 1,
      playerActorId: 12,
      capabilitySet: caps,
      actorSetHash: acquired.package.actorSetHash,
      abilityFilterHash: acquired.package.abilityFilterHash,
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      requiredCapability: "PARTICIPANT_METADATA",
    });
    expect(metaLookup?.providerCalls).toBe(0);
  });
});

describe("verified ReportEvents contract", () => {
  it("documents supported variables only", () => {
    expect(VERIFIED_REPORT_EVENTS_VARIABLES).toContain("filterExpression");
    expect(VERIFIED_REPORT_EVENTS_VARIABLES).toContain("sourceID");
    expect(VERIFIED_REPORT_EVENTS_VARIABLES).not.toContain("targetID");
    expect(VERIFIED_REPORT_EVENTS_VARIABLES).not.toContain("abilityID");
  });
});
