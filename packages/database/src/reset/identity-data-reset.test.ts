import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findMonorepoConfigRoot } from "@mplus/artifact-store";
import {
  assertIdentityDataResetAllowed,
  IDENTITY_RESET_DEPLOYED_TEST_CONFIRMATION_TOKEN,
  IDENTITY_RESET_DEPLOYED_TEST_DATABASE_NAME,
  IDENTITY_RESET_DEPLOYED_TEST_ENVIRONMENT_ID,
  IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN,
  IDENTITY_RESET_LOCAL_DATABASE_NAME,
  isValidUuid,
} from "./identity-data-reset-guard.js";
import {
  ALL_PRISMA_MAPPED_TABLES,
  IDENTITY_DATA_STATIC_RETAIN_TABLES,
  IDENTITY_DATA_TRUNCATE_TABLES,
  classifyIdentityDataTables,
  identityResetRedisKeyPrefixes,
} from "./identity-data-reset-table-plan.js";
import {
  WCL_SCORING_DERIVED_CLEAR_TABLES,
} from "./wcl-scoring-derived-table-plan.js";
import {
  acquireIdentityResetLock,
  buildIdentityDataResetPlan,
  executeIdentityDataReset,
  formatIdentityPlanTerminalSummary,
  probeIdentityActiveWriters,
  type ExtendedRedisScanner,
} from "./identity-data-reset.js";

const CONFIG_ROOT = findMonorepoConfigRoot(process.cwd())!;
const LOCAL_ARTIFACTS = "./data/raw-artifacts";
const KEEP_USER = "11111111-1111-4111-8111-111111111111";
const KEEP_BNET = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const LOCAL_DB = `postgresql://u:p@localhost:5432/${IDENTITY_RESET_LOCAL_DATABASE_NAME}`;
const LOCAL_REDIS = "redis://127.0.0.1:6379";
const DEPLOYED_DB = `postgresql://u:p@postgres:5432/${IDENTITY_RESET_DEPLOYED_TEST_DATABASE_NAME}`;
const DEPLOYED_REDIS = "redis://redis:6379";

function idleRedis(overrides: Partial<ExtendedRedisScanner> = {}): ExtendedRedisScanner {
  return {
    keys: vi.fn(async () => []),
    del: vi.fn(async () => 0),
    llen: vi.fn(async () => 0),
    exists: vi.fn(async () => 0),
    set: vi.fn(async () => "OK"),
    get: vi.fn(async () => null),
    eval: vi.fn(async () => 1),
    quit: vi.fn(async () => undefined),
    ...overrides,
  };
}

function localGateInput(overrides: Record<string, unknown> = {}) {
  return {
    target: "local-development",
    keepUserId: KEEP_USER,
    keepBnetAccountId: KEEP_BNET,
    confirmationToken: IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN,
    databaseUrl: LOCAL_DB,
    redisUrl: LOCAL_REDIS,
    rawArtifactsDir: LOCAL_ARTIFACTS,
    configRoot: CONFIG_ROOT,
    appEnv: "development",
    nodeEnv: "development",
    env: {
      APP_ENV: "development",
      NODE_ENV: "development",
    },
    ...overrides,
  };
}

function deployedGateInput(overrides: Record<string, unknown> = {}) {
  return {
    target: "deployed-test",
    keepUserId: KEEP_USER,
    keepBnetAccountId: KEEP_BNET,
    confirmationToken: IDENTITY_RESET_DEPLOYED_TEST_CONFIRMATION_TOKEN,
    expectedDatabaseName: IDENTITY_RESET_DEPLOYED_TEST_DATABASE_NAME,
    databaseUrl: DEPLOYED_DB,
    redisUrl: DEPLOYED_REDIS,
    rawArtifactsDir: "/data/raw-artifacts",
    configRoot: CONFIG_ROOT,
    appEnv: "staging",
    nodeEnv: "production",
    cleanupTarget: "deployed-test",
    identityResetEnvironmentId: IDENTITY_RESET_DEPLOYED_TEST_ENVIRONMENT_ID,
    writersStopped: "true",
    env: {
      APP_ENV: "staging",
      NODE_ENV: "production",
      MPLUS_CLEANUP_TARGET: "deployed-test",
      MPLUS_IDENTITY_RESET_ENVIRONMENT_ID: IDENTITY_RESET_DEPLOYED_TEST_ENVIRONMENT_ID,
      MPLUS_DEPLOYED_TEST_WRITERS_STOPPED: "true",
    },
    ...overrides,
  };
}

describe("identity reset CLI contract (guard)", () => {
  it("1. target argument is mandatory", () => {
    const result = assertIdentityDataResetAllowed(
      localGateInput({ target: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockedConditions.join(" ")).toMatch(/--target is mandatory/);
  });

  it("2. unknown target is refused", () => {
    const result = assertIdentityDataResetAllowed(
      localGateInput({ target: "staging" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockedConditions.join(" ")).toMatch(/unknown --target/);
  });

  it("5/6. local confirmation token is required and target-specific", () => {
    expect(
      assertIdentityDataResetAllowed(localGateInput({ confirmationToken: null })).ok,
    ).toBe(false);
    expect(
      assertIdentityDataResetAllowed(
        localGateInput({
          confirmationToken: IDENTITY_RESET_DEPLOYED_TEST_CONFIRMATION_TOKEN,
        }),
      ).ok,
    ).toBe(false);
  });

  it("7/8/9. deployed-test token is target-specific; cross-tokens refused", () => {
    expect(
      assertIdentityDataResetAllowed(
        deployedGateInput({
          confirmationToken: IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN,
        }),
      ).ok,
    ).toBe(false);
    expect(assertIdentityDataResetAllowed(deployedGateInput()).ok).toBe(true);
  });

  it("10. production APP_ENV is refused", () => {
    expect(
      assertIdentityDataResetAllowed(localGateInput({ appEnv: "production" })).ok,
    ).toBe(false);
    expect(
      assertIdentityDataResetAllowed(deployedGateInput({ appEnv: "production" })).ok,
    ).toBe(false);
  });

  it("11. production NODE_ENV is refused for local-development", () => {
    expect(
      assertIdentityDataResetAllowed(localGateInput({ nodeEnv: "production" })).ok,
    ).toBe(false);
  });

  it("12/13/14. local refuses remote DB, wrong name, remote Redis", () => {
    expect(
      assertIdentityDataResetAllowed(
        localGateInput({
          databaseUrl: "postgresql://u:p@db.example.com:5432/mplus_trust",
        }),
      ).ok,
    ).toBe(false);
    expect(
      assertIdentityDataResetAllowed(
        localGateInput({
          databaseUrl: "postgresql://u:p@localhost:5432/mplus_itest_abcdef12",
        }),
      ).ok,
    ).toBe(false);
    expect(
      assertIdentityDataResetAllowed(
        localGateInput({ redisUrl: "redis://redis.example.com:6379" }),
      ).ok,
    ).toBe(false);
  });

  it("15/16/17. deployed-test requires cleanup target + expected DB name match", () => {
    expect(
      assertIdentityDataResetAllowed(
        deployedGateInput({ cleanupTarget: "", env: { APP_ENV: "staging" } }),
      ).ok,
    ).toBe(false);
    expect(
      assertIdentityDataResetAllowed(
        deployedGateInput({ expectedDatabaseName: null }),
      ).ok,
    ).toBe(false);
    expect(
      assertIdentityDataResetAllowed(
        deployedGateInput({ expectedDatabaseName: "other_db" }),
      ).ok,
    ).toBe(false);
  });

  it("18/19. generic remote / production-like targets refused", () => {
    expect(
      assertIdentityDataResetAllowed(
        deployedGateInput({
          identityResetEnvironmentId: "",
          databaseUrl: "postgresql://u:p@db.example.com:5432/mplus_trust_test",
        }),
      ).ok,
    ).toBe(false);
    expect(
      assertIdentityDataResetAllowed(
        deployedGateInput({
          databaseUrl: "postgresql://u:p@mplus-prod.example:5432/mplus_trust_prod",
          expectedDatabaseName: "mplus_trust_prod",
        }),
      ).ok,
    ).toBe(false);
  });

  it("20. malformed retained UUID is refused", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(
      assertIdentityDataResetAllowed(localGateInput({ keepUserId: "nope" })).ok,
    ).toBe(false);
  });

  it("42. missing deployed-test maintenance assertion blocks execute", () => {
    const result = assertIdentityDataResetAllowed(
      deployedGateInput({ execute: true, writersStopped: "false" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockedConditions.join(" ")).toMatch(
        /MPLUS_DEPLOYED_TEST_WRITERS_STOPPED/,
      );
    }
  });

  it("50. local and deployed-test safety matrices cannot be confused", () => {
    // Local token + deployed target
    expect(
      assertIdentityDataResetAllowed(
        deployedGateInput({
          confirmationToken: IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN,
        }),
      ).ok,
    ).toBe(false);
    // Deployed cleanup flag on local target
    expect(
      assertIdentityDataResetAllowed(
        localGateInput({ cleanupTarget: "deployed-test" }),
      ).ok,
    ).toBe(false);
    // Local host with deployed-test target
    expect(
      assertIdentityDataResetAllowed(
        deployedGateInput({
          databaseUrl: LOCAL_DB,
          expectedDatabaseName: IDENTITY_RESET_LOCAL_DATABASE_NAME,
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts exact local and deployed-test matrices", () => {
    const local = assertIdentityDataResetAllowed(localGateInput());
    expect(local.ok).toBe(true);
    if (local.ok) {
      expect(local.databaseName).toBe("mplus_trust");
      expect(local.redisEnvSegment).toBe("development");
      expect(local.artifactsDir).toBe(path.resolve(CONFIG_ROOT, LOCAL_ARTIFACTS));
    }
    const deployed = assertIdentityDataResetAllowed(deployedGateInput());
    expect(deployed.ok).toBe(true);
    if (deployed.ok) {
      expect(deployed.deployedTestClassification).toBe("canonical-deployed-test");
      expect(deployed.redisEnvSegment).toBe("staging");
    }
  });
});

describe("table classification", () => {
  it("classifies every Prisma-mapped table and reuses WCL clear list", () => {
    expect(classifyIdentityDataTables()).toEqual({ ok: true });
    for (const table of WCL_SCORING_DERIVED_CLEAR_TABLES) {
      expect(IDENTITY_DATA_TRUNCATE_TABLES).toContain(table);
    }
    for (const table of ["regions", "realms", "seasons", "score_models", "roles"]) {
      expect(IDENTITY_DATA_STATIC_RETAIN_TABLES).toContain(table);
    }
    expect(ALL_PRISMA_MAPPED_TABLES.length).toBeGreaterThan(50);
  });

  it("uses mapped Scoring V2 physical table names in the truncate plan", () => {
    for (const table of ["scoring_v2_shadow_canaries", "scoring_v2_evidence_exports"] as const) {
      expect(ALL_PRISMA_MAPPED_TABLES).toContain(table);
      expect(WCL_SCORING_DERIVED_CLEAR_TABLES).toContain(table);
      expect(IDENTITY_DATA_TRUNCATE_TABLES).toContain(table);
    }
    for (const stale of ["scoring_shadow_canaries", "scoring_evidence_exports"] as const) {
      expect(ALL_PRISMA_MAPPED_TABLES).not.toContain(stale);
      expect(WCL_SCORING_DERIVED_CLEAR_TABLES).not.toContain(stale);
      expect(IDENTITY_DATA_TRUNCATE_TABLES).not.toContain(stale);
    }
  });

  it("44. Redis prefixes never include FLUSHALL wildcards", () => {
    const prefixes = identityResetRedisKeyPrefixes("development");
    expect(prefixes.some((p) => p.startsWith("mplus:development:"))).toBe(true);
    expect(prefixes.every((p) => p !== "*" && p !== "*:*")).toBe(true);
  });
});

describe("live writers / locks", () => {
  function mockPrisma() {
    return {
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes("pg_catalog.pg_class") || sql.includes('AS "exists"')) {
          return [{ exists: true }];
        }
        if (sql.includes("ingestion_jobs")) return [{ count: 3n }];
        if (sql.includes("scoring_v2_shadow_canaries")) return [{ count: 1n }];
        if (sql.includes("bulk_operations")) return [{ count: 0n }];
        if (sql.includes("score_analysis_batches")) return [{ count: 0n }];
        return [{ count: 0n }];
      }),
      user: { findUnique: vi.fn(), findFirst: vi.fn() },
      battleNetAccount: { findUnique: vi.fn(), findFirst: vi.fn() },
      userRoleAssignment: { findFirst: vi.fn() },
      $executeRawUnsafe: vi.fn(),
      $executeRaw: vi.fn(),
      $transaction: vi.fn(),
    };
  }

  it("38. active BullMQ job blocks execution", async () => {
    const probe = await probeIdentityActiveWriters({
      prisma: mockPrisma() as never,
      redis: idleRedis({
        llen: vi.fn(async (key) => (key.includes(":active") ? 2 : 0)),
      }),
      redisEnvSegment: "development",
    });
    expect(probe.blocked).toBe(true);
    expect(probe.liveBullmqActiveJobs).toBeGreaterThan(0);
  });

  it("39. active queue lock blocks execution", async () => {
    const probe = await probeIdentityActiveWriters({
      prisma: mockPrisma() as never,
      redis: idleRedis({
        keys: vi.fn(async (pattern) =>
          pattern.includes(":lock") ? ["bull:refresh-character:1:lock"] : [],
        ),
      }),
      redisEnvSegment: "development",
    });
    expect(probe.blocked).toBe(true);
  });

  it("40. active refresh reservation blocks execution", async () => {
    const probe = await probeIdentityActiveWriters({
      prisma: mockPrisma() as never,
      redis: idleRedis({
        keys: vi.fn(async (pattern) =>
          pattern.includes("refresh:") && pattern.includes("reservation")
            ? ["mplus:development:refresh:x:reservation"]
            : [],
        ),
      }),
      redisEnvSegment: "development",
    });
    expect(probe.blocked).toBe(true);
  });

  it("41. stale DB statuses alone do not block when Redis proves idle", async () => {
    const probe = await probeIdentityActiveWriters({
      prisma: mockPrisma() as never,
      redis: idleRedis(),
      redisEnvSegment: "development",
    });
    expect(probe.staleDbStatuses.ingestionJobsQueuedOrActive).toBe(3);
    expect(probe.blocked).toBe(false);
  });

  it("43. concurrent reset lock blocks execution", async () => {
    const redis = idleRedis({
      set: vi.fn(async () => null),
    });
    const lock = await acquireIdentityResetLock({
      redis,
      redisEnvSegment: "development",
    });
    expect(lock.acquired).toBe(false);
  });

  it("45. unclassified relevant Redis keys block plan", async () => {
    const gate = assertIdentityDataResetAllowed(localGateInput());
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;

    const prisma = {
      ...mockPrisma(),
      user: {
        findUnique: vi.fn(async () => ({
          id: KEEP_USER,
          role: "ADMIN",
          disabledAt: null,
          roleAssignments: [],
        })),
      },
      battleNetAccount: {
        findUnique: vi.fn(async () => ({
          id: KEEP_BNET,
          userId: KEEP_USER,
          providerAccountId: "p",
          regionId: null,
          battletagHash: "h",
          battletagDisplay: null,
          claimed: true,
          linkedAt: new Date("2024-01-01T00:00:00.000Z"),
          unlinkedAt: null,
          accessTokenEncrypted: "a",
          refreshTokenEncrypted: "r",
          tokenExpiresAt: null,
          grantedScopes: "openid",
          lastOwnershipSyncAt: new Date(),
          lastOwnershipSyncError: null,
          lastDiscoveryJobId: null,
          lastDiscoveryStatus: "ok",
          lastDiscoveryStartedAt: null,
          lastDiscoveryFinishedAt: null,
          lastDiscoveryError: null,
          lastDiscoveryCounters: null,
          lastDiscoveryOwnershipSyncAt: null,
        })),
      },
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes("pg_catalog.pg_class") || sql.includes('AS "exists"')) {
          return [{ exists: true }];
        }
        return [{ count: 0n }];
      }),
    };

    const redis = idleRedis({
      keys: vi.fn(async (pattern: string) => {
        if (pattern === "bull:*") return ["bull:mystery-score-queue:active"];
        return [];
      }),
    });

    const plan = await buildIdentityDataResetPlan({
      prisma: prisma as never,
      gate,
      execute: false,
      redis,
    });
    expect(plan.mode).toBe("DRY-RUN");
    expect(plan.blockedConditions.join(" ")).toMatch(/unclassified relevant Redis/);
  });

  it("classifies scoring-v2 BullMQ prefixes as reset-owned", async () => {
    const gate = assertIdentityDataResetAllowed(localGateInput());
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;

    const prefixes = identityResetRedisKeyPrefixes("development");
    expect(prefixes).toEqual(
      expect.arrayContaining([
        "bull:scoring-v2-shadow-canary",
        "bull:scoring-v2-evidence-export",
      ]),
    );

    const prisma = {
      ...mockPrisma(),
      user: {
        findUnique: vi.fn(async () => ({
          id: KEEP_USER,
          role: "ADMIN",
          disabledAt: null,
          roleAssignments: [],
        })),
      },
      battleNetAccount: {
        findUnique: vi.fn(async () => ({
          id: KEEP_BNET,
          userId: KEEP_USER,
          providerAccountId: "p",
          regionId: null,
          battletagHash: "h",
          battletagDisplay: null,
          claimed: true,
          linkedAt: new Date("2024-01-01T00:00:00.000Z"),
          unlinkedAt: null,
          accessTokenEncrypted: "a",
          refreshTokenEncrypted: "r",
          tokenExpiresAt: null,
          grantedScopes: "openid",
          lastOwnershipSyncAt: new Date(),
          lastOwnershipSyncError: null,
          lastDiscoveryJobId: null,
          lastDiscoveryStatus: "ok",
          lastDiscoveryStartedAt: null,
          lastDiscoveryFinishedAt: null,
          lastDiscoveryError: null,
          lastDiscoveryCounters: null,
          lastDiscoveryOwnershipSyncAt: null,
        })),
      },
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes("pg_catalog.pg_class") || sql.includes('AS "exists"')) {
          return [{ exists: true }];
        }
        return [{ count: 0n }];
      }),
    };

    const ownedKeys = [
      "bull:scoring-v2-shadow-canary:completed",
      "bull:scoring-v2-shadow-canary:meta",
      "bull:scoring-v2-evidence-export:meta",
      "bull:scoring-v2-evidence-export:id",
    ];
    const redis = idleRedis({
      keys: vi.fn(async (pattern: string) => {
        if (pattern === "bull:*") return ownedKeys;
        if (pattern.startsWith("bull:scoring-v2-")) {
          return ownedKeys.filter((k) => k.startsWith(pattern.replace(/\*$/, "")));
        }
        return [];
      }),
    });

    const plan = await buildIdentityDataResetPlan({
      prisma: prisma as never,
      gate,
      execute: false,
      redis,
    });

    expect(plan.redis.unclassifiedRelevantKeys).toEqual([]);
    expect(plan.blockedConditions.join(" ")).not.toMatch(/unclassified relevant Redis/);
    expect(plan.redis.matchingKeyCount).toBeGreaterThanOrEqual(ownedKeys.length);
    expect(plan.redis.sampleKeyCategories).toEqual(
      expect.arrayContaining([
        "bull:scoring-v2-shadow-canary",
        "bull:scoring-v2-evidence-export",
      ]),
    );
  });
});

describe("dry-run / execute planner", () => {
  function retentionPrisma() {
    const account = {
      id: KEEP_BNET,
      userId: KEEP_USER,
      providerAccountId: "provider-1",
      regionId: null,
      battletagHash: "hash",
      battletagDisplay: null,
      claimed: true,
      linkedAt: new Date("2024-01-01T00:00:00.000Z"),
      unlinkedAt: null,
      accessTokenEncrypted: "enc-a",
      refreshTokenEncrypted: "enc-r",
      tokenExpiresAt: new Date("2024-06-01T00:00:00.000Z"),
      grantedScopes: "openid wow.profile",
      lastOwnershipSyncAt: new Date("2024-02-01T00:00:00.000Z"),
      lastOwnershipSyncError: "stale",
      lastDiscoveryJobId: OTHER_USER,
      lastDiscoveryStatus: "DONE",
      lastDiscoveryStartedAt: new Date("2024-02-01T00:00:00.000Z"),
      lastDiscoveryFinishedAt: new Date("2024-02-01T00:00:01.000Z"),
      lastDiscoveryError: null,
      lastDiscoveryCounters: { found: 3 },
      lastDiscoveryOwnershipSyncAt: new Date("2024-02-01T00:00:00.000Z"),
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("pg_catalog.pg_class") || sql.includes('AS "exists"')) {
        return [{ exists: true }];
      }
      if (sql.includes('"_prisma_migrations"')) return [{ count: 10n }];
      return [{ count: 0n }];
    });
    return {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(async () => 0),
      $executeRaw: vi.fn(async () => 0),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRawUnsafe: query,
          $executeRawUnsafe: vi.fn(async () => 0),
          $executeRaw: vi.fn(async () => 0),
          user: {
            findFirst: vi.fn(async () => ({
              id: KEEP_USER,
              role: "ADMIN",
              disabledAt: null,
            })),
            findUnique: vi.fn(async () => ({
              id: KEEP_USER,
              role: "ADMIN",
              disabledAt: null,
              roleAssignments: [],
            })),
          },
          battleNetAccount: {
            findFirst: vi.fn(async () => ({ ...account, lastOwnershipSyncAt: null, lastDiscoveryStatus: null, lastOwnershipSyncError: null, lastDiscoveryJobId: null, lastDiscoveryStartedAt: null, lastDiscoveryFinishedAt: null, lastDiscoveryError: null, lastDiscoveryCounters: null, lastDiscoveryOwnershipSyncAt: null })),
            findUnique: vi.fn(async () => account),
          },
          userRoleAssignment: { findFirst: vi.fn(async () => ({ id: "a" })) },
        }),
      ),
      user: {
        findUnique: vi.fn(async () => ({
          id: KEEP_USER,
          role: "ADMIN",
          disabledAt: null,
          roleAssignments: [],
        })),
        findFirst: vi.fn(async () => ({
          id: KEEP_USER,
          role: "ADMIN",
          disabledAt: null,
        })),
      },
      battleNetAccount: {
        findUnique: vi.fn(async () => account),
        findFirst: vi.fn(async () => account),
      },
      userRoleAssignment: { findFirst: vi.fn(async () => ({ id: "a" })) },
    };
  }

  it("3/4. default dry-run performs zero mutations", async () => {
    const gate = assertIdentityDataResetAllowed(localGateInput());
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const prisma = retentionPrisma();
    const redis = idleRedis();
    const plan = await buildIdentityDataResetPlan({
      prisma: prisma as never,
      gate,
      execute: false,
      redis,
    });
    expect(plan.mode).toBe("DRY-RUN");
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("21-25. retention validation failures block plan", async () => {
    const gate = assertIdentityDataResetAllowed(localGateInput());
    if (!gate.ok) throw new Error("gate");

    const missingUser = retentionPrisma();
    missingUser.user.findUnique = vi.fn(async () => null);
    const planMissingUser = await buildIdentityDataResetPlan({
      prisma: missingUser as never,
      gate,
      execute: false,
      redis: idleRedis(),
    });
    expect(planMissingUser.blockedConditions.join(" ")).toMatch(/does not exist/);

    const wrongOwner = retentionPrisma();
    wrongOwner.battleNetAccount.findUnique = vi.fn(async () => ({
      ...(await retentionPrisma().battleNetAccount.findUnique()),
      userId: OTHER_USER,
    }));
    const planWrong = await buildIdentityDataResetPlan({
      prisma: wrongOwner as never,
      gate,
      execute: false,
      redis: idleRedis(),
    });
    expect(planWrong.blockedConditions.join(" ")).toMatch(/userId does not equal/);

    const nonAdmin = retentionPrisma();
    nonAdmin.user.findUnique = vi.fn(async () => ({
      id: KEEP_USER,
      role: "USER",
      disabledAt: null,
      roleAssignments: [],
    }));
    const planNonAdmin = await buildIdentityDataResetPlan({
      prisma: nonAdmin as never,
      gate,
      execute: false,
      redis: idleRedis(),
    });
    expect(planNonAdmin.blockedConditions.join(" ")).toMatch(/not an administrator/);

    const disabled = retentionPrisma();
    disabled.user.findUnique = vi.fn(async () => ({
      id: KEEP_USER,
      role: "ADMIN",
      disabledAt: new Date(),
      roleAssignments: [],
    }));
    const planDisabled = await buildIdentityDataResetPlan({
      prisma: disabled as never,
      gate,
      execute: false,
      redis: idleRedis(),
    });
    expect(planDisabled.blockedConditions.join(" ")).toMatch(/disabled/);
  });

  it("46. artifact backend refusal occurs before DB mutation (gate)", () => {
    const result = assertIdentityDataResetAllowed(
      localGateInput({ rawArtifactsDir: "s3://bucket/path" }),
    );
    expect(result.ok).toBe(false);
  });

  it("execute refuses without lock / with writers", async () => {
    const gate = assertIdentityDataResetAllowed(localGateInput());
    if (!gate.ok) throw new Error("gate");
    const prisma = retentionPrisma();
    const redis = idleRedis({
      llen: vi.fn(async () => 1),
      set: vi.fn(async () => "OK"),
    });
    const plan = await buildIdentityDataResetPlan({
      prisma: prisma as never,
      gate,
      execute: true,
      redis,
    });
    expect(plan.activeWriters.blocked).toBe(true);
    await expect(
      executeIdentityDataReset({ prisma: prisma as never, plan, redis }),
    ).rejects.toThrow(/Refusing execute/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("skips configured reset tables that are absent from the live DB", async () => {
    const gate = assertIdentityDataResetAllowed(localGateInput());
    if (!gate.ok) throw new Error("gate");

    const missingTable = "audit_events";
    const prisma = retentionPrisma();
    prisma.$queryRawUnsafe = vi.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes("pg_catalog.pg_class") || sql.includes('AS "exists"')) {
        const table = String(params[0] ?? "");
        return [{ exists: table !== missingTable }];
      }
      if (sql.includes('"_prisma_migrations"')) return [{ count: 10n }];
      const match = /FROM "([^"]+)"/.exec(sql);
      const table = match?.[1] ?? "";
      if (table === "users" || table === "battlenet_accounts") return [{ count: 2n }];
      if (table === "characters") return [{ count: 5n }];
      if (table === "scoring_v2_shadow_canaries" || table === "scoring_v2_evidence_exports") {
        return [{ count: 1n }];
      }
      return [{ count: 0n }];
    });

    const plan = await buildIdentityDataResetPlan({
      prisma: prisma as never,
      gate,
      execute: false,
      redis: idleRedis(),
    });

    expect(plan.mode).toBe("DRY-RUN");
    expect(plan.skippedMissingTables).toContain(missingTable);
    expect(plan.plannedTruncations.some((t) => t.table === missingTable)).toBe(false);
    expect(plan.plannedTruncations.some((t) => t.table === "characters")).toBe(true);
    expect(plan.plannedTruncations.find((t) => t.table === "characters")?.rowCount).toBe(5);
    expect(plan.plannedTruncations.some((t) => t.table === "scoring_v2_shadow_canaries")).toBe(
      true,
    );
    expect(plan.plannedTruncations.some((t) => t.table === "scoring_v2_evidence_exports")).toBe(
      true,
    );
    expect(plan.warnings.join(" ")).toMatch(/skipped missing reset-plan table/);
    expect(formatIdentityPlanTerminalSummary(plan)).toMatch(/skipped missing tables: 1/);
    expect(formatIdentityPlanTerminalSummary(plan)).toContain(missingTable);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
