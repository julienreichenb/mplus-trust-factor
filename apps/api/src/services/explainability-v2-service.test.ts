import { describe, expect, it, vi } from "vitest";
import {
  assertPublicExplainabilitySanitized,
  buildExplainabilityV2Public,
} from "@mplus/contracts";
import { buildExplainabilityV2Admin, toPublicExplainabilityV2 } from "@mplus/scoring";
import { ExplainabilityV2Service } from "./explainability-v2-service.js";

describe("explainability-v2 service semantics", () => {
  it("keeps report codes admin-only and blocks shadow from public GET attach", () => {
    const admin = buildExplainabilityV2Admin({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonId: "22222222-2222-2222-2222-222222222222",
      seasonSlug: "season-midnight-s1",
      modelKey: "default",
      modelVersion: 6,
      manifestId: "33333333-3333-3333-3333-333333333333",
      manifestContentHash: "content-hash",
      coverageState: "STRONG",
      expectedSlotCount: 16,
      selectedSlotCount: 14,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      slots: [
        {
          dungeonSlug: "ara-kara",
          slotIndex: 0,
          state: "SELECTED",
          keyLevel: 13,
          reportCode: "AbCdEfGhIjKl12Op",
          fightId: 1,
          reportRevision: 1,
        },
      ],
      rejectedCandidates: [],
      datasets: [],
      factSets: [],
      dimensions: [
        {
          dimension: "UTILITY",
          score: 61,
          confidence: 0.55,
          state: "SHADOW",
          algorithmVersion: "utility-v2",
          inputFingerprint: "fp",
          computedAt: "2026-08-01T00:00:00.000Z",
          metrics: { availabilityState: "PARTIAL" },
          explanation: { mode: "OBSERVED_CONTRIBUTION", notes: ["observed contribution"] },
        },
      ],
      batch: null,
      v1Snapshot: null,
    });

    expect(admin.matrix[0]?.reportCode).toBe("AbCdEfGhIjKl12Op");
    expect(admin.publicView).toBeNull();
    expect(toPublicExplainabilityV2(admin)).toBeNull();
  });

  it("returns null for UNAVAILABLE and emits only for PUBLISHED/PROVISIONAL", () => {
    const unavailable = buildExplainabilityV2Admin({
      characterId: "c",
      seasonId: "s",
      seasonSlug: "season-midnight-s1",
      modelKey: null,
      modelVersion: null,
      manifestId: "m",
      manifestContentHash: "h",
      coverageState: "INSUFFICIENT",
      expectedSlotCount: 16,
      selectedSlotCount: 0,
      evidenceCutoffAt: null,
      slots: [],
      rejectedCandidates: [],
      datasets: [],
      factSets: [],
      dimensions: [
        {
          dimension: "PERFORMANCE",
          score: null,
          confidence: 0,
          state: "PUBLISHED",
          algorithmVersion: "performance-v2",
          inputFingerprint: "fp",
          computedAt: "2026-08-01T00:00:00.000Z",
          metrics: { availabilityState: "UNAVAILABLE" },
          explanation: {},
        },
      ],
      batch: null,
      v1Snapshot: null,
    });
    expect(toPublicExplainabilityV2(unavailable)).toBeNull();

    const published = buildExplainabilityV2Public({
      modelKey: "default",
      modelVersion: 6,
      dataAsOf: "2026-08-01T00:00:00.000Z",
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      coverageState: "FULL",
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      lifecycleStates: ["PUBLISHED", "PUBLISHED"],
      selectedRuns: [
        {
          dungeonSlug: "ara-kara",
          slotIndex: 0,
          keyLevel: 12,
          timed: true,
          state: "SELECTED",
          hasWclSource: true,
        },
      ],
      dimensions: [
        {
          dimension: "PERFORMANCE",
          score: 80,
          confidence: 0.9,
          availabilityState: "AVAILABLE",
          algorithmVersion: "performance-v2",
        },
        {
          dimension: "UTILITY",
          score: null,
          confidence: 0,
          availabilityState: "UNAVAILABLE",
          algorithmVersion: "utility-v2",
          utilityNotes: ["Observed contribution only; missing actions are not zero."],
        },
      ],
    });
    expect(published).not.toBeNull();
    assertPublicExplainabilitySanitized(published!);
    expect(published?.coverage.publicationState).toBe("PUBLISHED");
    const utility = published?.dimensions.find((d) => d.dimension === "UTILITY");
    expect(utility?.gradeU).toBe(true);
    expect(utility?.score).toBeNull();
    expect(JSON.stringify(published)).not.toMatch(
      /manifestContentHash|inputFingerprint|reportCode|slotId|scoreModelId|artifact/,
    );
  });

  it("public path never calls getAdminDiagnostics and returns null without loading slots when ineligible", async () => {
    const findFirst = vi.fn(async () => ({
      id: "m1",
      coverageState: "FULL",
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      evidenceCutoffAt: new Date("2026-08-01T00:00:00.000Z"),
      season: { slug: "season-midnight-s1" },
      dimensionComputations: [{ state: "SHADOW", dimension: "PERFORMANCE" }],
    }));
    const findMany = vi.fn(async () => {
      throw new Error("slots/facts must not be loaded for ineligible publication");
    });
    const findUnique = vi.fn();
    const service = new ExplainabilityV2Service({
      worker: {
        prisma: {
          evidenceManifest: { findFirst },
          evidenceManifestSlot: { findMany },
          dimensionComputation: { findMany },
          scoreModel: { findUnique },
        },
      },
    } as never);

    const adminSpy = vi.spyOn(service, "getAdminDiagnostics");
    const result = await service.getPublicExplainabilityFromPublishedComputations({
      characterId: "11111111-1111-1111-1111-111111111111",
    });

    expect(result).toBeNull();
    expect(adminSpy).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findMany).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("UNAVAILABLE eligibility returns null without slot/fact loads", async () => {
    const findFirst = vi.fn(async () => ({
      id: "m1",
      coverageState: "INSUFFICIENT",
      expectedSlotCount: 16,
      selectedSlotCount: 0,
      evidenceCutoffAt: new Date("2026-08-01T00:00:00.000Z"),
      season: { slug: "season-midnight-s1" },
      dimensionComputations: [{ state: "PUBLISHED", dimension: "PERFORMANCE" }],
    }));
    const findMany = vi.fn(async () => {
      throw new Error("must not load");
    });
    const service = new ExplainabilityV2Service({
      worker: {
        prisma: {
          evidenceManifest: { findFirst },
          evidenceManifestSlot: { findMany },
          dimensionComputation: { findMany },
          scoreModel: { findUnique: vi.fn() },
        },
      },
    } as never);

    const result = await service.getPublicExplainability({
      characterId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("publishable path loads minimal projections only (no facts, no admin diagnostics)", async () => {
    const findFirst = vi.fn(async () => ({
      id: "m1",
      coverageState: "FULL",
      expectedSlotCount: 16,
      selectedSlotCount: 1,
      evidenceCutoffAt: new Date("2026-08-01T00:00:00.000Z"),
      season: { slug: "season-midnight-s1" },
      dimensionComputations: [{ state: "PUBLISHED", dimension: "PERFORMANCE" }],
    }));
    const slotFindMany = vi.fn(async () => [
      {
        dungeon: { slug: "ara-kara" },
        slotIndex: 0,
        state: "SELECTED",
        keyLevel: 12,
        reportCode: "AbCdEfGhIjKl12Op",
        providerDataAsOf: new Date("2026-08-01T00:00:00.000Z"),
      },
    ]);
    const dimFindMany = vi.fn(async () => [
      {
        dimension: "PERFORMANCE",
        score: 80,
        confidence: 0.9,
        state: "PUBLISHED",
        algorithmVersion: "performance-v2",
        metrics: { availabilityState: "AVAILABLE" },
        explanation: {},
        scoreModelId: "model-1",
      },
    ]);
    const findUnique = vi.fn(async () => ({ key: "default", version: 6 }));
    const service = new ExplainabilityV2Service({
      worker: {
        prisma: {
          evidenceManifest: { findFirst },
          evidenceManifestSlot: { findMany: slotFindMany },
          dimensionComputation: { findMany: dimFindMany },
          scoreModel: { findUnique },
          scoreAnalysisBatch: { findFirst: vi.fn() },
          scoreSnapshot: { findFirst: vi.fn() },
        },
      },
    } as never);

    const adminSpy = vi.spyOn(service, "getAdminDiagnostics");
    const result = await service.getPublicExplainability({
      characterId: "11111111-1111-1111-1111-111111111111",
    });

    expect(adminSpy).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    assertPublicExplainabilitySanitized(result!);
    expect(JSON.stringify(result)).not.toContain("AbCdEfGhIjKl12Op");
    expect(JSON.stringify(result)).not.toContain("facts");
    expect(slotFindMany.mock.calls[0]?.[0]?.select?.factSets).toBeUndefined();
    expect(dimFindMany.mock.calls[0]?.[0]?.select?.facts).toBeUndefined();
  });
});
