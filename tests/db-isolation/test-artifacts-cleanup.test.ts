/**
 * Regression coverage for general test-artifact cleanup (jobs, characters, models).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  TEST_CHARACTER_DISPLAY_NAME_PREFIXES,
  TEST_INGESTION_DEDUPE_KEY_PREFIXES,
  TEST_INGESTION_PAYLOAD_NAME_PREFIXES,
  TEST_SCORE_MODEL_KEY_PREFIXES,
  isDiscoverDedupeKey,
  isModelActivateLogicalKey,
  matchIngestionDedupeKey,
  matchIngestionPayloadName,
  matchScoreModelKey,
  matchTestCharacterIdentity,
  matchTestRealmSlug,
} from "../../tools/scripts/lib/test-artifact-registry.mjs";
import {
  applyCleanup,
  assertCleanupTargetAllowed,
  classifyBulkOperation,
  classifyCharacter,
  classifyIngestionJob,
  parseArgs as parseCleanupArgs,
  resolveQueueNameForJobType,
  totalRefused,
} from "../../tools/scripts/cleanup-test-artifacts.mjs";
import { assertTestDatabaseAllowed, DEV_DATABASE_NAME, ISOLATED_TEST_DB_MARKER } from "../../tools/scripts/lib/test-db-isolation.mjs";

describe("test artifact registry (authoritative markers)", () => {
  it("includes known refresh-job character and payload markers", () => {
    expect(matchTestCharacterIdentity("AdminRefreshab12", "adminrefreshxyz")).toEqual({
      kind: "displayName",
      prefix: "AdminRefresh",
    });
    expect(matchIngestionPayloadName({ name: "FailChar99aa" })).toEqual({ id: "FailChar", name: "FailChar99aa" });
    expect(matchIngestionPayloadName({ name: "QueuedChar" })).toEqual({ id: "QueuedChar", name: "QueuedChar" });
    expect(matchIngestionPayloadName({ name: "ModelChar" })).toEqual({ id: "ModelChar", name: "ModelChar" });
    expect(matchIngestionPayloadName({ name: "NoModelChar" })).toEqual({ id: "NoModelChar", name: "NoModelChar" });
    expect(matchIngestionPayloadName({ name: "NormalRefreshOk-abcd1234" })).toEqual({
      id: "NormalRefreshOk",
      name: "NormalRefreshOk-abcd1234",
    });
    expect(matchIngestionPayloadName({ name: "E2eApiA-deadbeef" })).toEqual({ id: "E2eApiA", name: "E2eApiA-deadbeef" });
    expect(matchIngestionPayloadName({ name: "LegitimatePlayer" })).toBeNull();
  });

  it("includes known ingestion dedupe prefixes and rejects production-like hashes", () => {
    expect(matchIngestionDedupeKey("refresh:old:deadbeef12")).toEqual({ id: "refresh:old:" });
    expect(matchIngestionDedupeKey("refresh:queued:deadbeef12")).toEqual({ id: "refresh:queued:" });
    // discover:* is deliberately NOT an exclusive dedupe pattern — it needs a second signal.
    expect(matchIngestionDedupeKey("discover:uuid")).toBeNull();
    expect(isDiscoverDedupeKey("discover:uuid")).toBe(true);
    // Production dedupe keys are SHA-256 hex — not allowlisted.
    expect(matchIngestionDedupeKey("a".repeat(64))).toBeNull();
  });

  it("matches test realm slug admin-refresh-realm", () => {
    expect(matchTestRealmSlug("admin-refresh-realm")).toBe("admin-refresh-realm");
    expect(matchTestRealmSlug("tarren-mill")).toBeNull();
  });

  it("does not treat model-activate alone as test-owned", () => {
    expect(isModelActivateLogicalKey("model-activate:default")).toBe(true);
  });

  it("does not treat status or the word Test alone as ownership", () => {
    expect(matchTestCharacterIdentity("Admin Test Model", "admin test model")).toBeNull();
    expect(matchScoreModelKey("custom-prod-key")).toBeNull();
    expect(TEST_SCORE_MODEL_KEY_PREFIXES.length).toBeGreaterThan(5);
    expect(TEST_CHARACTER_DISPLAY_NAME_PREFIXES).toContain("AdminRefresh");
    expect(TEST_INGESTION_DEDUPE_KEY_PREFIXES).toContain("refresh:old:");
    expect(TEST_INGESTION_PAYLOAD_NAME_PREFIXES).toContain("FailChar");
  });
});

describe("classifyIngestionJob — compound evidence required", () => {
  const testCharacterIds = new Set(["char-test-1"]);
  const ctx = { testCharacterIds, testModelKeys: new Set(), testRealmSlugs: new Set() };

  it("treats a lone discover:* dedupe key as ambiguous, not owned", () => {
    const verdict = classifyIngestionJob(
      { id: "j1", characterId: null, dedupeKey: "discover:abc", payload: {}, status: "QUEUED", jobType: "discover-owned-characters" },
      ctx,
    );
    expect(verdict.owned).toBe(false);
    expect(verdict.ambiguous).toBe(true);
    expect(verdict.reason).toMatch(/discover without compound/);
  });

  it("owns a discover:* job when combined with a test-owned character", () => {
    const verdict = classifyIngestionJob(
      {
        id: "j1b",
        characterId: "char-test-1",
        dedupeKey: "discover:abc",
        payload: {},
        status: "QUEUED",
        jobType: "discover-owned-characters",
      },
      ctx,
    );
    expect(verdict.owned).toBe(true);
    expect(verdict.evidence).toContain("discover+compound");
  });

  it("treats a lone payload-name match as ambiguous, not owned", () => {
    const verdict = classifyIngestionJob(
      { id: "j2", characterId: "unknown", dedupeKey: null, payload: { name: "FailChardead" }, status: "FAILED", jobType: "refresh-character" },
      ctx,
    );
    expect(verdict.owned).toBe(false);
    expect(verdict.ambiguous).toBe(true);
    expect(verdict.reason).toMatch(/payload without second independent marker/);
  });

  it("owns a job when payload-name is combined with a test-owned character", () => {
    const verdict = classifyIngestionJob(
      {
        id: "j2b",
        characterId: "char-test-1",
        dedupeKey: null,
        payload: { name: "FailChardead" },
        status: "FAILED",
        jobType: "refresh-character",
      },
      ctx,
    );
    expect(verdict.owned).toBe(true);
  });

  it("owns a job when payload-name is combined with a test realm in the payload", () => {
    const verdict = classifyIngestionJob(
      {
        id: "j2c",
        characterId: "unknown",
        dedupeKey: null,
        payload: { name: "FailChardead", realmSlug: "admin-refresh-realm" },
        status: "FAILED",
        jobType: "refresh-character",
      },
      ctx,
    );
    expect(verdict.owned).toBe(true);
  });

  it("treats a lone exclusive dedupe key as ambiguous, not owned", () => {
    const verdict = classifyIngestionJob(
      { id: "j5", characterId: "unknown", dedupeKey: "refresh:old:deadbeef12", payload: {}, status: "QUEUED", jobType: "refresh-character" },
      ctx,
    );
    expect(verdict.owned).toBe(false);
    expect(verdict.ambiguous).toBe(true);
    expect(verdict.reason).toMatch(/dedupe without second independent marker/);
  });

  it("owns a job when exclusive dedupe is combined with exclusive payload name", () => {
    const verdict = classifyIngestionJob(
      {
        id: "j6",
        characterId: "unknown",
        dedupeKey: "refresh:old:deadbeef12",
        payload: { name: "FailChardead" },
        status: "QUEUED",
        jobType: "refresh-character",
      },
      ctx,
    );
    expect(verdict.owned).toBe(true);
  });

  it("does not own a job by a test-owned character id alone (no independent job-level marker)", () => {
    const verdict = classifyIngestionJob(
      { id: "j3", characterId: "char-test-1", dedupeKey: null, payload: { name: "Someone" }, status: "COMPLETED", jobType: "refresh-character" },
      ctx,
    );
    expect(verdict.owned).toBe(false);
    expect(verdict.ambiguous).toBeUndefined();
    expect(verdict.evidence).toContain("character:char-test-1");
  });

  it("does not own a legitimate job without markers", () => {
    const verdict = classifyIngestionJob(
      { id: "j4", characterId: "real-char", dedupeKey: "a".repeat(64), payload: { name: "SomeRealPlayer" }, status: "COMPLETED", jobType: "refresh-character" },
      ctx,
    );
    expect(verdict).toEqual({ owned: false, evidence: [] });
  });
});

describe("classifyBulkOperation — model-activate requires a test-owned model", () => {
  it("owns an exclusive test-bulk logical key regardless of model", () => {
    const verdict = classifyBulkOperation({ logicalKey: "test-bulk-abc123", scoreModelId: null, scoreModel: null });
    expect(verdict.owned).toBe(true);
  });

  it("retains model-activate referencing the canonical default model", () => {
    const verdict = classifyBulkOperation({
      logicalKey: "model-activate:default",
      scoreModelId: "id-1",
      scoreModel: { key: "default" },
    });
    expect(verdict.owned).toBe(false);
    expect(verdict.reason).toMatch(/canonical default/);
  });

  it("owns model-activate referencing a test-owned score model", () => {
    const verdict = classifyBulkOperation({
      logicalKey: "model-activate:life-arch-abc",
      scoreModelId: "id-2",
      scoreModel: { key: "life-arch-abc123" },
    });
    expect(verdict.owned).toBe(true);
  });

  it("retains model-activate referencing an unrecognized model", () => {
    const verdict = classifyBulkOperation({
      logicalKey: "model-activate:custom-prod-key",
      scoreModelId: "id-3",
      scoreModel: { key: "custom-prod-key" },
    });
    expect(verdict.owned).toBe(false);
  });
});

describe("classifyCharacter — compound evidence required", () => {
  const identity = { id: "AdminRefresh", field: "displayName" };

  it("owns a character on a test-exclusive realm regardless of ownership signals", () => {
    const verdict = classifyCharacter({
      identity,
      isTestRealm: true,
      ownershipCount: 1,
      canonicalPublishedScoreCount: 1,
      nonTestJobCount: 5,
    });
    expect(verdict.owned).toBe(true);
  });

  it("retains a character with verified ownership off a test realm", () => {
    const verdict = classifyCharacter({
      identity,
      isTestRealm: false,
      ownershipCount: 1,
      canonicalPublishedScoreCount: 0,
      nonTestJobCount: 0,
    });
    expect(verdict.owned).toBe(false);
    expect(verdict.reason).toMatch(/verified ownership/);
  });

  it("retains a character with a canonical published score off a test realm", () => {
    const verdict = classifyCharacter({
      identity,
      isTestRealm: false,
      ownershipCount: 0,
      canonicalPublishedScoreCount: 1,
      nonTestJobCount: 0,
    });
    expect(verdict.owned).toBe(false);
    expect(verdict.reason).toMatch(/canonical model/);
  });

  it("owns a character with identity + no ownership + no canonical score + no non-test jobs", () => {
    const verdict = classifyCharacter({
      identity,
      isTestRealm: false,
      ownershipCount: 0,
      canonicalPublishedScoreCount: 0,
      nonTestJobCount: 0,
    });
    expect(verdict.owned).toBe(true);
  });

  it("never owns without an exact identity match", () => {
    const verdict = classifyCharacter({
      identity: null,
      isTestRealm: true,
      ownershipCount: 0,
      canonicalPublishedScoreCount: 0,
      nonTestJobCount: 0,
    });
    expect(verdict.owned).toBe(false);
  });
});

describe("refresh-job tests cannot write to development database", () => {
  it("assertTestDatabaseAllowed refuses mplus_trust even with marker", () => {
    expect(() =>
      assertTestDatabaseAllowed(
        `postgresql://u:p@localhost:5433/${DEV_DATABASE_NAME}?schema=public`,
        { NODE_ENV: "test", APP_ENV: "test", [ISOLATED_TEST_DB_MARKER]: "true" },
      ),
    ).toThrow(/TEST DATABASE SAFETY GUARD/);
  });

  it("createTestPrismaClient path requires isolated disposable DB", () => {
    expect(() =>
      assertTestDatabaseAllowed("", {
        NODE_ENV: "test",
        APP_ENV: "test",
        [ISOLATED_TEST_DB_MARKER]: "true",
      }),
    ).toThrow(/DATABASE_URL/);
  });
});

describe("negative ownership — legitimate rows survive broad prefixes", () => {
  it("does not match bare Bulk/Force/Hist display names", () => {
    expect(matchTestCharacterIdentity("BulkPlayer", "bulkplayer")).toBeNull();
    expect(matchTestCharacterIdentity("Force", "force")).toBeNull();
    expect(matchTestCharacterIdentity("Hist", "hist")).toBeNull();
    expect(matchTestCharacterIdentity("Wallidrixe", "wallidrixe")).toBeNull();
    expect(matchTestCharacterIdentity("Chérith", "cherith")).toBeNull();
  });

  it("does not own Prio payload alone", () => {
    const verdict = classifyIngestionJob(
      {
        id: "prio-alone",
        characterId: null,
        dedupeKey: null,
        payload: { name: "Prio" },
        status: "QUEUED",
        jobType: "refresh-character",
      },
      { testCharacterIds: new Set(), testModelKeys: new Set(), testRealmSlugs: new Set() },
    );
    expect(verdict.owned).toBe(false);
    expect(verdict.ambiguous).toBe(true);
  });

  it("does not own discover job for a real account without compound signal", () => {
    const verdict = classifyIngestionJob(
      {
        id: "disc",
        characterId: "real-account-char",
        dedupeKey: "discover:real-uuid",
        payload: {},
        status: "QUEUED",
        jobType: "discover-owned-characters",
      },
      { testCharacterIds: new Set(), testModelKeys: new Set(), testRealmSlugs: new Set() },
    );
    expect(verdict.owned).toBe(false);
    expect(verdict.ambiguous).toBe(true);
  });

  it("retains model-activate bulk key referencing canonical model", () => {
    const verdict = classifyBulkOperation({
      logicalKey: "model-activate:default:v6",
      scoreModelId: "sm1",
      scoreModel: { key: "default" },
    });
    expect(verdict.owned).toBe(false);
  });
});

describe("BullMQ queue mapping fail-closed", () => {
  it("refuses unknown job types instead of falling back to refresh-character", async () => {
    const known = new Set(["refresh-character", "discover-owned-characters"]);
    expect(await resolveQueueNameForJobType("refresh-character", known)).toBe("refresh-character");
    expect(await resolveQueueNameForJobType("mystery-job", known)).toBeNull();
  });
});

function emptyCleanupInventory(overrides = {}) {
  return {
    scoreModels: { candidates: [], total: 0 },
    ingestionJobs: { testOwned: [], ambiguousRetained: [], totalJobs: 0, byCharacterId: new Map() },
    characters: { candidates: [], retained: [] },
    bulkOperations: { candidates: [], retained: [] },
    realms: [],
    dungeons: [],
    seasons: [],
    mechanicRules: [],
    redis: { queueJobIds: [] },
    ...overrides,
  };
}

function mockPrismaForCleanup() {
  const deletedJobIds = [];
  const deletedCharacterIds = [];
  return {
    deletedJobIds,
    deletedCharacterIds,
    ingestionJob: {
      delete: async ({ where }) => {
        deletedJobIds.push(where.id);
        return { id: where.id };
      },
      count: async () => 0,
    },
    character: {
      delete: async ({ where }) => {
        deletedCharacterIds.push(where.id);
        return { id: where.id };
      },
      count: async () => 0,
    },
    $transaction: async (fn) => fn({
      characterSnapshot: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
      scoreAnalysisBatch: { deleteMany: async () => ({ count: 0 }) },
      runAnalysis: { deleteMany: async () => ({ count: 0 }) },
      runParticipant: { deleteMany: async () => ({ count: 0 }) },
      character: {
        delete: async ({ where }) => {
          deletedCharacterIds.push(where.id);
          return { id: where.id };
        },
      },
    }),
    auditEvent: { count: async () => 0 },
  };
}

describe("BullMQ fail-closed applyCleanup", () => {
  const prevRedis = process.env.REDIS_URL;

  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("missing REDIS_URL + queueJobId refuses DB deletion", async () => {
    delete process.env.REDIS_URL;
    const prisma = mockPrismaForCleanup();
    const inventory = emptyCleanupInventory({
      ingestionJobs: {
        testOwned: [
          {
            job: {
              id: "job-1",
              queueJobId: "q-1",
              jobType: "refresh-character",
              characterId: "c1",
              status: "QUEUED",
            },
            evidence: "test",
          },
        ],
        ambiguousRetained: [],
        totalJobs: 1,
        byCharacterId: new Map(),
      },
    });
    const { results } = await applyCleanup(prisma, inventory, null);
    expect(results.ingestionJobs.refused).toBe(1);
    expect(results.ingestionJobs.deleted).toBe(0);
    expect(prisma.deletedJobIds).toEqual([]);
  });

  it("BullMQ connection/unavailable refuses DB deletion", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const prisma = mockPrismaForCleanup();
    const inventory = emptyCleanupInventory({
      ingestionJobs: {
        testOwned: [
          {
            job: {
              id: "job-2",
              queueJobId: "q-2",
              jobType: "refresh-character",
              characterId: "c2",
              status: "QUEUED",
            },
            evidence: "test",
          },
        ],
        ambiguousRetained: [],
        totalJobs: 1,
        byCharacterId: new Map(),
      },
    });
    const { results } = await applyCleanup(prisma, inventory, null);
    expect(results.ingestionJobs.refused).toBe(1);
    expect(prisma.deletedJobIds).toEqual([]);
  });

  it("locked ACTIVE job refuses DB deletion", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const prisma = mockPrismaForCleanup();
    const bullmq = {
      removeJob: async () => ({ ok: false, reason: "active_locked:active", blocked: true }),
      close: async () => {},
    };
    const inventory = emptyCleanupInventory({
      ingestionJobs: {
        testOwned: [
          {
            job: {
              id: "job-3",
              queueJobId: "q-3",
              jobType: "refresh-character",
              characterId: "c3",
              status: "RUNNING",
            },
            evidence: "test",
          },
        ],
        ambiguousRetained: [],
        totalJobs: 1,
        byCharacterId: new Map(),
      },
    });
    const { results, refusedJobCharacterIds } = await applyCleanup(prisma, inventory, bullmq);
    expect(results.ingestionJobs.refused).toBe(1);
    expect(prisma.deletedJobIds).toEqual([]);
    expect(refusedJobCharacterIds.has("c3")).toBe(true);
  });

  it("not-found queue job permits DB deletion", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const prisma = mockPrismaForCleanup();
    const bullmq = {
      removeJob: async () => ({ ok: true, state: "not-found" }),
      close: async () => {},
    };
    const inventory = emptyCleanupInventory({
      ingestionJobs: {
        testOwned: [
          {
            job: {
              id: "job-4",
              queueJobId: "q-4",
              jobType: "refresh-character",
              characterId: null,
              status: "QUEUED",
            },
            evidence: "test",
          },
        ],
        ambiguousRetained: [],
        totalJobs: 1,
        byCharacterId: new Map(),
      },
    });
    const { results } = await applyCleanup(prisma, inventory, bullmq);
    expect(results.ingestionJobs.deleted).toBe(1);
    expect(results.ingestionJobs.queueNotFound).toBe(1);
    expect(results.ingestionJobs.refused).toBe(0);
    expect(prisma.deletedJobIds).toEqual(["job-4"]);
  });

  it("successful removal permits DB deletion", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const prisma = mockPrismaForCleanup();
    const bullmq = {
      removeJob: async () => ({ ok: true, state: "removed" }),
      close: async () => {},
    };
    const inventory = emptyCleanupInventory({
      ingestionJobs: {
        testOwned: [
          {
            job: {
              id: "job-5",
              queueJobId: "q-5",
              jobType: "refresh-character",
              characterId: null,
              status: "QUEUED",
            },
            evidence: "test",
          },
        ],
        ambiguousRetained: [],
        totalJobs: 1,
        byCharacterId: new Map(),
      },
    });
    const { results, removedQueueJobIds } = await applyCleanup(prisma, inventory, bullmq);
    expect(results.ingestionJobs.deleted).toBe(1);
    expect(results.ingestionJobs.queueRemoved).toBe(1);
    expect(prisma.deletedJobIds).toEqual(["job-5"]);
    expect(removedQueueJobIds).toEqual([{ queueJobId: "q-5", jobType: "refresh-character" }]);
  });

  it("refused job prevents related character deletion", async () => {
    delete process.env.REDIS_URL;
    const prisma = mockPrismaForCleanup();
    const inventory = emptyCleanupInventory({
      ingestionJobs: {
        testOwned: [
          {
            job: {
              id: "job-6",
              queueJobId: "q-6",
              jobType: "refresh-character",
              characterId: "char-blocked",
              status: "QUEUED",
            },
            evidence: "test",
          },
        ],
        ambiguousRetained: [],
        totalJobs: 1,
        byCharacterId: new Map(),
      },
      characters: {
        candidates: [
          {
            character: { id: "char-blocked", displayName: "AdminRefreshabcd" },
            evidence: "identity+orphan",
          },
        ],
        retained: [],
      },
    });
    const { results } = await applyCleanup(prisma, inventory, null);
    expect(results.ingestionJobs.refused).toBe(1);
    expect(results.characters.refused).toBe(1);
    expect(results.characters.deleted).toBe(0);
    expect(prisma.deletedCharacterIds).toEqual([]);
  });

  it("totalRefused > 0 implies non-zero exit path", async () => {
    delete process.env.REDIS_URL;
    const prisma = mockPrismaForCleanup();
    const inventory = emptyCleanupInventory({
      ingestionJobs: {
        testOwned: [
          {
            job: {
              id: "job-7",
              queueJobId: "q-7",
              jobType: "refresh-character",
              characterId: null,
              status: "QUEUED",
            },
            evidence: "test",
          },
        ],
        ambiguousRetained: [],
        totalJobs: 1,
        byCharacterId: new Map(),
      },
    });
    const { results } = await applyCleanup(prisma, inventory, null);
    expect(totalRefused(results)).toBeGreaterThan(0);
  });
});

describe("cleanup CLI safety for artifacts", () => {
  it("defaults to dry-run", () => {
    expect(parseCleanupArgs([])).toEqual({ confirm: false, dryRun: true, modelsOnly: false });
  });

  it("supports --models-only", () => {
    expect(parseCleanupArgs(["--confirm", "--models-only"])).toEqual({
      confirm: true,
      dryRun: false,
      modelsOnly: true,
    });
  });

  it("refuses production", () => {
    const gate = assertCleanupTargetAllowed(
      "postgresql://mplus:x@localhost:5433/mplus_trust?schema=public",
      { APP_ENV: "production" },
    );
    expect(gate.ok).toBe(false);
  });

  it("refuses remote without deployed-test assertion", () => {
    const gate = assertCleanupTargetAllowed(
      "postgresql://mplus:x@db.example.com:5432/mplus_trust?schema=public",
      { APP_ENV: "test" },
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toMatch(/MPLUS_CLEANUP_TARGET=deployed-test/);
  });
});
