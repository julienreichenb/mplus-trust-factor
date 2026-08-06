import { describe, expect, it, vi } from "vitest";
import {
  OBS_EVENTS,
  emitScoringEvent,
  getMetricsRegistry,
  resetMetricsRegistry,
} from "@mplus/observability";
import { runAnalyzeEvidenceSlotV2 } from "./slot-processor.js";

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    analysisBatchId: "batch-1",
    slotId: "slot-1",
    acquisitionPlanContentHash: "plan",
    refreshGeneration: 1,
    correlationId: "corr-1",
    ...overrides,
  };
}

describe("slot-processor terminal lifecycle events", () => {
  it("emits exactly one unavailable terminal event for empty candidates", async () => {
    resetMetricsRegistry();
    const info = vi.fn();
    const completeSlot = vi.fn().mockResolvedValue({ becameReady: false });
    const container = {
      env: {
        SCORING_ENABLED: true,
        SCORING_PUBLICATION_ENABLED: false,
      },
      logger: { info, warn: vi.fn(), error: vi.fn() },
      prisma: { character: { findUnique: vi.fn() } },
      repositories: {
        evidenceV2Batch: {
          getById: vi.fn().mockResolvedValue({
            meta: {
              acquisitionPlanContentHash: "plan",
              acquisitionPlan: {
                expectedSlotCount: 1,
                slots: [{ slotId: "slot-1", orderedCandidates: [], provisionalMissingState: null }],
              },
            },
            batch: { characterId: "c1" },
          }),
          claimSlot: vi.fn().mockResolvedValue({
            outcome: "claimed",
            view: {
              batch: { characterId: "c1" },
              meta: {
                acquisitionPlanContentHash: "plan",
                acquisitionPlan: {
                  expectedSlotCount: 1,
                  slots: [
                    { slotId: "slot-1", orderedCandidates: [], provisionalMissingState: null },
                  ],
                },
              },
            },
          }),
          completeSlot,
        },
      },
    };

    const result = await runAnalyzeEvidenceSlotV2(container as never, baseJob() as never, {
      enqueueFinalizeEvidenceBatch: vi.fn(),
    });
    expect(result.status).toBe("UNAVAILABLE");
    const terminal = info.mock.calls.filter(
      (c) => (c[0] as { event?: string }).event === OBS_EVENTS.scoringSlotCompleted,
    );
    expect(terminal).toHaveLength(1);
    expect((terminal[0]![0] as { status: string }).status).toBe("UNAVAILABLE");
    expect(getMetricsRegistry().toPrometheusText()).toMatch(/unavailable/);
  });

  it("emits exactly one failed terminal event for missing slot plan", async () => {
    resetMetricsRegistry();
    const info = vi.fn();
    const error = vi.fn();
    const container = {
      env: {
        SCORING_ENABLED: true,
        SCORING_PUBLICATION_ENABLED: false,
      },
      logger: { info, warn: vi.fn(), error },
      repositories: {
        evidenceV2Batch: {
          getById: vi.fn().mockResolvedValue({
            meta: { acquisitionPlanContentHash: "plan", acquisitionPlan: { slots: [] } },
            batch: { characterId: "c1" },
          }),
          claimSlot: vi.fn().mockResolvedValue({
            outcome: "claimed",
            view: {
              batch: { characterId: "c1" },
              meta: {
                acquisitionPlanContentHash: "plan",
                acquisitionPlan: { slots: [] },
              },
            },
          }),
          completeSlot: vi.fn().mockResolvedValue({ becameReady: false }),
        },
      },
    };

    await runAnalyzeEvidenceSlotV2(container as never, baseJob() as never, {
      enqueueFinalizeEvidenceBatch: vi.fn(),
    });
    const failed = error.mock.calls.filter(
      (c) => (c[0] as { event?: string }).event === OBS_EVENTS.scoringSlotFailed,
    );
    expect(failed).toHaveLength(1);
    expect((failed[0]![0] as { reason: string }).reason).toBe("SLOT_PLAN_MISSING");
  });

  it("does not emit terminal events on already_terminal redelivery", async () => {
    const info = vi.fn();
    const container = {
      env: {
        SCORING_ENABLED: true,
        SCORING_PUBLICATION_ENABLED: false,
      },
      logger: { info, warn: vi.fn(), error: vi.fn() },
      repositories: {
        evidenceV2Batch: {
          getById: vi.fn().mockResolvedValue({
            meta: { acquisitionPlanContentHash: "plan" },
          }),
          claimSlot: vi.fn().mockResolvedValue({
            outcome: "already_terminal",
            view: {
              meta: { slots: [{ slotId: "slot-1", status: "SUCCEEDED" }] },
            },
          }),
        },
      },
    };
    const result = await runAnalyzeEvidenceSlotV2(container as never, baseJob() as never, {
      enqueueFinalizeEvidenceBatch: vi.fn(),
    });
    expect(result.outcome).toBe("terminal_redelivery_noop");
    expect(info).not.toHaveBeenCalled();
  });

  it("telemetry logger failures do not fail the slot job after terminal persistence", async () => {
    const completeSlot = vi.fn().mockResolvedValue({ becameReady: false });
    const container = {
      env: {
        SCORING_ENABLED: true,
        SCORING_PUBLICATION_ENABLED: false,
      },
      logger: {
        info: () => {
          throw new Error("logger_boom");
        },
        warn: vi.fn(),
        error: () => {
          throw new Error("logger_boom");
        },
      },
      repositories: {
        evidenceV2Batch: {
          getById: vi.fn().mockResolvedValue({
            meta: {
              acquisitionPlanContentHash: "plan",
              acquisitionPlan: { slots: [] },
            },
            batch: { characterId: "c1" },
          }),
          claimSlot: vi.fn().mockResolvedValue({
            outcome: "claimed",
            view: {
              batch: { characterId: "c1" },
              meta: {
                acquisitionPlanContentHash: "plan",
                acquisitionPlan: { slots: [] },
              },
            },
          }),
          completeSlot,
        },
      },
    };

    await expect(
      runAnalyzeEvidenceSlotV2(container as never, baseJob() as never, {
        enqueueFinalizeEvidenceBatch: vi.fn(),
      }),
    ).resolves.toMatchObject({ outcome: "slot_plan_missing" });
    expect(completeSlot).toHaveBeenCalled();
    // prove emit helper itself is safe
    expect(() =>
      emitScoringEvent(container.logger, OBS_EVENTS.scoringSlotFailed, { reason: "x" }, "error"),
    ).not.toThrow();
  });
});
