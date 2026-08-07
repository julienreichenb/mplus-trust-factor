import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_EXPORT_MAX_ARCHIVE_BYTES,
  EVIDENCE_EXPORT_MAX_MEMBERS,
  EVIDENCE_EXPORT_STALE_LEASE_CODE,
  reclaimStaleEvidenceExports,
  runScoringEvidenceExportJob,
} from "./scoring-evidence-export.js";

const runEvidenceJoin = vi.hoisted(() => vi.fn());
const buildEvidenceJoinMarkdown = vi.hoisted(() =>
  vi.fn(() => "# evidence-join\n"),
);

vi.mock("./scoring/evidence-join.js", () => ({
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

function persistFromBytes(bytes: Buffer | Uint8Array) {
  const buf = Buffer.from(bytes);
  const contentHash = createHash("sha256").update(buf).digest("hex");
  return {
    artifactId: `art-${contentHash.slice(0, 8)}`,
    write: {
      contentHash,
      uncompressedSizeBytes: buf.byteLength,
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
      description: "desc",
      externalKey: "cohort-ext",
      createdAt: generatedAt,
      revision: 3,
      seasonId: "22222222-2222-4222-8222-222222222222",
      members: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          externalMemberKey: "m-1",
          region: "eu",
          realmSlug: "realm",
          characterName: "Hero",
          expectedLabel: "GOOD",
          rationale: "expert",
          providedRole: "DPS",
          classSlug: "mage",
          specSlug: "frost",
          characterId: "44444444-4444-4444-8444-444444444444",
          included: true,
          exclusionCode: null,
          exclusionDetail: null,
          evidenceCutoffAt: generatedAt,
          source: "USER_SELECTED",
        },
      ],
    },
    ...overrides,
  };
}

function joinResult(generatedAt = "2026-08-03T12:00:00.000Z") {
  return {
    schemaVersion: "scoring-evidence-join-preflight-v1",
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

function evidencePrismaMocks(evidenceCutoffAt = new Date("2026-08-03T12:00:00.000Z")) {
  const manifestContentHash = "b".repeat(64);
  return {
    evidenceManifest: {
      findFirst: vi.fn(async () => ({
        id: "manifest-1",
        contentHash: manifestContentHash,
        schemaVersion: "2.0.0",
        document: {
          schemaVersion: "2.0.0",
          contentHash: manifestContentHash,
          slots: [],
        },
        frozenAt: evidenceCutoffAt,
        slots: [
          {
            id: "slot-1",
            factSets: [
              {
                schemaVersion: "utility-v2-facts",
                extractorFamily: "utility",
                extractorVersion: "1",
                inputFingerprint: "fp-1",
                facts: { kind: "fixture" },
                coverage: {},
                limitations: [],
                computedAt: evidenceCutoffAt,
              },
            ],
          },
        ],
      })),
    },
    dimensionComputation: {
      findMany: vi.fn(async () =>
        (["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as const).map((dimension) => ({
          dimension,
          algorithmVersion: `${dimension.toLowerCase()}-algo`,
          inputFingerprint: `fp-${dimension}`,
          score: 70,
          confidence: 0.9,
          state: "COMPLETE",
          metrics: {},
          explanation: {},
          computedAt: evidenceCutoffAt,
        })),
      ),
    },
    scoreSnapshot: {
      findFirst: vi.fn(async () => ({
        id: "snap-1",
        characterId: "44444444-4444-4444-8444-444444444444",
        seasonId: "22222222-2222-4222-8222-222222222222",
        scoreModelId: "model-1",
        scopeType: "CHARACTER",
        scopeKey: null,
        overallScore: 70,
        grade: "B",
        skillScore: 70,
        authenticityScore: 70,
        confidence: 0.9,
        calculatedAt: evidenceCutoffAt,
        inputFingerprint: "fp-snap",
        explanation: {},
        publicationStatus: "PUBLIC",
        isPublic: true,
        evidenceManifestId: "manifest-1",
      })),
    },
  };
}

describe("runScoringEvidenceExportJob idempotency (B3)", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  let prisma: {
    scoringEvidenceExport: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    scoreModel: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    season: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    evidenceManifest: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    dimensionComputation: {
      findMany: ReturnType<typeof vi.fn>;
    };
    scoreSnapshot: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  let artifacts: { persist: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    runEvidenceJoin.mockResolvedValue(joinResult());
    const { createDefaultModelV6, createDefaultscoringDimensionConfigSet, withscoringDimensionConfigs } =
      await import("@mplus/scoring");
    const evidence = evidencePrismaMocks();
    prisma = {
      scoringEvidenceExport: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      scoreModel: {
        findUnique: vi.fn(async () => ({
          id: "model-1",
          key: "v6",
          version: 1,
          status: "ACTIVE",
          config: withscoringDimensionConfigs(
            createDefaultModelV6({ key: "v6", version: 1 }),
            createDefaultscoringDimensionConfigSet(),
          ),
        })),
      },
      season: {
        findUnique: vi.fn(async () => ({
          id: "22222222-2222-4222-8222-222222222222",
          slug: "s",
          region: { code: "eu" },
        })),
      },
      ...evidence,
    };
    let persistCalls = 0;
    artifacts = {
      persist: vi.fn(async (input: { bytes: Buffer | Uint8Array }) => {
        persistCalls += 1;
        // First four writes are summary/preflight/markdown/archive with fixed hashes.
        if (persistCalls === 1) return artifactWrite("summary-hash");
        if (persistCalls === 2) return artifactWrite("preflight-hash");
        if (persistCalls === 3) return artifactWrite("markdown-hash");
        if (persistCalls === 4) return artifactWrite("archive-hash", 100);
        return persistFromBytes(input.bytes);
      }),
    };
  });

  it("short-circuits when already COMPLETED with archiveContentHash", async () => {
    prisma.scoringEvidenceExport.findUnique.mockResolvedValue(
      baseExportRow({
        status: "COMPLETED",
        archiveContentHash: "existing-archive",
        artifactSetHash: "existing-archive",
        blockerCount: 2,
        warningCount: 1,
      }),
    );

    const result = await runScoringEvidenceExportJob(
      {
        prisma: prisma as never,
        logger: logger as never,
        artifacts: artifacts as never,
      },
      JOB_PAYLOAD,
    );

    expect(result).toEqual({ exportId: EXPORT_ID, status: "COMPLETED" });
    expect(prisma.scoringEvidenceExport.updateMany).not.toHaveBeenCalled();
    expect(runEvidenceJoin).not.toHaveBeenCalled();
    expect(artifacts.persist).not.toHaveBeenCalled();
  });

  it("passes pinned generatedAt to runEvidenceJoin (not wall-clock now)", async () => {
    const pinned = new Date("2026-08-03T12:00:00.000Z");
    const wallClock = new Date("2026-08-03T15:30:00.000Z");
    prisma.scoringEvidenceExport.findUnique
      .mockResolvedValueOnce(baseExportRow({ generatedAt: pinned, evidenceCutoffAt: pinned }))
      .mockResolvedValueOnce({
        attempt: 1,
        generatedAt: pinned,
        evidenceCutoffAt: pinned,
        leaseOwner: "owner-1",
      });
    prisma.scoringEvidenceExport.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 1 }); // finalize

    await runScoringEvidenceExportJob(
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

    expect(prisma.scoringEvidenceExport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "RUNNING" }),
        take: 50,
      }),
    );

    const finalizeCall = prisma.scoringEvidenceExport.updateMany.mock.calls[1]![0];
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
    prisma.scoringEvidenceExport.findUnique
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
    prisma.scoringEvidenceExport.updateMany.mockResolvedValueOnce({ count: 0 }); // claim lost

    const result = await runScoringEvidenceExportJob(
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
    prisma.scoringEvidenceExport.findUnique
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
    prisma.scoringEvidenceExport.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 1 }); // fail terminal

    const result = await runScoringEvidenceExportJob(
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
    const failCall = prisma.scoringEvidenceExport.updateMany.mock.calls[1]![0];
    expect(failCall.data.status).toBe("FAILED");
    expect(failCall.data.errorCode).toBe("EVIDENCE_EXPORT_MEMBER_LIMIT");
  });

  it("optimistic finalize guard returns COMPLETED when peer already wrote same hash", async () => {
    const pinned = new Date("2026-08-03T12:00:00.000Z");
    prisma.scoringEvidenceExport.findUnique
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
    prisma.scoringEvidenceExport.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 0 }); // finalize lost

    const result = await runScoringEvidenceExportJob(
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

  it("H3: persists freezeSnapshot v2 with members[].evidence digests and scoreModelId", async () => {
    const pinned = new Date("2026-08-03T12:00:00.000Z");
    prisma.scoringEvidenceExport.findUnique
      .mockResolvedValueOnce(baseExportRow({ generatedAt: pinned, evidenceCutoffAt: pinned }))
      .mockResolvedValueOnce({
        attempt: 1,
        generatedAt: pinned,
        evidenceCutoffAt: pinned,
        leaseOwner: "owner-1",
      });
    prisma.scoringEvidenceExport.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 1 }); // finalize

    const result = await runScoringEvidenceExportJob(
      {
        prisma: prisma as never,
        logger: logger as never,
        artifacts: artifacts as never,
        leaseOwnerFactory: () => "owner-1",
      },
      JOB_PAYLOAD,
    );

    expect(result).toEqual({ exportId: EXPORT_ID, status: "COMPLETED" });
    expect(prisma.scoreModel.findUnique).toHaveBeenCalledWith({ where: { id: "model-1" } });
    expect(prisma.season.findUnique).toHaveBeenCalled();
    expect(prisma.evidenceManifest.findFirst).toHaveBeenCalled();
    expect(prisma.dimensionComputation.findMany).toHaveBeenCalled();

    const finalizeCall = prisma.scoringEvidenceExport.updateMany.mock.calls[1]![0];
    expect(finalizeCall.data.scoreModelId).toBe("model-1");
    const snap = finalizeCall.data.freezeSnapshot as {
      schemaVersion: string;
      contentHash: string;
      activeModel: { id: string; key: string } | null;
      members: Array<{
        id: string;
        expectedLabel: string;
        characterName: string;
        evidence: {
          manifest: { contentHash: string; byteDigest: string; digestAlgorithm: string };
          factSets: Array<{ contentHash: string }>;
          dimensionExports: Record<string, { contentHash: string }>;
          previousSnapshot: { contentHash: string } | null;
        } | null;
      }>;
      cohortRevision: number;
      evaluationModel: unknown;
    };
    expect(snap.schemaVersion).toBe("scoring-freeze-snapshot-v2");
    expect(snap.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.activeModel?.id).toBe("model-1");
    expect(snap.evaluationModel).toBeNull();
    expect(snap.cohortRevision).toBe(3);
    expect(snap.members).toHaveLength(1);
    expect(snap.members[0]!.expectedLabel).toBe("GOOD");
    expect(snap.members[0]!.characterName).toBe("Hero");
    expect(snap.members[0]!.evidence).not.toBeNull();
    expect(snap.members[0]!.evidence!.manifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.members[0]!.evidence!.manifest.byteDigest).toBe(
      `sha256:${snap.members[0]!.evidence!.manifest.contentHash}`,
    );
    expect(snap.members[0]!.evidence!.manifest.digestAlgorithm).toBe("sha256");
    expect(snap.members[0]!.evidence!.factSets.length).toBeGreaterThan(0);
    expect(snap.members[0]!.evidence!.dimensionExports.PERFORMANCE?.contentHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(snap.members[0]!.evidence!.previousSnapshot?.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const { parseAndVerifyFreezeSnapshot } = await import("@mplus/scoring");
    const verified = parseAndVerifyFreezeSnapshot(snap);
    expect(verified.ok).toBe(true);
  });
});

describe("reclaimStaleEvidenceExports (M3)", () => {
  it("marks expired RUNNING leases as RETRYABLE with STALE_LEASE", async () => {
    const now = new Date("2026-08-03T12:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const result = await reclaimStaleEvidenceExports(
      { scoringEvidenceExport: { findMany, updateMany } } as never,
      now,
    );
    expect(result).toEqual({ reclaimed: 2 });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "RUNNING",
        OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null }],
      },
      select: { id: true },
      orderBy: [{ leaseExpiresAt: "asc" }, { id: "asc" }],
      take: 50,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["a", "b"] },
        status: "RUNNING",
        OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null }],
      },
      data: {
        status: "RETRYABLE",
        errorCode: EVIDENCE_EXPORT_STALE_LEASE_CODE,
        errorMessage: "Evidence export lease expired; marked retryable for reclaim",
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
  });

  it("respects optional reclaim limit (bounded batch)", async () => {
    const now = new Date("2026-08-03T12:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([{ id: "only" }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await reclaimStaleEvidenceExports(
      { scoringEvidenceExport: { findMany, updateMany } } as never,
      now,
      { limit: 3 },
    );
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
  });

  it("is idempotent when no stale rows exist", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const updateMany = vi.fn();
    const result = await reclaimStaleEvidenceExports({
      scoringEvidenceExport: { findMany, updateMany },
    } as never);
    expect(result).toEqual({ reclaimed: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
