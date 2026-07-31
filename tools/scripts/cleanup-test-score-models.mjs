/**
 * Guarded cleanup of automated-test score models.
 *
 * Default is dry-run. Deletion requires explicit `--confirm`.
 *
 * Usage:
 *   pnpm db:cleanup:test-score-models -- --dry-run
 *   pnpm db:cleanup:test-score-models -- --confirm
 *
 * Deployed test environment (required assertion):
 *   MPLUS_CLEANUP_TARGET=deployed-test pnpm db:cleanup:test-score-models -- --confirm
 *
 * Production is categorically refused.
 * Never deletes canonical seeded keys (`default`).
 * Only deletes keys matching the exact allowlist of test prefixes.
 */
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CANONICAL_SCORE_MODEL_KEYS,
  TEST_SCORE_MODEL_KEY_PREFIXES,
  isCanonicalScoreModelKey,
  isTestOwnedScoreModelKey,
  parseDatabaseUrl,
  sanitizeDatabaseUrl,
} from "./lib/test-db-isolation.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

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
        "  MPLUS_CLEANUP_TARGET=deployed-test pnpm db:cleanup:test-score-models -- --dry-run",
        "  MPLUS_CLEANUP_TARGET=deployed-test pnpm db:cleanup:test-score-models -- --confirm",
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

async function loadPrisma(databaseUrl) {
  const distEntry = resolve(root, "packages/database/dist/index.js");
  const { createPrismaClient } = await import(pathToFileURL(distEntry).href);
  return createPrismaClient(databaseUrl);
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} modelId
 */
async function countDependents(prisma, modelId) {
  const [scoreSnapshots, analysisBatches, characterRedFlags, addonExports, bulkOperations] =
    await Promise.all([
      prisma.scoreSnapshot.count({ where: { scoreModelId: modelId } }),
      prisma.scoreAnalysisBatch.count({ where: { scoreModelId: modelId } }),
      prisma.characterRedFlag.count({ where: { scoreModelId: modelId } }),
      prisma.addonExport.count({ where: { scoreModelId: modelId } }),
      prisma.bulkOperation.count({ where: { scoreModelId: modelId } }),
    ]);
  return { scoreSnapshots, analysisBatches, characterRedFlags, addonExports, bulkOperations };
}

function dependentsBlockHardDelete(deps) {
  return (
    deps.scoreSnapshots > 0 ||
    deps.analysisBatches > 0 ||
    deps.addonExports > 0 ||
    deps.characterRedFlags > 0
  );
  // bulkOperations are onDelete: SetNull — not a hard blocker, but we still report them.
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} modelId
 */
async function deleteModelTransactionally(prisma, modelId) {
  await prisma.$transaction(async (tx) => {
    const model = await tx.scoreModel.findUnique({ where: { id: modelId } });
    if (!model) return;
    if (isCanonicalScoreModelKey(model.key)) {
      throw new Error(`Refusing to delete canonical model key=${model.key}`);
    }
    if (!isTestOwnedScoreModelKey(model.key)) {
      throw new Error(`Refusing to delete non-allowlisted key=${model.key}`);
    }

    const deps = {
      scoreSnapshots: await tx.scoreSnapshot.count({ where: { scoreModelId: modelId } }),
      analysisBatches: await tx.scoreAnalysisBatch.count({ where: { scoreModelId: modelId } }),
      characterRedFlags: await tx.characterRedFlag.count({ where: { scoreModelId: modelId } }),
      addonExports: await tx.addonExport.count({ where: { scoreModelId: modelId } }),
      bulkOperations: await tx.bulkOperation.count({ where: { scoreModelId: modelId } }),
    };

    if (dependentsBlockHardDelete(deps)) {
      const err = new Error(
        `Ambiguous/durable dependencies for ${model.key}: ` +
          `snapshots=${deps.scoreSnapshots} batches=${deps.analysisBatches} ` +
          `redFlags=${deps.characterRedFlags} exports=${deps.addonExports}`,
      );
      err.code = "AMBIGUOUS_DEPENDENCIES";
      err.deps = deps;
      throw err;
    }

    // Safe: clear optional bulk FK then delete model.
    if (deps.bulkOperations > 0) {
      await tx.bulkOperation.updateMany({
        where: { scoreModelId: modelId },
        data: { scoreModelId: null },
      });
    }

    await tx.scoreModel.delete({ where: { id: modelId } });
  });
}

async function main() {
  const { confirm, dryRun } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("cleanup-test-score-models: DATABASE_URL is required");
    process.exit(1);
  }

  const gate = assertCleanupTargetAllowed(databaseUrl);
  if (!gate.ok) {
    console.error(gate.message);
    process.exit(1);
  }

  console.log(`cleanup-test-score-models: mode=${gate.mode} dryRun=${dryRun || !confirm}`);
  console.log(`Target (sanitized): ${gate.sanitized}`);
  console.log(`Allowlisted prefixes: ${TEST_SCORE_MODEL_KEY_PREFIXES.join(", ")}`);
  console.log(`Canonical keys preserved: ${CANONICAL_SCORE_MODEL_KEYS.join(", ")}`);

  const prisma = await loadPrisma(databaseUrl);
  try {
    const all = await prisma.scoreModel.findMany({
      orderBy: [{ key: "asc" }, { version: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        version: true,
        status: true,
        createdAt: true,
        activatedAt: true,
      },
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
      const deps = await countDependents(prisma, model.id);
      candidates.push({ model, deps });
    }

    console.log(`\nFound ${candidates.length} test-owned candidate(s), ${retained.length} retained.\n`);

    for (const { model, deps } of candidates) {
      const blocked = dependentsBlockHardDelete(deps);
      console.log(
        [
          `— ${model.id}`,
          `  key=${model.key} name=${JSON.stringify(model.name)} version=${model.version}`,
          `  status=${model.status} created=${model.createdAt.toISOString()} activated=${model.activatedAt?.toISOString() ?? "null"}`,
          `  deps: snapshots=${deps.scoreSnapshots} batches=${deps.analysisBatches} redFlags=${deps.characterRedFlags} exports=${deps.addonExports} bulkOps=${deps.bulkOperations}`,
          `  ${blocked ? "BLOCKED (durable deps — will refuse delete)" : "deletable"}`,
        ].join("\n"),
      );
    }

    if (retained.length > 0 && retained.length <= 30) {
      console.log("\nRetained (sample):");
      for (const { model, reason } of retained.slice(0, 30)) {
        console.log(`  keep ${model.key}@v${model.version} (${model.status}) — ${reason}`);
      }
    } else if (retained.length > 30) {
      console.log(`\nRetained: ${retained.length} models (canonical + non-allowlisted).`);
    }

    if (!confirm) {
      console.log("\nDry-run only. No rows deleted.");
      console.log("To delete: pnpm db:cleanup:test-score-models -- --confirm");
      console.log(
        "Deployed test: MPLUS_CLEANUP_TARGET=deployed-test pnpm db:cleanup:test-score-models -- --confirm",
      );
      return;
    }

    let deleted = 0;
    let refused = 0;
    for (const { model, deps } of candidates) {
      if (dependentsBlockHardDelete(deps)) {
        console.error(`REFUSED delete ${model.key}@v${model.version}: durable dependencies`);
        refused += 1;
        continue;
      }
      try {
        await deleteModelTransactionally(prisma, model.id);
        console.log(`DELETED ${model.key}@v${model.version} (${model.id})`);
        deleted += 1;
      } catch (err) {
        console.error(
          `FAILED ${model.key}@v${model.version}: ${err instanceof Error ? err.message : String(err)}`,
        );
        refused += 1;
      }
    }

    const remainingTestOwned = await prisma.scoreModel.count({
      where: {
        OR: TEST_SCORE_MODEL_KEY_PREFIXES.map((prefix) => ({ key: { startsWith: prefix } })),
      },
    });
    const canonicalRemaining = await prisma.scoreModel.count({
      where: { key: { in: [...CANONICAL_SCORE_MODEL_KEYS] } },
    });

    console.log(`\nSummary: deleted=${deleted} refused=${refused} retainedReported=${retained.length}`);
    console.log(`Post-check: remaining allowlisted test-prefix models=${remainingTestOwned}`);
    console.log(`Post-check: canonical models still present=${canonicalRemaining}`);
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
    return entry.replace(/\\/g, "/").endsWith("/tools/scripts/cleanup-test-score-models.mjs");
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export {
  assertCleanupTargetAllowed,
  dependentsBlockHardDelete,
  parseArgs,
  isTestOwnedScoreModelKey,
  isCanonicalScoreModelKey,
  TEST_SCORE_MODEL_KEY_PREFIXES,
};
