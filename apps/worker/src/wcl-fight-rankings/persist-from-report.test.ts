import { describe, expect, it, vi } from "vitest";
import { persistWclFightRankingsFromReport } from "./persist-from-report.js";

const RANKINGS = {
  data: [
    {
      fightID: 5,
      roles: {
        dps: {
          characters: [
            {
              id: 8693457,
              name: "Own",
              server: { name: "Ravencrest" },
              spec: "Frost",
              class: "Mage",
              rankPercent: 99,
              bracketPercent: 0,
            },
            {
              id: 111,
              name: "Peer",
              server: { name: "Ravencrest" },
              spec: "Havoc",
              class: "DemonHunter",
              rankPercent: 88,
              bracketPercent: 85,
            },
          ],
        },
      },
    },
  ],
};

describe("persistWclFightRankingsFromReport", () => {
  it("skips when rankings is null without writing", async () => {
    const prisma = {
      wclFightRankingSnapshot: { findUnique: vi.fn(), create: vi.fn() },
    };
    const out = await persistWclFightRankingsFromReport({
      prisma: prisma as never,
      rawRunId: "raw-1",
      rankings: null,
      masterData: { actors: [] },
      friendlyPlayers: [4],
    });
    expect(out.status).toBe("skipped");
    expect(prisma.wclFightRankingSnapshot.create).not.toHaveBeenCalled();
  });

  it("persists bracketPercent 0 on a new snapshot without substituting rankPercent", async () => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      wclFightRankingSnapshot: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { entries: { create: Array<Record<string, unknown>> }; rankingAcquisitionVersion: string } }) => {
          created.push(...data.entries.create);
          return { id: "snap-1", contentHash: "h", rankingAcquisitionVersion: data.rankingAcquisitionVersion, entries: data.entries.create };
        }),
      },
    };
    const out = await persistWclFightRankingsFromReport({
      prisma: prisma as never,
      rawRunId: "raw-1",
      rankings: RANKINGS,
      masterData: {
        actors: [
          { id: 4, name: "Own", type: "Player", server: "Ravencrest" },
          { id: 7, name: "Peer", type: "Player", server: "Ravencrest" },
        ],
      },
      friendlyPlayers: [4, 7],
      fightId: 5,
    });
    expect(out.status).toBe("persisted");
    expect(out.created).toBe(true);
    const own = created.find((r) => r.reportActorId === 4);
    expect(own?.bracketPercent).toBe(0);
    expect(own?.rankPercent).toBe(99);
    expect(own?.wclCharacterId).toBe(8693457);
    expect(prisma.wclFightRankingSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rankingAcquisitionVersion: "wcl-fight-ranking-v2-ui-key-percent",
        }),
      }),
    );
  });
});
