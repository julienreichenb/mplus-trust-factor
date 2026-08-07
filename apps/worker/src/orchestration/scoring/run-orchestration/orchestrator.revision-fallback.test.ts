/**
 * Cold-path report revision: hydrate via resolveReportRevision, reject with
 * REPORT_REVISION_UNRESOLVED, and fall back to the next ranked candidate —
 * never abort the whole character for one unresolved report.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  expectedEvidenceSlotCount,
  type EvidenceCandidateMetadataV2,
  type EvidenceSelectionScope,
} from "@mplus/contracts";
import { createMemoryOrchestrationPorts } from "./memory-ports.js";
import { orchestrateScoringRuns } from "./orchestrator.js";

const CHAR_ID = "char-revision-fallback";
const DUNGEON = "skyreach";

function scope(
  overrides?: Partial<EvidenceSelectionScope>,
): EvidenceSelectionScope {
  return {
    characterId: CHAR_ID,
    seasonId: "season-1",
    seasonSlug: "season-tww-3",
    role: "DPS",
    classSlug: "mage",
    specSlug: "arcane",
    specializationId: null,
    activeDungeonSlugs: [DUNGEON],
    evidenceCutoffAt: "2026-12-31T00:00:00.000Z",
    highKeyPolicyId: "high-key-policy-v1",
    refreshContractHash: "revision-fallback-test",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<EvidenceCandidateMetadataV2> & {
    reportCode: string;
    fightId: number;
    keyLevel: number;
  },
): EvidenceCandidateMetadataV2 {
  const { reportCode, fightId, keyLevel, ...rest } = overrides;
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision: rest.reportRevision !== undefined ? rest.reportRevision : null,
    dungeonSlug: DUNGEON,
    keyLevel,
    timed: rest.timed !== undefined ? rest.timed : true,
    runScore: rest.runScore !== undefined ? rest.runScore : 400,
    evidenceCompleteness: rest.evidenceCompleteness ?? 0.5,
    completedAt: rest.completedAt ?? "2026-07-01T12:00:00.000Z",
    fightDurationMs: rest.fightDurationMs ?? 1_800_000,
    actorId: rest.actorId ?? 1,
    accessState: rest.accessState ?? "PUBLIC",
    identityResolution: rest.identityResolution ?? "RESOLVED",
    fightAccessible: rest.fightAccessible ?? true,
    hardError: rest.hardError ?? false,
  };
}

describe("orchestrateScoringRuns report-revision resolve + fallback", () => {
  it("resolves revision via WCL hydration then acquires the candidate", async () => {
    const ports = createMemoryOrchestrationPorts();
    const resolveReportRevision = vi.fn(async () => ({
      reportRevision: 7,
      providerCalls: 1,
    }));
    ports.resolveReportRevision = resolveReportRevision;

    const result = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: scope(),
      candidates: [
        candidate({
          reportCode: "jCWxQFPV7tHpgXah",
          fightId: 1,
          keyLevel: 22,
          reportRevision: null,
        }),
        candidate({
          reportCode: "fallbackCode01",
          fightId: 2,
          keyLevel: 20,
          reportRevision: null,
        }),
      ],
      ports,
      plannedAt: "2026-08-01T11:00:00.000Z",
      selectedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(resolveReportRevision).toHaveBeenCalled();
    expect(resolveReportRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        reportCode: "jCWxQFPV7tHpgXah",
        fightId: 1,
      }),
    );
    const slot0 = result.manifest.slots.find((s) => s.slotIndex === 0);
    expect(slot0?.state).toBe("SELECTED");
    expect(slot0?.identity).toEqual({
      reportCode: "jCWxQFPV7tHpgXah",
      fightId: 1,
      reportRevision: 7,
    });
    expect(result.accounting.providerCalls).toBeGreaterThanOrEqual(1);
  });

  it("rejects candidate #1 with REPORT_REVISION_UNRESOLVED and selects #2", async () => {
    const ports = createMemoryOrchestrationPorts();
    ports.resolveReportRevision = vi.fn(async (input) => {
      if (input.reportCode === "jCWxQFPV7tHpgXah" && input.fightId === 1) {
        return null;
      }
      if (input.reportCode === "secondValid01" && input.fightId === 2) {
        return { reportRevision: 3, providerCalls: 1 };
      }
      return null;
    });

    const result = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: scope(),
      candidates: [
        candidate({
          reportCode: "jCWxQFPV7tHpgXah",
          fightId: 1,
          keyLevel: 22,
          reportRevision: null,
        }),
        candidate({
          reportCode: "secondValid01",
          fightId: 2,
          keyLevel: 20,
          reportRevision: null,
        }),
      ],
      ports,
      plannedAt: "2026-08-01T11:00:00.000Z",
      selectedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(result.manifest.rejectedCandidates.some(
      (r) =>
        r.reason === "REPORT_REVISION_UNRESOLVED" &&
        r.reportCode === "jCWxQFPV7tHpgXah" &&
        r.fightId === 1,
    )).toBe(true);

    const slot0 = result.manifest.slots.find((s) => s.slotIndex === 0);
    expect(slot0?.state).toBe("SELECTED");
    expect(slot0?.identity).toEqual({
      reportCode: "secondValid01",
      fightId: 2,
      reportRevision: 3,
    });
    expect(slot0?.selectedRank).toBeGreaterThan(0);
    expect(slot0?.fallbackReason).toBe("REPORT_REVISION_UNRESOLVED");
  });

  it("exhausts candidates without fabricating a revision or aborting", async () => {
    const ports = createMemoryOrchestrationPorts();
    ports.resolveReportRevision = vi.fn(async () => null);

    const result = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: scope(),
      candidates: [
        candidate({
          reportCode: "jCWxQFPV7tHpgXah",
          fightId: 1,
          keyLevel: 22,
          reportRevision: null,
        }),
        candidate({
          reportCode: "alsoBroken02",
          fightId: 2,
          keyLevel: 20,
          reportRevision: null,
        }),
      ],
      ports,
      plannedAt: "2026-08-01T11:00:00.000Z",
      selectedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(result.incomplete).toBe(true);
    expect(result.selectedSlotCount).toBe(0);
    expect(result.expectedSlotCount).toBe(expectedEvidenceSlotCount(1));
    for (const slot of result.manifest.slots) {
      expect(slot.state).not.toBe("SELECTED");
      expect(slot.identity).toBeNull();
    }
    expect(
      result.manifest.rejectedCandidates.filter(
        (r) => r.reason === "REPORT_REVISION_UNRESOLVED",
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      result.manifest.rejectedCandidates.some((r) => r.reason === "FALLBACK_EXHAUSTED"),
    ).toBe(true);
  });

  it("does not call resolve when candidate metadata already has revision", async () => {
    const ports = createMemoryOrchestrationPorts();
    const resolveReportRevision = vi.fn(async () => ({
      reportRevision: 99,
      providerCalls: 1,
    }));
    ports.resolveReportRevision = resolveReportRevision;

    const result = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: scope(),
      candidates: [
        candidate({
          reportCode: "knownRev01",
          fightId: 1,
          keyLevel: 22,
          reportRevision: 4,
        }),
      ],
      ports,
      plannedAt: "2026-08-01T11:00:00.000Z",
      selectedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(resolveReportRevision).not.toHaveBeenCalled();
    expect(result.manifest.slots[0]?.identity?.reportRevision).toBe(4);
  });
});
