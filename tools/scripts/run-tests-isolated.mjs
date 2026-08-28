/**
 * Isolated test database runner.
 *
 * Creates a unique disposable PostgreSQL database, migrates + seeds it,
 * runs the requested Vitest command with MPLUS_ISOLATED_TEST_DB=true,
 * then drops the database in a finally block.
 *
 * Never mutates the development database (mplus_trust).
 * Never CREATE DATABASE on production or an inherited remote DATABASE_URL.
 * Cleanup always connects to the administrative `postgres` database — never
 * to the disposable target — and fails the wrapper if DROP fails.
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

/** @param {unknown} err */
export function sanitizePgError(err) {
  const code = err && typeof err === "object" && "code" in err ? String(/** @type {{code?: unknown}} */ (err).code ?? "") : "";
  const message = err instanceof Error ? err.message : String(err);
  const safe = message
    .replace(/postgresql:\/\/[^@\s]+@/gi, "postgresql://***@")
    .replace(/postgres:\/\/[^@\s]+@/gi, "postgres://***@");
  return code ? `SQLSTATE ${code}: ${safe}` : safe;
}

/**
 * Quote a disposable database identifier for DDL. Names are already restricted
 * to `mplus_itest_[a-z0-9]{8,24}` — never interpolate unvalidated input.
 * @param {string} dbName
 */
export function quoteDisposableIdent(dbName) {
  if (!isDisposableDatabaseName(dbName)) {
    throw new Error(`Refusing to quote non-disposable database name: ${dbName}`);
  }
  // Safe: disposable names contain only [a-z0-9_]; double-quote for DDL.
  return `"${dbName.toLowerCase()}"`;
}

/**
 * Administrative URL must target `postgres` (or another non-disposable DB),
 * never the disposable database being created/dropped.
 * @param {string} serverUrl
 * @param {string} disposableName
 */
export function resolveAdminUrl(serverUrl, disposableName) {
  if (!isDisposableDatabaseName(disposableName)) {
    throw new Error(`Refusing admin URL for non-disposable name: ${disposableName}`);
  }
  const adminUrl = toMaintenanceDatabaseUrl(serverUrl);
  const parsed = parseDatabaseUrl(adminUrl);
  if (!parsed) {
    throw new Error("Invalid administrative database URL after rewrite");
  }
  if (parsed.database.toLowerCase() === disposableName.toLowerCase()) {
    throw new Error("Refusing cleanup: administrative URL targets the disposable database");
  }
  if (isDisposableDatabaseName(parsed.database)) {
    throw new Error(
      `Refusing cleanup: administrative database looks disposable (${parsed.database})`,
    );
  }
  return { adminUrl, adminDatabase: parsed.database };
}

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
    /** @type {Error & { code?: string }} */ (err).code = "TEST_SERVER_REFUSED";
    throw err;
  }
  return { serverUrl: resolved.serverUrl, source: resolved.source };
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} serverUrl
 * @param {string} dbName
 */
export async function createDatabase(serverUrl, dbName) {
  if (!isDisposableDatabaseName(dbName)) {
    throw new Error(`Refusing to create non-disposable database name: ${dbName}`);
  }
  const { adminUrl } = resolveAdminUrl(serverUrl, dbName);
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(`CREATE DATABASE ${quoteDisposableIdent(dbName)}`);
  } catch (err) {
    throw new Error(`CREATE DATABASE failed: ${sanitizePgError(err)}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Deterministic disposable-database teardown (PostgreSQL 16+).
 *
 * Always connects to the administrative database (never the disposable target),
 * terminates remaining backends with a parameterized query, then DROP DATABASE
 * WITH (FORCE) with a small bounded retry for transient object-in-use errors.
 *
 * @param {string} serverUrl
 * @param {string} dbName
 * @param {{ maxAttempts?: number, retryDelayMs?: number }} [opts]
 * @returns {Promise<{ ok: true, attempts: number }>}
 */
export async function dropDatabase(serverUrl, dbName, opts = {}) {
  if (!isDisposableDatabaseName(dbName)) {
    throw new Error(`Refusing to drop non-disposable database name: ${dbName}`);
  }
  const { adminUrl } = resolveAdminUrl(serverUrl, dbName);
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  const retryDelayMs = Math.max(0, opts.retryDelayMs ?? 75);
  const ident = quoteDisposableIdent(dbName);
  const client = new Client({ connectionString: adminUrl });

  try {
    await client.connect();

    let lastError = /** @type {unknown} */ (null);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await client.query(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = $1
             AND pid <> pg_backend_pid()`,
          [dbName],
        );
      } catch (err) {
        // Termination failures are logged via the eventual DROP error path;
        // continue — WITH (FORCE) can still succeed on PG13+.
        lastError = err;
      }

      try {
        await client.query(`DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`);
        return { ok: true, attempts: attempt };
      } catch (err) {
        lastError = err;
        const code =
          err && typeof err === "object" && "code" in err
            ? String(/** @type {{ code?: unknown }} */ (err).code ?? "")
            : "";
        // 55006 = object_in_use; 42501 = insufficient privilege (don't retry forever)
        const retryable = code === "55006" || /being accessed|is being used/i.test(String(err));
        if (!retryable || attempt === maxAttempts) {
          throw new Error(`DROP DATABASE failed: ${sanitizePgError(err)}`);
        }
        await sleep(retryDelayMs * attempt);
      }
    }

    throw new Error(`DROP DATABASE failed: ${sanitizePgError(lastError)}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Spawn a child and resolve only after the process has exited *and* its
 * stdio streams have closed (`close` event), so Prisma/pg handles are gone
 * before DROP DATABASE runs.
 *
 * Shell is used only on Windows for bare commands (e.g. `pnpm`). Absolute
 * paths / `process.execPath` must not go through `cmd.exe` — spaces in
 * `C:\Program Files\...` would otherwise break argument parsing. On Unix,
 * `shell:true` also mangles metacharacters in `-e` scripts.
 *
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>}
 */
export function runCommand(args, env) {
  return new Promise((resolvePromise) => {
    if (!args.length) {
      resolvePromise(1);
      return;
    }
    const command = args[0];
    const isAbsoluteOrNode =
      command === process.execPath ||
      /[\\/]/.test(command) ||
      /\.(exe|cmd|bat)$/i.test(command);
    const useShell = process.platform === "win32" && !isAbsoluteOrNode;
    const child = spawn(command, args.slice(1), {
      cwd: root,
      env,
      stdio: "inherit",
      shell: useShell,
      windowsHide: true,
    });
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolvePromise(code);
    };
    child.on("error", (err) => {
      console.error(`run-tests-isolated: failed to spawn ${command}: ${err.message}`);
      finish(1);
    });
    // `close` fires after `exit` once stdio streams are closed.
    child.on("close", (code, signal) => {
      if (signal) {
        finish(1);
        return;
      }
      finish(code ?? 1);
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

/**
 * Combine child + cleanup outcomes.
 * - child pass + cleanup pass => 0
 * - child fail + cleanup pass => child code
 * - child pass + cleanup fail => 1
 * - child fail + cleanup fail => child code (cleanup error already printed)
 * @param {number} childExitCode
 * @param {{ ok: boolean }} cleanupOutcome
 */
export function resolveWrapperExitCode(childExitCode, cleanupOutcome) {
  if (cleanupOutcome.ok) return childExitCode;
  if (childExitCode === 0) return 1;
  return childExitCode;
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
  let created = false;
  /** @type {Promise<{ ok: boolean, error?: string, skipped?: boolean }> | null} */
  let cleanupPromise = null;
  let signalShutdown = false;

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      if (!created) return { ok: true, skipped: true };
      try {
        console.log(`run-tests-isolated: dropping disposable database ${dbName}`);
        await dropDatabase(serverUrl, dbName);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`run-tests-isolated: cleanup failed: ${message}`);
        return { ok: false, error: message };
      }
    })();
    return cleanupPromise;
  };

  const onSignal = (sig) => {
    if (signalShutdown) return;
    signalShutdown = true;
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
      console.log("run-tests-isolated: activating Bootstrap ability catalog release for tests");
      const bootstrapCode = await runCommand(
        ["pnpm", "exec", "tsx", "apps/api/src/cli/seed-active-bootstrap.ts"],
        childEnv,
      );
      if (bootstrapCode !== 0) {
        throw new Error(`seed-active-bootstrap failed (exit ${bootstrapCode})`);
      }
    }

    console.log(`run-tests-isolated: running ${command.join(" ")}`);
    exitCode = await runCommand(command, childEnv);
  } catch (err) {
    console.error(`run-tests-isolated: ${err instanceof Error ? err.message : String(err)}`);
    exitCode = 1;
  }

  // Always await cleanup after the child has fully closed (runCommand uses `close`).
  // Skip if a signal handler already owns shutdown — it will exit itself.
  if (!signalShutdown) {
    const cleanupOutcome = await cleanup();
    process.exit(resolveWrapperExitCode(exitCode, cleanupOutcome));
  }
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
