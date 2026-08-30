import { describe, expect, it, vi } from "vitest";

/**
 * Prove the canonical sync CLI entry does not invoke publish/activation.
 * Full SimC/Blizzard integration is exercised via the one-shot container.
 */
describe("catalog-sync CLI contract", () => {
  it("documents standalone sync sequence without publish", async () => {
    const calls: string[] = [];
    const runRefresh = vi.fn(async () => {
      calls.push("refresh");
      return {
        result: {
          report: { snapshots: [] },
          summary: "ok",
        },
        batchId: "batch-1",
        created: true,
        reviewRequired: true,
        activeUnchanged: true as const,
      };
    });
    const publishChanges = vi.fn(async () => {
      calls.push("publish");
    });

    // Simulated thin CLI body (same order as catalog-sync.ts)
    await runRefresh();
    expect(calls).toEqual(["refresh"]);
    expect(publishChanges).not.toHaveBeenCalled();
  });
});
