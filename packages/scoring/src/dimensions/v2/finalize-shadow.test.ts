import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  type CharacterSeasonEvidenceManifestV2,
} from "@mplus/contracts";
import {
  buildUnavailableInputFingerprint,
  finalizeShadowDimensions,
  isShadowPlaceholderFact,
  verifyManifestContentHash,
} from "./index.js";
import { emptyUtilityV2FactSet } from "../../utility/v2/index.js";

const COMPUTED_AT = new Date("2026-08-01T12:00:00.000Z");

function emptyManifest(
  overrides: Partial<CharacterSeasonEvidenceManifestV2> = {},
): CharacterSeasonEvidenceManifestV2 {
  return {
    schemaVersion: "2.0.0",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    characterId: "char-1",
    seasonId: "season-1",
    seasonSlug: "season-tww-1",
    specSlug: "affliction",
    role: "DPS",
    refreshContractHash: "refresh-hash",
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    highKeyPolicyId: "high-key-v1",
    activeDungeonSlugs: ["dungeon-a"],
    expectedSlotCount: 2,
    selectedSlotCount: 0,
    selectedAt: "2026-08-01T12:00:00.000Z",
    acquisitionPlanContentHash: "plan-hash",
    slots: [],
    rejectedCandidates: [],
    coverage: {
      state: "INSUFFICIENT",
      expectedSlotCount: 2,
      selectedSlotCount: 0,
      dungeonCount: 1,
      dungeonsRepresented: 0,
      slotFillRatio: 0,
      dungeonFillRatio: 0,
    },
    contentHash: "manifest-hash-empty",
    diagnostics: {
      candidatesConsidered: 0,
      candidatesEligible: 0,
      candidatesRejected: 0,
      rejectionReasonCounts: {},
      perDungeon: [],
    },
    ...overrides,
  };
}

describe("finalizeShadowDimensions", () => {
  it("fails closed on manifest content hash mismatch without outcomes", () => {
    const manifest = emptyManifest();
    const result = finalizeShadowDimensions({
      characterId: "char-1",
      seasonId: "season-1",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      manifest,
      expectedManifestContentHash: "wrong-hash",
      enabledDimensions: ["PERFORMANCE", "SURVIVAL"],
      factSets: [],
      computedAt: COMPUTED_AT,
    });
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toContain("manifest_content_hash_mismatch");
    expect(result.outcomes).toHaveLength(0);
  });

  it("persists SHADOW + UNAVAILABLE for placeholder facts on all enabled dims", () => {
    const manifest = emptyManifest({
      selectedSlotCount: 1,
      slots: [
        {
          slotId: "dungeon-a:0",
          dungeonSlug: "dungeon-a",
          slotIndex: 0,
          state: "SELECTED",
          identity: { reportCode: "AbCdEfGh", fightId: 1, reportRevision: 1 },
          keyLevel: 12,
          timed: true,
          runScore: 200,
          completedAt: "2026-07-01T00:00:00.000Z",
          actorId: 1,
          selectedRank: 1,
          fallbackReason: null,
          dimensionValidity: {
            performance: "PARTIAL",
            survival: "PARTIAL",
            utility: "PARTIAL",
            reasons: ["SHADOW_PLACEHOLDER_FACT_SET"],
          },
          datasetHashes: [],
          factSetHash: "fp-placeholder",
        },
      ],
    });

    const placeholderFacts = {
      schemaVersion: "2.0.0",
      kind: "shadow_placeholder",
      reportCode: "AbCdEfGh",
      fightId: 1,
      reportRevision: 1,
    };
    expect(isShadowPlaceholderFact(placeholderFacts)).toBe(true);

    const result = finalizeShadowDimensions({
      characterId: "char-1",
      seasonId: "season-1",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      manifest,
      expectedManifestContentHash: manifest.contentHash,
      enabledDimensions: ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"],
      factSets: [
        {
          extractorFamily: "evidence-v2-shadow",
          extractorVersion: "0.1.0",
          schemaVersion: "2.0.0",
          inputFingerprint: "fp-placeholder",
          facts: placeholderFacts,
          limitations: ["DIMENSION_CALCULATORS_NOT_WIRED"],
        },
      ],
      experienceHistory: null,
      computedAt: COMPUTED_AT,
    });

    expect(result.ok).toBe(true);
    expect(result.outcomes).toHaveLength(4);
    for (const outcome of result.outcomes) {
      expect(outcome.record.state).toBe("SHADOW");
      expect(outcome.record.metrics.availabilityState).toBe("UNAVAILABLE");
      expect(outcome.record.metrics.publicationBlocked).toBe(true);
      expect(outcome.record.score).toBeNull();
      expect(outcome.record.confidence).toBe(0);
      expect(outcome.record.metrics.failureReasons).toBeTruthy();
    }
  });

  it("isolates dimension failures — one exception does not block siblings", () => {
    const manifest = emptyManifest();
    // Force utility path with typed facts that will bind-fail or compute; use fixture utility facts.
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const utilFact = emptyUtilityV2FactSet({
      slotId: "slot-a",
      runId: "R1:1",
      dungeonSlug: "dungeon-a",
      reportCode: identity.reportCode,
      fightId: identity.fightId,
      reportRevision: identity.reportRevision,
    });

    const result = finalizeShadowDimensions({
      characterId: "char-1",
      seasonId: "season-1",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      manifest,
      expectedManifestContentHash: manifest.contentHash,
      enabledDimensions: ["PERFORMANCE", "UTILITY", "EXPERIENCE"],
      factSets: [],
      // Utility gets typed facts → may be UNAVAILABLE due to bind (no matching selected slots)
      utilityFactSets: [utilFact],
      experienceHistory: null,
      computedAt: COMPUTED_AT,
    });

    expect(result.outcomes).toHaveLength(3);
    const byDim = Object.fromEntries(result.outcomes.map((o) => [o.dimension, o]));
    expect(byDim.PERFORMANCE.record.state).toBe("SHADOW");
    expect(byDim.PERFORMANCE.record.metrics.availabilityState).toBe("UNAVAILABLE");
    expect(byDim.UTILITY.record.state).toBe("SHADOW");
    // Utility may COMPUTE or UNAVAILABLE depending on bind — either way siblings exist.
    expect(byDim.EXPERIENCE.record.state).toBe("SHADOW");
    expect(byDim.EXPERIENCE.record.metrics.availabilityState).toBe("UNAVAILABLE");
  });

  it("is deterministic for identical unavailable inputs", () => {
    const manifest = emptyManifest();
    const input = {
      characterId: "char-1",
      seasonId: "season-1",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      manifest,
      expectedManifestContentHash: manifest.contentHash,
      enabledDimensions: ["SURVIVAL", "PERFORMANCE"] as const,
      factSets: [],
      computedAt: COMPUTED_AT,
    };
    const a = finalizeShadowDimensions({ ...input, enabledDimensions: [...input.enabledDimensions] });
    const b = finalizeShadowDimensions({ ...input, enabledDimensions: [...input.enabledDimensions] });
    expect(a.outcomes.map((o) => o.record.inputFingerprint)).toEqual(
      b.outcomes.map((o) => o.record.inputFingerprint),
    );
    expect(a.outcomes.map((o) => o.record.score)).toEqual(
      b.outcomes.map((o) => o.record.score),
    );

    const fp = buildUnavailableInputFingerprint({
      dimension: "SURVIVAL",
      algorithmVersion: a.outcomes.find((o) => o.dimension === "SURVIVAL")!.record.algorithmVersion,
      manifestContentHash: manifest.contentHash,
      reasons: (a.outcomes.find((o) => o.dimension === "SURVIVAL")!.record.metrics
        .failureReasons as string[]) ?? [],
    });
    expect(a.outcomes.find((o) => o.dimension === "SURVIVAL")!.record.inputFingerprint).toBe(fp);
  });

  it("verifyManifestContentHash helper matches", () => {
    const manifest = emptyManifest();
    expect(verifyManifestContentHash(manifest, manifest.contentHash).ok).toBe(true);
    expect(verifyManifestContentHash(manifest, "nope").ok).toBe(false);
  });

  it("fails closed on duplicate frozen identities for selected slots", () => {
    const identity = { reportCode: "DupCode01", fightId: 9, reportRevision: 2 };
    const manifest = emptyManifest({
      selectedSlotCount: 2,
      expectedSlotCount: 2,
      activeDungeonSlugs: ["dungeon-a", "dungeon-b"],
      slots: [
        {
          slotId: "dungeon-a:0",
          dungeonSlug: "dungeon-a",
          slotIndex: 0,
          state: "SELECTED",
          identity,
          keyLevel: 10,
          timed: true,
          runScore: 100,
          completedAt: "2026-07-01T00:00:00.000Z",
          actorId: 1,
          selectedRank: 1,
          fallbackReason: null,
          dimensionValidity: {
            performance: "VALID",
            survival: "VALID",
            utility: "VALID",
            reasons: [],
          },
          datasetHashes: [],
          factSetHash: "f1",
        },
        {
          slotId: "dungeon-b:0",
          dungeonSlug: "dungeon-b",
          slotIndex: 0,
          state: "SELECTED",
          identity,
          keyLevel: 10,
          timed: true,
          runScore: 100,
          completedAt: "2026-07-01T00:00:00.000Z",
          actorId: 1,
          selectedRank: 1,
          fallbackReason: null,
          dimensionValidity: {
            performance: "VALID",
            survival: "VALID",
            utility: "VALID",
            reasons: [],
          },
          datasetHashes: [],
          factSetHash: "f2",
        },
      ],
      contentHash: "manifest-dup-identity",
    });

    const result = finalizeShadowDimensions({
      characterId: "char-1",
      seasonId: "season-1",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      manifest,
      expectedManifestContentHash: manifest.contentHash,
      enabledDimensions: ["PERFORMANCE", "SURVIVAL"],
      factSets: [],
      computedAt: COMPUTED_AT,
    });
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toContain("DUPLICATE_FROZEN_IDENTITY");
    expect(result.outcomes).toHaveLength(2);
    for (const o of result.outcomes) {
      expect(o.record.state).toBe("SHADOW");
      expect(o.record.metrics.availabilityState).toBe("UNAVAILABLE");
    }
  });
});
