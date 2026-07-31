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
 *   pnpm db:cleanup:test-artifacts -- --confirm --models-only   (score models only)
 *
 * Deployed test environment (required assertion):
 *   MPLUS_CLEANUP_TARGET=deployed-test pnpm db:cleanup:test-artifacts -- --confirm
 *
 * Safety:
 *   - Production (APP_ENV/NODE_ENV) is categorically refused.
 *   - Remote/non-loopback targets require MPLUS_CLEANUP_TARGET=deployed-test.
 *   - Never deletes the canonical seeded score model key (`default`).
 *   - Candidates are selected exclusively via the compound classifiers below,
 *     backed by the authoritative marker registry
 *     (tools/scripts/lib/test-artifact-registry.mjs) — never by status, date,
 *     or a bare substring match. A single weak marker (e.g. `discover:` alone,
 *     or a character id alone) is never sufficient; ownership requires at
 *     least two independent signals.
 *   - BullMQ removal is fail-closed: if Redis/BullMQ is unavailable, or the
 *     queue job cannot be verified as removed, the corresponding IngestionJob
 *     row (and any Character that still references it) is refused, not
 *     silently skipped.
 *   - Never prints credentials (all DATABASE_URL/REDIS_URL logging is sanitized).
 */
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  CANONICAL_SCORE_MODEL_KEYS,
  TEST_SCORE_MODEL_KEY_PREFIXES,
  TEST_REALM_SLUGS,
  TEST_REALM_SLUG_PREFIXES,
  TEST_DUNGEON_SLUG_PREFIXES,
  TEST_SEASON_SLUGS,
  TEST_BULK_LOGICAL_KEY_PREFIXES,
  TEST_MECHANIC_RULE_SOURCES,
  matchScoreModelKey,
  matchExactCharacterIdentity,
  matchIngestionDedupeKey,
  matchIngestionPayloadName,
  matchBulkLogicalKey,
  matchTestRealmSlug,
  matchTestDungeonSlug,
  isModelActivateLogicalKey,
  isDiscoverDedupeKey,
} from "./lib/test-artifact-registry.mjs";
import {
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
  const modelsOnly = argv.includes("--models-only");
  return { confirm, dryRun: !confirm, modelsOnly };
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

/** Strips credentials from Redis connection errors before they hit the console. */
function sanitizeErrorMessage(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/redis(s)?:\/\/[^@\s]*@/gi, "redis$1://***@");
}

/**
 * A job's `jobType` must equal a known BullMQ queue name exactly. There is
 * intentionally NO fallback to `refresh-character` (or any other queue) for
 * unrecognized job types — an unknown job type means we cannot prove the
 * queue job was removed, so the caller must refuse instead of guessing.
 * @param {string} jobType
 * @param {Set<string>} queueNamesSet
 * @returns {Promise<string | null>}
 */
async function resolveQueueNameForJobType(jobType, queueNamesSet) {
  if (typeof jobType === "string" && queueNamesSet.has(jobType)) return jobType;
  return null;
}

/**
 * Fail-closed BullMQ context. Returns `null` only when Redis/BullMQ itself is
 * unavailable — callers must treat that as a reason to REFUSE deletion of any
 * ingestion job that still has a `queueJobId`, never as permission to skip
 * the queue check and delete anyway.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<null | {
 *   knownQueueNames: Set<string>,
 *   getJob(queueName: string, queueJobId: string): Promise<unknown>,
 *   removeJob(jobType: string, queueJobId: string, jobStatus?: string): Promise<{ ok: boolean, state?: string, reason?: string, blocked?: boolean }>,
 *   close(): Promise<void>,
 * }>}
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
    knownQueueNames,

    async getJob(queueName, queueJobId) {
      const queue = queueFor(queueName);
      return queue.getJob(queueJobId);
    },

    async removeJob(jobType, queueJobId) {
      const queueName = await resolveQueueNameForJobType(jobType, knownQueueNames);
      if (!queueName) return { ok: false, reason: `unknown_job_type:${jobType}` };
      try {
        const queue = queueFor(queueName);
        const job = await queue.getJob(queueJobId);
        if (!job) return { ok: true, state: "not-found" }; // nothing to remove — DB delete permitted
        const state = await job.getState();
        if (state === "active") {
          // Do NOT force-remove a job a worker currently holds a lock on.
          return { ok: false, reason: `active_locked:${state}`, blocked: true };
        }
        await job.remove();
        const again = await queue.getJob(queueJobId);
        if (again) return { ok: false, reason: "still_present_after_remove" };
        return { ok: true, state: "removed" };
      } catch (err) {
        return { ok: false, reason: sanitizeErrorMessage(err) };
      }
    },

    async close() {
      await Promise.all([...queues.values()].map((q) => q.close().catch(() => {})));
    },
  };
}

/* ---------------------------------------------------------------------- *
 * Compound ownership classifiers (pure — exported for unit tests)
 * ---------------------------------------------------------------------- */

/**
 * No single weak marker (a lone `discover:` dedupe key, a lone payload name,
 * or a lone reference to a test character id) is sufficient evidence of test
 * ownership on its own — each of those can, in principle, coincide with real
 * data. Ownership requires at least two independent signals to line up.
 *
 * @param {{ characterId?: string | null, dedupeKey?: string | null, payload?: unknown }} job
 * @param {{ testCharacterIds: Set<string>, testModelKeys?: Set<string>, testRealmSlugs?: Set<string> }} ctx
 * @returns {{ owned: boolean, ambiguous?: boolean, evidence: string[], reason?: string }}
 */
function classifyIngestionJob(job, ctx) {
  const evidence = [];
  const dedupe = matchIngestionDedupeKey(job.dedupeKey ?? null);
  const payload = matchIngestionPayloadName(job.payload ?? null);
  const payloadRealm =
    job.payload && typeof job.payload === "object" ? /** @type {{realmSlug?: unknown}} */ (job.payload).realmSlug : null;
  const realmMatch = matchTestRealmSlug(typeof payloadRealm === "string" ? payloadRealm : null);
  const onTestChar = Boolean(job.characterId && ctx.testCharacterIds.has(job.characterId));

  if (dedupe) evidence.push(`dedupe:${dedupe.id}`);
  if (payload) evidence.push(`payload:${payload.id}`);
  if (realmMatch) evidence.push(`payloadRealm:${realmMatch}`);
  if (onTestChar) evidence.push(`character:${job.characterId}`);

  // discover:* alone → not owned (ambiguous unless another signal)
  if (isDiscoverDedupeKey(job.dedupeKey ?? null)) {
    if (onTestChar || (payload && realmMatch)) {
      evidence.push("discover+compound");
      return { owned: true, evidence };
    }
    return { owned: false, ambiguous: true, evidence: ["discover:alone"], reason: "discover without compound test signal" };
  }

  // Compound rules:
  // - dedupe exclusive AND payload exclusive
  // - dedupe exclusive AND test character
  // - payload exclusive AND (test character OR test realm in payload)
  if (dedupe && payload) return { owned: true, evidence };
  if (dedupe && onTestChar) return { owned: true, evidence };
  if (payload && onTestChar) return { owned: true, evidence };
  if (payload && realmMatch) return { owned: true, evidence };

  // Single exclusive dedupe without second signal → ambiguous retain
  if (dedupe && !payload && !onTestChar) {
    return { owned: false, ambiguous: true, evidence, reason: "dedupe without second independent marker" };
  }
  if (payload && !dedupe && !onTestChar && !realmMatch) {
    return { owned: false, ambiguous: true, evidence, reason: "payload without second independent marker" };
  }

  return { owned: false, evidence };
}

/**
 * @param {{ logicalKey: string, scoreModelId?: string | null, scoreModel?: { key: string } | null }} bulkOperation
 * @returns {{ owned: boolean, evidence: string[], reason?: string }}
 */
function classifyBulkOperation(bulkOperation) {
  const exclusive = matchBulkLogicalKey(bulkOperation.logicalKey);
  if (exclusive) return { owned: true, evidence: [`logicalKey:${exclusive.id}`] };

  if (isModelActivateLogicalKey(bulkOperation.logicalKey)) {
    const modelKey = bulkOperation.scoreModel?.key ?? null;
    if (modelKey && !isCanonicalScoreModelKey(modelKey)) {
      const scoreMatch = matchScoreModelKey(modelKey);
      if (scoreMatch) return { owned: true, evidence: [`modelActivate:${scoreMatch.id}`] };
    }
    return {
      owned: false,
      evidence: [],
      reason:
        modelKey && isCanonicalScoreModelKey(modelKey)
          ? "model-activate references the canonical default model"
          : "model-activate references a non-test-owned or missing model",
    };
  }

  return { owned: false, evidence: [], reason: "no exclusive marker matched" };
}

/**
 * Pure classifier for a character that already has an exact identity match.
 * All DB lookups (ownership, canonical published score, non-test job count)
 * are performed by the caller and passed in as pre-computed signals so the
 * decision logic stays testable without a database.
 *
 * @param {{ identity: {id: string, field: string} | null, isTestRealm: boolean, ownershipCount: number, canonicalPublishedScoreCount: number, nonTestJobCount: number }} signals
 * @returns {{ owned: boolean, evidence: string[], reason?: string }}
 */
function classifyCharacter(signals) {
  const { identity, isTestRealm, ownershipCount, canonicalPublishedScoreCount, nonTestJobCount } = signals;
  if (!identity) return { owned: false, evidence: [], reason: "no exact identity match" };

  const evidence = [`identity:${identity.field}:${identity.id}`];

  // A character created exclusively inside a test-owned realm is test data by
  // construction — any ownership/publication rows on it are test fixtures too.
  if (isTestRealm) {
    evidence.push("realm:test");
    return { owned: true, evidence };
  }

  if (ownershipCount > 0) {
    return { owned: false, evidence, reason: `has ${ownershipCount} verified ownership record(s)` };
  }
  if (canonicalPublishedScoreCount > 0) {
    return { owned: false, evidence, reason: "has published score on canonical model" };
  }
  if (nonTestJobCount > 0) {
    return { owned: false, evidence, reason: `has ${nonTestJobCount} non-test ingestion job(s)` };
  }

  return { owned: true, evidence };
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
      evidence: `key:${matchScoreModelKey(model.key).id}`,
    });
  }
  return { candidates, retained };
}

/**
 * Exact-identity classification requires the full regex (including the
 * random/UUID suffix shape tests generate), which cannot be expressed as a
 * SQL prefix filter for every pattern — so this loads the (expected-small,
 * test/CI-scoped) Character table once and classifies in memory.
 * @param {import("@prisma/client").PrismaClient} prisma
 * @returns {Promise<{ character: { id: string, displayName: string, normalizedName: string, realmId: string, realm: { slug: string } | null }, identity: {id: string, field: string} }[]>}
 */
async function findIdentityMatchedCharacters(prisma) {
  const all = await prisma.character.findMany({
    select: {
      id: true,
      displayName: true,
      normalizedName: true,
      realmId: true,
      createdAt: true,
      realm: { select: { slug: true } },
    },
  });
  const matched = [];
  for (const character of all) {
    const identity = matchExactCharacterIdentity(character.displayName, character.normalizedName);
    if (identity) matched.push({ character, identity });
  }
  return matched;
}

/**
 * Fetch + classify every IngestionJob. The table is expected to stay small in
 * practice for test/CI environments; classification is done in-memory so the
 * dedupeKey/payload-name/character-identity compound rules stay in one place
 * (classifyIngestionJob) instead of being re-expressed as SQL.
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ testCharacterIds: Set<string>, testModelKeys: Set<string>, testRealmSlugs: Set<string> }} ctx
 */
async function inventoryIngestionJobs(prisma, ctx) {
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
  const ambiguousRetained = [];
  /** @type {Map<string, { total: number, testOwned: number }>} */
  const byCharacterId = new Map();

  for (const job of jobs) {
    const verdict = classifyIngestionJob(job, ctx);
    if (job.characterId) {
      const bucket = byCharacterId.get(job.characterId) ?? { total: 0, testOwned: 0 };
      bucket.total += 1;
      if (verdict.owned) bucket.testOwned += 1;
      byCharacterId.set(job.characterId, bucket);
    }
    if (verdict.owned) {
      testOwned.push({ job, evidence: verdict.evidence.join(",") });
    } else if (verdict.ambiguous) {
      ambiguousRetained.push({ job, reason: verdict.reason, evidence: verdict.evidence.join(",") });
    }
  }

  return { testOwned, ambiguousRetained, totalJobs: jobs.length, byCharacterId };
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {Awaited<ReturnType<typeof findIdentityMatchedCharacters>>} identityMatched
 * @param {Map<string, { total: number, testOwned: number }>} jobsByCharacterId
 * @param {string[]} canonicalModelIds
 * @param {Set<string>} testCharacterIds
 */
async function inventoryCharacters(prisma, identityMatched, jobsByCharacterId, canonicalModelIds, testCharacterIds) {
  const candidates = [];
  const retained = [];

  for (const { character, identity } of identityMatched) {
    const isTestRealm = Boolean(matchTestRealmSlug(character.realm?.slug ?? null));

    const jobBucket = jobsByCharacterId.get(character.id);
    const nonTestJobCount = jobBucket ? jobBucket.total - jobBucket.testOwned : 0;

    let ownershipCount = 0;
    let canonicalPublishedScoreCount = 0;
    // Test-realm characters are test data by construction; skip the extra
    // round-trips (and avoid retaining test rows over their own test fixtures).
    if (!isTestRealm) {
      ownershipCount = await prisma.verifiedCharacterOwnership.count({ where: { characterId: character.id } });
      if (ownershipCount === 0 && canonicalModelIds.length > 0) {
        canonicalPublishedScoreCount = await prisma.characterPublishedScore.count({
          where: { characterId: character.id, scoreModelId: { in: canonicalModelIds } },
        });
      }
    }

    const verdict = classifyCharacter({
      identity,
      isTestRealm,
      ownershipCount,
      canonicalPublishedScoreCount,
      nonTestJobCount,
    });

    if (!verdict.owned) {
      retained.push({ character, reason: verdict.reason ?? "not classified as test-owned", evidence: verdict.evidence.join(",") });
      continue;
    }

    // Extra defense-in-depth beyond the compound rule: never break a shared
    // mythic run that still has a non-test-owned participant.
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
        evidence: verdict.evidence.join(","),
      });
      continue;
    }

    candidates.push({ character, evidence: verdict.evidence.join(",") });
  }

  return { candidates, retained };
}

/**
 * `model-activate:` bulk ops are included in the query (in addition to the
 * exclusive prefixes) purely so they can be classified and RETAINED by
 * default — they are never test-owned unless the ScoreModel they reference is
 * itself test-owned (never the canonical `default`).
 * @param {import("@prisma/client").PrismaClient} prisma
 */
async function inventoryBulkOperations(prisma) {
  const all = await prisma.bulkOperation.findMany({
    where: {
      OR: [
        ...TEST_BULK_LOGICAL_KEY_PREFIXES.map((prefix) => ({ logicalKey: { startsWith: prefix } })),
        { logicalKey: { startsWith: "model-activate:" } },
      ],
    },
    select: {
      id: true,
      logicalKey: true,
      status: true,
      mode: true,
      createdAt: true,
      scoreModelId: true,
      scoreModel: { select: { key: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const candidates = [];
  const retained = [];
  for (const bulkOperation of all) {
    const verdict = classifyBulkOperation(bulkOperation);
    if (verdict.owned) {
      candidates.push({ bulkOperation, evidence: verdict.evidence.join(",") });
    } else {
      retained.push({ bulkOperation, reason: verdict.reason, evidence: verdict.evidence.join(",") });
    }
  }
  return { candidates, retained };
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
 * @param {{ modelsOnly?: boolean }} [opts]
 */
async function inventoryTestArtifacts(prisma, opts = {}) {
  const modelsOnly = Boolean(opts.modelsOnly);

  const scoreModels = await inventoryScoreModels(prisma);
  const canonicalModelIds = scoreModels.retained
    .filter((r) => r.reason === "canonical")
    .map((r) => r.model.id);

  if (modelsOnly) {
    return {
      scoreModels,
      ingestionJobs: { testOwned: [], ambiguousRetained: [], totalJobs: 0, byCharacterId: new Map() },
      characters: { candidates: [], retained: [] },
      bulkOperations: { candidates: [], retained: [] },
      realms: [],
      dungeons: [],
      seasons: [],
      mechanicRules: [],
      redis: { queueJobIds: [] },
    };
  }

  const identityMatched = await findIdentityMatchedCharacters(prisma);
  const testCharacterIds = new Set(identityMatched.map((m) => m.character.id));
  const testModelKeys = new Set(scoreModels.candidates.map((c) => c.model.key));
  const testRealmSlugs = new Set(TEST_REALM_SLUGS);

  const ingestionJobs = await inventoryIngestionJobs(prisma, { testCharacterIds, testModelKeys, testRealmSlugs });
  const characters = await inventoryCharacters(
    prisma,
    identityMatched,
    ingestionJobs.byCharacterId,
    canonicalModelIds,
    testCharacterIds,
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
    // Callers must have already verified zero remaining ingestion jobs for
    // this character (queue removal proven or not-applicable); this is a
    // defensive no-op in the normal case.
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
 * @param {Awaited<ReturnType<typeof inventoryTestArtifacts>>} inventory
 * @param {Awaited<ReturnType<typeof createBullMqContext>>} bullmq
 * @param {{ modelsOnly?: boolean }} [opts]
 */
async function applyCleanup(prisma, inventory, bullmq, opts = {}) {
  const modelsOnly = Boolean(opts.modelsOnly);
  const results = {
    scoreModels: { deleted: 0, refused: 0 },
    ingestionJobs: { deleted: 0, refused: 0, queueRemoved: 0, queueNotFound: 0 },
    characters: { deleted: 0, refused: 0 },
    bulkOperations: { deleted: 0, refused: 0 },
    realms: { deleted: 0, retained: 0 },
    dungeons: { deleted: 0, retained: 0 },
    seasons: { deleted: 0, retained: 0 },
    mechanicRules: { deleted: 0, refused: 0 },
  };
  const deletedIds = [];
  const removedQueueJobIds = [];
  const refusedJobCharacterIds = new Set();

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

  if (modelsOnly) {
    results.auditEventsReferencingDeleted =
      deletedIds.length > 0 ? await prisma.auditEvent.count({ where: { resourceId: { in: deletedIds } } }) : 0;
    return { results, removedQueueJobIds, refusedJobCharacterIds };
  }

  const hasRedisUrl = Boolean(process.env.REDIS_URL);
  for (const { job, evidence } of inventory.ingestionJobs.testOwned) {
    if (job.queueJobId) {
      if (!hasRedisUrl) {
        console.error(
          `REFUSED ingestion_job ${job.id}: REDIS_URL not set — refusing to delete a job with a live queue reference (queueJobId=${job.queueJobId})`,
        );
        results.ingestionJobs.refused += 1;
        if (job.characterId) refusedJobCharacterIds.add(job.characterId);
        continue;
      }
      if (!bullmq) {
        console.error(
          `REFUSED ingestion_job ${job.id}: BullMQ unavailable — refusing to delete a job with a live queue reference (queueJobId=${job.queueJobId})`,
        );
        results.ingestionJobs.refused += 1;
        if (job.characterId) refusedJobCharacterIds.add(job.characterId);
        continue;
      }
      const outcome = await bullmq.removeJob(job.jobType, job.queueJobId, job.status);
      if (!outcome.ok) {
        console.error(`REFUSED ingestion_job ${job.id}: queue removal refused (${outcome.reason})`);
        results.ingestionJobs.refused += 1;
        if (job.characterId) refusedJobCharacterIds.add(job.characterId);
        continue;
      }
      if (outcome.state === "removed") {
        results.ingestionJobs.queueRemoved += 1;
        removedQueueJobIds.push({ queueJobId: job.queueJobId, jobType: job.jobType });
      } else {
        results.ingestionJobs.queueNotFound += 1;
      }
    }
    try {
      await prisma.ingestionJob.delete({ where: { id: job.id } });
      console.log(`DELETED ingestion_job ${job.id} evidence=${evidence}`);
      results.ingestionJobs.deleted += 1;
      deletedIds.push(job.id);
    } catch (err) {
      console.error(`REFUSED ingestion_job ${job.id}: ${err instanceof Error ? err.message : err}`);
      results.ingestionJobs.refused += 1;
      if (job.characterId) refusedJobCharacterIds.add(job.characterId);
    }
  }

  for (const { character } of inventory.characters.candidates) {
    if (refusedJobCharacterIds.has(character.id)) {
      console.error(
        `REFUSED character ${character.displayName} (${character.id}): an ingestion job for this character was not safely removed from the queue`,
      );
      results.characters.refused += 1;
      continue;
    }
    const remainingJobs = await prisma.ingestionJob.count({ where: { characterId: character.id } });
    if (remainingJobs > 0) {
      console.error(`REFUSED character ${character.displayName} (${character.id}): ${remainingJobs} ingestion job(s) still remain`);
      results.characters.refused += 1;
      continue;
    }
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

  for (const { bulkOperation } of inventory.bulkOperations.candidates) {
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

  results.auditEventsReferencingDeleted =
    deletedIds.length > 0 ? await prisma.auditEvent.count({ where: { resourceId: { in: deletedIds } } }) : 0;

  return { results, removedQueueJobIds, refusedJobCharacterIds };
}

/* ---------------------------------------------------------------------- *
 * Post-cleanup verification (confirm mode only)
 * ---------------------------------------------------------------------- */

/**
 * Re-runs the inventory after `applyCleanup` and proves:
 *   - no deletable candidate remains in any category (classification, not deletion, was the only barrier)
 *   - at least one ACTIVE canonical `default` ScoreModel still exists
 *   - every bulk_operation we deliberately retained pre-cleanup is still present
 *   - every BullMQ job we reported as "removed" is actually gone from Redis
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {Awaited<ReturnType<typeof createBullMqContext>>} bullmq
 * @param {{ removedQueueJobIds: {queueJobId: string, jobType: string}[], preservedBulkOperationIds: string[] }} verifyCtx
 * @param {{ modelsOnly?: boolean }} [opts]
 */
async function verifyPostCleanup(prisma, bullmq, verifyCtx, opts = {}) {
  const modelsOnly = Boolean(opts.modelsOnly);
  const { removedQueueJobIds, preservedBulkOperationIds } = verifyCtx;
  const failures = [];

  const post = await inventoryTestArtifacts(prisma, { modelsOnly });

  if (post.scoreModels.candidates.length > 0) {
    failures.push(`score_models still classified test-owned and deletable: ${post.scoreModels.candidates.length}`);
  }
  if (!modelsOnly) {
    if (post.ingestionJobs.testOwned.length > 0) {
      failures.push(`ingestion_jobs still classified test-owned: ${post.ingestionJobs.testOwned.length}`);
    }
    if (post.characters.candidates.length > 0) {
      failures.push(`characters still classified deletable: ${post.characters.candidates.length}`);
    }
    if (post.bulkOperations.candidates.length > 0) {
      failures.push(`bulk_operations still classified test-owned: ${post.bulkOperations.candidates.length}`);
    }
  }

  const activeCanonical = await prisma.scoreModel.count({
    where: { key: { in: [...CANONICAL_SCORE_MODEL_KEYS] }, status: "ACTIVE" },
  });
  if (activeCanonical < 1) {
    failures.push(`canonical default ScoreModel missing or not ACTIVE (found ${activeCanonical})`);
  }

  if (preservedBulkOperationIds.length > 0) {
    const stillPresent = await prisma.bulkOperation.count({ where: { id: { in: preservedBulkOperationIds } } });
    if (stillPresent !== preservedBulkOperationIds.length) {
      failures.push(
        `expected ${preservedBulkOperationIds.length} retained bulk_operation(s) (e.g. model-activate on canonical models) to remain untouched, found ${stillPresent}`,
      );
    }
  }

  if (bullmq && removedQueueJobIds.length > 0) {
    for (const { queueJobId, jobType } of removedQueueJobIds) {
      const queueName = await resolveQueueNameForJobType(jobType, bullmq.knownQueueNames);
      if (!queueName) continue;
      const stillThere = await bullmq.getJob(queueName, queueJobId);
      if (stillThere) {
        failures.push(`queueJobId ${queueJobId} (queue=${queueName}) still present in Redis after removal`);
      }
    }
  }

  return { post, failures };
}

/* ---------------------------------------------------------------------- *
 * Output formatting
 * ---------------------------------------------------------------------- */

function printInventory(inventory, { mode, sanitized, dryRun, modelsOnly }) {
  console.log(`cleanup-test-artifacts: mode=${mode} dryRun=${dryRun} modelsOnly=${Boolean(modelsOnly)}`);
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
  if (inventory.ingestionJobs.ambiguousRetained.length > 0) {
    console.log(`  ambiguous / retained (${inventory.ingestionJobs.ambiguousRetained.length}):`);
    for (const { job, reason } of inventory.ingestionJobs.ambiguousRetained) {
      console.log(`    keep ${job.id} — ${reason}`);
    }
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

  console.log(`\n=== bulk_operations (${inventory.bulkOperations.candidates.length}) ===`);
  for (const { bulkOperation, evidence } of inventory.bulkOperations.candidates) {
    console.log(`  id=${bulkOperation.id} logicalKey=${bulkOperation.logicalKey} evidence=${evidence}`);
  }
  if (inventory.bulkOperations.retained.length > 0) {
    console.log(`  retained (${inventory.bulkOperations.retained.length}):`);
    for (const { bulkOperation, reason } of inventory.bulkOperations.retained) {
      console.log(`    keep ${bulkOperation.logicalKey} (${bulkOperation.id}) — ${reason}`);
    }
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
      `ingestion_jobs=${inventory.ingestionJobs.testOwned.length} ` +
      `ingestion_jobs_ambiguous=${inventory.ingestionJobs.ambiguousRetained.length} ` +
      `characters=${inventory.characters.candidates.length} ` +
      `characters_retained=${inventory.characters.retained.length} ` +
      `bulk_operations=${inventory.bulkOperations.candidates.length} ` +
      `bulk_operations_retained=${inventory.bulkOperations.retained.length} ` +
      `realms=${inventory.realms.length} dungeons=${inventory.dungeons.length} ` +
      `seasons=${inventory.seasons.length} mechanic_rules=${inventory.mechanicRules.length}`,
  );
}

function printResults(results) {
  console.log("\n=== cleanup results ===");
  console.log(`score_models: deleted=${results.scoreModels.deleted} refused=${results.scoreModels.refused}`);
  console.log(
    `ingestion_jobs: deleted=${results.ingestionJobs.deleted} refused=${results.ingestionJobs.refused} ` +
      `queueRemoved=${results.ingestionJobs.queueRemoved} queueNotFound=${results.ingestionJobs.queueNotFound}`,
  );
  console.log(`characters: deleted=${results.characters.deleted} refused=${results.characters.refused}`);
  console.log(`bulk_operations: deleted=${results.bulkOperations.deleted} refused=${results.bulkOperations.refused}`);
  console.log(`realms: deleted=${results.realms.deleted} retained=${results.realms.retained}`);
  console.log(`dungeons: deleted=${results.dungeons.deleted} retained=${results.dungeons.retained}`);
  console.log(`seasons: deleted=${results.seasons.deleted} retained=${results.seasons.retained}`);
  console.log(`mechanic_rules: deleted=${results.mechanicRules.deleted} refused=${results.mechanicRules.refused}`);
  console.log(`audit_events referencing deleted ids (not deleted): ${results.auditEventsReferencingDeleted}`);
}

function totalRefused(results) {
  return (
    results.scoreModels.refused +
    results.ingestionJobs.refused +
    results.characters.refused +
    results.bulkOperations.refused +
    results.mechanicRules.refused
  );
}

/* ---------------------------------------------------------------------- *
 * Entry point
 * ---------------------------------------------------------------------- */

async function runCleanup(argv = process.argv.slice(2)) {
  const { confirm, dryRun, modelsOnly } = parseArgs(argv);
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
    const inventory = await inventoryTestArtifacts(prisma, { modelsOnly });
    printInventory(inventory, { mode: gate.mode, sanitized: gate.sanitized, dryRun: dryRun || !confirm, modelsOnly });

    if (!confirm) {
      console.log("\nDry-run only. No rows deleted.");
      console.log(`To delete: pnpm db:cleanup:test-artifacts -- --confirm${modelsOnly ? " --models-only" : ""}`);
      console.log(
        "Deployed test: MPLUS_CLEANUP_TARGET=deployed-test pnpm db:cleanup:test-artifacts -- --confirm",
      );
      return;
    }

    const preservedBulkOperationIds = inventory.bulkOperations.retained.map((r) => r.bulkOperation.id);

    const bullmq = await createBullMqContext();
    try {
      const { results, removedQueueJobIds } = await applyCleanup(prisma, inventory, bullmq, { modelsOnly });
      printResults(results);

      const { failures } = await verifyPostCleanup(
        prisma,
        bullmq,
        { removedQueueJobIds, preservedBulkOperationIds },
        { modelsOnly },
      );

      if (failures.length > 0) {
        console.error("\n=== post-cleanup verification FAILED ===");
        for (const failure of failures) console.error(`  - ${failure}`);
      }

      const refused = totalRefused(results);
      if (refused > 0 || failures.length > 0) {
        console.error(
          `\ncleanup-test-artifacts: refused=${refused} verificationFailures=${failures.length} — exiting non-zero.`,
        );
        process.exitCode = 1;
      }
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
  applyCleanup,
  createBullMqContext,
  classifyIngestionJob,
  classifyCharacter,
  classifyBulkOperation,
  resolveQueueNameForJobType,
  deleteScoreModelTransactionally,
  deleteCharacterTransactionally,
  totalRefused,
  CANONICAL_SCORE_MODEL_KEYS,
  TEST_SCORE_MODEL_KEY_PREFIXES,
  isCanonicalScoreModelKey,
  isTestOwnedScoreModelKey,
};
