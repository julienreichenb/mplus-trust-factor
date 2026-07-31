/**
 * Prepare a fresh local branch/worktree so `pnpm dev` / `pnpm test` can run.
 *
 * Cross-platform (Windows + Unix + git worktrees). Idempotent.
 * Reuses root package scripts; never starts `pnpm dev`.
 * Never overwrites `.env`; never targets a non-local database.
 * Does not create disposable test databases — those are created per `pnpm test` run.
 *
 * Usage: pnpm bootstrap
 */
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT_ENV_RELATIVE = ".env";
export const ROOT_ENV_EXAMPLE_RELATIVE = ".env.example";

/** Packages that export `dist/` and are imported by api/worker at runtime. */
export const DEV_PACKAGE_FILTER = "./packages/**";

export function resolveRepoRoot(fromMetaUrl = import.meta.url) {
  return resolve(fileURLToPath(new URL(".", fromMetaUrl)), "../..");
}

/**
 * Parse a dotenv file into a plain object (does not mutate process.env).
 * Last assignment wins; comments and blank lines are ignored.
 */
export function parseEnvFile(contents) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

/**
 * True when DATABASE_URL points at a loopback host (local Compose / local Postgres).
 */
export function isLocalDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl.trim()) return false;
  let parsed;
  try {
    parsed = new URL(databaseUrl.trim());
  } catch {
    return false;
  }
  const protocol = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (protocol !== "postgresql" && protocol !== "postgres") return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function missingEnvMessage(root) {
  const example = resolve(root, ROOT_ENV_EXAMPLE_RELATIVE);
  return [
    "bootstrap: missing root .env (refusing to create or overwrite).",
    `Copy the template, then re-run:`,
    `  cp ${ROOT_ENV_EXAMPLE_RELATIVE} ${ROOT_ENV_RELATIVE}`,
    `Template path: ${example}`,
    "Fill any secrets locally; never commit .env.",
  ].join("\n");
}

/**
 * @param {object} options
 * @param {string} options.root
 * @param {(args: string[], opts?: { env?: NodeJS.ProcessEnv }) => void} options.runPnpm
 * @param {(host: string, port: number, timeoutMs: number) => Promise<void>} options.waitForTcp
 * @param {(msg: string) => void} [options.log]
 * @param {(msg: string) => never} [options.fail]
 * @param {() => boolean} [options.envExists]
 * @param {() => string} [options.readEnvFile]
 * @param {number} [options.waitTimeoutMs]
 */
export async function runBootstrap(options) {
  const {
    root,
    runPnpm,
    waitForTcp,
    log = console.log,
    fail = (msg) => {
      console.error(msg);
      process.exit(1);
    },
    envExists = () => existsSync(resolve(root, ROOT_ENV_RELATIVE)),
    readEnvFile = () => readFileSync(resolve(root, ROOT_ENV_RELATIVE), "utf8"),
    waitTimeoutMs = 90_000,
  } = options;

  log("bootstrap: preparing local worktree for pnpm dev / isolated tests");

  if (!envExists()) {
    fail(missingEnvMessage(root));
  }
  log(`bootstrap: found ${ROOT_ENV_RELATIVE}`);

  const fileEnv = parseEnvFile(readEnvFile());
  const databaseUrl = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
  if (!databaseUrl) {
    fail(
      `bootstrap: DATABASE_URL is missing in ${ROOT_ENV_RELATIVE} (and process env).\n` +
        `Expected a local URL like the template in ${ROOT_ENV_EXAMPLE_RELATIVE}.`,
    );
  }
  if (!isLocalDatabaseUrl(databaseUrl)) {
    fail(
      "bootstrap: refusing database setup — DATABASE_URL is not a local loopback URL.\n" +
        "Only localhost / 127.0.0.1 / ::1 are allowed (see .env.example).",
    );
  }
  log("bootstrap: DATABASE_URL is local — OK");

  log("bootstrap: installing dependencies");
  runPnpm(["install"]);

  log("bootstrap: starting local infra (Postgres + Redis)");
  runPnpm(["run", "dev:infra"]);

  const dbUrl = new URL(databaseUrl);
  const rawHost = dbUrl.hostname.replace(/^\[(.*)\]$/, "$1");
  const dbHost = rawHost === "::1" ? "127.0.0.1" : rawHost;
  const dbPort = Number(dbUrl.port || 5432);
  log(`bootstrap: waiting for Postgres at ${dbHost}:${dbPort}`);
  await waitForTcp(dbHost, dbPort, waitTimeoutMs);

  log("bootstrap: generating Prisma client");
  runPnpm(["run", "db:generate"]);

  log(`bootstrap: building workspace packages (${DEV_PACKAGE_FILTER})`);
  runPnpm(["--filter", DEV_PACKAGE_FILTER, "--if-present", "run", "build"]);

  log("bootstrap: applying migrations to development database (pnpm db:migrate)");
  runPnpm(["run", "db:migrate"]);

  log("bootstrap: seeding development database only (pnpm db:seed) — not test artifacts");
  runPnpm(["run", "db:seed"]);

  log("bootstrap: ready.");
  log("  pnpm dev     — local application");
  log("  pnpm test    — isolated disposable database (never mutates mplus_trust)");
}

export function createPnpmRunner(root) {
  return function runPnpm(args, { env } = {}) {
    const printable = ["pnpm", ...args].join(" ");
    console.log(`→ ${printable}`);
    const result = spawnSync("pnpm", args, {
      cwd: root,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: "inherit",
      shell: true,
    });
    if (result.error) {
      console.error(`bootstrap: failed to start: ${result.error.message}`);
      process.exit(1);
    }
    if (result.status !== 0) {
      console.error(`bootstrap: command failed (exit ${result.status}): ${printable}`);
      process.exit(result.status ?? 1);
    }
  };
}

export function waitForTcp(host, port, timeoutMs) {
  const started = Date.now();
  return new Promise((resolveWait, reject) => {
    const attempt = () => {
      const socket = createConnection({ host, port }, () => {
        socket.end();
        resolveWait();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(
            new Error(
              `Timed out after ${timeoutMs}ms waiting for ${host}:${port}. Is Docker running?`,
            ),
          );
          return;
        }
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return entry.replace(/\\/g, "/").endsWith("/tools/scripts/bootstrap.mjs");
  }
}

if (isMainModule()) {
  const root = resolveRepoRoot();
  runBootstrap({
    root,
    runPnpm: createPnpmRunner(root),
    waitForTcp,
  }).catch((err) => {
    console.error(`bootstrap: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
