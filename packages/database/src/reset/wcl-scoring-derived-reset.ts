/**
 * Local WCL / scoring-derived reset planner + executor.
 * Default mode is DRY-RUN. Mutations require --execute after all safety gates.
 */
import { createHash } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  assertWclScoringDerivedResetAllowed,
  type WclScoringDerivedResetGuardResult,
} from "./wcl-scoring-derived-reset-guard.js";
import {
  WCL_SCORING_DERIVED_CLEAR_TABLES,
  WCL_SCORING_DERIVED_IMPORTANT_RETAIN_TABLES,
  WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES,
  WCL_SCORING_DERIVED_RETAIN_TABLES,
  classifyAllPrismaMappedTables,
} from "./wcl-scoring-derived-table-plan.js";

export type ActiveWriterProbe = {
  ingestionJobsActive: number;
  shadowCanariesActive: number;
  bulkOperationsActive: number;
  scoreBatchesActive: number;
  blocked: boolean;
  detail: string[];
};

export type ArtifactCleanupPlan = {
  rootDir: string;
  resolvedRootDir: string;
  fileCount: number;
  totalBytes: number;
  backend: "local-fs";
};

export type RedisCleanupPlan = {
  sanitizedUrl: string;
  prefixes: string[];
  matchingKeyCount: number;
  sampleKeys: string[];
  flushAllUsed: false;
};

export type WclScoringDerivedResetPlan = {
  mode: "DRY-RUN" | "EXECUTE";
  sanitizedDatabase: string;
  sanitizedRedis: string;
  databaseName: string;
  databaseHost: string;
  clearTables: Array<{ table: string; rowCount: number }>;
  retainTables: Array<{ table: string; rowCount: number | null }>;
  importantRetainTables: Array<{ table: string; rowCount: number }>;
  redis: RedisCleanupPlan;
  artifacts: ArtifactCleanupPlan;
  activeWriters: ActiveWriterProbe;
  warnings: string[];
  blockedConditions: string[];
  classificationOk: boolean;
  prismaMigrationsApplied: boolean | null;
};

export type RedisScanner = {
  keys(pattern: string): Promise<string[]>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<void>;
};

async function countTable(prisma: PrismaClient, table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
  );
  const raw = rows[0]?.count ?? 0;
  return typeof raw === "bigint" ? Number(raw) : Number(raw);
}

export async function probeActiveWriters(prisma: PrismaClient): Promise<ActiveWriterProbe> {
  const detail: string[] = [];
  const ingestion = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "ingestion_jobs" WHERE status IN ('QUEUED', 'ACTIVE')`,
  );
  const canaries = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "scoring_v2_shadow_canaries" WHERE UPPER(status) IN ('QUEUED', 'RUNNING', 'PENDING', 'STARTED', 'ACTIVE')`,
  );
  const bulk = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "bulk_operations" WHERE status IN ('PENDING', 'SELECTING', 'RUNNING', 'PAUSED')`,
  );
  const batches = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "score_analysis_batches" WHERE finalization_status IN ('PENDING', 'READY_TO_FINALIZE', 'FINALIZING')`,
  );

  const toNum = (v: bigint | number | undefined) =>
    typeof v === "bigint" ? Number(v) : Number(v ?? 0);

  const ingestionJobsActive = toNum(ingestion[0]?.count);
  const shadowCanariesActive = toNum(canaries[0]?.count);
  const bulkOperationsActive = toNum(bulk[0]?.count);
  const scoreBatchesActive = toNum(batches[0]?.count);

  if (ingestionJobsActive > 0) {
    detail.push(`${ingestionJobsActive} active ingestion_jobs (QUEUED/ACTIVE)`);
  }
  if (shadowCanariesActive > 0) {
    detail.push(`${shadowCanariesActive} active scoring_v2_shadow_canaries`);
  }
  if (bulkOperationsActive > 0) {
    detail.push(`${bulkOperationsActive} active bulk_operations`);
  }
  if (scoreBatchesActive > 0) {
    detail.push(`${scoreBatchesActive} active score_analysis_batches`);
  }

  return {
    ingestionJobsActive,
    shadowCanariesActive,
    bulkOperationsActive,
    scoreBatchesActive,
    blocked: detail.length > 0,
    detail,
  };
}

async function scanArtifactTree(rootDir: string): Promise<{ fileCount: number; totalBytes: number }> {
  let fileCount = 0;
  let totalBytes = 0;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      fileCount += 1;
      try {
        const s = await stat(full);
        totalBytes += s.size;
      } catch {
        // ignore unreadable files in dry-run sizing
      }
    }
  }

  await walk(rootDir);
  return { fileCount, totalBytes };
}

async function collectRedisKeys(
  redis: RedisScanner | null,
  prefixes: readonly string[],
): Promise<{ matchingKeyCount: number; sampleKeys: string[] }> {
  if (!redis) {
    return { matchingKeyCount: 0, sampleKeys: [] };
  }
  const all = new Set<string>();
  for (const prefix of prefixes) {
    const pattern = prefix.endsWith("*") ? prefix : `${prefix}*`;
    const keys = await redis.keys(pattern);
    for (const key of keys) all.add(key);
  }
  const list = [...all].sort();
  return {
    matchingKeyCount: list.length,
    sampleKeys: list.slice(0, 20),
  };
}

export async function buildWclScoringDerivedResetPlan(input: {
  prisma: PrismaClient;
  gate: Extract<WclScoringDerivedResetGuardResult, { ok: true }>;
  execute: boolean;
  redis?: RedisScanner | null;
  cwd?: string;
}): Promise<WclScoringDerivedResetPlan> {
  const warnings: string[] = [];
  const blockedConditions: string[] = [];
  const classification = classifyAllPrismaMappedTables();
  if (!classification.ok) {
    blockedConditions.push(
      `table classification incomplete: unclassified=${classification.unclassified.join(",") || "none"} duplicate=${classification.duplicate.join(",") || "none"}`,
    );
  }

  const clearTables: Array<{ table: string; rowCount: number }> = [];
  for (const table of WCL_SCORING_DERIVED_CLEAR_TABLES) {
    clearTables.push({ table, rowCount: await countTable(input.prisma, table) });
  }

  const importantRetainTables: Array<{ table: string; rowCount: number }> = [];
  for (const table of WCL_SCORING_DERIVED_IMPORTANT_RETAIN_TABLES) {
    importantRetainTables.push({ table, rowCount: await countTable(input.prisma, table) });
  }

  const retainTables: Array<{ table: string; rowCount: number | null }> =
    WCL_SCORING_DERIVED_RETAIN_TABLES.map((table) => {
      const important = importantRetainTables.find((r) => r.table === table);
      return { table, rowCount: important?.rowCount ?? null };
    });

  const resolvedRoot = path.resolve(input.cwd ?? process.cwd(), input.gate.artifactsDir);
  const artifactSizes = await scanArtifactTree(resolvedRoot);
  const redisScan = await collectRedisKeys(
    input.redis ?? null,
    WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES,
  );

  let prismaMigrationsApplied: boolean | null = null;
  try {
    const mig = await input.prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    const n =
      typeof mig[0]?.count === "bigint" ? Number(mig[0].count) : Number(mig[0]?.count ?? 0);
    prismaMigrationsApplied = n > 0;
    if (!prismaMigrationsApplied) {
      warnings.push("_prisma_migrations has no finished migrations");
    }
  } catch (error) {
    prismaMigrationsApplied = null;
    warnings.push(
      `_prisma_migrations unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const activeWriters = await probeActiveWriters(input.prisma);
  if (activeWriters.blocked) {
    blockedConditions.push(...activeWriters.detail.map((d) => `active writer: ${d}`));
  }

  if (input.redis == null) {
    warnings.push("Redis scanner unavailable — Redis cleanup plan is count-unknown until execute connects");
  }

  return {
    mode: input.execute ? "EXECUTE" : "DRY-RUN",
    sanitizedDatabase: input.gate.sanitizedDatabase,
    sanitizedRedis: input.gate.sanitizedRedis,
    databaseName: input.gate.databaseName,
    databaseHost: input.gate.databaseHost,
    clearTables,
    retainTables,
    importantRetainTables,
    redis: {
      sanitizedUrl: input.gate.sanitizedRedis,
      prefixes: [...WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES],
      matchingKeyCount: redisScan.matchingKeyCount,
      sampleKeys: redisScan.sampleKeys,
      flushAllUsed: false,
    },
    artifacts: {
      rootDir: input.gate.artifactsDir,
      resolvedRootDir: resolvedRoot,
      fileCount: artifactSizes.fileCount,
      totalBytes: artifactSizes.totalBytes,
      backend: "local-fs",
    },
    activeWriters,
    warnings,
    blockedConditions,
    classificationOk: classification.ok,
    prismaMigrationsApplied,
  };
}

export async function executeWclScoringDerivedReset(input: {
  prisma: PrismaClient;
  plan: WclScoringDerivedResetPlan;
  redis?: RedisScanner | null;
}): Promise<{
  clearedTables: Array<{ table: string; remaining: number }>;
  retainedTables: Array<{ table: string; before: number; after: number; unchanged: boolean }>;
  redisKeysDeleted: number;
  artifactFilesRemoved: number;
  danglingArtifactReferences: number;
  migrationsStillApplied: boolean;
}> {
  if (input.plan.blockedConditions.length > 0) {
    throw new Error(
      `Refusing execute: ${input.plan.blockedConditions.join("; ")}`,
    );
  }
  if (!input.plan.classificationOk) {
    throw new Error("Refusing execute: Prisma table classification incomplete");
  }

  // Re-check writers immediately before mutation.
  const writers = await probeActiveWriters(input.prisma);
  if (writers.blocked) {
    throw new Error(`Refusing execute: active writers detected (${writers.detail.join("; ")})`);
  }

  const retainBefore = new Map(
    input.plan.importantRetainTables.map((r) => [r.table, r.rowCount]),
  );

  const quoted = WCL_SCORING_DERIVED_CLEAR_TABLES.map((t) => `"${t}"`).join(", ");
  await input.prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
  );

  const clearedTables: Array<{ table: string; remaining: number }> = [];
  for (const table of WCL_SCORING_DERIVED_CLEAR_TABLES) {
    const remaining = await countTable(input.prisma, table);
    if (remaining !== 0) {
      throw new Error(`Post-reset integrity failed: "${table}" still has ${remaining} rows`);
    }
    clearedTables.push({ table, remaining });
  }

  const retainedTables: Array<{
    table: string;
    before: number;
    after: number;
    unchanged: boolean;
  }> = [];
  for (const table of WCL_SCORING_DERIVED_IMPORTANT_RETAIN_TABLES) {
    const after = await countTable(input.prisma, table);
    const before = retainBefore.get(table) ?? after;
    if (after !== before) {
      throw new Error(
        `Post-reset integrity failed: retained table "${table}" changed ${before} → ${after}`,
      );
    }
    retainedTables.push({ table, before, after, unchanged: true });
  }

  // No dangling artifact FK rows after truncate of both sides.
  const dangling = await countTable(input.prisma, "artifact_references");
  if (dangling !== 0) {
    throw new Error(`Post-reset integrity failed: dangling artifact_references=${dangling}`);
  }

  let redisKeysDeleted = 0;
  if (input.redis) {
    const scan = await collectRedisKeys(input.redis, WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES);
    if (scan.matchingKeyCount > 0) {
      // Delete in chunks to avoid huge argument lists.
      const keys = [
        ...(await collectAllRedisKeys(input.redis, WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES)),
      ];
      for (let i = 0; i < keys.length; i += 200) {
        const chunk = keys.slice(i, i + 200);
        redisKeysDeleted += await input.redis.del(...chunk);
      }
    }
  }

  let artifactFilesRemoved = 0;
  try {
    const entries = await readdir(input.plan.artifacts.resolvedRootDir, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const full = path.join(input.plan.artifacts.resolvedRootDir, entry.name);
      await rm(full, { recursive: true, force: true });
      artifactFilesRemoved += 1;
    }
  } catch {
    // Directory may not exist yet — treat as already clean.
  }

  const mig = await input.prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
  );
  const migrationsStillApplied =
    (typeof mig[0]?.count === "bigint" ? Number(mig[0].count) : Number(mig[0]?.count ?? 0)) > 0;
  if (!migrationsStillApplied) {
    throw new Error("Post-reset integrity failed: Prisma migrations no longer applied");
  }

  return {
    clearedTables,
    retainedTables,
    redisKeysDeleted,
    artifactFilesRemoved,
    danglingArtifactReferences: dangling,
    migrationsStillApplied,
  };
}

async function collectAllRedisKeys(
  redis: RedisScanner,
  prefixes: readonly string[],
): Promise<string[]> {
  const all = new Set<string>();
  for (const prefix of prefixes) {
    const pattern = prefix.endsWith("*") ? prefix : `${prefix}*`;
    for (const key of await redis.keys(pattern)) all.add(key);
  }
  return [...all];
}

/** Deterministic fingerprint of the clear/retain plan for tests. */
export function planFingerprint(plan: Pick<WclScoringDerivedResetPlan, "clearTables" | "retainTables">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        clear: plan.clearTables.map((t) => t.table),
        retain: plan.retainTables.map((t) => t.table),
      }),
    )
    .digest("hex");
}

export function formatPlanTerminalSummary(plan: WclScoringDerivedResetPlan): string {
  const clearTotal = plan.clearTables.reduce((n, t) => n + t.rowCount, 0);
  const lines = [
    `WCL scoring-derived reset — ${plan.mode}`,
    `  database: ${plan.sanitizedDatabase}`,
    `  redis: ${plan.sanitizedRedis}`,
    `  clear tables: ${plan.clearTables.length} (rows=${clearTotal})`,
    `  retain tables: ${plan.retainTables.length}`,
    `  redis keys matched: ${plan.redis.matchingKeyCount} (FLUSHALL=false)`,
    `  artifacts: ${plan.artifacts.resolvedRootDir} files=${plan.artifacts.fileCount} bytes=${plan.artifacts.totalBytes}`,
    `  active writers blocked: ${plan.activeWriters.blocked}`,
    `  classification ok: ${plan.classificationOk}`,
    `  migrations applied: ${plan.prismaMigrationsApplied}`,
  ];
  if (plan.warnings.length > 0) {
    lines.push("  warnings:");
    for (const w of plan.warnings) lines.push(`    - ${w}`);
  }
  if (plan.blockedConditions.length > 0) {
    lines.push("  blocked:");
    for (const b of plan.blockedConditions) lines.push(`    - ${b}`);
  }
  return lines.join("\n");
}

export { assertWclScoringDerivedResetAllowed };
