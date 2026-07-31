/**
 * Isolated test database runner.
 *
 * Creates a unique disposable PostgreSQL database, migrates + seeds it,
 * runs the requested Vitest command with MPLUS_ISOLATED_TEST_DB=true,
 * then drops the database in a finally block.
 *
 * Never mutates the development database (mplus_trust).
 * Never CREATE DATABASE on production or an inherited remote DATABASE_URL.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import {
  ISOLATED_TEST_DB_MARKER,
  createDisposableDatabaseName,
  isDisposableDatabaseName,
  parseDatabaseUrl,
  resolveIsolatedTestServer,
  rewriteDatabaseUrl,
  sanitizeDatabaseUrl,
  toMaintenanceDatabaseUrl,
} from "./lib/test-db-isolation.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const { Client } = pg;

function loadDotEnv() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveServerUrl(env = process.env) {
  const resolved = resolveIsolatedTestServer(env, loadDotEnv);
  if (!resolved.ok) {
    const err = new Error(
      [
        "run-tests-isolated: TEST SERVER SAFETY GUARD — refused before CREATE DATABASE.",
        resolved.reason,
        `Target (sanitized): ${resolved.sanitized}`,
      ].join("\n"),
    );
    err.code = "TEST_SERVER_REFUSED";
    throw err;
  }
  return { serverUrl: resolved.serverUrl, source: resolved.source };
}

/**
 * @param {string} databaseUrl
 * @param {string} sql
 */
async function execSql(databaseUrl, sql) {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query(sql);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const safe = message
      .replace(/postgresql:\/\/[^@\s]+@/gi, "postgresql://***@")
      .replace(/postgres:\/\/[^@\s]+@/gi, "postgres://***@");
    throw new Error(`SQL failed: ${safe}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * @param {string} serverUrl
 * @param {string} dbName
 */
export async function createDatabase(serverUrl, dbName) {
  if (!isDisposableDatabaseName(dbName)) {
    throw new Error(`Refusing to create non-disposable database name: ${dbName}`);
  }
  const maintenanceUrl = toMaintenanceDatabaseUrl(serverUrl);
  await execSql(maintenanceUrl, `CREATE DATABASE "${dbName}"`);
}

/**
 * @param {string} serverUrl
 * @param {string} dbName
 */
export async function dropDatabase(serverUrl, dbName) {
  if (!isDisposableDatabaseName(dbName)) {
    throw new Error(`Refusing to drop non-disposable database name: ${dbName}`);
  }
  const maintenanceUrl = toMaintenanceDatabaseUrl(serverUrl);
  await execSql(
    maintenanceUrl,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
  ).catch(() => undefined);
  try {
    await execSql(maintenanceUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } catch {
    await execSql(maintenanceUrl, `DROP DATABASE IF EXISTS "${dbName}"`);
  }
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>}
 */
function runCommand(args, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: root,
      env,
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        resolvePromise(1);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

export function parseArgs(argv) {
  const dash = argv.indexOf("--");
  const flags = dash === -1 ? argv : argv.slice(0, dash);
  const command = dash === -1 ? ["vitest", "run"] : argv.slice(dash + 1);
  return {
    seed: flags.includes("--seed") || !flags.includes("--no-seed"),
    migrate: !flags.includes("--no-migrate"),
    command: command.length > 0 ? command : ["vitest", "run"],
  };
}

/**
 * Build child env. Never rewrites production APP_ENV into test — caller must refuse first.
 * @param {NodeJS.ProcessEnv} parentEnv
 * @param {string} isolatedUrl
 */
export function buildChildEnv(parentEnv, isolatedUrl) {
  const appEnv = String(parentEnv.APP_ENV ?? "").toLowerCase();
  if (appEnv === "production" || appEnv === "prod") {
    throw new Error(
      "run-tests-isolated: refusing to spawn tests — APP_ENV is production/prod (never rewritten to test).",
    );
  }
  const nodeEnv = String(parentEnv.NODE_ENV ?? "").toLowerCase();
  if (nodeEnv === "production") {
    throw new Error(
      "run-tests-isolated: refusing to spawn tests — NODE_ENV is production.",
    );
  }

  return {
    ...parentEnv,
    DATABASE_URL: isolatedUrl,
    [ISOLATED_TEST_DB_MARKER]: "true",
    NODE_ENV: "test",
    APP_ENV: parentEnv.APP_ENV || "test",
    PROVIDER_MODE: parentEnv.PROVIDER_MODE || "fixture",
  };
}

async function main() {
  const { seed, migrate, command } = parseArgs(process.argv.slice(2));

  let serverUrl;
  let source;
  try {
    ({ serverUrl, source } = resolveServerUrl(process.env));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const parsed = parseDatabaseUrl(serverUrl);
  if (!parsed) {
    console.error("run-tests-isolated: invalid server URL after guard");
    process.exit(1);
  }

  const dbName = createDisposableDatabaseName();
  const isolatedUrl = rewriteDatabaseUrl(serverUrl, dbName, "public");
  let cleaned = false;
  let created = false;

  const cleanup = async () => {
    if (cleaned || !created) return;
    cleaned = true;
    try {
      console.log(`run-tests-isolated: dropping disposable database ${dbName}`);
      await dropDatabase(serverUrl, dbName);
    } catch (err) {
      console.error(
        `run-tests-isolated: cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const onSignal = (sig) => {
    console.error(`run-tests-isolated: received ${sig}, cleaning up…`);
    void cleanup().finally(() => process.exit(1));
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  let exitCode = 1;
  try {
    console.log(
      `run-tests-isolated: creating disposable database ${dbName} on ${parsed.host}:${parsed.port} (source=${source})`,
    );
    await createDatabase(serverUrl, dbName);
    created = true;
    console.log(`run-tests-isolated: target ${sanitizeDatabaseUrl(isolatedUrl)}`);

    const childEnv = buildChildEnv(process.env, isolatedUrl);

    if (migrate) {
      console.log("run-tests-isolated: applying Prisma migrations to disposable database");
      const migrateCode = await runCommand(
        ["pnpm", "--filter", "@mplus/database", "exec", "prisma", "migrate", "deploy"],
        childEnv,
      );
      if (migrateCode !== 0) {
        throw new Error(`migrate deploy failed (exit ${migrateCode})`);
      }
    }

    if (seed) {
      console.log("run-tests-isolated: seeding disposable database");
      const seedCode = await runCommand(
        ["pnpm", "--filter", "@mplus/database", "run", "seed"],
        childEnv,
      );
      if (seedCode !== 0) {
        throw new Error(`seed failed (exit ${seedCode})`);
      }
    }

    console.log(`run-tests-isolated: running ${command.join(" ")}`);
    exitCode = await runCommand(command, childEnv);
  } catch (err) {
    console.error(`run-tests-isolated: ${err instanceof Error ? err.message : String(err)}`);
    exitCode = 1;
  } finally {
    await cleanup();
  }

  process.exit(exitCode);
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return entry.replace(/\\/g, "/").endsWith("/tools/scripts/run-tests-isolated.mjs");
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { resolveIsolatedTestServer };
