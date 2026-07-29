import { describe, expect, it, beforeEach } from "vitest";
import {
  recordProfileViewAggregated,
  resetProfileViewMemoryRateLimit,
  hashViewerIdentity,
} from "./profile-view-recorder.js";

describe("profile view recorder", () => {
  beforeEach(() => {
    resetProfileViewMemoryRateLimit();
  });

  it("aggregates repeated views into one row window (no per-hit inserts)", async () => {
    const creates: unknown[] = [];
    const updates: unknown[] = [];
    let existing: { id: string } | null = null;

    const prisma = {
      characterProfileView: {
        findFirst: async () => existing,
        create: async ({ data }: { data: unknown }) => {
          creates.push(data);
          existing = { id: "v1" };
          return existing;
        },
        update: async ({ data }: { data: unknown }) => {
          updates.push(data);
          return { id: "v1" };
        },
      },
    };

    const first = await recordProfileViewAggregated(prisma as never, {
      characterId: "c1",
      viewerHash: hashViewerIdentity("10.0.0.1"),
      nowMs: 1_000_000,
      coalesceWindowMs: 3_600_000,
    });
    expect(first.created).toBe(true);
    expect(creates).toHaveLength(1);

    // Within memory rate limit — no DB write.
    const second = await recordProfileViewAggregated(prisma as never, {
      characterId: "c1",
      viewerHash: hashViewerIdentity("10.0.0.1"),
      nowMs: 1_000_000 + 5_000,
    });
    expect(second.reason).toBe("memory_rate_limited");
    expect(creates).toHaveLength(1);
    expect(updates).toHaveLength(0);

    // After memory window, coalesce updates existing row.
    const third = await recordProfileViewAggregated(prisma as never, {
      characterId: "c1",
      viewerHash: hashViewerIdentity("10.0.0.1"),
      nowMs: 1_000_000 + 60_000,
      coalesceWindowMs: 3_600_000,
    });
    expect(third.reason).toBe("coalesced_update");
    expect(creates).toHaveLength(1);
    expect(updates).toHaveLength(1);
  });

  it("hashes viewer identity for abuse-resistant bucketing", () => {
    const a = hashViewerIdentity("user-agent+ip");
    const b = hashViewerIdentity("user-agent+ip");
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });
});
