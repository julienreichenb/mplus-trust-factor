import { describe, expect, it, vi } from "vitest";
import { attachRankingSnapshot } from "./attach-ranking-snapshot.js";

const V1 = "wcl-fight-rankings-v1";
const V2 = "wcl-fight-ranking-v2-ui-key-percent";

function rawPrisma(opts: {
  v2?: { id: string; contentHash: string; entries: unknown[] } | null;
  any?: { id: string; contentHash: string; rankingAcquisitionVersion: string; entries: unknown[] } | null;
}) {
  return {
    wclRunRaw: {
      findMany: vi.fn(async () => [
        {
          id: "raw-1",
          reportCode: "LJc9kp2HP4gfBv6x",
          fightId: 5,
          reportRevision: 2,
          acquisitionVersion: "capability-acquisition-plan-v2",
        },
      ]),
    },
    wclFightRankingSnapshot: {
      findFirst: vi.fn(async ({ where }: { where: { rankingAcquisitionVersion?: string } }) => {
        if (where.rankingAcquisitionVersion === V2) return opts.v2 ?? null;
        if (!where.rankingAcquisitionVersion) return opts.any ?? opts.v2 ?? null;
        return null;
      }),
    },
  };
}

describe("attachRankingSnapshot semantic compatibility", () => {
  it("loads subject + peers from one v2 snapshot including bracketPercent 0", async () => {
    const prisma = rawPrisma({
      v2: {
        id: "snap-v2",
        contentHash: "h2",
        entries: [
          { reportActorId: 4, wclCharacterId: 1, name: "Own", bracketPercent: 0, rankPercent: 99, role: "dps" },
          { reportActorId: 1, wclCharacterId: 2, name: "Fazo", bracketPercent: 82, rankPercent: 99, role: "dps" },
          { reportActorId: 84, wclCharacterId: 3, name: "Eskaonlypma", bracketPercent: 96, rankPercent: 99, role: "dps" },
          { reportActorId: 6, wclCharacterId: 4, name: "Nrzy", bracketPercent: 99, rankPercent: 99, role: "tanks" },
          { reportActorId: 2, wclCharacterId: 5, name: "Spinxd", bracketPercent: 95, rankPercent: 99, role: "healers" },
        ],
      },
    });
    const out = await attachRankingSnapshot({
      prisma: prisma as never,
      reportCode: "LJc9kp2HP4gfBv6x",
      fightId: 5,
      reportRevision: 2,
      subjectActorId: 4,
    });
    expect(out.missingReason).toBeNull();
    expect(out.rankingSnapshotId).toBe("snap-v2");
    expect(out.subjectKeyParse).toBe(0);
    expect(out.peerKeyParses.map((p) => p.keyParse).sort((a, b) => a - b)).toEqual([82, 95, 96, 99]);
    expect(out.peerKeyParses.every((p) => p.keyParse !== 99 || p.displayName === "Nrzy")).toBe(true);
  });

  it("never uses rankPercent as Key % when bracketPercent is missing", async () => {
    const prisma = rawPrisma({
      v2: {
        id: "snap-v2",
        contentHash: "h2",
        entries: [{ reportActorId: 4, wclCharacterId: 1, name: "Own", bracketPercent: null, rankPercent: 99, role: "dps" }],
      },
    });
    const out = await attachRankingSnapshot({
      prisma: prisma as never,
      reportCode: "LJc9kp2HP4gfBv6x",
      fightId: 5,
      reportRevision: 2,
      subjectActorId: 4,
    });
    expect(out.subjectKeyParse).toBeNull();
    expect(out.missingReason).toBe("SUBJECT_BRACKET_PERCENT_MISSING");
  });

  it("marks v1-only snapshots incompatible instead of using latest fetchedAt", async () => {
    const prisma = rawPrisma({
      v2: null,
      any: {
        id: "snap-v1",
        contentHash: "h1",
        rankingAcquisitionVersion: V1,
        entries: [{ reportActorId: 4, name: "Own", bracketPercent: 94, rankPercent: 99 }],
      },
    });
    const out = await attachRankingSnapshot({
      prisma: prisma as never,
      reportCode: "LJc9kp2HP4gfBv6x",
      fightId: 5,
      reportRevision: 2,
      subjectActorId: 4,
    });
    expect(out.rankingSnapshotId).toBeNull();
    expect(out.subjectKeyParse).toBeNull();
    expect(out.missingReason).toBe("INCOMPATIBLE_RANKING_SEMANTIC");
  });
});
