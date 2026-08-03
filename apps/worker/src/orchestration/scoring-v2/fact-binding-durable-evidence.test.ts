import { describe, expect, it } from "vitest";
import {
  attachDatasetToBundle,
  buildEmptyBundle,
  evidenceDatasetReuseDecision,
  isDurableSharedEvidenceBundle,
  isRealMasterData,
  synthesizeMasterDataFromActors,
  type WclRunEvidenceDataset,
} from "@mplus/provider-warcraftlogs";
import { buildSlotFactSetBindingHash, finalizeShadowDimensions } from "@mplus/scoring";
import { buildFactSetFingerprint } from "./acquisition.js";

function emptyManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "2.0.0" as const,
    characterId: "char-1",
    seasonId: "season-1",
    seasonSlug: "midnight-season-1",
    classSlug: "warlock",
    specSlug: "demonology",
    role: "DPS" as const,
    refreshContractHash: "refresh",
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    highKeyPolicyId: "policy",
    plannedAt: "2026-08-01T00:00:00.000Z",
    expectedSlotCount: 1,
    selectedSlotCount: 1,
    coverage: {
      state: "PARTIAL" as const,
      expectedSlotCount: 1,
      selectedSlotCount: 1,
      dungeonCount: 1,
      reasons: [],
    },
    slots: [],
    rejectedCandidates: [],
    contentHash: "manifest-hash",
    ...overrides,
  };
}

function okDataset(key: WclRunEvidenceDataset["key"], pageCount = 1): WclRunEvidenceDataset {
  return {
    key,
    state: "OK",
    truncated: false,
    pageCount,
    eventCount: pageCount > 0 ? 2 : 0,
    filterSourceId: null,
    filterExpression: null,
    pages: Array.from({ length: pageCount }, (_, pageIndex) => ({
      pageIndex,
      startTime: pageIndex,
      nextPageTimestamp: null,
      eventCount: 2,
      payloadFingerprint: `fp-${key}-${pageIndex}`,
    })),
    events: [{ timestamp: 1 }, { timestamp: 2 }],
    consumers: ["survival", "utility"],
    pointsConsumed: 1,
    costSource: "measured",
    requestCostUnits: [1],
    wclRequests: 1,
    fetchedAt: "2026-08-01T00:00:00.000Z",
    source: "provider",
  };
}

describe("durable shared evidence completeness", () => {
  it("does not treat MISSING datasets as present", () => {
    let bundle = buildEmptyBundle({
      reportCode: "AbCdEfGh",
      reportRevision: 1,
      fightId: 3,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "skyreach",
      startTime: 0,
      endTime: 1,
      consumers: ["survival", "utility"],
    });
    bundle.completeness.required = ["Casts", "Deaths", "masterData"];
    const missing: WclRunEvidenceDataset = {
      ...okDataset("Casts"),
      state: "MISSING",
      pageCount: 0,
      eventCount: 0,
      pages: [],
      events: [],
      source: "missing",
      wclRequests: 0,
      pointsConsumed: null,
      costSource: "unknown",
    };
    bundle = attachDatasetToBundle(bundle, missing);
    expect(bundle.completeness.present).not.toContain("Casts");
    expect(bundle.completeness.missing).toContain("Casts");
    expect(
      isDurableSharedEvidenceBundle(bundle, ["Casts", "Deaths", "masterData"]),
    ).toBe(false);
  });

  it("rejects page-less legacy cache for reuse", () => {
    expect(
      evidenceDatasetReuseDecision({
        existing: {
          ...okDataset("Casts"),
          pageCount: 0,
          pages: [],
          state: "OK",
        },
        reportRevision: 1,
        forceRefetch: false,
      }),
    ).toBe("fetch_missing");
  });

  it("rejects synthesized stub masterData as durable", () => {
    const stub = synthesizeMasterDataFromActors({
      playerActorId: 42,
      ownedPetActorIds: [99],
    });
    expect(isRealMasterData(stub)).toBe(false);
    expect(
      isRealMasterData({
        actors: [
          { id: 1, name: "Wallidrixe", type: "Player", server: "Archimonde", subType: "Warlock" },
          { id: 2, name: "HealerOne", type: "Player", server: "Archimonde", subType: "Priest" },
          { id: 3, name: "TankOne", type: "Player", server: "Archimonde", subType: "Paladin" },
          { id: 4, name: "DpsTwo", type: "Player", server: "Archimonde", subType: "Hunter" },
          { id: 5, name: "DpsThree", type: "Player", server: "Archimonde", subType: "Mage" },
        ],
      }),
    ).toBe(true);
  });

  it("accepts a complete durable bundle with pages + real masterData", () => {
    let bundle = buildEmptyBundle({
      reportCode: "AbCdEfGh",
      reportRevision: 1,
      fightId: 3,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "skyreach",
      startTime: 0,
      endTime: 1,
      consumers: ["survival"],
    });
    bundle.completeness.required = ["Casts", "masterData"];
    bundle = attachDatasetToBundle(bundle, okDataset("Casts"));
    bundle = {
      ...bundle,
      masterData: {
        actors: [
          { id: 10, name: "Wallidrixe", type: "Player", server: "Archimonde", subType: "Warlock" },
        ],
      },
      completeness: {
        ...bundle.completeness,
        present: [...bundle.completeness.present, "masterData"],
        missing: [],
      },
    };
    expect(isDurableSharedEvidenceBundle(bundle, ["Casts", "masterData"])).toBe(true);
  });
});

describe("fact_set_hash_mismatch live shape (hollow ACQUIRED)", () => {
  it("fails closed when SELECTED expected hash has no RunFactSet rows (actual=missing)", () => {
    const identity = { reportCode: "QfMvDaxTqAkXmwyR", fightId: 3, reportRevision: 4 };
    // Hollow acquisition previously stamped scoring-v2-acquisition placeholder.
    const hollowExpected = buildFactSetFingerprint({
      reportCode: identity.reportCode,
      fightId: identity.fightId,
      reportRevision: identity.reportRevision,
      extractorFamily: "scoring-v2-acquisition",
      extractorVersion: "2.0.0",
      classSlug: "warlock",
      specSlug: "demonology",
    });

    const result = finalizeShadowDimensions({
      characterId: "char-1",
      seasonId: "season-1",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      manifest: emptyManifest({
        contentHash: "manifest-hollow",
        slots: [
          {
            slotId: "magisters-terrace:0",
            dungeonSlug: "magisters-terrace",
            slotIndex: 0,
            state: "SELECTED",
            identity,
            keyLevel: 22,
            timed: true,
            runScore: 200,
            completedAt: "2026-08-01T00:00:00.000Z",
            actorId: 1,
            selectedRank: 0,
            fallbackReason: null,
            dimensionValidity: {
              performance: "PARTIAL",
              survival: "PARTIAL",
              utility: "PARTIAL",
              reasons: [],
            },
            datasetHashes: [],
            factSetHash: hollowExpected,
          },
        ],
      }) as never,
      expectedManifestContentHash: "manifest-hollow",
      enabledDimensions: ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"],
      factSets: [],
      computedAt: "2026-08-01T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.blockedReason).toContain("fact_set_hash_mismatch");
    expect(result.blockedReason).toContain("actual=missing");
    expect(result.blockedReason).toContain(`expected=${hollowExpected}`);
  });

  it("accepts WRITTEN facts whose binding hash matches frozen SELECTED slot", () => {
    const identity = { reportCode: "QfMvDaxTqAkXmwyR", fightId: 3, reportRevision: 4 };
    const inputFingerprint = buildFactSetFingerprint({
      reportCode: identity.reportCode,
      fightId: identity.fightId,
      reportRevision: identity.reportRevision,
      extractorFamily: "utility-v2",
      extractorVersion: "0.1.0",
      classSlug: "warlock",
      specSlug: "demonology",
    });
    const expected = buildSlotFactSetBindingHash([
      {
        extractorFamily: "utility-v2",
        extractorVersion: "0.1.0",
        inputFingerprint,
        facts: { kind: "utility" },
      },
    ]);

    const result = finalizeShadowDimensions({
      characterId: "char-1",
      seasonId: "season-1",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      manifest: emptyManifest({
        contentHash: "manifest-ok",
        slots: [
          {
            slotId: "magisters-terrace:0",
            dungeonSlug: "magisters-terrace",
            slotIndex: 0,
            state: "SELECTED",
            identity,
            keyLevel: 22,
            timed: true,
            runScore: 200,
            completedAt: "2026-08-01T00:00:00.000Z",
            actorId: 1,
            selectedRank: 0,
            fallbackReason: null,
            dimensionValidity: {
              performance: "PARTIAL",
              survival: "PARTIAL",
              utility: "VALID",
              reasons: [],
            },
            datasetHashes: [],
            factSetHash: expected,
          },
        ],
      }) as never,
      expectedManifestContentHash: "manifest-ok",
      enabledDimensions: ["UTILITY"],
      factSets: [
        {
          extractorFamily: "utility-v2",
          extractorVersion: "0.1.0",
          schemaVersion: "2.0.0",
          inputFingerprint,
          facts: { kind: "utility" },
          reportCode: identity.reportCode,
          fightId: identity.fightId,
          reportRevision: identity.reportRevision,
        },
      ],
      computedAt: "2026-08-01T00:00:00.000Z",
    });

    // May still be UNAVAILABLE for calculator readiness, but must not be hash mismatch.
    expect(result.blockedReason ?? "").not.toContain("fact_set_hash_mismatch");
  });
});
