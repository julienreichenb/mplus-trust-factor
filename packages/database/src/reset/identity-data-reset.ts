/**
 * Guarded identity-data reset planner + executor.
 *
 * Default mode is DRY-RUN. Mutations require --execute after all safety gates.
 * Preserves exactly one User + one BattleNetAccount; clears all characters.
 */
import { createHash, randomUUID } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { IdentityResetGuardOk } from "./identity-data-reset-guard.js";
import {
  IDENTITY_DATA_FK_PLAN,
  IDENTITY_DATA_IMPORTANT_COUNT_TABLES,
  IDENTITY_DATA_SELECTIVE_TABLES,
  IDENTITY_DATA_STATIC_RETAIN_TABLES,
  IDENTITY_DATA_TRUNCATE_TABLES,
  IDENTITY_DATA_CHARACTER_GRAPH_TRUNCATE_TABLES,
  IDENTITY_RESET_ADMIN_ROLE_KEY,
  IDENTITY_RESET_BULLMQ_QUEUES,
  classifyIdentityDataTables,
  identityResetRedisKeyPrefixes,
} from "./identity-data-reset-table-plan.js";
import type {
  ActiveWriterProbe,
  ExternalCleanupResult,
  RedisScanner,
} from "./wcl-scoring-derived-reset.js";

export type { RedisScanner, ExternalCleanupResult };

const RESET_LOCK_TTL_SECONDS = 600;

export type RetainedUserSummary = {
  id: string;
  legacyRole: string;
  hasActiveAdminRoleAssignment: boolean;
  disabled: boolean;
};

export type RetainedBattleNetAccountSummary = {
  id: string;
  userId: string;
  claimed: boolean;
  unlinked: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasTokenExpiry: boolean;
  hasGrantedScopes: boolean;
};

export type IdentityRedisCleanupPlan = {
  sanitizedUrl: string;
  prefixes: string[];
  matchingKeyCount: number;
  sampleKeyCategories: string[];
  activeLocks: string[];
  unclassifiedRelevantKeys: string[];
  flushAllUsed: false;
};

export type IdentityArtifactCleanupPlan = {
  backend: "local-fs";
  rootDir: string;
  configuredDir: string;
  resolvedRootDir: string;
  fileCount: number;
  totalBytes: number;
};

export type IdentityDataResetPlan = {
  mode: "DRY-RUN" | "EXECUTE";
  target: IdentityResetGuardOk["target"];
  sanitizedDatabase: string;
  sanitizedRedis: string;
  databaseName: string;
  databaseHost: string;
  redisEnvSegment: string;
  expectedDatabaseName: string | null;
  deployedTestClassification: string;
  artifactBackend: "local-fs";
  retainedUser: RetainedUserSummary;
  retainedBattleNetAccount: RetainedBattleNetAccountSummary;
  keepUserId: string;
  keepBnetAccountId: string;
  rowCountsBefore: Array<{ table: string; rowCount: number }>;
  plannedTruncations: Array<{ table: string; rowCount: number }>;
  plannedSelectiveDeletes: Array<{ table: string; deleteCount: number; retainCount: number }>;
  plannedStaticRetain: Array<{ table: string; rowCount: number }>;
  foreignKeyPlan: typeof IDENTITY_DATA_FK_PLAN;
  redis: IdentityRedisCleanupPlan;
  artifacts: IdentityArtifactCleanupPlan;
  activeWriters: ActiveWriterProbe;
  maintenanceAssertion: {
    required: boolean;
    asserted: boolean;
  };
  warnings: string[];
  blockedConditions: string[];
  classificationOk: boolean;
  prismaMigrationsApplied: boolean | null;
  confirmationTokenRequired: string;
  postconditions: string[];
};

export type IdentityResetLock = {
  key: string;
  token: string;
  acquired: boolean;
};

async function countTable(
  prisma: PrismaClient | Prisma.TransactionClient,
  table: string,
): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
  );
  const raw = rows[0]?.count ?? 0;
  return typeof raw === "bigint" ? Number(raw) : Number(raw);
}

function toNum(v: bigint | number | undefined): number {
  return typeof v === "bigint" ? Number(v) : Number(v ?? 0);
}

function categorizeRedisKey(key: string, envSegment: string): string {
  if (key.startsWith(`mplus:${envSegment}:identity-reset:`)) return "identity-reset-lock";
  if (key.startsWith(`mplus:${envSegment}:refresh:`)) return "refresh-admission";
  if (key.startsWith(`mplus:${envSegment}:wcl-v2:`)) return "wcl-v2-permits";
  if (key.startsWith(`mplus:${envSegment}:`)) return `mplus:${envSegment}:*`;
  if (key.startsWith("bull:")) {
    const queue = key.slice("bull:".length).split(":")[0] ?? "unknown";
    return `bull:${queue}`;
  }
  return "other";
}

/**
 * Live-writer probe scoped to an APP_ENV Redis segment.
 * Stale DB statuses alone never block when Redis proves writers are idle.
 */
export async function probeIdentityActiveWriters(input: {
  prisma: PrismaClient;
  redis?: RedisScanner | null;
  redisEnvSegment: string;
}): Promise<ActiveWriterProbe> {
  const detail: string[] = [];
  const env = input.redisEnvSegment;

  const ingestion = await input.prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "ingestion_jobs" WHERE status IN ('QUEUED', 'ACTIVE')`,
  );
  const canaries = await input.prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "scoring_v2_shadow_canaries" WHERE UPPER(status) IN ('QUEUED', 'RUNNING', 'PENDING', 'STARTED', 'ACTIVE')`,
  );
  const bulk = await input.prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "bulk_operations" WHERE status IN ('PENDING', 'SELECTING', 'RUNNING', 'PAUSED')`,
  );
  const batches = await input.prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "score_analysis_batches" WHERE finalization_status IN ('PENDING', 'READY_TO_FINALIZE', 'FINALIZING')`,
  );
  // Informational only — live Redis reservation keys are the blocking signal.
  const staleDbStatuses = {
    ingestionJobsQueuedOrActive: toNum(ingestion[0]?.count),
    shadowCanariesNonTerminal: toNum(canaries[0]?.count),
    bulkOperationsNonTerminal: toNum(bulk[0]?.count),
    scoreBatchesNonTerminal: toNum(batches[0]?.count),
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
  for (const queue of IDENTITY_RESET_BULLMQ_QUEUES) {
    const activeKey = `bull:${queue}:active`;
    const len = await input.redis.llen(activeKey);
    if (len > 0) {
      liveBullmqActiveJobs += len;
      activeQueueHits.push(`${activeKey}=${len}`);
    }
  }

  const lockOrPermitKeys = new Set<string>();
  for (const queue of IDENTITY_RESET_BULLMQ_QUEUES) {
    for (const key of await input.redis.keys(`bull:${queue}:*:lock`)) {
      lockOrPermitKeys.add(key);
    }
  }
  for (const key of await input.redis.keys(`mplus:${env}:wcl-v2:*:lease`)) {
    lockOrPermitKeys.add(key);
  }
  for (const key of await input.redis.keys(`mplus:${env}:wcl-v2:sf:*`)) {
    lockOrPermitKeys.add(key);
  }
  for (const key of await input.redis.keys(`mplus:${env}:wcl-v2:sf-report:*`)) {
    lockOrPermitKeys.add(key);
  }
  for (const key of await input.redis.keys(`mplus:${env}:wcl-v2:*:owners`)) {
    lockOrPermitKeys.add(key);
  }
  // Live refresh admission reservations in Redis.
  for (const key of await input.redis.keys(`mplus:${env}:refresh:*:reservation*`)) {
    lockOrPermitKeys.add(key);
  }
  for (const key of await input.redis.keys(`mplus:${env}:refresh:admit:*`)) {
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
      `${liveLockOrPermitKeys} held worker lock/permit/reservation key(s) (sample: ${[...lockOrPermitKeys].slice(0, 5).join(", ")})`,
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

async function scanArtifactTree(
  rootDir: string,
): Promise<{ fileCount: number; totalBytes: number }> {
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
        // ignore
      }
    }
  }

  await walk(rootDir);
  return { fileCount, totalBytes };
}

async function classifyRedisKeys(
  redis: RedisScanner | null,
  envSegment: string,
): Promise<{
  matchingKeyCount: number;
  sampleKeyCategories: string[];
  activeLocks: string[];
  unclassifiedRelevantKeys: string[];
  allClassifiedKeys: string[];
}> {
  if (!redis) {
    return {
      matchingKeyCount: 0,
      sampleKeyCategories: [],
      activeLocks: [],
      unclassifiedRelevantKeys: [],
      allClassifiedKeys: [],
    };
  }

  const prefixes = identityResetRedisKeyPrefixes(envSegment);
  const knownQueues = new Set<string>(IDENTITY_RESET_BULLMQ_QUEUES);
  const classified = new Set<string>();
  const categories = new Set<string>();
  const activeLocks: string[] = [];
  const unclassifiedRelevantKeys: string[] = [];

  for (const prefix of prefixes) {
    const pattern = prefix.endsWith("*") ? prefix : `${prefix}*`;
    for (const key of await redis.keys(pattern)) {
      classified.add(key);
      categories.add(categorizeRedisKey(key, envSegment));
      if (key.includes(":lock") || key.endsWith(":lock")) {
        activeLocks.push(key);
      }
    }
  }

  // Fail closed on BullMQ queues outside the known project set.
  for (const key of await redis.keys("bull:*")) {
    const queue = key.slice("bull:".length).split(":")[0] ?? "";
    if (!queue) continue;
    if (!knownQueues.has(queue as (typeof IDENTITY_RESET_BULLMQ_QUEUES)[number])) {
      // Only block queues that look application-owned (heuristic: contains known stems).
      if (
        /refresh|score|calib|evidence|canary|bulk|discover|addon|realm|analy|wcl|mplus/i.test(
          queue,
        )
      ) {
        unclassifiedRelevantKeys.push(key);
      }
    }
  }

  const list = [...classified].sort();
  return {
    matchingKeyCount: list.length,
    sampleKeyCategories: [...categories].sort().slice(0, 20),
    activeLocks: activeLocks.slice(0, 20),
    unclassifiedRelevantKeys: [...new Set(unclassifiedRelevantKeys)].slice(0, 50),
    allClassifiedKeys: list,
  };
}

export type RetentionValidation =
  | {
      ok: true;
      user: RetainedUserSummary;
      account: RetainedBattleNetAccountSummary;
      oauthFingerprint: string;
    }
  | { ok: false; reasons: string[] };

function oauthFingerprint(row: {
  providerAccountId: string;
  regionId: string | null;
  battletagHash: string;
  battletagDisplay: string | null;
  claimed: boolean;
  linkedAt: Date;
  unlinkedAt: Date | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  grantedScopes: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        providerAccountId: row.providerAccountId,
        regionId: row.regionId,
        battletagHash: row.battletagHash,
        battletagDisplay: row.battletagDisplay,
        claimed: row.claimed,
        linkedAt: row.linkedAt.toISOString(),
        unlinkedAt: row.unlinkedAt?.toISOString() ?? null,
        accessTokenEncrypted: row.accessTokenEncrypted,
        refreshTokenEncrypted: row.refreshTokenEncrypted,
        tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
        grantedScopes: row.grantedScopes,
      }),
    )
    .digest("hex");
}

export async function validateRetainedIdentity(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  keepUserId: string;
  keepBnetAccountId: string;
}): Promise<RetentionValidation> {
  const reasons: string[] = [];
  const user = await input.prisma.user.findUnique({
    where: { id: input.keepUserId },
    include: {
      roleAssignments: {
        include: { role: true },
      },
    },
  });
  if (!user) {
    reasons.push(`retained User ${input.keepUserId} does not exist`);
  }

  const account = await input.prisma.battleNetAccount.findUnique({
    where: { id: input.keepBnetAccountId },
  });
  if (!account) {
    reasons.push(`retained BattleNetAccount ${input.keepBnetAccountId} does not exist`);
  }

  if (user && account && account.userId !== user.id) {
    reasons.push(
      "retained BattleNetAccount.userId does not equal retained User.id",
    );
  }

  if (user?.disabledAt != null) {
    reasons.push("retained User is disabled");
  }

  let hasActiveAdminRoleAssignment = false;
  if (user) {
    const now = new Date();
    hasActiveAdminRoleAssignment = user.roleAssignments.some(
      (a) =>
        a.role.key === IDENTITY_RESET_ADMIN_ROLE_KEY &&
        (a.expiresAt == null || a.expiresAt > now),
    );
    const isLegacyAdmin = user.role === "ADMIN";
    if (!isLegacyAdmin && !hasActiveAdminRoleAssignment) {
      reasons.push(
        "retained User is not an administrator (legacy role ADMIN or active admin role assignment required)",
      );
    }
  }

  if (reasons.length > 0 || !user || !account) {
    return { ok: false, reasons };
  }

  return {
    ok: true,
    user: {
      id: user.id,
      legacyRole: user.role,
      hasActiveAdminRoleAssignment,
      disabled: false,
    },
    account: {
      id: account.id,
      userId: account.userId,
      claimed: account.claimed,
      unlinked: account.unlinkedAt != null,
      hasAccessToken: account.accessTokenEncrypted != null,
      hasRefreshToken: account.refreshTokenEncrypted != null,
      hasTokenExpiry: account.tokenExpiresAt != null,
      hasGrantedScopes: account.grantedScopes != null,
    },
    oauthFingerprint: oauthFingerprint(account),
  };
}

export async function buildIdentityDataResetPlan(input: {
  prisma: PrismaClient;
  gate: IdentityResetGuardOk;
  execute: boolean;
  redis?: RedisScanner | null;
}): Promise<IdentityDataResetPlan> {
  const warnings: string[] = [];
  const blockedConditions: string[] = [];
  const classification = classifyIdentityDataTables();
  if (!classification.ok) {
    blockedConditions.push(
      `table classification incomplete: unclassified=${classification.unclassified.join(",") || "none"} duplicate=${classification.duplicate.join(",") || "none"}`,
    );
  }

  const retention = await validateRetainedIdentity({
    prisma: input.prisma,
    keepUserId: input.gate.keepUserId,
    keepBnetAccountId: input.gate.keepBnetAccountId,
  });
  if (!retention.ok) {
    blockedConditions.push(...retention.reasons.map((r) => `retention: ${r}`));
  }

  const plannedTruncations: Array<{ table: string; rowCount: number }> = [];
  for (const table of [
    ...IDENTITY_DATA_TRUNCATE_TABLES,
    ...IDENTITY_DATA_CHARACTER_GRAPH_TRUNCATE_TABLES,
  ] as const) {
    plannedTruncations.push({ table, rowCount: await countTable(input.prisma, table) });
  }

  const plannedStaticRetain: Array<{ table: string; rowCount: number }> = [];
  for (const table of IDENTITY_DATA_STATIC_RETAIN_TABLES) {
    plannedStaticRetain.push({ table, rowCount: await countTable(input.prisma, table) });
  }

  const usersTotal = await countTable(input.prisma, "users");
  const bnetTotal = await countTable(input.prisma, "battlenet_accounts");
  const plannedSelectiveDeletes = [
    {
      table: "users",
      deleteCount: Math.max(0, usersTotal - (retention.ok ? 1 : 0)),
      retainCount: retention.ok ? 1 : 0,
    },
    {
      table: "battlenet_accounts",
      deleteCount: Math.max(0, bnetTotal - (retention.ok ? 1 : 0)),
      retainCount: retention.ok ? 1 : 0,
    },
    ...IDENTITY_DATA_SELECTIVE_TABLES.filter(
      (t) => t !== "users" && t !== "battlenet_accounts",
    ).map((table) => ({
      table,
      deleteCount: -1, // cascade with deleted users; counted post-hoc
      retainCount: -1,
    })),
  ];

  const rowCountsBefore: Array<{ table: string; rowCount: number }> = [];
  for (const table of IDENTITY_DATA_IMPORTANT_COUNT_TABLES) {
    rowCountsBefore.push({ table, rowCount: await countTable(input.prisma, table) });
  }

  const resolvedRoot = path.resolve(input.gate.artifactsDir);
  // Path safety: refuse executing artifact cleanup outside configured root for relative paths.
  // Absolute deployed-test paths (/data/raw-artifacts) are accepted by the artifact-store gate.
  const artifactSizes = await scanArtifactTree(resolvedRoot);

  const redisScan = await classifyRedisKeys(
    input.redis ?? null,
    input.gate.redisEnvSegment,
  );
  if (redisScan.unclassifiedRelevantKeys.length > 0) {
    blockedConditions.push(
      `unclassified relevant Redis keys block execution: ${redisScan.unclassifiedRelevantKeys.slice(0, 5).join(", ")}`,
    );
  }

  let prismaMigrationsApplied: boolean | null = null;
  try {
    const mig = await input.prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    prismaMigrationsApplied = toNum(mig[0]?.count) > 0;
    if (!prismaMigrationsApplied) {
      warnings.push("_prisma_migrations has no finished migrations");
    }
  } catch (error) {
    prismaMigrationsApplied = null;
    warnings.push(
      `_prisma_migrations unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const activeWriters = await probeIdentityActiveWriters({
    prisma: input.prisma,
    redis: input.redis ?? null,
    redisEnvSegment: input.gate.redisEnvSegment,
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
      `Stale non-terminal DB status rows present (${staleTotal}) but no live BullMQ active jobs/locks — reset is allowed`,
    );
  }

  if (input.redis == null) {
    warnings.push(
      "Redis scanner unavailable — live-writer probe and Redis cleanup cannot run",
    );
  }

  const maintenanceRequired = input.gate.target === "deployed-test";
  const maintenanceAsserted = input.gate.writersStoppedAsserted;
  if (maintenanceRequired && input.execute && !maintenanceAsserted) {
    blockedConditions.push(
      "deployed-test execute requires MPLUS_DEPLOYED_TEST_WRITERS_STOPPED=true",
    );
  }

  const retainedUser: RetainedUserSummary = retention.ok
    ? retention.user
    : {
        id: input.gate.keepUserId,
        legacyRole: "UNKNOWN",
        hasActiveAdminRoleAssignment: false,
        disabled: true,
      };
  const retainedBattleNetAccount: RetainedBattleNetAccountSummary = retention.ok
    ? retention.account
    : {
        id: input.gate.keepBnetAccountId,
        userId: input.gate.keepUserId,
        claimed: false,
        unlinked: true,
        hasAccessToken: false,
        hasRefreshToken: false,
        hasTokenExpiry: false,
        hasGrantedScopes: false,
      };

  return {
    mode: input.execute ? "EXECUTE" : "DRY-RUN",
    target: input.gate.target,
    sanitizedDatabase: input.gate.sanitizedDatabase,
    sanitizedRedis: input.gate.sanitizedRedis,
    databaseName: input.gate.databaseName,
    databaseHost: input.gate.databaseHost,
    redisEnvSegment: input.gate.redisEnvSegment,
    expectedDatabaseName: input.gate.expectedDatabaseName,
    deployedTestClassification: input.gate.deployedTestClassification,
    artifactBackend: input.gate.artifactBackend,
    retainedUser,
    retainedBattleNetAccount,
    keepUserId: input.gate.keepUserId,
    keepBnetAccountId: input.gate.keepBnetAccountId,
    rowCountsBefore,
    plannedTruncations,
    plannedSelectiveDeletes,
    plannedStaticRetain,
    foreignKeyPlan: IDENTITY_DATA_FK_PLAN,
    redis: {
      sanitizedUrl: input.gate.sanitizedRedis,
      prefixes: identityResetRedisKeyPrefixes(input.gate.redisEnvSegment),
      matchingKeyCount: redisScan.matchingKeyCount,
      sampleKeyCategories: redisScan.sampleKeyCategories,
      activeLocks: redisScan.activeLocks,
      unclassifiedRelevantKeys: redisScan.unclassifiedRelevantKeys,
      flushAllUsed: false,
    },
    artifacts: {
      backend: "local-fs",
      rootDir: input.gate.artifactsDir,
      configuredDir: input.gate.artifactsConfiguredDir,
      resolvedRootDir: resolvedRoot,
      fileCount: artifactSizes.fileCount,
      totalBytes: artifactSizes.totalBytes,
    },
    activeWriters,
    maintenanceAssertion: {
      required: maintenanceRequired,
      asserted: maintenanceAsserted,
    },
    warnings,
    blockedConditions: [...new Set(blockedConditions)],
    classificationOk: classification.ok,
    prismaMigrationsApplied,
    confirmationTokenRequired: input.gate.confirmationToken,
    postconditions: [
      "users = 1 and id equals --keep-user-id",
      "battlenet_accounts = 1 and id equals --keep-bnet-account-id",
      "characters = character_aliases = verified_character_ownerships = 0",
      "retained OAuth/account fields unchanged; discovery/ownership sync cleared",
      "static catalogs unchanged (regions, realms, seasons, …)",
      "no dangling characterId references",
      "migrations remain applied",
      "Redis FLUSHALL was not used",
    ],
  };
}

export type ExtendedRedisScanner = RedisScanner & {
  set?(
    key: string,
    value: string,
    mode?: string,
    ttl?: number,
    nx?: string,
  ): Promise<string | null>;
  get?(key: string): Promise<string | null>;
  eval?(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
};

export async function acquireIdentityResetLock(input: {
  redis: ExtendedRedisScanner;
  redisEnvSegment: string;
}): Promise<IdentityResetLock> {
  const key = `mplus:${input.redisEnvSegment}:identity-reset:lock`;
  const token = randomUUID();
  if (!input.redis.set) {
    return { key, token, acquired: false };
  }
  const result = await input.redis.set(key, token, "EX", RESET_LOCK_TTL_SECONDS, "NX");
  return { key, token, acquired: result === "OK" };
}

export async function releaseIdentityResetLock(input: {
  redis: ExtendedRedisScanner;
  lock: IdentityResetLock;
}): Promise<void> {
  if (!input.lock.acquired || !input.redis.eval) return;
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await input.redis.eval(script, 1, input.lock.key, input.lock.token);
}

async function verifyPostconditions(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  keepUserId: string;
  keepBnetAccountId: string;
  staticBefore: Map<string, number>;
  oauthFingerprintBefore: string;
}): Promise<string[]> {
  const failures: string[] = [];

  const users = await countTable(input.prisma, "users");
  if (users !== 1) failures.push(`users=${users} expected 1`);
  const soleUser = await input.prisma.user.findFirst();
  if (!soleUser || soleUser.id !== input.keepUserId) {
    failures.push("sole User.id does not equal --keep-user-id");
  }
  if (soleUser?.disabledAt != null) failures.push("retained User is disabled");
  if (soleUser) {
    const adminOk =
      soleUser.role === "ADMIN" ||
      (
        await input.prisma.userRoleAssignment.findFirst({
          where: {
            userId: soleUser.id,
            role: { key: IDENTITY_RESET_ADMIN_ROLE_KEY },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        })
      ) != null;
    if (!adminOk) failures.push("retained User is not an administrator");
  }

  const bnet = await countTable(input.prisma, "battlenet_accounts");
  if (bnet !== 1) failures.push(`battlenet_accounts=${bnet} expected 1`);
  const soleAccount = await input.prisma.battleNetAccount.findFirst();
  if (!soleAccount || soleAccount.id !== input.keepBnetAccountId) {
    failures.push("sole BattleNetAccount.id does not equal --keep-bnet-account-id");
  }
  if (soleAccount && soleAccount.userId !== input.keepUserId) {
    failures.push("retained BattleNetAccount.userId mismatch");
  }
  if (soleAccount) {
    const fp = oauthFingerprint(soleAccount);
    if (fp !== input.oauthFingerprintBefore) {
      failures.push("retained BattleNetAccount OAuth/account data changed");
    }
    if (
      soleAccount.lastOwnershipSyncAt != null ||
      soleAccount.lastOwnershipSyncError != null ||
      soleAccount.lastDiscoveryJobId != null ||
      soleAccount.lastDiscoveryStatus != null ||
      soleAccount.lastDiscoveryStartedAt != null ||
      soleAccount.lastDiscoveryFinishedAt != null ||
      soleAccount.lastDiscoveryError != null ||
      soleAccount.lastDiscoveryCounters != null ||
      soleAccount.lastDiscoveryOwnershipSyncAt != null
    ) {
      failures.push("retained BattleNetAccount discovery/ownership sync state not cleared");
    }
  }

  for (const table of [
    "characters",
    "character_aliases",
    "verified_character_ownerships",
    "character_snapshots",
    "character_provider_states",
    "character_profile_views",
  ] as const) {
    const n = await countTable(input.prisma, table);
    if (n !== 0) failures.push(`${table}=${n} expected 0`);
  }

  for (const [table, before] of input.staticBefore) {
    const after = await countTable(input.prisma, table);
    if (after !== before) {
      failures.push(`static table "${table}" changed ${before} → ${after}`);
    }
  }

  const mig = await input.prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
  );
  if (toNum(mig[0]?.count) <= 0) {
    failures.push("Prisma migrations no longer applied");
  }

  return failures;
}

export async function executeIdentityDataReset(input: {
  prisma: PrismaClient;
  plan: IdentityDataResetPlan;
  redis?: ExtendedRedisScanner | null;
  artifactsDir?: string;
}): Promise<{
  postconditionFailures: string[];
  externalCleanup: ExternalCleanupResult;
  oauthFingerprintUnchanged: boolean;
}> {
  if (input.plan.blockedConditions.length > 0) {
    throw new Error(`Refusing execute: ${input.plan.blockedConditions.join("; ")}`);
  }
  if (!input.plan.classificationOk) {
    throw new Error("Refusing execute: Prisma table classification incomplete");
  }
  if (!input.redis) {
    throw new Error("Refusing execute: Redis required for lock + writer probe + cleanup");
  }

  const writers = await probeIdentityActiveWriters({
    prisma: input.prisma,
    redis: input.redis,
    redisEnvSegment: input.plan.redisEnvSegment,
  });
  if (writers.blocked) {
    throw new Error(`Refusing execute: active writers detected (${writers.detail.join("; ")})`);
  }

  const lock = await acquireIdentityResetLock({
    redis: input.redis,
    redisEnvSegment: input.plan.redisEnvSegment,
  });
  if (!lock.acquired) {
    throw new Error(
      "Refusing execute: could not acquire identity-reset Redis lock (concurrent reset?)",
    );
  }

  const retention = await validateRetainedIdentity({
    prisma: input.prisma,
    keepUserId: input.plan.keepUserId,
    keepBnetAccountId: input.plan.keepBnetAccountId,
  });
  if (!retention.ok) {
    await releaseIdentityResetLock({ redis: input.redis, lock });
    throw new Error(`Refusing execute: ${retention.reasons.join("; ")}`);
  }

  const staticBefore = new Map(
    input.plan.plannedStaticRetain.map((r) => [r.table, r.rowCount]),
  );
  const oauthFingerprintBefore = retention.oauthFingerprint;

  const externalCleanup: ExternalCleanupResult = {
    redis: { ok: true, keysDeleted: 0 },
    artifacts: { ok: true, filesRemoved: 0 },
    partial: false,
  };

  let postconditionFailures: string[] = [];

  try {
    const quoted = IDENTITY_DATA_TRUNCATE_TABLES.map((t) => `"${t}"`).join(", ");
    const keepUserId = input.plan.keepUserId;
    const keepBnetId = input.plan.keepBnetAccountId;

    await input.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} CASCADE`);

      // Retained cohort members use SetNull on Character — null before deleting
      // characters. Prefer DELETE over TRUNCATE here: empty Restrict FKs still
      // block TRUNCATE without CASCADE, and CASCADE would wipe cohort members.
      await tx.$executeRawUnsafe(
        `UPDATE "calibration_cohort_members" SET "character_id" = NULL WHERE "character_id" IS NOT NULL`,
      );
      await tx.$executeRawUnsafe(`DELETE FROM "verified_character_ownerships"`);
      await tx.$executeRawUnsafe(`DELETE FROM "character_aliases"`);
      await tx.$executeRawUnsafe(`DELETE FROM "characters"`);

      // Clear Restrict FKs from static-retained tables to deleted users.
      await tx.$executeRawUnsafe(
        `UPDATE "score_models" SET "created_by_user_id" = NULL WHERE "created_by_user_id" IS DISTINCT FROM $1::uuid`,
        keepUserId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE "calibration_cohorts" SET "created_by_user_id" = $1::uuid WHERE "created_by_user_id" IS DISTINCT FROM $1::uuid`,
        keepUserId,
      );

      await tx.$executeRawUnsafe(
        `DELETE FROM "battlenet_accounts" WHERE "id" <> $1::uuid`,
        keepBnetId,
      );
      await tx.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" <> $1::uuid`, keepUserId);

      // Clear discovery/ownership sync on retained account (preserve OAuth bytes).
      await tx.$executeRawUnsafe(
        `UPDATE "battlenet_accounts" SET
          "last_ownership_sync_at" = NULL,
          "last_ownership_sync_error" = NULL,
          "last_discovery_job_id" = NULL,
          "last_discovery_status" = NULL,
          "last_discovery_started_at" = NULL,
          "last_discovery_finished_at" = NULL,
          "last_discovery_error" = NULL,
          "last_discovery_counters" = NULL,
          "last_discovery_ownership_sync_at" = NULL
        WHERE "id" = $1::uuid`,
        keepBnetId,
      );

      postconditionFailures = await verifyPostconditions({
        prisma: tx,
        keepUserId,
        keepBnetAccountId: keepBnetId,
        staticBefore,
        oauthFingerprintBefore,
      });
      if (postconditionFailures.length > 0) {
        throw new Error(
          `Postcondition failure (transaction rolled back): ${postconditionFailures.join("; ")}`,
        );
      }
    });
  } catch (error) {
    await releaseIdentityResetLock({ redis: input.redis, lock });
    throw error;
  }

  // Redis / artifact cleanup outside the DB transaction (idempotent).
  try {
    const scan = await classifyRedisKeys(input.redis, input.plan.redisEnvSegment);
    // Preserve our own lock key until we release it.
    const keys = scan.allClassifiedKeys.filter((k) => k !== lock.key);
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

  try {
    const root = input.artifactsDir ?? input.plan.artifacts.resolvedRootDir;
    const entries = await readdir(root, { withFileTypes: true });
    let artifactFilesRemoved = 0;
    for (const entry of entries) {
      const full = path.join(root, entry.name);
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

  await releaseIdentityResetLock({ redis: input.redis, lock });

  // Final postcondition check after external cleanup.
  const after = await verifyPostconditions({
    prisma: input.prisma,
    keepUserId: input.plan.keepUserId,
    keepBnetAccountId: input.plan.keepBnetAccountId,
    staticBefore,
    oauthFingerprintBefore,
  });
  postconditionFailures = after;

  return {
    postconditionFailures,
    externalCleanup,
    oauthFingerprintUnchanged: after.every((f) => !f.includes("OAuth")),
  };
}

export function formatIdentityPlanTerminalSummary(plan: IdentityDataResetPlan): string {
  const truncateTotal = plan.plannedTruncations.reduce((n, t) => n + t.rowCount, 0);
  const lines = [
    `Identity-data reset — ${plan.mode}`,
    `  target: ${plan.target}`,
    `  database: ${plan.sanitizedDatabase}`,
    `  redis: ${plan.sanitizedRedis}`,
    `  deployed-test classification: ${plan.deployedTestClassification}`,
    `  retained user id: ${plan.retainedUser.id} legacyRole=${plan.retainedUser.legacyRole} adminAssignment=${plan.retainedUser.hasActiveAdminRoleAssignment} disabled=${plan.retainedUser.disabled}`,
    `  retained bnet id: ${plan.retainedBattleNetAccount.id} claimed=${plan.retainedBattleNetAccount.claimed} unlinked=${plan.retainedBattleNetAccount.unlinked}`,
    `  truncate tables: ${plan.plannedTruncations.length} (rows=${truncateTotal})`,
    `  redis keys matched: ${plan.redis.matchingKeyCount} (FLUSHALL=false)`,
    `  artifacts: backend=${plan.artifacts.backend} files=${plan.artifacts.fileCount}`,
    `  live writers blocked: ${plan.activeWriters.blocked}`,
    `  maintenance: required=${plan.maintenanceAssertion.required} asserted=${plan.maintenanceAssertion.asserted}`,
    `  confirmation: ${plan.confirmationTokenRequired}`,
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
