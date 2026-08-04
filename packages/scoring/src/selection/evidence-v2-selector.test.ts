import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  EVIDENCE_SLOTS_PER_DUNGEON,
  expectedEvidenceSlotCount,
  type EvidenceAcquisitionPlanV2,
  type EvidenceCandidateAcquisitionResult,
  type EvidenceCandidateMetadataV2,
  type EvidenceSelectionScope,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  compareEvidenceCandidatesV2,
  computeEvidenceAcquisitionPlanContentHash,
  buildEvidenceAcquisitionPlanContentHashInput,
  computeEvidenceManifestContentHash,
  buildEvidenceManifestContentHashInput,
  finalizeEvidenceManifestV2,
} from "./evidence-v2-selector.js";
import { scoringRunCandidateToEvidenceMetadata } from "./evidence-v2-adapters.js";

const EIGHT_DUNGEONS = [
  "ara-kara-city-of-echoes",
  "eco-dome-aldani",
  "halls-of-atonement",
  "operation-floodgate",
  "priory-of-the-sacred-flame",
  "tazavesh-streets-of-wonder",
  "the-dawnbreaker",
  "the-rookery",
] as const;

function baseScope(overrides?: Partial<EvidenceSelectionScope>): EvidenceSelectionScope {
  return {
    characterId: "char-1",
    seasonId: "season-1",
    seasonSlug: "the-war-within-season-1",
    specializationId: "spec-1",
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS",
    refreshContractHash: "refresh-hash-1",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    highKeyPolicyId: "high-key-v1",
    activeDungeonSlugs: [...EIGHT_DUNGEONS],
    ...overrides,
  };
}

function candidate(
  overrides: Partial<EvidenceCandidateMetadataV2> & {
    reportCode: string;
    fightId: number;
    dungeonSlug: string;
    keyLevel: number;
  },
): EvidenceCandidateMetadataV2 {
  const { reportCode, fightId, dungeonSlug, keyLevel, ...rest } = overrides;
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision: rest.reportRevision !== undefined ? rest.reportRevision : null,
    dungeonSlug,
    keyLevel,
    timed: rest.timed !== undefined ? rest.timed : true,
    runScore: rest.runScore !== undefined ? rest.runScore : 400,
    evidenceCompleteness: rest.evidenceCompleteness ?? 1,
    completedAt: rest.completedAt !== undefined ? rest.completedAt : "2026-07-01T12:00:00.000Z",
    fightDurationMs: rest.fightDurationMs !== undefined ? rest.fightDurationMs : 1_800_000,
    actorId: rest.actorId !== undefined ? rest.actorId : 10,
    accessState: rest.accessState ?? "PUBLIC",
    identityResolution: rest.identityResolution ?? "RESOLVED",
    fightAccessible: rest.fightAccessible ?? true,
    hardError: rest.hardError ?? false,
    discoverySource: rest.discoverySource,
    diagnosticsOnly: rest.diagnosticsOnly,
  };
}

function fullEightPoolCandidates(): EvidenceCandidateMetadataV2[] {
  return EIGHT_DUNGEONS.flatMap((dungeonSlug, i) => [
    candidate({
      reportCode: `high-${i}`,
      fightId: 1,
      dungeonSlug,
      keyLevel: 16 + (i % 3),
      runScore: 500,
      completedAt: "2026-07-10T12:00:00.000Z",
    }),
    candidate({
      reportCode: `mid-${i}`,
      fightId: 2,
      dungeonSlug,
      keyLevel: 14,
      runScore: 420,
      completedAt: "2026-07-08T12:00:00.000Z",
    }),
    candidate({
      reportCode: `low-${i}`,
      fightId: 3,
      dungeonSlug,
      keyLevel: 12,
      runScore: 380,
      completedAt: "2026-07-05T12:00:00.000Z",
    }),
  ]);
}

/** Simulate successful WS03 acquisition for every planned discovery identity. */
function acquireAllFromPlan(
  plan: EvidenceAcquisitionPlanV2,
  overrides?: Map<string, Partial<EvidenceCandidateAcquisitionResult>>,
): EvidenceCandidateAcquisitionResult[] {
  const seen = new Set<string>();
  const results: EvidenceCandidateAcquisitionResult[] = [];
  for (const slot of plan.slots) {
    for (const attempt of slot.orderedCandidates) {
      const key = `${attempt.discoveryIdentity.reportCode}:${attempt.discoveryIdentity.fightId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const patch = overrides?.get(key);
      results.push({
        discoveryIdentity: { ...attempt.discoveryIdentity },
        acquisitionStatus: "ACQUIRED",
        reportRevision: 1,
        rejectionReason: null,
        rejectionDetail: null,
        datasetHashes: [{ dataset: "CASTS", contentHash: `casts-${key}` }],
        factSetHash: `facts-${key}`,
        dimensionValidity: {
          performance: "VALID",
          survival: "VALID",
          utility: "VALID",
          reasons: [],
        },
        keyLevel: attempt.keyLevel,
        timed: attempt.timed,
        runScore: attempt.runScore,
        completedAt: attempt.completedAt,
        actorId: attempt.actorId,
        evidenceCompleteness: attempt.evidenceCompleteness,
        ...patch,
      });
    }
  }
  return results;
}

function planAndFinalize(
  candidates: EvidenceCandidateMetadataV2[],
  options?: {
    scope?: EvidenceSelectionScope;
    plannedAt?: string;
    selectedAt?: string;
    acquisitionOverrides?: Map<string, Partial<EvidenceCandidateAcquisitionResult>>;
  },
) {
  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope: options?.scope ?? baseScope(),
    candidates,
    plannedAt: options?.plannedAt ?? "2026-08-01T11:00:00.000Z",
  });
  const { manifest } = finalizeEvidenceManifestV2({
    plan,
    acquisitionResults: acquireAllFromPlan(plan, options?.acquisitionOverrides),
    selectedAt: options?.selectedAt ?? "2026-08-01T12:00:00.000Z",
  });
  return { plan, manifest };
}

describe("evidence V2 plan → acquire → finalize lifecycle", () => {
  it("builds an immutable acquisition plan before any manifest exists", () => {
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope: baseScope({ activeDungeonSlugs: ["skyreach"] }),
      candidates: [
        candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 18 }),
        candidate({ reportCode: "b", fightId: 2, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      plannedAt: "2026-08-01T11:00:00.000Z",
    });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.slots).toHaveLength(2);
    expect(plan.slots[0]!.orderedCandidates.map((c) => c.discoveryIdentity.reportCode)).toEqual([
      "a",
      "b",
    ]);
    // Both slots share the full deterministic chain; finalize enforces distinct identities.
    expect(plan.slots[1]!.orderedCandidates.map((c) => c.discoveryIdentity.reportCode)).toEqual([
      "a",
      "b",
    ]);
    for (const slot of plan.slots) {
      for (const attempt of slot.orderedCandidates) {
        expect(attempt.discoveryIdentity).toEqual({
          reportCode: expect.any(String),
          fightId: expect.any(Number),
        });
        expect(attempt).not.toHaveProperty("reportRevision");
      }
    }
  });

  it("does not freeze a manifest from plan build alone", () => {
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope: baseScope({ activeDungeonSlugs: ["skyreach"] }),
      candidates: [
        candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 16 }),
      ],
      plannedAt: "2026-08-01T11:00:00.000Z",
    });
    expect(plan.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(plan).not.toHaveProperty("selectedSlotCount");
    expect(plan).not.toHaveProperty("coverage");
  });

  it("finalizes frozen identities only after acquisition with reportRevision", () => {
    const { plan, manifest } = planAndFinalize([
      candidate({
        reportCode: "a",
        fightId: 1,
        dungeonSlug: "skyreach",
        keyLevel: 16,
        reportRevision: null,
      }),
      candidate({
        reportCode: "b",
        fightId: 2,
        dungeonSlug: "skyreach",
        keyLevel: 14,
        reportRevision: null,
      }),
    ], { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) });

    expect(plan.slots[0]!.orderedCandidates).toHaveLength(2);
    expect(manifest.slots[0]!.identity).toEqual({
      reportCode: "a",
      fightId: 1,
      reportRevision: 1,
    });
    expect(manifest.acquisitionPlanContentHash).toBe(plan.contentHash);
    expect(manifest.slots[0]!.factSetHash).toBe("facts-a:1");
    expect(manifest.slots[0]!.datasetHashes).toEqual([
      { dataset: "CASTS", contentHash: "casts-a:1" },
    ]);
  });

  it("falls back when the preferred candidate fails acquisition", () => {
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope: baseScope({ activeDungeonSlugs: ["skyreach"] }),
      candidates: [
        candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 18 }),
        candidate({ reportCode: "b", fightId: 2, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      plannedAt: "2026-08-01T11:00:00.000Z",
    });

    const results = acquireAllFromPlan(
      plan,
      new Map([
        [
          "a:1",
          {
            acquisitionStatus: "REJECTED",
            reportRevision: null,
            rejectionReason: "ARCHIVED_OR_GATED",
            rejectionDetail: "archived",
            datasetHashes: [],
            factSetHash: null,
            dimensionValidity: null,
          },
        ],
      ]),
    );

    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults: results,
      selectedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(manifest.slots[0]!.identity?.reportCode).toBe("b");
    expect(manifest.slots[0]!.selectedRank).toBe(1);
    expect(manifest.slots[0]!.fallbackReason).toBe("ARCHIVED_OR_GATED");
    expect(manifest.rejectedCandidates.some((r) => r.reason === "ARCHIVED_OR_GATED")).toBe(true);
  });

  it("selects 2×8 full slots without hardcoding eight", () => {
    const { manifest } = planAndFinalize(fullEightPoolCandidates());

    expect(manifest.expectedSlotCount).toBe(expectedEvidenceSlotCount(8));
    expect(manifest.expectedSlotCount).toBe(EIGHT_DUNGEONS.length * EVIDENCE_SLOTS_PER_DUNGEON);
    expect(manifest.selectedSlotCount).toBe(16);
    expect(manifest.slots).toHaveLength(16);
    expect(manifest.coverage.state).toBe("FULL");
    expect(manifest.slots.every((s) => s.state === "SELECTED")).toBe(true);

    for (const dungeon of EIGHT_DUNGEONS) {
      const dungeonSlots = manifest.slots.filter((s) => s.dungeonSlug === dungeon);
      expect(dungeonSlots).toHaveLength(2);
      expect(dungeonSlots[0]!.keyLevel).toBeGreaterThanOrEqual(dungeonSlots[1]!.keyLevel!);
    }
  });

  it("falls back to a lower key for the second slot", () => {
    const { manifest } = planAndFinalize(
      [
        candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 18 }),
        candidate({ reportCode: "b", fightId: 1, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );

    expect(manifest.selectedSlotCount).toBe(2);
    expect(manifest.slots[0]!.identity?.reportCode).toBe("a");
    expect(manifest.slots[0]!.keyLevel).toBe(18);
    expect(manifest.slots[1]!.identity?.reportCode).toBe("b");
    expect(manifest.slots[1]!.keyLevel).toBe(14);
  });

  it("rejects hidden, archived, wrong season, and wrong spec at plan time", () => {
    const { plan, manifest } = planAndFinalize(
      [
        candidate({
          reportCode: "hidden",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 20,
          accessState: "PRIVATE_OR_HIDDEN",
        }),
        candidate({
          reportCode: "archived",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 19,
          accessState: "ARCHIVED_OR_GATED",
        }),
        candidate({
          reportCode: "wrong-season",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 18,
          identityResolution: "WRONG_SEASON",
        }),
        candidate({
          reportCode: "wrong-spec",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 17,
          identityResolution: "WRONG_SPEC",
        }),
        candidate({ reportCode: "ok", fightId: 1, dungeonSlug: "skyreach", keyLevel: 12 }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );

    expect(plan.rejectedCandidates.map((r) => r.reason)).toEqual(
      expect.arrayContaining([
        "PRIVATE_OR_HIDDEN",
        "ARCHIVED_OR_GATED",
        "WRONG_SEASON",
        "WRONG_SPEC",
      ]),
    );
    expect(manifest.selectedSlotCount).toBe(1);
    expect(manifest.slots[0]!.identity?.reportCode).toBe("ok");
    expect(manifest.slots[1]!.state).not.toBe("SELECTED");
  });

  it("rejects duplicate report/fight across slots", () => {
    const { manifest } = planAndFinalize(
      [
        candidate({ reportCode: "same", fightId: 7, dungeonSlug: "skyreach", keyLevel: 16 }),
        candidate({ reportCode: "same", fightId: 7, dungeonSlug: "neltharus", keyLevel: 16 }),
        candidate({ reportCode: "other", fightId: 1, dungeonSlug: "neltharus", keyLevel: 14 }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach", "neltharus"] }) },
    );

    const selectedKeys = manifest.slots
      .filter((s) => s.state === "SELECTED")
      .map((s) => `${s.identity!.reportCode}:${s.identity!.fightId}`);
    expect(new Set(selectedKeys).size).toBe(selectedKeys.length);
    expect(manifest.rejectedCandidates.some((r) => r.reason === "DUPLICATE_REPORT_FIGHT")).toBe(
      true,
    );
  });

  it("keeps selected fallback identity distinct and does not mark it as duplicate", () => {
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope: baseScope({ activeDungeonSlugs: ["skyreach"] }),
      candidates: [
        candidate({ reportCode: "head", fightId: 1, dungeonSlug: "skyreach", keyLevel: 18 }),
        candidate({ reportCode: "fallback", fightId: 2, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      plannedAt: "2026-08-01T11:00:00.000Z",
    });

    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults: acquireAllFromPlan(plan),
      selectedAt: "2026-08-01T12:00:00.000Z",
    });

    const slot0 = manifest.slots.find((s) => s.slotIndex === 0)!;
    const slot1 = manifest.slots.find((s) => s.slotIndex === 1)!;
    expect(slot0.identity?.reportCode).toBe("head");
    expect(slot0.selectedRank).toBe(0);
    expect(slot0.fallbackReason).toBeNull();
    expect(slot1.identity?.reportCode).toBe("fallback");
    expect(slot1.selectedRank).toBe(1);
    expect(slot1.fallbackReason).toBe("DUPLICATE_REPORT_FIGHT");
    // Selected identity itself is not a duplicate — rejected list holds the skip.
    expect(
      manifest.rejectedCandidates.some(
        (r) =>
          r.reason === "DUPLICATE_REPORT_FIGHT" &&
          r.reportCode === "head" &&
          r.fightId === 1,
      ),
    ).toBe(true);
    const selectedKeys = manifest.slots
      .filter((s) => s.state === "SELECTED")
      .map((s) => `${s.identity!.reportCode}:${s.identity!.fightId}`);
    expect(new Set(selectedKeys).size).toBe(selectedKeys.length);
  });

  it("ignores parse / behavior / label fields in ordering", () => {
    const lowParseFirst = candidate({
      reportCode: "low-parse",
      fightId: 1,
      dungeonSlug: "skyreach",
      keyLevel: 15,
      runScore: 400,
      diagnosticsOnly: { parsePercentile: 99, deaths: 0, expectedLabel: "S" },
    });
    const highParseSecond = candidate({
      reportCode: "high-parse",
      fightId: 2,
      dungeonSlug: "skyreach",
      keyLevel: 15,
      runScore: 450,
      diagnosticsOnly: { parsePercentile: 10, deaths: 40, expectedLabel: "D" },
    });

    expect(compareEvidenceCandidatesV2(lowParseFirst, highParseSecond)).toBeGreaterThan(0);

    const { manifest } = planAndFinalize([lowParseFirst, highParseSecond], {
      scope: baseScope({ activeDungeonSlugs: ["skyreach"] }),
    });
    expect(manifest.slots[0]!.identity?.reportCode).toBe("high-parse");
  });

  it("is stable on ties via lexical report code and fight id", () => {
    const { manifest } = planAndFinalize(
      [
        candidate({
          reportCode: "zzz",
          fightId: 9,
          dungeonSlug: "skyreach",
          keyLevel: 15,
          timed: true,
          runScore: 400,
          evidenceCompleteness: 1,
          completedAt: "2026-07-01T12:00:00.000Z",
        }),
        candidate({
          reportCode: "aaa",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 15,
          timed: true,
          runScore: 400,
          evidenceCompleteness: 1,
          completedAt: "2026-07-01T12:00:00.000Z",
        }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );
    expect(manifest.slots[0]!.identity?.reportCode).toBe("aaa");
    expect(manifest.slots[1]!.identity?.reportCode).toBe("zzz");
  });

  it("is invariant to input order for plan and manifest hashes", () => {
    const pool = fullEightPoolCandidates();
    const forward = planAndFinalize(pool);
    const reverse = planAndFinalize([...pool].reverse());

    expect(reverse.plan.contentHash).toBe(forward.plan.contentHash);
    expect(reverse.manifest.contentHash).toBe(forward.manifest.contentHash);
    expect(reverse.manifest.slots.map((s) => s.identity)).toEqual(
      forward.manifest.slots.map((s) => s.identity),
    );
  });

  it("represents sparse seasons honestly", () => {
    const { manifest } = planAndFinalize(
      [candidate({ reportCode: "only", fightId: 1, dungeonSlug: "skyreach", keyLevel: 12 })],
      {
        scope: baseScope({
          activeDungeonSlugs: ["skyreach", "neltharus", "freehold"],
        }),
      },
    );

    expect(manifest.expectedSlotCount).toBe(6);
    expect(manifest.selectedSlotCount).toBe(1);
    expect(manifest.coverage.state).toBe("INSUFFICIENT");
    expect(manifest.slots.filter((s) => s.state === "MISSING_NO_CANDIDATE").length).toBeGreaterThan(
      0,
    );
  });

  it("supports non-eight dungeon pools", () => {
    const pool = ["a", "b", "c", "d", "e"];
    const candidates = pool.flatMap((dungeonSlug) => [
      candidate({ reportCode: `${dungeonSlug}-1`, fightId: 1, dungeonSlug, keyLevel: 16 }),
      candidate({ reportCode: `${dungeonSlug}-2`, fightId: 2, dungeonSlug, keyLevel: 14 }),
    ]);
    const { manifest } = planAndFinalize(candidates, {
      scope: baseScope({ activeDungeonSlugs: pool }),
    });
    expect(manifest.expectedSlotCount).toBe(10);
    expect(manifest.selectedSlotCount).toBe(10);
    expect(manifest.coverage.state).toBe("FULL");
  });

  it("changes plan/manifest hashes when scoring-relevant fields mutate", () => {
    const base = planAndFinalize(
      [
        candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 16 }),
        candidate({ reportCode: "b", fightId: 2, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );
    const mutated = planAndFinalize(
      [
        candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 17 }),
        candidate({ reportCode: "b", fightId: 2, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );

    expect(mutated.plan.contentHash).not.toBe(base.plan.contentHash);
    expect(mutated.manifest.contentHash).not.toBe(base.manifest.contentHash);

    const sameContentDifferentClock = planAndFinalize(
      [
        candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 16 }),
        candidate({ reportCode: "b", fightId: 2, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      {
        scope: baseScope({ activeDungeonSlugs: ["skyreach"] }),
        plannedAt: "2026-08-01T18:00:00.000Z",
        selectedAt: "2026-08-01T19:00:00.000Z",
      },
    );
    expect(sameContentDifferentClock.plan.contentHash).toBe(base.plan.contentHash);
    expect(sameContentDifferentClock.manifest.contentHash).toBe(base.manifest.contentHash);
  });

  it("freezes final manifest and keeps cross-dimension parity", () => {
    const { manifest } = planAndFinalize(
      [
        candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 16 }),
        candidate({ reportCode: "b", fightId: 2, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );

    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.slots)).toBe(true);
    expect(() => {
      (manifest as { selectedSlotCount: number }).selectedSlotCount = 0;
    }).toThrow();

    expect(manifest.contentHash).toBe(manifest.contentHash);
    expect(manifest.slots.map((s) => s.slotId)).toEqual(["skyreach:0", "skyreach:1"]);
  });

  it("rejects acquired candidates missing reportRevision at finalize", () => {
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope: baseScope({ activeDungeonSlugs: ["skyreach"] }),
      candidates: [
        candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 16 }),
        candidate({ reportCode: "b", fightId: 2, dungeonSlug: "skyreach", keyLevel: 12 }),
      ],
      plannedAt: "2026-08-01T11:00:00.000Z",
    });

    const results = acquireAllFromPlan(
      plan,
      new Map([
        [
          "a:1",
          {
            reportRevision: null,
            factSetHash: "facts-a",
          },
        ],
      ]),
    );

    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults: results,
      selectedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(manifest.slots[0]!.identity?.reportCode).toBe("b");
    expect(manifest.rejectedCandidates.some((r) => r.reason === "MISSING_REPORT_REVISION")).toBe(
      true,
    );
  });

  it("adapts V1 scoring candidates without providers", () => {
    const adapted = scoringRunCandidateToEvidenceMetadata({
      reportCode: "abc",
      fightId: 9,
      reportRevision: 2,
      dungeonSlug: "Skyreach",
      keyLevel: 15,
      timed: true,
      completedAt: "2026-07-01T12:00:00.000Z",
      durationMs: 1_000_000,
      scoreValue: 410,
      hasWclSource: true,
    });
    expect(adapted).not.toBeNull();
    expect(adapted!.dungeonSlug).toBe("skyreach");
    expect(adapted!.discoveryIdentity).toEqual({ reportCode: "abc", fightId: 9 });
  });

  it("recomputes plan and manifest hashes from content-hash inputs", () => {
    const { plan, manifest } = planAndFinalize(
      [candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 16 })],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );

    const planHashInput = buildEvidenceAcquisitionPlanContentHashInput({
      selectorVersion: plan.selectorVersion,
      characterId: plan.characterId,
      seasonId: plan.seasonId,
      seasonSlug: plan.seasonSlug,
      classSlug: plan.classSlug ?? null,
      specSlug: plan.specSlug,
      role: plan.role,
      refreshContractHash: plan.refreshContractHash,
      evidenceCutoffAt: plan.evidenceCutoffAt,
      highKeyPolicyId: plan.highKeyPolicyId,
      activeDungeonSlugs: plan.activeDungeonSlugs,
      expectedSlotCount: plan.expectedSlotCount,
      slots: [...plan.slots],
      rejectedCandidates: [...plan.rejectedCandidates],
    });
    expect(computeEvidenceAcquisitionPlanContentHash(planHashInput)).toBe(plan.contentHash);

    const manifestHashInput = buildEvidenceManifestContentHashInput({
      selectorVersion: manifest.selectorVersion,
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      seasonSlug: manifest.seasonSlug,
      classSlug: manifest.classSlug ?? null,
      specSlug: manifest.specSlug,
      role: manifest.role,
      refreshContractHash: manifest.refreshContractHash,
      evidenceCutoffAt: manifest.evidenceCutoffAt,
      highKeyPolicyId: manifest.highKeyPolicyId,
      activeDungeonSlugs: manifest.activeDungeonSlugs,
      expectedSlotCount: manifest.expectedSlotCount,
      selectedSlotCount: manifest.selectedSlotCount,
      acquisitionPlanContentHash: manifest.acquisitionPlanContentHash,
      slots: [...manifest.slots],
      rejectedCandidates: [...manifest.rejectedCandidates],
      coverage: { ...manifest.coverage },
    });
    expect(computeEvidenceManifestContentHash(manifestHashInput)).toBe(manifest.contentHash);
  });

  it("keeps timed=null eligible and only uses timer quality as a secondary tie-break", () => {
    const { plan, manifest } = planAndFinalize(
      [
        candidate({
          reportCode: "unknown-timed-higher-key",
          fightId: 2,
          dungeonSlug: "skyreach",
          keyLevel: 19,
          timed: null,
        }),
        candidate({
          reportCode: "timed-ok",
          fightId: 3,
          dungeonSlug: "skyreach",
          keyLevel: 18,
          timed: true,
        }),
        candidate({
          reportCode: "untimed-high",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 20,
          timed: false,
        }),
        candidate({
          reportCode: "timed-ok-2",
          fightId: 4,
          dungeonSlug: "skyreach",
          keyLevel: 17,
          timed: true,
        }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );

    expect(plan.rejectedCandidates.map((r) => r.reason)).not.toEqual(
      expect.arrayContaining(["UNTIMED_RUN", "TIMED_STATE_UNKNOWN"]),
    );
    expect(manifest.selectedSlotCount).toBe(2);
    expect(manifest.slots.map((s) => s.identity?.reportCode)).toEqual([
      "untimed-high",
      "unknown-timed-higher-key",
    ]);
  });

  it("never lets timer state outrank a higher key", () => {
    const highUnknown = candidate({
      reportCode: "high-unknown",
      fightId: 1,
      dungeonSlug: "skyreach",
      keyLevel: 16,
      timed: null,
    });
    const lowTimed = candidate({
      reportCode: "low-timed",
      fightId: 2,
      dungeonSlug: "skyreach",
      keyLevel: 15,
      timed: true,
    });
    expect(compareEvidenceCandidatesV2(highUnknown, lowTimed)).toBeLessThan(0);
  });

  it("falls back past private candidates to fill two slots", () => {
    const { plan, manifest } = planAndFinalize(
      [
        candidate({
          reportCode: "private",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 22,
          accessState: "PRIVATE_OR_HIDDEN",
        }),
        candidate({
          reportCode: "public-a",
          fightId: 3,
          dungeonSlug: "skyreach",
          keyLevel: 16,
        }),
        candidate({
          reportCode: "public-b",
          fightId: 4,
          dungeonSlug: "skyreach",
          keyLevel: 15,
        }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );

    expect(plan.rejectedCandidates.map((r) => r.reason)).toEqual(
      expect.arrayContaining(["PRIVATE_OR_HIDDEN"]),
    );
    expect(manifest.selectedSlotCount).toBe(2);
    expect(manifest.slots[0]!.identity?.reportCode).toBe("public-a");
    expect(manifest.slots[1]!.identity?.reportCode).toBe("public-b");
  });

  it("slot 1 falls back after slot 0 selects the highest candidate", () => {
    const { manifest } = planAndFinalize(
      [
        candidate({ reportCode: "best", fightId: 1, dungeonSlug: "skyreach", keyLevel: 18 }),
        candidate({ reportCode: "second", fightId: 2, dungeonSlug: "skyreach", keyLevel: 16 }),
        candidate({ reportCode: "third", fightId: 3, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );
    expect(manifest.slots[0]!.identity).toEqual({
      reportCode: "best",
      fightId: 1,
      reportRevision: 1,
    });
    expect(manifest.slots[1]!.identity).toEqual({
      reportCode: "second",
      fightId: 2,
      reportRevision: 1,
    });
  });

  it("same reportCode+fightId cannot occupy both slots", () => {
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope: baseScope({ activeDungeonSlugs: ["skyreach"] }),
      candidates: [
        candidate({ reportCode: "only", fightId: 1, dungeonSlug: "skyreach", keyLevel: 18 }),
        candidate({ reportCode: "only", fightId: 1, dungeonSlug: "skyreach", keyLevel: 18 }),
        candidate({ reportCode: "other", fightId: 2, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      plannedAt: "2026-08-01T11:00:00.000Z",
    });
    const results = acquireAllFromPlan(plan);
    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults: results,
      selectedAt: "2026-08-01T12:00:00.000Z",
    });
    const identities = manifest.slots
      .filter((s) => s.state === "SELECTED")
      .map((s) => `${s.identity!.reportCode}:${s.identity!.fightId}`);
    expect(new Set(identities).size).toBe(identities.length);
    expect(identities).toEqual(["only:1", "other:2"]);
  });

  it("preserves candidate rejection chain when fallback is exhausted", () => {
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope: baseScope({ activeDungeonSlugs: ["skyreach"] }),
      candidates: [
        candidate({ reportCode: "a", fightId: 1, dungeonSlug: "skyreach", keyLevel: 18 }),
        candidate({ reportCode: "b", fightId: 2, dungeonSlug: "skyreach", keyLevel: 14 }),
      ],
      plannedAt: "2026-08-01T11:00:00.000Z",
    });
    const results = [
      {
        discoveryIdentity: { reportCode: "a", fightId: 1 },
        acquisitionStatus: "REJECTED" as const,
        reportRevision: null,
        rejectionReason: "TARGET_NOT_IN_FIGHT" as const,
        rejectionDetail: "actor absent from friendlyPlayers",
        datasetHashes: [],
        factSetHash: null,
        dimensionValidity: null,
        keyLevel: 18,
        timed: true,
      },
      {
        discoveryIdentity: { reportCode: "b", fightId: 2 },
        acquisitionStatus: "REJECTED" as const,
        reportRevision: null,
        rejectionReason: "ARCHIVED_OR_GATED" as const,
        rejectionDetail: "archived",
        datasetHashes: [],
        factSetHash: null,
        dimensionValidity: null,
        keyLevel: 14,
        timed: true,
      },
    ];
    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults: results,
      selectedAt: "2026-08-01T12:00:00.000Z",
    });
    expect(manifest.selectedSlotCount).toBe(0);
    expect(manifest.coverage.state).toBe("INSUFFICIENT");
    expect(manifest.rejectedCandidates.map((r) => r.reason)).toEqual(
      expect.arrayContaining(["TARGET_NOT_IN_FIGHT", "ARCHIVED_OR_GATED", "FALLBACK_EXHAUSTED"]),
    );
    const exhausted = manifest.rejectedCandidates.find((r) => r.reason === "FALLBACK_EXHAUSTED");
    expect(exhausted?.detail).toMatch(/TARGET_NOT_IN_FIGHT/);
    expect(exhausted?.detail).toMatch(/ARCHIVED_OR_GATED/);
  });

  it("reports insufficient eligible evidence without inventing slots", () => {
    const { manifest } = planAndFinalize(
      [
        candidate({
          reportCode: "only-one",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 14,
        }),
      ],
      { scope: baseScope({ activeDungeonSlugs: ["skyreach"] }) },
    );

    expect(manifest.selectedSlotCount).toBe(1);
    expect(manifest.slots[0]!.state).toBe("SELECTED");
    expect(manifest.slots[1]!.state).not.toBe("SELECTED");
    // 1/2 slots on a single dungeon is honest PARTIAL coverage (contract thresholds).
    expect(manifest.coverage.state).toBe("PARTIAL");
    expect(manifest.coverage.selectedSlotCount).toBe(1);
    expect(manifest.expectedSlotCount).toBe(2);
  });
});
