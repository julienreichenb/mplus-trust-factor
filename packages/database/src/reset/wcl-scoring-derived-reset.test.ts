import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findMonorepoConfigRoot } from "@mplus/artifact-store";
import {
  assertWclScoringDerivedResetAllowed,
  resolveLocalArtifactsDir,
  WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
  WCL_SCORING_DERIVED_RESET_DATABASE_NAME,
} from "./wcl-scoring-derived-reset-guard.js";
import {
  ALL_PRISMA_MAPPED_TABLES,
  REQUIRED_WCL_OWNERSHIP_CLEAR_TABLES,
  WCL_SCORING_DERIVED_CLEAR_TABLES,
  WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES,
  WCL_SCORING_DERIVED_RETAIN_TABLES,
  classifyAllPrismaMappedTables,
} from "./wcl-scoring-derived-table-plan.js";
import {
  buildWclScoringDerivedResetPlan,
  executeWclScoringDerivedReset,
  probeActiveWriters,
  type RedisScanner,
} from "./wcl-scoring-derived-reset.js";

const LOCAL_DB = `postgresql://u:p@localhost:5432/${WCL_SCORING_DERIVED_RESET_DATABASE_NAME}`;
const LOCAL_REDIS = "redis://127.0.0.1:6379";
const CONFIG_ROOT = findMonorepoConfigRoot(process.cwd())!;
const LOCAL_ARTIFACTS = "./data/raw-artifacts";

function idleRedis(overrides: Partial<RedisScanner> = {}): RedisScanner {
  return {
    keys: vi.fn(async () => []),
    del: vi.fn(async () => 0),
    llen: vi.fn(async () => 0),
    exists: vi.fn(async () => 0),
    quit: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("assertWclScoringDerivedResetAllowed", () => {
  it("rejects missing confirmation", () => {
    const result = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: LOCAL_ARTIFACTS,
      configRoot: CONFIG_ROOT,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects production and staging", () => {
    for (const appEnv of ["production", "prod", "staging", "test"]) {
      const result = assertWclScoringDerivedResetAllowed({
        appEnv,
        confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
        databaseUrl: LOCAL_DB,
        redisUrl: LOCAL_REDIS,
        rawArtifactsDir: LOCAL_ARTIFACTS,
        configRoot: CONFIG_ROOT,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects remote hosts", () => {
    const result = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: "postgresql://u:p@db.example.com:5432/mplus_trust",
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: LOCAL_ARTIFACTS,
      configRoot: CONFIG_ROOT,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects container-network hosts", () => {
    const result = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: "postgresql://u:p@postgres:5432/mplus_trust",
      redisUrl: "redis://redis:6379",
      rawArtifactsDir: LOCAL_ARTIFACTS,
      configRoot: CONFIG_ROOT,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects wrong database name", () => {
    const result = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: "postgresql://u:p@localhost:5432/mplus_itest_abcdef12",
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: LOCAL_ARTIFACTS,
      configRoot: CONFIG_ROOT,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts exact local development target", () => {
    const result = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: LOCAL_ARTIFACTS,
      configRoot: CONFIG_ROOT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.databaseName).toBe("mplus_trust");
      expect(result.databaseHost).toBe("localhost");
      expect(result.artifactsDir).toBe(path.resolve(CONFIG_ROOT, LOCAL_ARTIFACTS));
    }
  });

  it("rejects absent / guessed artifact path and remote CAS backends", () => {
    expect(
      resolveLocalArtifactsDir(undefined, CONFIG_ROOT).ok,
    ).toBe(false);
    expect(resolveLocalArtifactsDir("", CONFIG_ROOT).ok).toBe(false);
    expect(resolveLocalArtifactsDir("s3://bucket/path", CONFIG_ROOT).ok).toBe(false);
    expect(resolveLocalArtifactsDir("https://cdn.example/artifacts", CONFIG_ROOT).ok).toBe(
      false,
    );
    expect(resolveLocalArtifactsDir("./data/raw-artifacts", null).ok).toBe(false);
    expect(resolveLocalArtifactsDir("./data/raw-artifacts", CONFIG_ROOT).ok).toBe(true);

    const missing = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: null,
      configRoot: CONFIG_ROOT,
    });
    expect(missing.ok).toBe(false);
  });

  it("resolves relative CAS paths from config root, not package cwd", () => {
    const resolved = resolveLocalArtifactsDir("./data/raw-artifacts", CONFIG_ROOT);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.path).toBe(path.resolve(CONFIG_ROOT, "data/raw-artifacts"));
    expect(resolved.path).not.toBe(
      path.resolve(path.join(CONFIG_ROOT, "packages", "database"), "data/raw-artifacts"),
    );
  });
});

describe("table classification", () => {
  it("classifies every current Prisma-mapped table", () => {
    const result = classifyAllPrismaMappedTables();
    expect(result).toEqual({ ok: true });
    expect(ALL_PRISMA_MAPPED_TABLES.length).toBe(
      WCL_SCORING_DERIVED_CLEAR_TABLES.length + WCL_SCORING_DERIVED_RETAIN_TABLES.length,
    );
  });

  it("includes newly introduced WCL ownership tables in clear list", () => {
    for (const table of REQUIRED_WCL_OWNERSHIP_CLEAR_TABLES) {
      expect(WCL_SCORING_DERIVED_CLEAR_TABLES).toContain(table);
    }
  });

  it("does not clear retained identity/catalog tables", () => {
    const clear = new Set<string>(WCL_SCORING_DERIVED_CLEAR_TABLES);
    for (const table of [
      "users",
      "characters",
      "regions",
      "realms",
      "seasons",
      "score_models",
      "calibration_cohorts",
      "calibration_cohort_members",
    ]) {
      expect(clear.has(table)).toBe(false);
      expect(WCL_SCORING_DERIVED_RETAIN_TABLES).toContain(table);
    }
  });

  it("uses namespace-scoped Redis prefixes and never FLUSHALL", () => {
    expect(WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES.some((p) => p.startsWith("mplus:"))).toBe(
      true,
    );
    expect(WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES.every((p) => p !== "*")).toBe(true);
  });
});

describe("live writers vs stale DB statuses", () => {
  function mockPrismaWithStaleWriters() {
    return {
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes("pg_catalog.pg_class") || sql.includes('AS "exists"')) {
          return [{ exists: true }];
        }
        if (sql.includes("ingestion_jobs")) return [{ count: 4n }];
        if (sql.includes("scoring_v2_shadow_canaries")) {
          return [{ count: 2n }];
        }
        if (sql.includes("bulk_operations")) return [{ count: 1n }];
        if (sql.includes("score_analysis_batches")) return [{ count: 1n }];
        if (sql.includes("COUNT(*)")) return [{ count: 0n }];
        return [];
      }),
      $executeRawUnsafe: vi.fn(async () => 0),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRawUnsafe: vi.fn(async (sql: string) => {
            if (sql.includes("pg_catalog.pg_class") || sql.includes('AS "exists"')) {
              return [{ exists: true }];
            }
            if (sql.includes("COUNT(*)")) return [{ count: 0n }];
            return [];
          }),
          $executeRawUnsafe: vi.fn(async () => 0),
        }),
      ),
      $disconnect: vi.fn(async () => undefined),
    };
  }

  it("allows reset when DB statuses are stale but Redis shows no live writers", async () => {
    const prisma = mockPrismaWithStaleWriters();
    const redis = idleRedis();
    const probe = await probeActiveWriters({ prisma: prisma as never, redis });
    expect(probe.staleDbStatuses.ingestionJobsQueuedOrActive).toBe(4);
    expect(probe.liveBullmqActiveJobs).toBe(0);
    expect(probe.blocked).toBe(false);
    expect(probe.redisProbeAvailable).toBe(true);
  });

  it("blocks when BullMQ active lists are non-empty", async () => {
    const prisma = mockPrismaWithStaleWriters();
    const redis = idleRedis({
      llen: vi.fn(async (key: string) => (key === "bull:scoring-shadow-canary:active" ? 1 : 0)),
    });
    const probe = await probeActiveWriters({ prisma: prisma as never, redis });
    expect(probe.liveBullmqActiveJobs).toBe(1);
    expect(probe.blocked).toBe(true);
  });

  it("blocks when worker lock / permit keys are held", async () => {
    const prisma = mockPrismaWithStaleWriters();
    const redis = idleRedis({
      keys: vi.fn(async (pattern: string) => {
        if (pattern.includes(":lock")) return ["bull:refresh-character:42:lock"];
        return [];
      }),
    });
    const probe = await probeActiveWriters({ prisma: prisma as never, redis });
    expect(probe.liveLockOrPermitKeys).toBe(1);
    expect(probe.blocked).toBe(true);
  });

  it("fails closed when Redis probe is unavailable", async () => {
    const prisma = mockPrismaWithStaleWriters();
    const probe = await probeActiveWriters({ prisma: prisma as never, redis: null });
    expect(probe.blocked).toBe(true);
    expect(probe.redisProbeAvailable).toBe(false);
  });
});

describe("dry-run / execute planner", () => {
  function mockPrisma(counts: Record<string, number> = {}) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("pg_catalog.pg_class") || sql.includes('AS "exists"')) {
        return [{ exists: true }];
      }
      if (sql.includes("COUNT(*)") && sql.includes('"_prisma_migrations"')) {
        return [{ count: 12n }];
      }
      if (sql.includes("COUNT(*)") && sql.includes("ingestion_jobs")) {
        return [{ count: 0n }];
      }
      if (
        sql.includes("COUNT(*)") &&
        sql.includes("scoring_v2_shadow_canaries")
      ) {
        return [{ count: 0n }];
      }
      if (sql.includes("COUNT(*)") && sql.includes("bulk_operations")) {
        return [{ count: 0n }];
      }
      if (sql.includes("COUNT(*)") && sql.includes("score_analysis_batches")) {
        return [{ count: 0n }];
      }
      const match = /FROM "([^"]+)"/.exec(sql);
      const table = match?.[1] ?? "";
      return [{ count: BigInt(counts[table] ?? 0) }];
    });
    const execute = vi.fn(async () => 0);
    const txClient = { $queryRawUnsafe: query, $executeRawUnsafe: execute };
    return {
      $queryRawUnsafe: query,
      $executeRawUnsafe: execute,
      $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
      $disconnect: vi.fn(async () => undefined),
    };
  }

  it("dry-run performs no mutations", async () => {
    const prisma = mockPrisma({
      evidence_dataset_pages: 3,
      users: 2,
      characters: 5,
    });
    const gate = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: LOCAL_ARTIFACTS,
      configRoot: CONFIG_ROOT,
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;

    const redis = idleRedis({
      keys: vi.fn(async () => ["mplus:development:wcl-v2:global:count"]),
    });

    const plan = await buildWclScoringDerivedResetPlan({
      prisma: prisma as never,
      gate,
      execute: false,
      redis,
    });

    expect(plan.mode).toBe("DRY-RUN");
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(plan.clearTables.find((t) => t.table === "evidence_dataset_pages")?.rowCount).toBe(3);
  });

  it("missing --execute path never truncates even when plan is built with execute=false", async () => {
    const prisma = mockPrisma();
    const gate = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: LOCAL_ARTIFACTS,
      configRoot: CONFIG_ROOT,
    });
    if (!gate.ok) throw new Error("gate failed");
    await buildWclScoringDerivedResetPlan({
      prisma: prisma as never,
      gate,
      execute: false,
      redis: idleRedis(),
    });
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("execute refuses when live writers are present", async () => {
    const prisma = mockPrisma();
    const redis = idleRedis({
      llen: vi.fn(async (key: string) => (key.includes(":active") ? 2 : 0)),
    });
    const gate = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: LOCAL_ARTIFACTS,
      configRoot: CONFIG_ROOT,
    });
    if (!gate.ok) throw new Error("gate failed");
    const plan = await buildWclScoringDerivedResetPlan({
      prisma: prisma as never,
      gate,
      execute: true,
      redis,
    });
    expect(plan.activeWriters.blocked).toBe(true);
    await expect(
      executeWclScoringDerivedReset({ prisma: prisma as never, plan, redis }),
    ).rejects.toThrow(/active writers|Refusing execute/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("execute wraps truncate + integrity in a transaction and reports external cleanup", async () => {
    const prisma = mockPrisma({ users: 2, characters: 5 });
    // After truncate, counts are zero for cleared tables; retain counts stay.
    prisma.$queryRawUnsafe = vi.fn(async (sql: string) => {
      if (sql.includes("pg_catalog.pg_class") || sql.includes('AS "exists"')) {
        return [{ exists: true }];
      }
      if (sql.includes('"_prisma_migrations"')) return [{ count: 12n }];
      if (
        sql.includes("ingestion_jobs") ||
        sql.includes("scoring_v2_shadow_canaries") ||
        sql.includes("bulk_operations") ||
        sql.includes("score_analysis_batches")
      ) {
        return [{ count: 0n }];
      }
      const match = /FROM "([^"]+)"/.exec(sql);
      const table = match?.[1] ?? "";
      if (table === "users") return [{ count: 2n }];
      if (table === "characters") return [{ count: 5n }];
      if (
        table === "battlenet_accounts" ||
        table === "verified_character_ownerships" ||
        table === "regions" ||
        table === "realms" ||
        table === "seasons" ||
        table === "dungeons" ||
        table === "score_models" ||
        table === "calibration_cohorts" ||
        table === "calibration_cohort_members" ||
        table === "metric_definitions" ||
        table === "mechanic_rules" ||
        table === "red_flag_definitions"
      ) {
        return [{ count: 1n }];
      }
      return [{ count: 0n }];
    });
    const txQuery = prisma.$queryRawUnsafe;
    const txExecute = vi.fn(async () => 0);
    prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $queryRawUnsafe: txQuery, $executeRawUnsafe: txExecute }),
    );

    const redis = idleRedis({
      keys: vi.fn(async (pattern: string) => {
        if (
          pattern.includes(":lock") ||
          pattern.includes("wcl-v2:") ||
          pattern.includes(":active")
        ) {
          return [];
        }
        if (pattern.startsWith("mplus:development:")) {
          return ["mplus:development:cache:1"];
        }
        return [];
      }),
      del: vi.fn(async () => 1),
    });
    const gate = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: LOCAL_ARTIFACTS,
      configRoot: CONFIG_ROOT,
    });
    if (!gate.ok) throw new Error("gate failed");
    const plan = await buildWclScoringDerivedResetPlan({
      prisma: prisma as never,
      gate,
      execute: true,
      redis,
    });
    expect(plan.blockedConditions).toEqual([]);
    const result = await executeWclScoringDerivedReset({
      prisma: prisma as never,
      plan,
      redis,
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(txExecute).toHaveBeenCalledWith(
      expect.stringMatching(/^TRUNCATE TABLE .* RESTART IDENTITY CASCADE$/),
    );
    expect(result.externalCleanup.partial).toBe(false);
    expect(result.externalCleanup.redis.ok).toBe(true);
    expect(result.migrationsStillApplied).toBe(true);
  });

  it("CAS cleanup cannot target a remote backend", () => {
    const remote = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: "s3://mplus-prod-artifacts",
      configRoot: CONFIG_ROOT,
    });
    expect(remote.ok).toBe(false);
  });
});
