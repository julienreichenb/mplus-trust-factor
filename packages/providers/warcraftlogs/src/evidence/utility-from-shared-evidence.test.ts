/**
 * Shared-evidence → Utility shadow scoring (Agent 39 integration) tests.
 */
import { describe, expect, it, vi } from "vitest";
import {
  InMemorySharedEvidenceStore,
  ingestSharedEvidenceBundle,
  buildSharedEvidenceCompatibilityKey,
  buildEmptyBundle,
  attachDatasetToBundle,
  buildUtilityShadowInputsFromBundles,
  runUtilityObservedShadowPass,
  filterOutObservedContributionFromPublicUtility,
  utilityEvidencePresentInBundle,
  sharedEvidenceFilterTag,
  HOSTILE_CAST_FILTER_EXPRESSION,
  UTILITY_EVIDENCE_CONSUMERS,
  type WclRunEvidenceDataset,
} from "@mplus/provider-warcraftlogs";

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
    filterSourceId: key === "HostileCasts" ? null : 10,
    filterExpression: key === "HostileCasts" ? HOSTILE_CAST_FILTER_EXPRESSION : null,
    pages: [
      {
        pageIndex: 0,
        startTime: 0,
        nextPageTimestamp: null,
        eventCount: events.length,
        payloadFingerprint: `${key}-fp`,
      },
    ],
    events,
    consumers: ["survival", "utility"],
    pointsConsumed: null,
    costSource: "unknown",
    requestCostUnits: [],
    wclRequests: 0,
    fetchedAt: new Date().toISOString(),
    source: "persisted",
  };
}

describe("utility shadow + shared evidence", () => {
  it("compatible second ingest performs zero detailed WCL event calls", async () => {
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

    const client = { requestPermissive: vi.fn() };

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

  it("shadow scoring from persisted bundles changes no public Trust flags", () => {
    let bundle = buildEmptyBundle({
      reportCode: "ABC",
      reportRevision: 1,
      fightId: 7,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "skyreach",
      startTime: 0,
      endTime: 600_000,
      consumers: ["survival", "utility"],
    });
    bundle = {
      ...bundle,
      masterData: {
        actors: [{ id: 10, name: "Test", type: "Player", subType: "Mage", petOwner: null }],
      },
    };
    for (const key of [
      "Casts",
      "HostileCasts",
      "Interrupts",
      "Deaths",
      "Buffs",
      "Debuffs",
      "Dispels",
      "DamageDone",
      "CombatantInfo",
    ] as const) {
      bundle = attachDatasetToBundle(bundle, okDataset(key));
    }
    expect(utilityEvidencePresentInBundle(bundle).complete).toBe(true);

    const inputs = buildUtilityShadowInputsFromBundles({
      bundles: [bundle],
      classSlug: "mage",
      specSlug: "frost",
      roleSlug: "dps",
      detailedWclEventCallsMade: 0,
    });
    expect(inputs.hasPersistedSharedEvidence).toBe(true);
    const shadow = runUtilityObservedShadowPass({
      mode: "shadow",
      ...inputs,
    });
    expect(shadow.altersPublicTrustScore).toBe(false);
    expect(shadow.altersPublicUtility).toBe(false);
    expect(shadow.replacesLastKnownGoodUtility).toBe(false);
    expect(shadow.detailedWclEventCallsMade).toBe(0);
    expect(shadow.status).toBe("SHADOW_SCORED");
    expect(shadow.score?.rawBehaviorEstimate).toBeGreaterThanOrEqual(50);
  });

  it("SKIPPED_NO_PERSISTED_EVIDENCE only when evidence unavailable", () => {
    const empty = buildUtilityShadowInputsFromBundles({
      bundles: [],
      classSlug: "mage",
      specSlug: "frost",
      roleSlug: "dps",
    });
    expect(empty.hasPersistedSharedEvidence).toBe(false);
    expect(empty.coverage.candidateRunCount).toBe(0);
    const shadow = runUtilityObservedShadowPass({
      mode: "shadow",
      ...empty,
    });
    expect(shadow.status).toBe("SKIPPED_NO_PERSISTED_EVIDENCE");
    expect(shadow.score).toBeNull();
  });

  it("incomplete evidence (missing masterData) stays unavailable — never fabricated", () => {
    let bundle = buildEmptyBundle({
      reportCode: "ABC",
      reportRevision: 1,
      fightId: 7,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "skyreach",
      startTime: 0,
      endTime: 600_000,
      consumers: ["utility"],
    });
    for (const key of [
      "Casts",
      "HostileCasts",
      "Interrupts",
      "Deaths",
      "Buffs",
      "Debuffs",
      "Dispels",
      "DamageDone",
      "CombatantInfo",
    ] as const) {
      bundle = attachDatasetToBundle(bundle, okDataset(key));
    }
    expect(bundle.masterData).toBeNull();
    expect(utilityEvidencePresentInBundle(bundle).complete).toBe(false);
    expect(utilityEvidencePresentInBundle(bundle).missing).toContain("masterData");

    const inputs = buildUtilityShadowInputsFromBundles({
      bundles: [bundle],
      classSlug: "mage",
      specSlug: "frost",
      roleSlug: "dps",
    });
    expect(inputs.hasPersistedSharedEvidence).toBe(false);
    expect(inputs.coverage.missingMasterDataCount).toBe(1);
    expect(inputs.coverage.incompleteEvidenceCount).toBe(1);
    const shadow = runUtilityObservedShadowPass({ mode: "shadow", ...inputs });
    expect(shadow.status).toBe("SKIPPED_NO_PERSISTED_EVIDENCE");
    expect(shadow.score).toBeNull();
  });

  it("localOnly utility ingest synthesizes masterData so cached revisions are consumable", async () => {
    const store = new InMemorySharedEvidenceStore();
    for (const key of UTILITY_EVIDENCE_CONSUMERS) {
      if (key === "masterData") continue;
      // Compatibility keys always use the player actor id (see ingestSharedEvidenceBundle).
      const filterTag = sharedEvidenceFilterTag(key, false);
      const compat = buildSharedEvidenceCompatibilityKey({
        reportCode: "R",
        reportRevision: 1,
        fightId: 1,
        actorId: 10,
        dataset: key,
        startTime: null,
        endTime: null,
        filterExpression: filterTag,
        providerContractVersion: "wcl-graphql-v2-events",
        payloadFingerprint: null,
      });
      await store.saveDataset(compat, okDataset(key), {
        reportCode: "R",
        reportRevision: 1,
        fightId: 1,
        dataset: key,
      });
    }

    const bundle = await ingestSharedEvidenceBundle({
      client: null,
      store,
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      playerActorId: 10,
      ownedPetActorIds: [42],
      dungeonSlug: "ara-kara",
      startTime: null,
      endTime: null,
      consumers: ["utility"],
      localOnly: true,
    });

    expect(bundle.masterData).not.toBeNull();
    expect(utilityEvidencePresentInBundle(bundle).missing).toEqual([]);
    expect(utilityEvidencePresentInBundle(bundle).complete).toBe(true);
    expect(bundle.accounting.providerCalls).toBe(0);

    const actors = (
      bundle.masterData as { actors: Array<{ id: number; type: string; petOwner: number | null }> }
    ).actors;
    expect(actors.some((a) => a.id === 10 && a.type === "Player")).toBe(true);
    expect(actors.some((a) => a.id === 42 && a.petOwner === 10)).toBe(true);

    const inputs = buildUtilityShadowInputsFromBundles({
      bundles: [bundle],
      classSlug: "warlock",
      specSlug: "affliction",
      roleSlug: "dps",
      detailedWclEventCallsMade: 0,
    });
    expect(inputs.hasPersistedSharedEvidence).toBe(true);
    expect(inputs.coverage.reusedEvidenceCount).toBeGreaterThan(0);
    const shadow = runUtilityObservedShadowPass({ mode: "shadow", ...inputs });
    expect(shadow.status).toBe("SHADOW_SCORED");
    expect(shadow.altersPublicUtility).toBe(false);
    expect(shadow.altersPublicTrustScore).toBe(false);
  });

  it("provider failure path preserves public Utility (no research leak)", () => {
    const publicObs = filterOutObservedContributionFromPublicUtility([
      { metricKey: "utility.interrupts", context: { from: "combat-facts" } },
      {
        metricKey: "utility.research",
        context: { scoringMode: "OPPORTUNITY_RESEARCH" },
      },
      {
        metricKey: "utility.observed",
        context: { utilityScoringMode: "OBSERVED_CONTRIBUTION" },
      },
    ]);
    expect(publicObs).toHaveLength(1);
    expect(publicObs[0]!.metricKey).toBe("utility.interrupts");
  });
});
