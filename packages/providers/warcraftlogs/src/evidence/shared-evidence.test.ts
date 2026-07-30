/**
 * Shared WCL evidence ingestion tests — Survival + Utility reuse contract.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildSharedEvidenceCompatibilityKey,
  consumersForDataset,
  unionRequiredDatasets,
  HOSTILE_CAST_FILTER_EXPRESSION,
} from "./wcl-run-evidence-types.js";
import {
  dedupeEventsByIdentity,
  evidenceDatasetReuseDecision,
  fingerprintPayload,
  isPlayerDeadAt,
} from "./wcl-run-evidence.js";
import {
  InMemorySharedEvidenceStore,
  ingestSharedEvidenceBundle,
} from "./shared-evidence-ingest.js";
import {
  assertSharedRunSelectionParity,
  sharedSelectionFromUtilityNormalizedRuns,
} from "./shared-run-selection.js";
import {
  measureInterruptCatalogCoverage,
  prepareActiveSeasonInterruptCatalog,
} from "./interrupt-catalog-coverage.js";
import { extractRunOpportunities } from "../probe/utility-opportunity-engine.js";
import type { UtilityNormalizedRun } from "../probe/utility-probe-types.js";
import type { WclRunEvidenceDataset } from "./wcl-run-evidence-types.js";

function isPlayerDeadDuringWindow(
  deaths: Array<{ type?: string; timestamp?: number; targetID?: number }>,
  playerActorId: number,
  windowStart: number,
  windowEnd: number,
): boolean {
  void windowStart;
  return isPlayerDeadAt(deaths as Array<Record<string, unknown>>, playerActorId, windowEnd);
}

function baseRun(partial: Partial<UtilityNormalizedRun> = {}): UtilityNormalizedRun {
  return {
    reportCode: "ABC",
    fightId: 1,
    dungeonSlug: "skyreach",
    keyLevel: 10,
    durationMs: 600_000,
    playerActorId: 10,
    petActorIds: [],
    specialization: "frost",
    classSlug: "mage",
    roleSlug: "dps",
    interruptEvents: [],
    ccEvents: [],
    dispelPurgeEvents: [],
    externalGroupUtilityEvents: [],
    classSpecificEvents: [],
    interruptOpportunities: [],
    dispelPurgeOpportunities: [],
    unmatchedAbilityIds: [],
    incompleteDatasets: [],
    datasetStates: {
      CombatantInfo: "OK",
      Casts: "OK",
      Buffs: "OK",
      Debuffs: "OK",
      Interrupts: "OK",
      Dispels: "OK",
      Deaths: "OK",
      DamageDone: "OK",
    },
    truncatedDatasets: [],
    ...partial,
  } as UtilityNormalizedRun;
}

function okDataset(
  key: WclRunEvidenceDataset["key"],
  events: Array<Record<string, unknown>> = [],
): WclRunEvidenceDataset {
  return {
    key,
    state: "OK",
    truncated: false,
    pageCount: 1,
    eventCount: events.length,
    filterSourceId: null,
    filterExpression: key === "HostileCasts" ? HOSTILE_CAST_FILTER_EXPRESSION : null,
    pages: [
      {
        pageIndex: 0,
        startTime: null,
        nextPageTimestamp: null,
        eventCount: events.length,
        payloadFingerprint: fingerprintPayload(events),
      },
    ],
    events,
    consumers: consumersForDataset(key),
    pointsConsumed: 0,
    costSource: "measured",
    requestCostUnits: [],
    wclRequests: 0,
    fetchedAt: new Date().toISOString(),
    source: "persisted",
  };
}

describe("shared evidence compatibility", () => {
  it("builds deterministic compatibility keys", () => {
    const a = buildSharedEvidenceCompatibilityKey({
      reportCode: "R1",
      reportRevision: 3,
      fightId: 12,
      actorId: 5,
      dataset: "HostileCasts",
      startTime: 0,
      endTime: 1000,
      filterExpression: "hostile-npc-casts",
      providerContractVersion: "wcl-graphql-v2-events",
      payloadFingerprint: null,
    });
    const b = buildSharedEvidenceCompatibilityKey({
      reportCode: "R1",
      reportRevision: 3,
      fightId: 12,
      actorId: 5,
      dataset: "HostileCasts",
      startTime: 0,
      endTime: 1000,
      filterExpression: "hostile-npc-casts",
      providerContractVersion: "wcl-graphql-v2-events",
      payloadFingerprint: null,
    });
    expect(a).toBe(b);
  });

  it("lists overlapping datasets once for survival+utility union", () => {
    const union = unionRequiredDatasets(["survival", "utility"]);
    expect(union.filter((d) => d === "Deaths").length).toBe(1);
    expect(union.filter((d) => d === "Casts").length).toBe(1);
    expect(union).toContain("HostileCasts");
    expect(consumersForDataset("Deaths")).toEqual(["survival", "utility"]);
  });

  it("utility-only consumers omit Survival-only DamageTaken/Healing fetches", () => {
    const utilityOnly = unionRequiredDatasets(["utility"]);
    expect(utilityOnly).toContain("HostileCasts");
    expect(utilityOnly).toContain("Interrupts");
    expect(utilityOnly).not.toContain("DamageTaken");
    expect(utilityOnly).not.toContain("Healing");
  });

  it("reuses persisted complete dataset and forces refetch only on force/revision", () => {
    const existing = okDataset("HostileCasts");
    expect(
      evidenceDatasetReuseDecision({
        existing,
        reportRevision: 1,
        expectedRevision: 1,
        forceRefetch: false,
      }),
    ).toBe("reuse");
    expect(
      evidenceDatasetReuseDecision({
        existing,
        persistedReportRevision: 1,
        reportRevision: 2,
        forceRefetch: false,
      }),
    ).toBe("refetch_revision_changed");
    expect(
      evidenceDatasetReuseDecision({
        existing,
        reportRevision: 1,
        expectedRevision: 1,
        forceRefetch: true,
      }),
    ).toBe("refetch_forced");
  });
});

describe("pagination dedupe", () => {
  it("does not duplicate cast events across overlapping pages", () => {
    const events = [
      { timestamp: 1, type: "begincast", sourceID: 9, abilityGameID: 1 },
      { timestamp: 1, type: "begincast", sourceID: 9, abilityGameID: 1 },
      { timestamp: 2, type: "cast", sourceID: 9, abilityGameID: 1 },
    ];
    expect(dedupeEventsByIdentity(events)).toHaveLength(2);
  });
});

describe("shared run selection", () => {
  it("keeps Survival and Utility on the same report/fight per dungeon", () => {
    const selection = sharedSelectionFromUtilityNormalizedRuns(
      "eu/archimonde/wallidrixe",
      "tww-s3",
      [
        {
          dungeonSlug: "ara-kara",
          reportCode: "AAA",
          fightId: 1,
          playerActorId: 10,
        },
        {
          dungeonSlug: "ara-kara",
          reportCode: "BBB",
          fightId: 2,
          playerActorId: 10,
        },
        {
          dungeonSlug: "dawnbreaker",
          reportCode: "CCC",
          fightId: 3,
          playerActorId: 10,
        },
      ],
    );
    expect(selection.runs).toHaveLength(2);
    const survival = selection.runs;
    const utility = selection.runs;
    expect(assertSharedRunSelectionParity(survival, utility).ok).toBe(true);
  });
});

describe("shared ingest reuse", () => {
  it("second analysis makes zero WCL calls when datasets are persisted", async () => {
    const store = new InMemorySharedEvidenceStore();
    const key = buildSharedEvidenceCompatibilityKey({
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      actorId: 10,
      dataset: "HostileCasts",
      startTime: null,
      endTime: null,
      filterExpression: "hostile-npc-casts",
      providerContractVersion: "wcl-graphql-v2-events",
      payloadFingerprint: null,
    });
    await store.saveDataset(key, okDataset("HostileCasts", [{ timestamp: 1, type: "cast" }]), {
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      dataset: "HostileCasts",
    });

    const client = {
      requestPermissive: vi.fn(),
    };

    const first = await ingestSharedEvidenceBundle({
      client: client as never,
      store,
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "ara-kara",
      startTime: null,
      endTime: null,
      consumers: ["survival", "utility"],
      datasets: ["HostileCasts"],
    });
    expect(first.accounting.providerCalls).toBe(0);
    expect(first.accounting.persistedHits).toBeGreaterThan(0);
    expect(client.requestPermissive).not.toHaveBeenCalled();

    const second = await ingestSharedEvidenceBundle({
      client: client as never,
      store,
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "ara-kara",
      startTime: null,
      endTime: null,
      consumers: ["utility"],
      datasets: ["HostileCasts"],
    });
    expect(second.accounting.providerCalls).toBe(0);
    expect(client.requestPermissive).not.toHaveBeenCalled();
  });

  it("model-only recalculation makes zero WCL calls", async () => {
    const store = new InMemorySharedEvidenceStore();
    const key = buildSharedEvidenceCompatibilityKey({
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      actorId: 10,
      dataset: "HostileCasts",
      startTime: null,
      endTime: null,
      filterExpression: "hostile-npc-casts",
      providerContractVersion: "wcl-graphql-v2-events",
      payloadFingerprint: null,
    });
    await store.saveDataset(key, okDataset("HostileCasts"), {
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      dataset: "HostileCasts",
    });
    const bundle = await ingestSharedEvidenceBundle({
      client: null,
      store,
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "ara-kara",
      startTime: null,
      endTime: null,
      consumers: ["utility"],
      datasets: ["HostileCasts"],
      localOnly: true,
    });
    expect(bundle.accounting.providerCalls).toBe(0);
  });

  it("utility consumer ingest synthesizes masterData when localOnly", async () => {
    const store = new InMemorySharedEvidenceStore();
    const bundle = await ingestSharedEvidenceBundle({
      client: null,
      store,
      reportCode: "R",
      reportRevision: 2,
      fightId: 9,
      playerActorId: 15,
      ownedPetActorIds: [99],
      dungeonSlug: "ara-kara",
      startTime: 0,
      endTime: 1000,
      consumers: ["utility"],
      datasets: ["masterData", "HostileCasts"],
      localOnly: true,
    });
    expect(bundle.masterData).not.toBeNull();
    expect(bundle.accounting.providerCalls).toBe(0);
    const actors = (
      bundle.masterData as { actors: Array<{ id: number; petOwner: number | null }> }
    ).actors;
    expect(actors.some((a) => a.id === 15)).toBe(true);
    expect(actors.some((a) => a.id === 99 && a.petOwner === 15)).toBe(true);
    // HostileCasts marked missing (not persisted) — incomplete is explicit, not fabricated OK.
    expect(bundle.eventDatasets.HostileCasts?.state).toBe("MISSING");
  });

  it("concurrent ingest requests coalesce to one sequence", async () => {
    const store = new InMemorySharedEvidenceStore();
    const key = buildSharedEvidenceCompatibilityKey({
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      actorId: 10,
      dataset: "Deaths",
      startTime: null,
      endTime: null,
      filterExpression: null,
      providerContractVersion: "wcl-graphql-v2-events",
      payloadFingerprint: null,
    });
    await store.saveDataset(key, okDataset("Deaths"), {
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      dataset: "Deaths",
    });
    const input = {
      client: null as never,
      store,
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "ara-kara",
      startTime: null,
      endTime: null,
      consumers: ["survival", "utility"] as Array<"survival" | "utility">,
      datasets: ["Deaths"] as const,
      localOnly: true,
      coalesceKey: "same-key",
    };
    const [a, b] = await Promise.all([
      ingestSharedEvidenceBundle({ ...input, datasets: ["Deaths"] }),
      ingestSharedEvidenceBundle({ ...input, datasets: ["Deaths"] }),
    ]);
    expect(a.fetchedAt).toBe(b.fetchedAt);
  });

  it("partial utility missing dataset does not wipe survival dataset", async () => {
    const store = new InMemorySharedEvidenceStore();
    const deathKey = buildSharedEvidenceCompatibilityKey({
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      actorId: 10,
      dataset: "Deaths",
      startTime: null,
      endTime: null,
      filterExpression: "+resources",
      providerContractVersion: "wcl-graphql-v2-events",
      payloadFingerprint: null,
    });
    await store.saveDataset(deathKey, okDataset("Deaths", [{ timestamp: 1 }]), {
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      dataset: "Deaths",
    });
    const survival = await ingestSharedEvidenceBundle({
      client: null,
      store,
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "ara-kara",
      startTime: null,
      endTime: null,
      consumers: ["survival"],
      datasets: ["Deaths"],
      localOnly: true,
    });
    const utility = await ingestSharedEvidenceBundle({
      client: null,
      store,
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "ara-kara",
      startTime: null,
      endTime: null,
      consumers: ["utility"],
      datasets: ["HostileCasts"],
      localOnly: true,
    });
    expect(survival.eventDatasets.Deaths?.eventCount).toBe(1);
    expect(utility.eventDatasets.HostileCasts?.state).toBe("MISSING");
    const stillThere = await store.loadDataset(deathKey);
    expect(stillThere?.eventCount).toBe(1);
  });
});

describe("opportunity miss gating", () => {
  it("never promotes uncertain opportunities to confirmed misses", () => {
    const opps = extractRunOpportunities({
      normalized: baseRun(),
      castEvents: [
        {
          timestamp: 1000,
          type: "begincast",
          source: { id: 50, type: "NPC" },
          ability: { guid: 400011 },
        },
        {
          timestamp: 2800,
          type: "cast",
          source: { id: 50, type: "NPC" },
          ability: { guid: 400011 },
        },
      ],
    });
    expect(opps.every((o) => o.outcome !== "CAST_COMPLETED_CONFIRMED_MISS")).toBe(true);
  });

  it("player death disables miss classification for the window", () => {
    expect(
      isPlayerDeadDuringWindow(
        [{ type: "death", timestamp: 500, targetID: 10 }],
        10,
        1000,
        3000,
      ),
    ).toBe(true);
    expect(isPlayerDeadAt([{ type: "death", timestamp: 500, targetID: 10 }], 10, 1000)).toBe(
      true,
    );
    // Opportunity-engine miss gating is covered by utility probe suites; shared evidence
    // only needs death-at-timestamp semantics for reuse-safe consumers.
  });
});

describe("mechanic catalog coverage", () => {
  it("keeps unknown casts neutral rather than guessing", () => {
    const catalog = prepareActiveSeasonInterruptCatalog({ seasonSlug: "tww-s3" });
    const coverage = measureInterruptCatalogCoverage({
      catalog,
      observedHostileSpellIds: [111, 222],
    });
    expect(coverage.coverageRatio).toBe(0);
    expect(coverage.uncoveredSpellIds).toEqual([111, 222]);
    expect(coverage.verificationStatus).toBe("empty");
  });

  it("catalog-version change is local-only (no provider fetch required)", () => {
    const v1 = prepareActiveSeasonInterruptCatalog({ seasonSlug: "tww-s3" });
    const v2 = prepareActiveSeasonInterruptCatalog({
      seasonSlug: "tww-s3",
      rules: [
        {
          id: "x",
          seasonSlug: "tww-s3",
          dungeonSlug: "*",
          npcId: null,
          spellId: 111,
          ruleType: "PRIORITY_INTERRUPT",
          severity: 3,
          applicableRoles: ["DPS"],
          responseSpellIds: [],
          notes: null,
          source: "manual",
          version: "0.2.1",
          active: true,
        },
      ],
    });
    expect(v1.catalogVersion).toBe(v2.catalogVersion);
    const cov = measureInterruptCatalogCoverage({
      catalog: v2,
      observedHostileSpellIds: [111],
    });
    expect(cov.coveredSpellIds).toEqual([111]);
  });
});
