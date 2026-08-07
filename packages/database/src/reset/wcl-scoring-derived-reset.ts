/**
 * Local WCL / scoring-derived reset planner + executor.
 * Default mode is DRY-RUN. Mutations require --execute after all safety gates.
 */
import { createHash } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { WclScoringDerivedResetGuardResult } from "./wcl-scoring-derived-reset-guard.js";
import {
  countRawIfTableExists,
  countTableIfExists,
} from "./reset-table-presence.js";
import {
  WCL_SCORING_DERIVED_CLEAR_TABLES,
  WCL_SCORING_DERIVED_IMPORTANT_RETAIN_TABLES,
  WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES,
  WCL_SCORING_DERIVED_RETAIN_TABLES,
  classifyAllPrismaMappedTables,
} from "./wcl-scoring-derived-table-plan.js";

/** BullMQ queue names owned by this project (matches QUEUE_NAMES / Redis prefixes). */
const PROJECT_BULLMQ_QUEUES = [
  "refresh-character",
  "analyze-run",
  "recalculate-score",
  "finalize-score",
  "generate-addon-export",
  "sync-realm-catalog",
  "discover-owned-characters",
  "bulk-character-processing",
  "calibration-run",
  "analyze-evidence-slot",
  "finalize-analysis-batch",
  "refresh-character-calibration",
  "scoring-evidence-export",
  "scoring-shadow-canary",
] as const;

export type ActiveWriterProbe = {
  /** Informational only — stale DB statuses do not block when Redis shows no live writers. */
  staleDbStatuses: {
    ingestionJobsQueuedOrActive: number;
    shadowCanariesNonTerminal: number;
    bulkOperationsNonTerminal: number;
    scoreBatchesNonTerminal: number;
  };
  liveBullmqActiveJobs: number;
  liveLockOrPermitKeys: number;
  blocked: boolean;
  detail: string[];
  redisProbeAvailable: boolean;
};

export type ArtifactCleanupPlan = {
  rootDir: string;
  configuredDir: string;
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
  /** Configured clear/retain tables absent from the live DB (skipped, not fatal). */
  skippedMissingTables: string[];
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
  llen(key: string): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  quit(): Promise<void>;
};

export type ExternalCleanupResult = {
  redis: { ok: boolean; keysDeleted: number; error?: string };
  artifacts: { ok: boolean; filesRemoved: number; error?: string };
  partial: boolean;
};

async function countTable(prisma: PrismaClient, table: string): Promise<number> {
  const counted = await countTableIfExists(prisma, table);
  if (!counted.exists || counted.rowCount == null) {
    throw new Error(`relation "${table}" does not exist`);
  }
  return counted.rowCount;
}

/**
 * Distinguish live Redis/BullMQ writers from stale DB status rows.
 * Stale QUEUED/RUNNING DB rows alone never block; active BullMQ jobs or held
 * locks/permits do. Missing Redis fails closed (cannot prove writers are idle).
 */
export async function probeActiveWriters(input: {
  prisma: PrismaClient;
  redis?: RedisScanner | null;
}): Promise<ActiveWriterProbe> {
  const detail: string[] = [];

  const staleDbStatuses = {
    ingestionJobsQueuedOrActive: await countRawIfTableExists(
      input.prisma,
      "ingestion_jobs",
      `SELECT COUNT(*)::bigint AS count FROM "ingestion_jobs" WHERE status IN ('QUEUED', 'ACTIVE')`,
    ),
    // Prefer current mapped name; fall back to legacy clear-list name if present.
    shadowCanariesNonTerminal: Math.max(
      await countRawIfTableExists(
        input.prisma,
        "scoring_v2_shadow_canaries",
        `SELECT COUNT(*)::bigint AS count FROM "scoring_v2_shadow_canaries" WHERE UPPER(status) IN ('QUEUED', 'RUNNING', 'PENDING', 'STARTED', 'ACTIVE')`,
      ),
      await countRawIfTableExists(
        input.prisma,
        "scoring_shadow_canaries",
        `SELECT COUNT(*)::bigint AS count FROM "scoring_shadow_canaries" WHERE UPPER(status) IN ('QUEUED', 'RUNNING', 'PENDING', 'STARTED', 'ACTIVE')`,
      ),
    ),
    bulkOperationsNonTerminal: await countRawIfTableExists(
      input.prisma,
      "bulk_operations",
      `SELECT COUNT(*)::bigint AS count FROM "bulk_operations" WHERE status IN ('PENDING', 'SELECTING', 'RUNNING', 'PAUSED')`,
    ),
    scoreBatchesNonTerminal: await countRawIfTableExists(
      input.prisma,
      "score_analysis_batches",
      `SELECT COUNT(*)::bigint AS count FROM "score_analysis_batches" WHERE finalization_status IN ('PENDING', 'READY_TO_FINALIZE', 'FINALIZING')`,
    ),
  };

  if (!input.redis) {
    return {
      staleDbStatuses,
      liveBullmqActiveJobs: 0,
      liveLockOrPermitKeys: 0,
      blocked: true,
      detail: [
        "Redis live-writer probe unavailable — cannot distinguish stale DB statuses from live workers (fail closed)",
      ],
      redisProbeAvailable: false,
    };
  }

  let liveBullmqActiveJobs = 0;
  const activeQueueHits: string[] = [];
  for (const queue of PROJECT_BULLMQ_QUEUES) {
    const activeKey = `bull:${queue}:active`;
    const len = await input.redis.llen(activeKey);
    if (len > 0) {
      liveBullmqActiveJobs += len;
      activeQueueHits.push(`${activeKey}=${len}`);
    }
  }

  const lockOrPermitKeys = new Set<string>();
  for (const queue of PROJECT_BULLMQ_QUEUES) {
    for (const key of await input.redis.keys(`bull:${queue}:*:lock`)) {
      lockOrPermitKeys.add(key);
    }
  }
  for (const key of await input.redis.keys("mplus:development:wcl-v2:*:lease")) {
    lockOrPermitKeys.add(key);
  }
  for (const key of await input.redis.keys("mplus:development:wcl-v2:sf:*")) {
    lockOrPermitKeys.add(key);
  }
  for (const key of await input.redis.keys("mplus:development:wcl-v2:sf-report:*")) {
    lockOrPermitKeys.add(key);
  }
  // Held global/character permit owner sets indicate in-flight workers.
  for (const key of await input.redis.keys("mplus:development:wcl-v2:*:owners")) {
    lockOrPermitKeys.add(key);
  }

  const liveLockOrPermitKeys = lockOrPermitKeys.size;

  if (liveBullmqActiveJobs > 0) {
    detail.push(
      `${liveBullmqActiveJobs} live BullMQ active job(s): ${activeQueueHits.join(", ")}`,
    );
  }
  if (liveLockOrPermitKeys > 0) {
    detail.push(
      `${liveLockOrPermitKeys} held worker lock/permit key(s) (sample: ${[...lockOrPermitKeys].slice(0, 5).join(", ")})`,
    );
  }

  return {
    staleDbStatuses,
    liveBullmqActiveJobs,
    liveLockOrPermitKeys,
    blocked: detail.length > 0,
    detail,
    redisProbeAvailable: true,
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
  const skippedMissingTables: string[] = [];
  for (const table of WCL_SCORING_DERIVED_CLEAR_TABLES) {
    const counted = await countTableIfExists(input.prisma, table);
    if (!counted.exists || counted.rowCount == null) {
      skippedMissingTables.push(table);
      continue;
    }
    clearTables.push({ table, rowCount: counted.rowCount });
  }

  const importantRetainTables: Array<{ table: string; rowCount: number }> = [];
  for (const table of WCL_SCORING_DERIVED_IMPORTANT_RETAIN_TABLES) {
    const counted = await countTableIfExists(input.prisma, table);
    if (!counted.exists || counted.rowCount == null) {
      skippedMissingTables.push(table);
      continue;
    }
    importantRetainTables.push({ table, rowCount: counted.rowCount });
  }

  if (skippedMissingTables.length > 0) {
    warnings.push(
      `skipped missing reset-plan table(s): ${skippedMissingTables.join(", ")}`,
    );
  }

  const retainTables: Array<{ table: string; rowCount: number | null }> =
    WCL_SCORING_DERIVED_RETAIN_TABLES.map((table) => {
      const important = importantRetainTables.find((r) => r.table === table);
      return { table, rowCount: important?.rowCount ?? null };
    });

  // Absolute path already resolved from repository/config root by the gate.
  const resolvedRoot = path.resolve(input.gate.artifactsDir);
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

  const activeWriters = await probeActiveWriters({
    prisma: input.prisma,
    redis: input.redis ?? null,
  });
  if (activeWriters.blocked) {
    blockedConditions.push(...activeWriters.detail.map((d) => `active writer: ${d}`));
  }

  const staleTotal =
    activeWriters.staleDbStatuses.ingestionJobsQueuedOrActive +
    activeWriters.staleDbStatuses.shadowCanariesNonTerminal +
    activeWriters.staleDbStatuses.bulkOperationsNonTerminal +
    activeWriters.staleDbStatuses.scoreBatchesNonTerminal;
  if (staleTotal > 0 && !activeWriters.blocked) {
    warnings.push(
      `Stale non-terminal DB status rows present (${staleTotal}) but no live BullMQ active jobs/locks — reset is allowed without manual status edits`,
    );
  }

  if (input.redis == null) {
    warnings.push(
      "Redis scanner unavailable — live-writer probe and Redis cleanup cannot run",
    );
  }

  return {
    mode: input.execute ? "EXECUTE" : "DRY-RUN",
    sanitizedDatabase: input.gate.sanitizedDatabase,
    sanitizedRedis: input.gate.sanitizedRedis,
    databaseName: input.gate.databaseName,
    databaseHost: input.gate.databaseHost,
    clearTables,
    skippedMissingTables,
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
      configuredDir: input.gate.artifactsConfiguredDir,
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
  danglingArtifactReferences: number;
  migrationsStillApplied: boolean;
  externalCleanup: ExternalCleanupResult;
}> {
  if (input.plan.blockedConditions.length > 0) {
    throw new Error(
      `Refusing execute: ${input.plan.blockedConditions.join("; ")}`,
    );
  }
  if (!input.plan.classificationOk) {
    throw new Error("Refusing execute: Prisma table classification incomplete");
  }

  // Re-check live writers immediately before mutation.
  const writers = await probeActiveWriters({
    prisma: input.prisma,
    redis: input.redis ?? null,
  });
  if (writers.blocked) {
    throw new Error(`Refusing execute: active writers detected (${writers.detail.join("; ")})`);
  }

  const retainBefore = new Map(
    input.plan.importantRetainTables.map((r) => [r.table, r.rowCount]),
  );

  const clearTableNames = input.plan.clearTables.map((t) => t.table);

  const dbResult = await input.prisma.$transaction(async (tx) => {
    if (clearTableNames.length > 0) {
      const quoted = clearTableNames.map((t) => `"${t}"`).join(", ");
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    }

    const clearedTables: Array<{ table: string; remaining: number }> = [];
    for (const table of clearTableNames) {
      const remaining = await countTable(tx as unknown as PrismaClient, table);
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
    for (const table of input.plan.importantRetainTables.map((r) => r.table)) {
      const after = await countTable(tx as unknown as PrismaClient, table);
      const before = retainBefore.get(table) ?? after;
      if (after !== before) {
        throw new Error(
          `Post-reset integrity failed: retained table "${table}" changed ${before} → ${after}`,
        );
      }
      retainedTables.push({ table, before, after, unchanged: true });
    }

    const danglingCounted = await countTableIfExists(
      tx as unknown as PrismaClient,
      "artifact_references",
    );
    const dangling = danglingCounted.exists ? (danglingCounted.rowCount ?? 0) : 0;
    if (danglingCounted.exists && dangling !== 0) {
      throw new Error(`Post-reset integrity failed: dangling artifact_references=${dangling}`);
    }

    const mig = await tx.$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    const migRaw = mig[0]?.count ?? 0;
    const migrationsStillApplied =
      (typeof migRaw === "bigint" ? Number(migRaw) : Number(migRaw)) > 0;
    if (!migrationsStillApplied) {
      throw new Error("Post-reset integrity failed: Prisma migrations no longer applied");
    }

    return {
      clearedTables,
      retainedTables,
      danglingArtifactReferences: dangling,
      migrationsStillApplied,
    };
  });

  // Redis / CAS cleanup is intentionally outside the DB transaction and idempotent.
  const externalCleanup: ExternalCleanupResult = {
    redis: { ok: true, keysDeleted: 0 },
    artifacts: { ok: true, filesRemoved: 0 },
    partial: false,
  };

  if (input.redis) {
    try {
      const keys = await collectAllRedisKeys(input.redis, WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES);
      let redisKeysDeleted = 0;
      for (let i = 0; i < keys.length; i += 200) {
        const chunk = keys.slice(i, i + 200);
        if (chunk.length > 0) {
          redisKeysDeleted += await input.redis.del(...chunk);
        }
      }
      externalCleanup.redis = { ok: true, keysDeleted: redisKeysDeleted };
    } catch (error) {
      externalCleanup.redis = {
        ok: false,
        keysDeleted: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      externalCleanup.partial = true;
    }
  } else {
    externalCleanup.redis = {
      ok: false,
      keysDeleted: 0,
      error: "Redis scanner unavailable after DB reset",
    };
    externalCleanup.partial = true;
  }

  try {
    const entries = await readdir(input.plan.artifacts.resolvedRootDir, {
      withFileTypes: true,
    });
    let artifactFilesRemoved = 0;
    for (const entry of entries) {
      const full = path.join(input.plan.artifacts.resolvedRootDir, entry.name);
      await rm(full, { recursive: true, force: true });
      artifactFilesRemoved += 1;
    }
    externalCleanup.artifacts = { ok: true, filesRemoved: artifactFilesRemoved };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") {
      // Directory absent — already clean.
      externalCleanup.artifacts = { ok: true, filesRemoved: 0 };
    } else {
      externalCleanup.artifacts = {
        ok: false,
        filesRemoved: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      externalCleanup.partial = true;
    }
  }

  return {
    ...dbResult,
    externalCleanup,
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
    `  skipped missing tables: ${plan.skippedMissingTables.length}${
      plan.skippedMissingTables.length > 0
        ? ` (${plan.skippedMissingTables.join(", ")})`
        : ""
    }`,
    `  retain tables: ${plan.retainTables.length}`,
    `  redis keys matched: ${plan.redis.matchingKeyCount} (FLUSHALL=false)`,
    `  artifacts: ${plan.artifacts.resolvedRootDir} files=${plan.artifacts.fileCount} bytes=${plan.artifacts.totalBytes}`,
    `  live writers blocked: ${plan.activeWriters.blocked} (redisProbe=${plan.activeWriters.redisProbeAvailable})`,
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
