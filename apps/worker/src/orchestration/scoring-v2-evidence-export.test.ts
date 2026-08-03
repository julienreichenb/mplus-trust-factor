import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_EXPORT_MAX_ARCHIVE_BYTES,
  EVIDENCE_EXPORT_MAX_MEMBERS,
  runScoringV2EvidenceExportJob,
} from "./scoring-v2-evidence-export.js";

const runEvidenceJoin = vi.hoisted(() => vi.fn());
const buildEvidenceJoinMarkdown = vi.hoisted(() =>
  vi.fn(() => "# evidence-join\n"),
);

vi.mock("./scoring-v2/evidence-join.js", () => ({
  runEvidenceJoin,
  buildEvidenceJoinMarkdown,
}));

function artifactWrite(contentHash: string, size = 10) {
  return {
    write: {
      contentHash,
      uncompressedSizeBytes: size,
      storageUri: `cas://${contentHash}`,
      deduplicated: false,
    },
  };
}

const EXPORT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_PAYLOAD = {
  exportId: EXPORT_ID,
  requestedAt: "2026-08-03T12:00:00.000Z",
  correlationId: null,
} as const;

function baseExportRow(overrides: Record<string, unknown> = {}) {
  const generatedAt = new Date("2026-08-03T12:00:00.000Z");
  return {
    id: EXPORT_ID,
    cohortId: "11111111-1111-4111-8111-111111111111",
    cohortRevision: 3,
    seasonId: "22222222-2222-4222-8222-222222222222",
    scoreModelId: null,
    status: "QUEUED",
    blockerCount: 0,
    warningCount: 0,
    archiveContentHash: null,
    artifactSetHash: null,
    generatedAt,
    evidenceCutoffAt: generatedAt,
    freezeSnapshot: {},
    startedAt: null,
    attempt: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    cohort: {
      name: "Test Cohort",
      revision: 3,
      seasonId: "22222222-2222-4222-8222-222222222222",
      members: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          region: "eu",
          realmSlug: "realm",
          characterName: "Hero",
          expectedLabel: "GOOD",
          providedRole: "DPS",
          classSlug: "mage",
          specSlug: "frost",
          characterId: "44444444-4444-4444-8444-444444444444",
          included: true,
          exclusionCode: null,
          exclusionDetail: null,
        },
      ],
    },
    ...overrides,
  };
}

function joinResult(generatedAt = "2026-08-03T12:00:00.000Z") {
  return {
    schemaVersion: "scoring-v2-evidence-join-preflight-v1",
    generatedAt,
    cohortId: "11111111-1111-4111-8111-111111111111",
    cohortRevision: 3,
    cohortName: "Test Cohort",
    seasonBinding: {
      ok: true,
      season: {
        id: "22222222-2222-4222-8222-222222222222",
        slug: "s",
        isCurrent: true,
        blizzardSeasonId: 1,
        name: "S",
      },
      activeModel: { id: "model-1", key: "v6", version: 1, status: "ACTIVE" },
    },
    counts: {
      intakeMembers: 1,
      uniqueIdentities: 1,
      identitiesFound: 1,
      identitiesMissing: 0,
      completeBootstrapRows: 1,
      incompleteBootstrapRows: 0,
      membersCompatibleV6Snapshot: 1,
      membersStaleOrIncompatibleSnapshot: 0,
      membersNoScoreSnapshot: 0,
      membersExcluded: 0,
      membersRequiringScoreRefresh: 0,
      membersWithManifest: 1,
      membersWithFourDimensions: 1,
    },
    progress: {
      membersTotal: 1,
      membersScanned: 1,
      identitiesFound: 1,
      identitiesMissing: 0,
      bootstrapComplete: 1,
      bootstrapIncomplete: 0,
      manifestsPresent: 1,
      fourDimensionComplete: 1,
      compatibleSnapshots: 1,
      incompatibleSnapshots: 0,
    },
    issues: [],
    blockerCount: 0,
    warningCount: 0,
    members: [],
    freezeEligible: true,
  };
}

describe("runScoringV2EvidenceExportJob idempotency (B3)", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  let prisma: {
    scoringV2EvidenceExport: {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let artifacts: { persist: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    runEvidenceJoin.mockResolvedValue(joinResult());
    prisma = {
      scoringV2EvidenceExport: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    artifacts = {
      persist: vi
        .fn()
        .mockResolvedValueOnce(artifactWrite("summary-hash"))
        .mockResolvedValueOnce(artifactWrite("preflight-hash"))
        .mockResolvedValueOnce(artifactWrite("markdown-hash"))
        .mockResolvedValueOnce(artifactWrite("archive-hash", 100)),
    };
  });

  it("short-circuits when already COMPLETED with archiveContentHash", async () => {
    prisma.scoringV2EvidenceExport.findUnique.mockResolvedValue(
      baseExportRow({
        status: "COMPLETED",
        archiveContentHash: "existing-archive",
        artifactSetHash: "existing-archive",
        blockerCount: 2,
        warningCount: 1,
      }),
    );

    const result = await runScoringV2EvidenceExportJob(
      {
        prisma: prisma as never,
        logger: logger as never,
        artifacts: artifacts as never,
      },
      JOB_PAYLOAD,
    );

    expect(result).toEqual({ exportId: EXPORT_ID, status: "COMPLETED" });
    expect(prisma.scoringV2EvidenceExport.updateMany).not.toHaveBeenCalled();
    expect(runEvidenceJoin).not.toHaveBeenCalled();
    expect(artifacts.persist).not.toHaveBeenCalled();
  });

  it("passes pinned generatedAt to runEvidenceJoin (not wall-clock now)", async () => {
    const pinned = new Date("2026-08-03T12:00:00.000Z");
    const wallClock = new Date("2026-08-03T15:30:00.000Z");
    prisma.scoringV2EvidenceExport.findUnique
      .mockResolvedValueOnce(baseExportRow({ generatedAt: pinned, evidenceCutoffAt: pinned }))
      .mockResolvedValueOnce({
        attempt: 1,
        generatedAt: pinned,
        evidenceCutoffAt: pinned,
        leaseOwner: "owner-1",
      });
    prisma.scoringV2EvidenceExport.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 1 }); // finalize

    await runScoringV2EvidenceExportJob(
      {
        prisma: prisma as never,
        logger: logger as never,
        artifacts: artifacts as never,
        now: () => wallClock,
        leaseOwnerFactory: () => "owner-1",
      },
      JOB_PAYLOAD,
    );

    expect(runEvidenceJoin).toHaveBeenCalledTimes(1);
    expect(runEvidenceJoin.mock.calls[0]![1].now).toEqual(pinned);
    expect(runEvidenceJoin.mock.calls[0]![1].now).not.toEqual(wallClock);

    const finalizeCall = prisma.scoringV2EvidenceExport.updateMany.mock.calls[1]![0];
    expect(finalizeCall.data.status).toBe("COMPLETED");
    expect(finalizeCall.data.artifactSetHash).toBe("archive-hash");
    expect(finalizeCall.data.archiveContentHash).toBe("archive-hash");
    expect(finalizeCall.data.leaseOwner).toBeNull();
    expect(finalizeCall.where).toMatchObject({
      status: "RUNNING",
      leaseOwner: "owner-1",
      attempt: 1,
    });
  });

  it("does not rejoin when claim loses to an active RUNNING peer", async () => {
    prisma.scoringV2EvidenceExport.findUnique
      .mockResolvedValueOnce(baseExportRow({ status: "QUEUED" }))
      .mockResolvedValueOnce({
        status: "RUNNING",
        archiveContentHash: null,
        blockerCount: 0,
        warningCount: 0,
        cohortId: "11111111-1111-4111-8111-111111111111",
        leaseOwner: "other-owner",
        leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      });
    prisma.scoringV2EvidenceExport.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await runScoringV2EvidenceExportJob(
      {
        prisma: prisma as never,
        logger: logger as never,
        artifacts: artifacts as never,
        leaseOwnerFactory: () => "owner-1",
      },
      JOB_PAYLOAD,
    );

    expect(result).toEqual({ exportId: EXPORT_ID, status: "RUNNING" });
    expect(runEvidenceJoin).not.toHaveBeenCalled();
    expect(artifacts.persist).not.toHaveBeenCalled();
  });

  it("fails with EVIDENCE_EXPORT_MEMBER_LIMIT when cohort exceeds bound", async () => {
    const members = Array.from({ length: EVIDENCE_EXPORT_MAX_MEMBERS + 1 }, (_, i) => ({
      id: `m${i}`,
      region: "eu",
      realmSlug: "realm",
      characterName: `Hero${i}`,
      expectedLabel: "GOOD",
      providedRole: "DPS",
      classSlug: "mage",
      specSlug: "frost",
      characterId: `c${i}`,
      included: true,
      exclusionCode: null,
      exclusionDetail: null,
    }));
    prisma.scoringV2EvidenceExport.findUnique
      .mockResolvedValueOnce(
        baseExportRow({
          cohort: {
            name: "Big",
            revision: 3,
            seasonId: "22222222-2222-4222-8222-222222222222",
            members,
          },
        }),
      )
      .mockResolvedValueOnce({
        attempt: 1,
        generatedAt: new Date("2026-08-03T12:00:00.000Z"),
        evidenceCutoffAt: new Date("2026-08-03T12:00:00.000Z"),
        leaseOwner: "owner-1",
      });
    prisma.scoringV2EvidenceExport.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await runScoringV2EvidenceExportJob(
      {
        prisma: prisma as never,
        logger: logger as never,
        artifacts: artifacts as never,
        leaseOwnerFactory: () => "owner-1",
      },
      JOB_PAYLOAD,
    );

    expect(result).toEqual({ exportId: EXPORT_ID, status: "FAILED" });
    expect(runEvidenceJoin).not.toHaveBeenCalled();
    const failCall = prisma.scoringV2EvidenceExport.updateMany.mock.calls[1]![0];
    expect(failCall.data.status).toBe("FAILED");
    expect(failCall.data.errorCode).toBe("EVIDENCE_EXPORT_MEMBER_LIMIT");
  });

  it("optimistic finalize guard returns COMPLETED when peer already wrote same hash", async () => {
    const pinned = new Date("2026-08-03T12:00:00.000Z");
    prisma.scoringV2EvidenceExport.findUnique
      .mockResolvedValueOnce(baseExportRow({ generatedAt: pinned, evidenceCutoffAt: pinned }))
      .mockResolvedValueOnce({
        attempt: 1,
        generatedAt: pinned,
        evidenceCutoffAt: pinned,
        leaseOwner: "owner-1",
      })
      .mockResolvedValueOnce({
        status: "COMPLETED",
        archiveContentHash: "archive-hash",
        artifactSetHash: "archive-hash",
      });
    prisma.scoringV2EvidenceExport.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 0 }); // finalize lost

    const result = await runScoringV2EvidenceExportJob(
      {
        prisma: prisma as never,
        logger: logger as never,
        artifacts: artifacts as never,
        leaseOwnerFactory: () => "owner-1",
      },
      JOB_PAYLOAD,
    );

    expect(result).toEqual({ exportId: EXPORT_ID, status: "COMPLETED" });
  });

  it("exports max archive bound constant used by M4 lite", () => {
    expect(EVIDENCE_EXPORT_MAX_ARCHIVE_BYTES).toBe(50 * 1024 * 1024);
    expect(EVIDENCE_EXPORT_MAX_MEMBERS).toBe(500);
  });
});
