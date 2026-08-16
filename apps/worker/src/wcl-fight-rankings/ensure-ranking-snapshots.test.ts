import { describe, expect, it, vi } from "vitest";
import { CAPABILITY_ACQUISITION_PLAN_VERSION } from "@mplus/contracts";
import { WCL_FIGHT_RANKING_ACQUISITION_VERSION, WCL_FIGHT_RANKING_LEGACY_ACQUISITION_VERSION } from "@mplus/database";
import {
  ensureRankingSnapshotsForIdentities,
  uniqueRankingIdentities,
} from "./ensure-ranking-snapshots.js";

const ACQ = CAPABILITY_ACQUISITION_PLAN_VERSION;

const RANKINGS = {
  data: [
    {
      fightID: 8,
      roles: {
        dps: {
          characters: [
            {
              id: 1,
              name: "Veryalive",
              server: { name: "TarrenMill" },
              spec: "Frost",
              class: "Mage",
              rankPercent: 40,
              bracketPercent: 12,
            },
          ],
        },
      },
    },
  ],
};

const MASTER = {
  actors: [{ id: 4, name: "Veryalive", type: "Player", server: "TarrenMill" }],
};

function identity(reportCode = "HGN1B4QbKntwCMaV", fightId = 8, reportRevision: number | null = 3) {
  return { reportCode, fightId, reportRevision };
}

function prismaMock(opts: {
  raws: Array<Record<string, unknown>>;
  v2Snapshot?: { id: string } | null;
  v1Snapshot?: { id: string } | null;
}) {
  const created: Array<Record<string, unknown>> = [];
  const snapshots = [
    ...(opts.v1Snapshot
      ? [{ ...opts.v1Snapshot, rankingAcquisitionVersion: WCL_FIGHT_RANKING_LEGACY_ACQUISITION_VERSION }]
      : []),
    ...(opts.v2Snapshot
      ? [{ ...opts.v2Snapshot, rankingAcquisitionVersion: WCL_FIGHT_RANKING_ACQUISITION_VERSION }]
      : []),
  ];
  const prisma = {
    raws: opts.raws,
    created,
    wclRunRaw: {
      findMany: async ({ where }: { where: { reportCode: string; fightId: number } }) =>
        opts.raws.filter((r) => r.reportCode === where.reportCode && r.fightId === where.fightId),
    },
    wclFightRankingSnapshot: {
      findFirst: async ({
        where,
      }: {
        where: { rawRunId: string; rankingAcquisitionVersion?: string };
      }) => {
        return (
          snapshots.find((s) => {
            if (s.rawRunId !== where.rawRunId) return false;
            if (where.rankingAcquisitionVersion) {
              return s.rankingAcquisitionVersion === where.rankingAcquisitionVersion;
            }
            return true;
          }) ?? null
        );
      },
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        const row = {
          id: `snap-new-${created.length}`,
          ...data,
          entries: (data.entries as { create: unknown[] })?.create ?? [],
        };
        snapshots.push({
          id: row.id,
          rawRunId: data.rawRunId as string,
          rankingAcquisitionVersion: data.rankingAcquisitionVersion as string,
        });
        return row;
      },
    },
  };
  return prisma;
}

describe("ensureRankingSnapshotsForIdentities", () => {
  it("issues zero provider calls when a compatible v2 snapshot already exists", async () => {
    const fetchReport = vi.fn();
    const prisma = prismaMock({
      raws: [
        {
          id: "raw-1",
          reportCode: "HGN1B4QbKntwCMaV",
          fightId: 8,
          reportRevision: 3,
          acquisitionVersion: ACQ,
          payload: { contentHash: "raw-hash-1" },
        },
      ],
      v2Snapshot: { id: "snap-v2", rawRunId: "raw-1" },
    });
    const identities = [identity(), identity()];
    const before = JSON.parse(JSON.stringify(identities));
    const out = await ensureRankingSnapshotsForIdentities({
      prisma: prisma as never,
      identities,
      fetchReport,
    });
    expect(out.providerCalls).toBe(0);
    expect(out.skippedExisting).toBe(1);
    expect(fetchReport).not.toHaveBeenCalled();
    expect(prisma.created).toHaveLength(0);
    expect(identities).toEqual(before);
  });

  it("fetches ReportWithFightAndMasterData once when raw exists and v2 is absent", async () => {
    const fetchReport = vi.fn(async () => ({
      rankings: RANKINGS,
      masterData: MASTER,
      friendlyPlayers: [4],
    }));
    const prisma = prismaMock({
      raws: [
        {
          id: "raw-1",
          reportCode: "HGN1B4QbKntwCMaV",
          fightId: 8,
          reportRevision: 3,
          acquisitionVersion: ACQ,
          payload: { contentHash: "raw-hash-1" },
        },
      ],
    });
    const digestId = "digest-1";
    const out = await ensureRankingSnapshotsForIdentities({
      prisma: prisma as never,
      identities: [identity(), identity()],
      fetchReport,
    });
    expect(out.providerCalls).toBe(1);
    expect(out.persisted).toBe(1);
    expect(fetchReport).toHaveBeenCalledTimes(1);
    expect(prisma.raws[0]!.payload).toEqual({ contentHash: "raw-hash-1" });
    expect(digestId).toBe("digest-1");
    expect(prisma.created[0]).toEqual(
      expect.objectContaining({
        rawRunId: "raw-1",
        rankingAcquisitionVersion: WCL_FIGHT_RANKING_ACQUISITION_VERSION,
      }),
    );
  });

  it("does not treat v1 as v2 and preserves the v1 snapshot", async () => {
    const fetchReport = vi.fn(async () => ({
      rankings: RANKINGS,
      masterData: MASTER,
      friendlyPlayers: [4],
    }));
    const v1 = { id: "snap-v1", rawRunId: "raw-1" };
    const prisma = prismaMock({
      raws: [
        {
          id: "raw-1",
          reportCode: "HGN1B4QbKntwCMaV",
          fightId: 8,
          reportRevision: 3,
          acquisitionVersion: ACQ,
        },
      ],
      v1Snapshot: v1,
    });
    const out = await ensureRankingSnapshotsForIdentities({
      prisma: prisma as never,
      identities: [identity()],
      fetchReport,
    });
    expect(out.providerCalls).toBe(1);
    expect(out.persisted).toBe(1);
    expect(v1.id).toBe("snap-v1");
    const stillV1 = await prisma.wclFightRankingSnapshot.findFirst({
      where: { rawRunId: "raw-1", rankingAcquisitionVersion: WCL_FIGHT_RANKING_LEGACY_ACQUISITION_VERSION },
    });
    expect(stillV1?.id).toBe("snap-v1");
  });

  it("is a no-op without a live fetch hook", async () => {
    const prisma = prismaMock({
      raws: [
        {
          id: "raw-1",
          reportCode: "HGN1B4QbKntwCMaV",
          fightId: 8,
          reportRevision: 3,
          acquisitionVersion: ACQ,
        },
      ],
    });
    const out = await ensureRankingSnapshotsForIdentities({
      prisma: prisma as never,
      identities: [identity()],
    });
    expect(out.providerCalls).toBe(0);
    expect(out.skippedNoLive).toBe(1);
    expect(prisma.created).toHaveLength(0);
  });

  it("swallows per-identity provider failure and continues remaining identities", async () => {
    const fetchReport = vi.fn(async (id: { fightId: number }) => {
      if (id.fightId === 8) throw new Error("wcl timeout");
      return { rankings: RANKINGS, masterData: MASTER, friendlyPlayers: [4] };
    });
    const prisma = prismaMock({
      raws: [
        {
          id: "raw-1",
          reportCode: "AAA",
          fightId: 8,
          reportRevision: 1,
          acquisitionVersion: ACQ,
        },
        {
          id: "raw-2",
          reportCode: "BBB",
          fightId: 9,
          reportRevision: 1,
          acquisitionVersion: ACQ,
        },
      ],
    });
    const out = await ensureRankingSnapshotsForIdentities({
      prisma: prisma as never,
      identities: [identity("AAA", 8, 1), identity("BBB", 9, 1)],
      fetchReport,
    });
    expect(out.failed).toBe(1);
    expect(out.persisted).toBe(1);
    expect(out.providerCalls).toBe(1);
  });

  it("does not change identity order or contents (freeze)", async () => {
    const identities = [identity("A", 1, 1), identity("B", 2, 1)];
    const frozen = uniqueRankingIdentities(identities);
    const after = uniqueRankingIdentities(identities);
    expect(after).toEqual(frozen);
    expect(identities.map((i) => `${i.reportCode}#${i.fightId}`)).toEqual(["A#1", "B#2"]);
  });
});

describe("ranking enrichment GraphQL surface", () => {
  it("production helper uses ReportWithFightAndMasterData and never ReportEvents", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./ensure-ranking-snapshots.ts", import.meta.url), "utf8"),
    );
    expect(src).toContain("OPERATIONS.ReportWithFightAndMasterData");
    expect(src).not.toMatch(/OPERATIONS\.ReportEvents/);
    expect(src).not.toContain("ReportEvents.query");
  });
});
