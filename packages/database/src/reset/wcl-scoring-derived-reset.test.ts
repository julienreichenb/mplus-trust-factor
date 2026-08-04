import { describe, expect, it, vi } from "vitest";
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
} from "./wcl-scoring-derived-reset.js";

const LOCAL_DB = `postgresql://u:p@localhost:5432/${WCL_SCORING_DERIVED_RESET_DATABASE_NAME}`;
const LOCAL_REDIS = "redis://127.0.0.1:6379";

describe("assertWclScoringDerivedResetAllowed", () => {
  it("rejects missing confirmation", () => {
    const result = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: "./data/raw-artifacts",
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
        rawArtifactsDir: "./data/raw-artifacts",
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
      rawArtifactsDir: "./data/raw-artifacts",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects container-network hosts", () => {
    const result = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: "postgresql://u:p@postgres:5432/mplus_trust",
      redisUrl: "redis://redis:6379",
      rawArtifactsDir: "./data/raw-artifacts",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects wrong database name", () => {
    const result = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: "postgresql://u:p@localhost:5432/mplus_itest_abcdef12",
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: "./data/raw-artifacts",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts exact local development target", () => {
    const result = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: "./data/raw-artifacts",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.databaseName).toBe("mplus_trust");
      expect(result.databaseHost).toBe("localhost");
    }
  });

  it("rejects remote CAS / object-storage artifact backends", () => {
    expect(resolveLocalArtifactsDir("s3://bucket/path").ok).toBe(false);
    expect(resolveLocalArtifactsDir("https://cdn.example/artifacts").ok).toBe(false);
    expect(resolveLocalArtifactsDir("./data/raw-artifacts").ok).toBe(true);
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

describe("dry-run / execute planner", () => {
  function mockPrisma(counts: Record<string, number> = {}) {
    return {
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes("COUNT(*)") && sql.includes('"_prisma_migrations"')) {
          return [{ count: 12n }];
        }
        if (sql.includes("COUNT(*)") && sql.includes("ingestion_jobs")) {
          return [{ count: 0n }];
        }
        if (sql.includes("COUNT(*)") && sql.includes("scoring_v2_shadow_canaries")) {
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
      }),
      $executeRawUnsafe: vi.fn(async () => 0),
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
      rawArtifactsDir: "./data/raw-artifacts",
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;

    const redis = {
      keys: vi.fn(async () => ["mplus:development:wcl-v2:global:count"]),
      del: vi.fn(async () => 0),
      quit: vi.fn(async () => undefined),
    };

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
      rawArtifactsDir: "./data/raw-artifacts",
    });
    if (!gate.ok) throw new Error("gate failed");
    await buildWclScoringDerivedResetPlan({
      prisma: prisma as never,
      gate,
      execute: false,
      redis: null,
    });
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("execute refuses when active writers are present", async () => {
    const prisma = mockPrisma();
    prisma.$queryRawUnsafe = vi.fn(async (sql: string) => {
      if (sql.includes("ingestion_jobs")) return [{ count: 2n }];
      if (sql.includes("COUNT(*)")) return [{ count: 0n }];
      return [];
    });
    const gate = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: "./data/raw-artifacts",
    });
    if (!gate.ok) throw new Error("gate failed");
    const plan = await buildWclScoringDerivedResetPlan({
      prisma: prisma as never,
      gate,
      execute: true,
      redis: null,
    });
    expect(plan.activeWriters.blocked).toBe(true);
    await expect(
      executeWclScoringDerivedReset({ prisma: prisma as never, plan, redis: null }),
    ).rejects.toThrow(/active writers|Refusing execute/i);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("CAS cleanup cannot target a remote backend", () => {
    const remote = assertWclScoringDerivedResetAllowed({
      appEnv: "development",
      confirmationToken: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
      databaseUrl: LOCAL_DB,
      redisUrl: LOCAL_REDIS,
      rawArtifactsDir: "s3://mplus-prod-artifacts",
    });
    expect(remote.ok).toBe(false);
  });
});
