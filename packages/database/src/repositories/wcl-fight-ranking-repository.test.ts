import { describe, expect, it, vi } from "vitest";
import {
  rankingSnapshotContentHash,
  WclFightRankingRepository,
} from "./wcl-fight-ranking-repository.js";

describe("WclFightRankingRepository snapshots", () => {
  it("keeps bracketPercent 0 in the content hash", () => {
    const hashZero = rankingSnapshotContentHash([
      { reportActorId: 4, name: "Own", bracketPercent: 0, rankPercent: 99 },
    ]);
    const hashMissing = rankingSnapshotContentHash([
      { reportActorId: 4, name: "Own", bracketPercent: null, rankPercent: 99 },
    ]);
    expect(hashZero).not.toBe(hashMissing);
  });

  it("reuses an identical snapshot instead of overwriting", async () => {
    const existing = {
      id: "snap-1",
      rawRunId: "raw-1",
      contentHash: rankingSnapshotContentHash([
        { reportActorId: 4, name: "Own", bracketPercent: 0 },
      ]),
      entries: [{ reportActorId: 4, bracketPercent: 0 }],
    };
    const create = vi.fn();
    const prisma = {
      wclFightRankingSnapshot: {
        findUnique: vi.fn(async () => existing),
        create,
      },
    };
    const repo = new WclFightRankingRepository(prisma as never);
    const out = await repo.insertSnapshotIfNew({
      rawRunId: "raw-1",
      rows: [{ reportActorId: 4, name: "Own", bracketPercent: 0 }],
    });
    expect(out.created).toBe(false);
    expect(out.snapshot.id).toBe("snap-1");
    expect(create).not.toHaveBeenCalled();
  });

  it("does not treat latest v1 snapshot as current-compatible", async () => {
    const findFirst = vi.fn(async ({ where }: { where: { rankingAcquisitionVersion?: string } }) => {
      if (where.rankingAcquisitionVersion === "wcl-fight-ranking-v2-ui-key-percent") return null;
      return { id: "v1", rankingAcquisitionVersion: "wcl-fight-rankings-v1", entries: [] };
    });
    const prisma = { wclFightRankingSnapshot: { findFirst } };
    const repo = new WclFightRankingRepository(prisma as never);
    const compatible = await repo.findLatestSnapshotForRawRun("raw-1");
    expect(compatible).toBeNull();
    const any = await repo.findLatestSnapshotAnyVersion("raw-1");
    expect(any?.id).toBe("v1");
  });

  it("hashes rankingAcquisitionVersion so v1 and v2 with the same percents are distinct", () => {
    const rows = [{ reportActorId: 4, name: "Own", bracketPercent: 0, rankPercent: 99 }];
    expect(rankingSnapshotContentHash(rows, "wcl-fight-rankings-v1")).not.toBe(
      rankingSnapshotContentHash(rows, "wcl-fight-ranking-v2-ui-key-percent"),
    );
  });

  it("inserts a new snapshot when bracketPercent changes", async () => {
    const create = vi.fn(async ({ data }: { data: { contentHash: string } }) => ({
      id: "snap-2",
      ...data,
      entries: [],
    }));
    const prisma = {
      wclFightRankingSnapshot: {
        findUnique: vi.fn(async () => null),
        create,
      },
    };
    const repo = new WclFightRankingRepository(prisma as never);
    const first = await repo.insertSnapshotIfNew({
      rawRunId: "raw-1",
      rows: [{ reportActorId: 4, name: "Own", bracketPercent: 0 }],
    });
    expect(first.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
