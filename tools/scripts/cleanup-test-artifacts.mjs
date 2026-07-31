/**
 * General cleanup of automated-test artifacts left behind in a shared/deployed
 * database: score models, ingestion jobs (+ BullMQ), characters and their
 * durable dependents, bulk operations, realms/dungeons/seasons, and
 * test-fixture mechanic rules.
 *
 * Default is dry-run. Deletion requires explicit `--confirm`.
 *
 * Usage:
 *   pnpm db:cleanup:test-artifacts -- --dry-run
 *   pnpm db:cleanup:test-artifacts -- --confirm
 *
 * Deployed test environment (required assertion):
 *   MPLUS_CLEANUP_TARGET=deployed-test pnpm db:cleanup:test-artifacts -- --confirm
 *
 * Safety:
 *   - Production (APP_ENV/NODE_ENV) is categorically refused.
 *   - Remote/non-loopback targets require MPLUS_CLEANUP_TARGET=deployed-test.
 *   - Never deletes the canonical seeded score model key (`default`).
 *   - Candidates are selected exclusively from the registry of known
 *     automated-test markers (tools/scripts/lib/test-artifact-registry.mjs) —
 *     never by status, date, or a bare "Test" substring match.
 *   - Never prints credentials (all DATABASE_URL/REDIS_URL logging is sanitized).
 */
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  CANONICAL_SCORE_MODEL_KEYS,
  TEST_SCORE_MODEL_KEY_PREFIXES,
  TEST_CHARACTER_DISPLAY_NAME_PREFIXES,
  TEST_CHARACTER_NORMALIZED_NAME_PREFIXES,
  TEST_REALM_SLUGS,
  TEST_REALM_SLUG_PREFIXES,
  TEST_DUNGEON_SLUG_PREFIXES,
  TEST_SEASON_SLUGS,
  TEST_BULK_LOGICAL_KEY_PREFIXES,
  TEST_MECHANIC_RULE_SOURCES,
  matchScoreModelKey,
  matchTestCharacterIdentity,
  matchIngestionDedupeKey,
  matchIngestionPayloadName,
  matchBulkLogicalKey,
  matchTestRealmSlug,
  matchTestDungeonSlug,
  isCanonicalScoreModelKey,
  isTestOwnedScoreModelKey,
  parseDatabaseUrl,
  sanitizeDatabaseUrl,
} from "./lib/test-db-isolation.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

/* ---------------------------------------------------------------------- *
 * CLI args & safety gate
 * ---------------------------------------------------------------------- */

function parseArgs(argv) {
  const confirm = argv.includes("--confirm");
  return { confirm, dryRun: !confirm };
}

function assertCleanupTargetAllowed(databaseUrl, env = process.env) {
  const appEnv = String(env.APP_ENV ?? "").toLowerCase();
  const nodeEnv = String(env.NODE_ENV ?? "").toLowerCase();
  const cleanupTarget = String(env.MPLUS_CLEANUP_TARGET ?? "").toLowerCase();
  const parsed = parseDatabaseUrl(databaseUrl);
  const sanitized = sanitizeDatabaseUrl(databaseUrl);

  if (appEnv === "production" || appEnv === "prod" || nodeEnv === "production") {
    return {
      ok: false,
      message: [
        "REFUSED: production cleanup is categorically forbidden.",
        `Target (sanitized): ${sanitized}`,
      ].join("\n"),
    };
  }

  if (!parsed) {
    return { ok: false, message: `REFUSED: invalid DATABASE_URL.\nTarget: ${sanitized}` };
  }

  // Disposable isolated DBs are fine for local verification without extra flags.
  const isDisposable = /^mplus_itest_[a-z0-9]{8,24}$/.test(parsed.database);
  const isLoopback =
    parsed.host === "localhost" || parsed.host === "127.0.0.1" || parsed.host === "::1";

  if (isDisposable || isLoopback) {
    return { ok: true, sanitized, mode: isDisposable ? "disposable" : "local" };
  }

  // Remote / deployed: require explicit assertion that this is the deployed test env.
  if (cleanupTarget !== "deployed-test") {
    return {
      ok: false,
      message: [
        "REFUSED: remote DATABASE_URL without MPLUS_CLEANUP_TARGET=deployed-test.",
        `Target (sanitized): ${sanitized}`,
        "For the deployed test environment, run:",
        "  MPLUS_CLEANUP_TARGET=deployed-test pnpm db:cleanup:test-artifacts -- --dry-run",
        "  MPLUS_CLEANUP_TARGET=deployed-test pnpm db:cleanup:test-artifacts -- --confirm",
      ].join("\n"),
    };
  }

  if (cleanupTarget === "deployed-test" && (appEnv === "production" || appEnv === "prod")) {
    return {
      ok: false,
      message: "REFUSED: MPLUS_CLEANUP_TARGET=deployed-test cannot be combined with production APP_ENV.",
    };
  }

  return { ok: true, sanitized, mode: "deployed-test" };
}

/* ---------------------------------------------------------------------- *
 * Prisma / BullMQ loaders
 * ---------------------------------------------------------------------- */

async function loadPrisma(databaseUrl) {
  const distEntry = resolve(root, "packages/database/dist/index.js");
  try {
    const { createPrismaClient } = await import(pathToFileURL(distEntry).href);
    return createPrismaClient(databaseUrl);
  } catch (err) {
    if (err && (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "MODULE_NOT_FOUND")) {
      console.error(
        [
          "cleanup-test-artifacts: packages/database is not built.",
          `Expected: ${distEntry}`,
          "Run: pnpm db:generate && pnpm --filter @mplus/database run build   (or pnpm build)",
        ].join("\n"),
      );
      process.exit(1);
    }
    throw err;
  }
}

/** Best-effort: resolve BullMQ `Queue` from the worker's dependency tree. */
function loadBullMqQueueCtor() {
  try {
    const require = createRequire(pathToFileURL(resolve(root, "apps/worker/package.json")).href);
    return require("bullmq").Queue;
  } catch {
    return null;
  }
}

/** All known queue names, sourced from @mplus/contracts (falls back to the refresh queue). */
async function loadQueueNames() {
  try {
    const distEntry = resolve(root, "packages/contracts/dist/index.js");
    const mod = await import(pathToFileURL(distEntry).href);
    if (mod.QUEUE_NAMES) return new Set(Object.values(mod.QUEUE_NAMES));
  } catch {
    // fall through to default below
  }
  return new Set(["refresh-character"]);
}

function parseRedisConnectionOptions(redisUrl) {
  const u = new URL(redisUrl);
  const options = { host: u.hostname, port: u.port ? Number(u.port) : 6379 };
  if (u.username) options.username = decodeURIComponent(u.username);
  if (u.password) options.password = decodeURIComponent(u.password);
  if (u.pathname && u.pathname.length > 1) {
    const db = Number(u.pathname.slice(1));
    if (Number.isFinite(db)) options.db = db;
  }
  if (u.protocol === "rediss:") options.tls = {};
  return options;
}

/**
 * Best-effort BullMQ context. Never throws — callers fall back to
 * DB-only cleanup (queue_skipped) when Redis/BullMQ is unavailable.
 * @returns {Promise<null | { removeJob(jobType: string, queueJobId: string): Promise<{removed: boolean, reason?: string}>, close(): Promise<void> }>}
 */
async function createBullMqContext(env = process.env) {
  const redisUrl = env.REDIS_URL;
  if (!redisUrl) return null;
  const Queue = loadBullMqQueueCtor();
  if (!Queue) return null;

  const connection = parseRedisConnectionOptions(redisUrl);
  const knownQueueNames = await loadQueueNames();
  const queues = new Map();

  function queueFor(name) {
    let queue = queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection });
      queues.set(name, queue);
    }
    return queue;
  }

  return {
    async removeJob(jobType, queueJobId) {
      const queueName = knownQueueNames.has(jobType) ? jobType : "refresh-character";
      try {
        const queue = queueFor(queueName);
        const job = await queue.getJob(queueJobId);
        if (!job) return { removed: false, reason: "not-found" };
        await job.remove();
        return { removed: true };
      } catch (err) {
        return { removed: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },
    async close() {
      await Promise.all([...queues.values()].map((q) => q.close().catch(() => {})));
    },
  };
}

/* ---------------------------------------------------------------------- *
 * isTestOwnedIngestionJob — pure classifier (exported for unit tests)
 * ---------------------------------------------------------------------- */

/**
 * @param {{ characterId?: string | null, dedupeKey?: string | null, payload?: unknown }} job
 * @param {Set<string>} testCharacterIds
 * @returns {{ owned: boolean, evidence: string | null }}
 */
function isTestOwnedIngestionJob(job, testCharacterIds = new Set()) {
  const dedupeMatch = matchIngestionDedupeKey(job.dedupeKey ?? null);
  if (dedupeMatch) return { owned: true, evidence: `dedupe:${dedupeMatch}` };

  const payloadMatch = matchIngestionPayloadName(job.payload ?? null);
  if (payloadMatch) return { owned: true, evidence: `payload:${payloadMatch}` };

  if (job.characterId && testCharacterIds.has(job.characterId)) {
    return { owned: true, evidence: `character:${job.characterId}` };
  }

  return { owned: false, evidence: null };
}

/* ---------------------------------------------------------------------- *
 * Inventory — read-only classification of every candidate table
 * ---------------------------------------------------------------------- */

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 */
async function inventoryScoreModels(prisma) {
  const all = await prisma.scoreModel.findMany({
    orderBy: [{ key: "asc" }, { version: "asc" }],
    select: { id: true, key: true, name: true, version: true, status: true, createdAt: true, activatedAt: true },
  });

  const candidates = [];
  const retained = [];
  for (const model of all) {
    if (isCanonicalScoreModelKey(model.key)) {
      retained.push({ model, reason: "canonical" });
      continue;
    }
    if (!isTestOwnedScoreModelKey(model.key)) {
      retained.push({ model, reason: "not-allowlisted" });
      continue;
    }
    const [scoreSnapshots, analysisBatches, characterRedFlags, addonExports, bulkOperations] = await Promise.all([
      prisma.scoreSnapshot.count({ where: { scoreModelId: model.id } }),
      prisma.scoreAnalysisBatch.count({ where: { scoreModelId: model.id } }),
      prisma.characterRedFlag.count({ where: { scoreModelId: model.id } }),
      prisma.addonExport.count({ where: { scoreModelId: model.id } }),
      prisma.bulkOperation.count({ where: { scoreModelId: model.id } }),
    ]);
    candidates.push({
      model,
      deps: { scoreSnapshots, analysisBatches, characterRedFlags, addonExports, bulkOperations },
      evidence: `key:${matchScoreModelKey(model.key)}`,
    });
  }
  return { candidates, retained };
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @returns {Promise<{ id: string, displayName: string, normalizedName: string, realmId: string }[]>}
 */
async function findIdentityMatchedCharacters(prisma) {
  return prisma.character.findMany({
    where: {
      OR: [
        ...TEST_CHARACTER_DISPLAY_NAME_PREFIXES.map((prefix) => ({ displayName: { startsWith: prefix } })),
        ...TEST_CHARACTER_NORMALIZED_NAME_PREFIXES.map((prefix) => ({ normalizedName: { startsWith: prefix } })),
      ],
    },
    select: { id: true, displayName: true, normalizedName: true, realmId: true, createdAt: true },
  });
}

/**
 * Fetch + classify every IngestionJob. The table is expected to stay small in
 * practice for test/CI environments; classification is done in-memory so the
 * dedupeKey/payload-name/character-identity rules stay in one place
 * (isTestOwnedIngestionJob) instead of being re-expressed as SQL.
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {Set<string>} testCharacterIds
 */
async function inventoryIngestionJobs(prisma, testCharacterIds) {
  const jobs = await prisma.ingestionJob.findMany({
    select: {
      id: true,
      jobType: true,
      status: true,
      characterId: true,
      dedupeKey: true,
      payload: true,
      queueJobId: true,
    },
    orderBy: { scheduledAt: "asc" },
  });

  const testOwned = [];
  /** @type {Map<string, { total: number, testOwned: number }>} */
  const byCharacterId = new Map();

  for (const job of jobs) {
    const { owned, evidence } = isTestOwnedIngestionJob(job, testCharacterIds);
    if (job.characterId) {
      const bucket = byCharacterId.get(job.characterId) ?? { total: 0, testOwned: 0 };
      bucket.total += 1;
      if (owned) bucket.testOwned += 1;
      byCharacterId.set(job.characterId, bucket);
    }
    if (owned) testOwned.push({ job, evidence });
  }

  return { testOwned, totalJobs: jobs.length, byCharacterId };
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ id: string, displayName: string, normalizedName: string, realmId: string }[]} identityMatched
 * @param {Map<string, { total: number, testOwned: number }>} jobsByCharacterId
 * @param {string[]} canonicalModelIds
 */
async function inventoryCharacters(prisma, identityMatched, jobsByCharacterId, canonicalModelIds) {
  const testCharacterIds = new Set(identityMatched.map((c) => c.id));
  const candidates = [];
  const retained = [];

  for (const character of identityMatched) {
    const identity = matchTestCharacterIdentity(character.displayName, character.normalizedName);
    const evidence = `${identity.kind}:${identity.prefix}`;

    const ownershipCount = await prisma.verifiedCharacterOwnership.count({
      where: { characterId: character.id },
    });
    if (ownershipCount > 0) {
      retained.push({ character, reason: `has ${ownershipCount} verified ownership record(s)`, evidence });
      continue;
    }

    if (canonicalModelIds.length > 0) {
      const canonicalPublished = await prisma.characterPublishedScore.count({
        where: { characterId: character.id, scoreModelId: { in: canonicalModelIds } },
      });
      if (canonicalPublished > 0) {
        retained.push({
          character,
          reason: "has published score on canonical model",
          evidence,
        });
        continue;
      }
    }

    const jobBucket = jobsByCharacterId.get(character.id);
    const nonTestJobCount = jobBucket ? jobBucket.total - jobBucket.testOwned : 0;
    if (nonTestJobCount > 0) {
      retained.push({ character, reason: `has ${nonTestJobCount} non-test ingestion job(s)`, evidence });
      continue;
    }

    // Runs shared with a non-test-owned participant must not lose their linkage.
    const participants = await prisma.runParticipant.findMany({
      where: { characterId: character.id },
      select: { id: true, runId: true },
    });
    let ambiguousRun = null;
    for (const participant of participants) {
      const others = await prisma.runParticipant.findMany({
        where: { runId: participant.runId, NOT: { id: participant.id } },
        select: { characterId: true },
      });
      const hasNonTestParticipant = others.some(
        (other) => !other.characterId || !testCharacterIds.has(other.characterId),
      );
      if (hasNonTestParticipant) {
        ambiguousRun = participant.runId;
        break;
      }
    }
    if (ambiguousRun) {
      retained.push({
        character,
        reason: `shared mythic run ${ambiguousRun} has a non-test participant`,
        evidence,
      });
      continue;
    }

    candidates.push({ character, evidence });
  }

  return { candidates, retained };
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 */
async function inventoryBulkOperations(prisma) {
  const all = await prisma.bulkOperation.findMany({
    where: {
      OR: TEST_BULK_LOGICAL_KEY_PREFIXES.map((prefix) => ({ logicalKey: { startsWith: prefix } })),
    },
    select: { id: true, logicalKey: true, status: true, mode: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return all.map((bulkOperation) => ({
    bulkOperation,
    evidence: `logicalKey:${matchBulkLogicalKey(bulkOperation.logicalKey)}`,
  }));
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 */
async function inventoryRealms(prisma) {
  const all = await prisma.realm.findMany({
    where: {
      OR: [
        { slug: { in: [...TEST_REALM_SLUGS] } },
        ...TEST_REALM_SLUG_PREFIXES.map((prefix) => ({ slug: { startsWith: prefix } })),
      ],
    },
    select: { id: true, slug: true, name: true },
  });
  const candidates = [];
  for (const realm of all) {
    const referencingCharacters = await prisma.character.count({ where: { realmId: realm.id } });
    candidates.push({ realm, evidence: `slug:${matchTestRealmSlug(realm.slug)}`, referencingCharacters });
  }
  return candidates;
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 */
async function inventoryDungeons(prisma) {
  const all = await prisma.dungeon.findMany({
    where: { OR: TEST_DUNGEON_SLUG_PREFIXES.map((prefix) => ({ slug: { startsWith: prefix } })) },
    select: { id: true, slug: true, name: true },
  });
  const candidates = [];
  for (const dungeon of all) {
    const [runs, rules, seasonDungeons] = await Promise.all([
      prisma.mythicRun.count({ where: { dungeonId: dungeon.id } }),
      prisma.mechanicRule.count({ where: { dungeonId: dungeon.id } }),
      prisma.seasonDungeon.count({ where: { dungeonId: dungeon.id } }),
    ]);
    candidates.push({
      dungeon,
      evidence: `slug:${matchTestDungeonSlug(dungeon.slug)}`,
      referencingRows: runs + rules + seasonDungeons,
    });
  }
  return candidates;
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 */
async function inventorySeasons(prisma) {
  const all = await prisma.season.findMany({
    where: { slug: { in: [...TEST_SEASON_SLUGS] } },
    select: { id: true, slug: true, name: true },
  });
  const candidates = [];
  for (const season of all) {
    const counts = await Promise.all([
      prisma.mythicRun.count({ where: { seasonId: season.id } }),
      prisma.scoreSnapshot.count({ where: { seasonId: season.id } }),
      prisma.addonExport.count({ where: { seasonId: season.id } }),
      prisma.seasonDungeon.count({ where: { seasonId: season.id } }),
      prisma.mechanicRule.count({ where: { seasonId: season.id } }),
      prisma.metricObservation.count({ where: { seasonId: season.id } }),
      prisma.characterRedFlag.count({ where: { seasonId: season.id } }),
      prisma.characterPublishedScore.count({ where: { seasonId: season.id } }),
      prisma.scoreAnalysisBatch.count({ where: { seasonId: season.id } }),
    ]);
    candidates.push({
      season,
      evidence: `slug:${season.slug}`,
      referencingRows: counts.reduce((a, b) => a + b, 0),
    });
  }
  return candidates;
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 */
async function inventoryMechanicRules(prisma) {
  const all = await prisma.mechanicRule.findMany({
    where: { source: { in: [...TEST_MECHANIC_RULE_SOURCES] } },
    select: { id: true, source: true, ruleType: true, seasonId: true, dungeonId: true },
  });
  return all.map((rule) => ({ rule, evidence: `source:${rule.source}` }));
}

/**
 * Structured, read-only inventory used by both the CLI dry-run/confirm flow
 * and by unit/integration tests.
 * @param {import("@prisma/client").PrismaClient} prisma
 */
async function inventoryTestArtifacts(prisma) {
  const scoreModels = await inventoryScoreModels(prisma);
  const canonicalModelIds = scoreModels.retained
    .filter((r) => r.reason === "canonical")
    .map((r) => r.model.id);

  const identityMatched = await findIdentityMatchedCharacters(prisma);
  const identityMatchedIds = new Set(identityMatched.map((c) => c.id));

  const ingestionJobs = await inventoryIngestionJobs(prisma, identityMatchedIds);
  const characters = await inventoryCharacters(
    prisma,
    identityMatched,
    ingestionJobs.byCharacterId,
    canonicalModelIds,
  );
  const bulkOperations = await inventoryBulkOperations(prisma);
  const realms = await inventoryRealms(prisma);
  const dungeons = await inventoryDungeons(prisma);
  const seasons = await inventorySeasons(prisma);
  const mechanicRules = await inventoryMechanicRules(prisma);

  const queueJobIds = ingestionJobs.testOwned
    .filter(({ job }) => job.queueJobId)
    .map(({ job }) => ({ queueJobId: job.queueJobId, jobType: job.jobType, ingestionJobId: job.id }));

  return {
    scoreModels,
    ingestionJobs,
    characters,
    bulkOperations,
    realms,
    dungeons,
    seasons,
    mechanicRules,
    redis: { queueJobIds },
  };
}

/* ---------------------------------------------------------------------- *
 * Deletion (confirm mode only)
 * ---------------------------------------------------------------------- */

/**
 * Deletes a test-owned score model and its durable dependents.
 *
 * Dependents (ScoreSnapshot, ScoreAnalysisBatch, CharacterRedFlag, AddonExport)
 * are keyed 1:1 to `scoreModelId` — they can never be shared with another
 * model — so once the model itself is confirmed test-owned, cascading through
 * this exact chain is safe regardless of which character they belong to.
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} modelId
 */
async function deleteScoreModelTransactionally(prisma, modelId) {
  await prisma.$transaction(async (tx) => {
    const model = await tx.scoreModel.findUnique({ where: { id: modelId } });
    if (!model) return;
    if (isCanonicalScoreModelKey(model.key)) {
      throw new Error(`Refusing to delete canonical model key=${model.key}`);
    }
    if (!isTestOwnedScoreModelKey(model.key)) {
      throw new Error(`Refusing to delete non-allowlisted key=${model.key}`);
    }

    const snapshots = await tx.scoreSnapshot.findMany({
      where: { scoreModelId: modelId },
      select: { id: true },
    });
    const snapshotIds = snapshots.map((s) => s.id);

    if (snapshotIds.length > 0) {
      await tx.dimensionScore.deleteMany({ where: { scoreSnapshotId: { in: snapshotIds } } });
      await tx.scoreDispute.deleteMany({ where: { scoreSnapshotId: { in: snapshotIds } } });
      await tx.characterPublishedScore.deleteMany({ where: { publishedSnapshotId: { in: snapshotIds } } });
      await tx.scoreSnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
    }

    await tx.characterRedFlag.deleteMany({ where: { scoreModelId: modelId } });
    await tx.scoreAnalysisBatch.deleteMany({ where: { scoreModelId: modelId } });
    await tx.addonExport.deleteMany({ where: { scoreModelId: modelId } });
    await tx.bulkOperation.updateMany({ where: { scoreModelId: modelId }, data: { scoreModelId: null } });

    await tx.scoreModel.delete({ where: { id: modelId } });
  });
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} characterId
 */
async function deleteCharacterTransactionally(prisma, characterId) {
  await prisma.$transaction(async (tx) => {
    // Any ingestion jobs left referencing this character are, by construction
    // of the caller's retain checks, test-owned (non-test jobs block the
    // character from ever becoming a candidate).
    await tx.ingestionJob.deleteMany({ where: { characterId } });

    await tx.characterAlias.deleteMany({ where: { characterId } });
    await tx.metricObservation.deleteMany({ where: { characterId } });

    const snapshots = await tx.scoreSnapshot.findMany({ where: { characterId }, select: { id: true } });
    const snapshotIds = snapshots.map((s) => s.id);
    if (snapshotIds.length > 0) {
      await tx.dimensionScore.deleteMany({ where: { scoreSnapshotId: { in: snapshotIds } } });
    }
    await tx.scoreDispute.deleteMany({
      where: { OR: [{ characterId }, ...(snapshotIds.length ? [{ scoreSnapshotId: { in: snapshotIds } }] : [])] },
    });
    await tx.characterPublishedScore.deleteMany({
      where: {
        OR: [{ characterId }, ...(snapshotIds.length ? [{ publishedSnapshotId: { in: snapshotIds } }] : [])],
      },
    });
    await tx.characterRedFlag.deleteMany({ where: { characterId } });
    if (snapshotIds.length > 0) {
      await tx.scoreSnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
    }

    const characterSnapshots = await tx.characterSnapshot.findMany({
      where: { characterId },
      select: { id: true },
    });
    const characterSnapshotIds = characterSnapshots.map((s) => s.id);
    if (characterSnapshotIds.length > 0) {
      await tx.equipmentSnapshot.deleteMany({ where: { characterSnapshotId: { in: characterSnapshotIds } } });
      await tx.talentSnapshot.deleteMany({ where: { characterSnapshotId: { in: characterSnapshotIds } } });
      await tx.characterSnapshot.deleteMany({ where: { id: { in: characterSnapshotIds } } });
    }

    await tx.scoreAnalysisBatch.deleteMany({ where: { characterId } });

    // Vetted by the caller: no run has a non-test-owned participant.
    await tx.runAnalysis.deleteMany({ where: { characterId } });
    await tx.runParticipant.deleteMany({ where: { characterId } });

    // character_provider_states, character_profile_views, refresh_schedule_items
    // (Cascade) and refresh_admissions / bulk_operation_items / refresh_cost_ledger
    // (SetNull) are handled automatically by the DB on Character delete.
    await tx.character.delete({ where: { id: characterId } });
  });
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {ReturnType<typeof inventoryTestArtifacts>} inventoryPromise
 * @param {Awaited<ReturnType<typeof createBullMqContext>>} bullmq
 */
async function applyCleanup(prisma, inventory, bullmq) {
  const results = {
    scoreModels: { deleted: 0, refused: 0 },
    ingestionJobs: { deleted: 0, refused: 0, queueRemoved: 0, queueNotFound: 0, queueSkipped: 0 },
    characters: { deleted: 0, refused: 0 },
    bulkOperations: { deleted: 0, refused: 0 },
    realms: { deleted: 0, retained: 0 },
    dungeons: { deleted: 0, retained: 0 },
    seasons: { deleted: 0, retained: 0 },
    mechanicRules: { deleted: 0, refused: 0 },
  };
  const deletedIds = [];

  for (const { model } of inventory.scoreModels.candidates) {
    try {
      await deleteScoreModelTransactionally(prisma, model.id);
      console.log(`DELETED score_model ${model.key}@v${model.version} (${model.id})`);
      results.scoreModels.deleted += 1;
      deletedIds.push(model.id);
    } catch (err) {
      console.error(`REFUSED score_model ${model.key}@v${model.version}: ${err instanceof Error ? err.message : err}`);
      results.scoreModels.refused += 1;
    }
  }

  const hasRedisUrl = Boolean(process.env.REDIS_URL);
  for (const { job, evidence } of inventory.ingestionJobs.testOwned) {
    try {
      if (job.queueJobId) {
        if (bullmq) {
          const outcome = await bullmq.removeJob(job.jobType, job.queueJobId);
          if (outcome.removed) results.ingestionJobs.queueRemoved += 1;
          else if (outcome.reason === "not-found") results.ingestionJobs.queueNotFound += 1;
          else results.ingestionJobs.queueSkipped += 1;
        } else {
          if (!hasRedisUrl) {
            console.warn(`WARN ingestion job ${job.id}: REDIS_URL not set, skipping queue removal (queue_skipped)`);
          }
          results.ingestionJobs.queueSkipped += 1;
        }
      }
      await prisma.ingestionJob.delete({ where: { id: job.id } });
      console.log(`DELETED ingestion_job ${job.id} evidence=${evidence}`);
      results.ingestionJobs.deleted += 1;
      deletedIds.push(job.id);
    } catch (err) {
      console.error(`REFUSED ingestion_job ${job.id}: ${err instanceof Error ? err.message : err}`);
      results.ingestionJobs.refused += 1;
    }
  }

  for (const { character } of inventory.characters.candidates) {
    try {
      await deleteCharacterTransactionally(prisma, character.id);
      console.log(`DELETED character ${character.displayName} (${character.id})`);
      results.characters.deleted += 1;
      deletedIds.push(character.id);
    } catch (err) {
      console.error(
        `REFUSED character ${character.displayName} (${character.id}): ${err instanceof Error ? err.message : err}`,
      );
      results.characters.refused += 1;
    }
  }

  for (const { bulkOperation } of inventory.bulkOperations) {
    try {
      await prisma.bulkOperationItem.deleteMany({ where: { bulkOperationId: bulkOperation.id } });
      await prisma.bulkOperation.delete({ where: { id: bulkOperation.id } });
      console.log(`DELETED bulk_operation ${bulkOperation.logicalKey} (${bulkOperation.id})`);
      results.bulkOperations.deleted += 1;
      deletedIds.push(bulkOperation.id);
    } catch (err) {
      console.error(
        `REFUSED bulk_operation ${bulkOperation.logicalKey} (${bulkOperation.id}): ${err instanceof Error ? err.message : err}`,
      );
      results.bulkOperations.refused += 1;
    }
  }

  // Realms/dungeons/seasons: dependents may have just been cleared above,
  // so re-check live counts immediately before each delete.
  for (const { realm } of inventory.realms) {
    const remaining = await prisma.character.count({ where: { realmId: realm.id } });
    if (remaining > 0) {
      console.log(`RETAINED realm ${realm.slug}: ${remaining} referencing character(s) remain`);
      results.realms.retained += 1;
      continue;
    }
    await prisma.realm.delete({ where: { id: realm.id } });
    console.log(`DELETED realm ${realm.slug} (${realm.id})`);
    results.realms.deleted += 1;
    deletedIds.push(realm.id);
  }

  for (const { dungeon } of inventory.dungeons) {
    const [runs, rules, seasonDungeons] = await Promise.all([
      prisma.mythicRun.count({ where: { dungeonId: dungeon.id } }),
      prisma.mechanicRule.count({ where: { dungeonId: dungeon.id } }),
      prisma.seasonDungeon.count({ where: { dungeonId: dungeon.id } }),
    ]);
    const remaining = runs + rules + seasonDungeons;
    if (remaining > 0) {
      console.log(`RETAINED dungeon ${dungeon.slug}: ${remaining} referencing row(s) remain`);
      results.dungeons.retained += 1;
      continue;
    }
    await prisma.dungeon.delete({ where: { id: dungeon.id } });
    console.log(`DELETED dungeon ${dungeon.slug} (${dungeon.id})`);
    results.dungeons.deleted += 1;
    deletedIds.push(dungeon.id);
  }

  for (const { season } of inventory.seasons) {
    const counts = await Promise.all([
      prisma.mythicRun.count({ where: { seasonId: season.id } }),
      prisma.scoreSnapshot.count({ where: { seasonId: season.id } }),
      prisma.addonExport.count({ where: { seasonId: season.id } }),
      prisma.seasonDungeon.count({ where: { seasonId: season.id } }),
      prisma.mechanicRule.count({ where: { seasonId: season.id } }),
      prisma.metricObservation.count({ where: { seasonId: season.id } }),
      prisma.characterRedFlag.count({ where: { seasonId: season.id } }),
      prisma.characterPublishedScore.count({ where: { seasonId: season.id } }),
      prisma.scoreAnalysisBatch.count({ where: { seasonId: season.id } }),
    ]);
    const remaining = counts.reduce((a, b) => a + b, 0);
    if (remaining > 0) {
      console.log(`RETAINED season ${season.slug}: ${remaining} referencing row(s) remain`);
      results.seasons.retained += 1;
      continue;
    }
    await prisma.season.delete({ where: { id: season.id } });
    console.log(`DELETED season ${season.slug} (${season.id})`);
    results.seasons.deleted += 1;
    deletedIds.push(season.id);
  }

  for (const { rule } of inventory.mechanicRules) {
    try {
      await prisma.mechanicRule.delete({ where: { id: rule.id } });
      results.mechanicRules.deleted += 1;
      deletedIds.push(rule.id);
    } catch (err) {
      console.error(`REFUSED mechanic_rule ${rule.id}: ${err instanceof Error ? err.message : err}`);
      results.mechanicRules.refused += 1;
    }
  }

  if (deletedIds.length > 0) {
    const referencingAuditEvents = await prisma.auditEvent.count({ where: { resourceId: { in: deletedIds } } });
    results.auditEventsReferencingDeleted = referencingAuditEvents;
  } else {
    results.auditEventsReferencingDeleted = 0;
  }

  return results;
}

/* ---------------------------------------------------------------------- *
 * Output formatting
 * ---------------------------------------------------------------------- */

function printInventory(inventory, { mode, sanitized, dryRun }) {
  console.log(`cleanup-test-artifacts: mode=${mode} dryRun=${dryRun}`);
  console.log(`Target (sanitized): ${sanitized}`);

  console.log(`\n=== score_models (${inventory.scoreModels.candidates.length}) ===`);
  for (const { model, deps, evidence } of inventory.scoreModels.candidates) {
    console.log(
      `  id=${model.id} key=${model.key} version=${model.version} status=${model.status} evidence=${evidence} ` +
        `deps(snapshots=${deps.scoreSnapshots} batches=${deps.analysisBatches} redFlags=${deps.characterRedFlags} exports=${deps.addonExports} bulkOps=${deps.bulkOperations})`,
    );
  }

  console.log(`\n=== ingestion_jobs (${inventory.ingestionJobs.testOwned.length}) ===`);
  for (const { job, evidence } of inventory.ingestionJobs.testOwned) {
    console.log(
      `  id=${job.id} status=${job.status} jobType=${job.jobType} characterId=${job.characterId ?? "null"} ` +
        `dedupeKey=${job.dedupeKey ?? "null"} evidence=${evidence}`,
    );
  }

  console.log(`\n=== characters (${inventory.characters.candidates.length}) ===`);
  for (const { character, evidence } of inventory.characters.candidates) {
    console.log(`  id=${character.id} displayName=${character.displayName} evidence=${evidence}`);
  }
  if (inventory.characters.retained.length > 0) {
    console.log(`  retained (${inventory.characters.retained.length}):`);
    for (const { character, reason } of inventory.characters.retained) {
      console.log(`    keep ${character.displayName} (${character.id}) — ${reason}`);
    }
  }

  console.log(`\n=== bulk_operations (${inventory.bulkOperations.length}) ===`);
  for (const { bulkOperation, evidence } of inventory.bulkOperations) {
    console.log(`  id=${bulkOperation.id} logicalKey=${bulkOperation.logicalKey} evidence=${evidence}`);
  }

  console.log(`\n=== realms / dungeons / seasons ===`);
  for (const { realm, evidence, referencingCharacters } of inventory.realms) {
    console.log(`  realm id=${realm.id} slug=${realm.slug} evidence=${evidence} referencingCharacters=${referencingCharacters}`);
  }
  for (const { dungeon, evidence, referencingRows } of inventory.dungeons) {
    console.log(`  dungeon id=${dungeon.id} slug=${dungeon.slug} evidence=${evidence} referencingRows=${referencingRows}`);
  }
  for (const { season, evidence, referencingRows } of inventory.seasons) {
    console.log(`  season id=${season.id} slug=${season.slug} evidence=${evidence} referencingRows=${referencingRows}`);
  }

  console.log(`\n=== mechanic_rules (${inventory.mechanicRules.length}) ===`);
  for (const { rule, evidence } of inventory.mechanicRules) {
    console.log(`  id=${rule.id} evidence=${evidence}`);
  }

  console.log(`\n=== redis/bullmq ===`);
  console.log(`  queueJobIds to remove: ${inventory.redis.queueJobIds.length}`);
  for (const { queueJobId, jobType, ingestionJobId } of inventory.redis.queueJobIds) {
    console.log(`    queueJobId=${queueJobId} jobType=${jobType} ingestionJobId=${ingestionJobId}`);
  }

  console.log(
    `\nSummary: candidates by table — score_models=${inventory.scoreModels.candidates.length} ` +
      `ingestion_jobs=${inventory.ingestionJobs.testOwned.length} characters=${inventory.characters.candidates.length} ` +
      `bulk_operations=${inventory.bulkOperations.length} realms=${inventory.realms.length} ` +
      `dungeons=${inventory.dungeons.length} seasons=${inventory.seasons.length} mechanic_rules=${inventory.mechanicRules.length}`,
  );
}

function printResults(results) {
  console.log("\n=== cleanup results ===");
  console.log(`score_models: deleted=${results.scoreModels.deleted} refused=${results.scoreModels.refused}`);
  console.log(
    `ingestion_jobs: deleted=${results.ingestionJobs.deleted} refused=${results.ingestionJobs.refused} ` +
      `queueRemoved=${results.ingestionJobs.queueRemoved} queueNotFound=${results.ingestionJobs.queueNotFound} ` +
      `queueSkipped=${results.ingestionJobs.queueSkipped}`,
  );
  console.log(`characters: deleted=${results.characters.deleted} refused=${results.characters.refused}`);
  console.log(`bulk_operations: deleted=${results.bulkOperations.deleted} refused=${results.bulkOperations.refused}`);
  console.log(`realms: deleted=${results.realms.deleted} retained=${results.realms.retained}`);
  console.log(`dungeons: deleted=${results.dungeons.deleted} retained=${results.dungeons.retained}`);
  console.log(`seasons: deleted=${results.seasons.deleted} retained=${results.seasons.retained}`);
  console.log(`mechanic_rules: deleted=${results.mechanicRules.deleted} refused=${results.mechanicRules.refused}`);
  console.log(`audit_events referencing deleted ids (not deleted): ${results.auditEventsReferencingDeleted}`);
}

/* ---------------------------------------------------------------------- *
 * Entry point
 * ---------------------------------------------------------------------- */

async function runCleanup(argv = process.argv.slice(2)) {
  const { confirm, dryRun } = parseArgs(argv);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("cleanup-test-artifacts: DATABASE_URL is required");
    process.exit(1);
  }

  const gate = assertCleanupTargetAllowed(databaseUrl);
  if (!gate.ok) {
    console.error(gate.message);
    process.exit(1);
  }

  const prisma = await loadPrisma(databaseUrl);
  try {
    const inventory = await inventoryTestArtifacts(prisma);
    printInventory(inventory, { mode: gate.mode, sanitized: gate.sanitized, dryRun: dryRun || !confirm });

    if (!confirm) {
      console.log("\nDry-run only. No rows deleted.");
      console.log("To delete: pnpm db:cleanup:test-artifacts -- --confirm");
      console.log(
        "Deployed test: MPLUS_CLEANUP_TARGET=deployed-test pnpm db:cleanup:test-artifacts -- --confirm",
      );
      return;
    }

    const bullmq = await createBullMqContext();
    try {
      const results = await applyCleanup(prisma, inventory, bullmq);
      printResults(results);
    } finally {
      if (bullmq) await bullmq.close();
    }
  } finally {
    await prisma.$disconnect();
  }
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return entry.replace(/\\/g, "/").endsWith("/tools/scripts/cleanup-test-artifacts.mjs");
  }
}

if (isMainModule()) {
  runCleanup().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export {
  assertCleanupTargetAllowed,
  parseArgs,
  runCleanup,
  inventoryTestArtifacts,
  isTestOwnedIngestionJob,
  deleteScoreModelTransactionally,
  deleteCharacterTransactionally,
  CANONICAL_SCORE_MODEL_KEYS,
  TEST_SCORE_MODEL_KEY_PREFIXES,
  isCanonicalScoreModelKey,
  isTestOwnedScoreModelKey,
};
