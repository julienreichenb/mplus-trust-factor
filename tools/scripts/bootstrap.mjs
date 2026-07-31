/**
 * Prepare a fresh local branch/worktree so `pnpm dev` can run.
 *
 * Cross-platform (Windows + Unix + git worktrees). Idempotent.
 * Reuses root package scripts; never starts `pnpm dev`.
 * Never overwrites `.env`; never targets a non-local database.
 * Never prints secret values.
 *
 * Usage:
 *   pnpm bootstrap
 *   pnpm bootstrap -- --copy-env
 *   pnpm bootstrap -- --from-example
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
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

export function parseBootstrapFlags(argv = []) {
  return {
    copyEnv: argv.includes("--copy-env"),
    fromExample: argv.includes("--from-example"),
  };
}

/** Compare filesystem paths across Windows/Unix (spaces, separators, drive case). */
export function pathsEqual(a, b) {
  const left = resolve(a);
  const right = resolve(b);
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/**
 * Parse `git worktree list --porcelain` output.
 * @returns {{ path: string, head?: string, branch?: string, bare?: boolean, detached?: boolean }[]}
 */
export function parseWorktreeListPorcelain(text) {
  /** @type {{ path: string, head?: string, branch?: string, bare?: boolean, detached?: boolean }[]} */
  const entries = [];
  /** @type {{ path: string, head?: string, branch?: string, bare?: boolean, detached?: boolean } | null} */
  let current = null;

  const push = () => {
    if (current) {
      entries.push(current);
      current = null;
    }
  };

  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      push();
      current = { path: line.slice("worktree ".length) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "") {
      push();
    }
  }
  push();
  return entries;
}

/**
 * Detect primary + current worktree via `git worktree list --porcelain`.
 * @param {string} root
 * @param {(args: string[], cwd: string) => { status: number, stdout: string, stderr: string }} runGit
 */
export function detectWorktreeContext(root, runGit) {
  const list = runGit(["worktree", "list", "--porcelain"], root);
  if (list.status !== 0) {
    const detail = (list.stderr || list.stdout || "unknown error").trim();
    throw new Error(
      `bootstrap: git worktree detection failed (git worktree list --porcelain).\n${detail}`,
    );
  }

  const entries = parseWorktreeListPorcelain(list.stdout);
  if (entries.length === 0) {
    throw new Error("bootstrap: git worktree list returned no worktrees.");
  }

  const primary = entries.find((e) => !e.bare) ?? entries[0];
  if (!primary?.path) {
    throw new Error("bootstrap: could not resolve primary git worktree path.");
  }

  let current = entries.find((e) => pathsEqual(e.path, root));
  if (!current) {
    const toplevel = runGit(["rev-parse", "--show-toplevel"], root);
    if (toplevel.status !== 0) {
      throw new Error(
        "bootstrap: not a git repository (cannot detect worktree). " +
          "Run from a clone or linked worktree, or create .env manually from .env.example.",
      );
    }
    const top = toplevel.stdout.trim();
    current = entries.find((e) => pathsEqual(e.path, top));
    if (!current) {
      // Safe fallback: treat this checkout as its own worktree; primary remains first entry.
      current = { path: resolve(root), synthetic: true };
    }
  }

  return {
    primaryPath: resolve(primary.path),
    currentPath: resolve(current.path),
    isPrimary: pathsEqual(primary.path, current.path),
    entries,
  };
}

export function envPath(root) {
  return resolve(root, ROOT_ENV_RELATIVE);
}

export function envExamplePath(root) {
  return resolve(root, ROOT_ENV_EXAMPLE_RELATIVE);
}

/** Non-empty trimmed string. Never logs the value. */
export function hasEnvValue(env, key) {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

/**
 * Keys that are empty/missing locally but set in the primary env.
 * Returns key names only — never values.
 */
export function listFillableEnvKeys(localEnv, primaryEnv) {
  /** @type {string[]} */
  const keys = [];
  for (const key of Object.keys(primaryEnv).sort()) {
    if (!hasEnvValue(primaryEnv, key)) continue;
    if (hasEnvValue(localEnv, key)) continue;
    keys.push(key);
  }
  return keys;
}

/**
 * Fill empty local keys from primary contents. Never overwrites non-empty local values.
 * Preserves comments and unrelated lines. Does not log values.
 *
 * @returns {{ contents: string, filledKeys: string[] }}
 */
export function mergeEmptyEnvKeys(localContents, primaryContents) {
  const primaryEnv = parseEnvFile(primaryContents);
  const localEnv = parseEnvFile(localContents);
  const fillable = listFillableEnvKeys(localEnv, primaryEnv);
  if (fillable.length === 0) {
    return { contents: localContents, filledKeys: [] };
  }

  const fillSet = new Set(fillable);
  const updated = new Set();
  const eol = localContents.includes("\r\n") ? "\r\n" : "\n";
  const lines = localContents.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return line;
    const key = trimmed.slice(0, eq).trim();
    if (!fillSet.has(key)) return line;
    updated.add(key);
    return `${key}=${primaryEnv[key]}`;
  });

  for (const key of fillable) {
    if (!updated.has(key)) {
      lines.push(`${key}=${primaryEnv[key]}`);
      updated.add(key);
    }
  }

  let contents = lines.join(eol);
  if (localContents.endsWith("\n") && !contents.endsWith("\n")) {
    contents += eol;
  }
  return { contents, filledKeys: fillable };
}

/**
 * Capability summary from parsed env (booleans only — never secret values).
 * Battle.net OAuth and Blizzard live both require BLIZZARD_CLIENT_ID + BLIZZARD_CLIENT_SECRET.
 */
export function summarizeCapabilities(env) {
  const blizzardPair =
    hasEnvValue(env, "BLIZZARD_CLIENT_ID") && hasEnvValue(env, "BLIZZARD_CLIENT_SECRET");
  const wclPair = hasEnvValue(env, "WCL_CLIENT_ID") && hasEnvValue(env, "WCL_CLIENT_SECRET");
  return {
    postgres: hasEnvValue(env, "DATABASE_URL"),
    redis: hasEnvValue(env, "REDIS_URL"),
    battleNetOauth: blizzardPair,
    blizzardLive: blizzardPair,
    warcraftLogs: wclPair,
  };
}

export function formatCapabilitySummary(caps) {
  const yn = (v) => (v ? "yes" : "no");
  return [
    "bootstrap: capabilities",
    `  PostgreSQL configured: ${yn(caps.postgres)}`,
    `  Redis configured: ${yn(caps.redis)}`,
    `  Battle.net OAuth configured: ${yn(caps.battleNetOauth)}`,
    `  Blizzard live provider configured: ${yn(caps.blizzardLive)}`,
    `  Warcraft Logs configured: ${yn(caps.warcraftLogs)}`,
  ].join("\n");
}

export function missingEnvGuidance(root) {
  const example = envExamplePath(root);
  return [
    "bootstrap: missing root .env.",
    "Each Git worktree has its own filesystem — .env is not shared automatically.",
    "Create one from the template (never invent credentials):",
    `  cp ${ROOT_ENV_EXAMPLE_RELATIVE} ${ROOT_ENV_RELATIVE}`,
    `Template path: ${example}`,
    "Or re-run with:",
    "  pnpm bootstrap -- --from-example",
    "If the primary worktree already has .env:",
    "  pnpm bootstrap -- --copy-env",
    "Fill secrets locally; never commit .env.",
  ].join("\n");
}

/** @deprecated Use missingEnvGuidance — kept for older tests/callers. */
export function missingEnvMessage(root) {
  return missingEnvGuidance(root);
}

export function createPromptYesNo({ stdin = process.stdin, stdout = process.stdout } = {}) {
  return async function promptYesNo(question, { defaultAnswer = false } = {}) {
    if (!stdin.isTTY) {
      return defaultAnswer;
    }
    const rl = createInterface({ input: stdin, output: stdout });
    const hint = defaultAnswer ? "Y/n" : "y/N";
    try {
      const answer = await new Promise((resolveAnswer) => {
        rl.question(`${question} [${hint}] `, resolveAnswer);
      });
      const trimmed = String(answer ?? "")
        .trim()
        .toLowerCase();
      if (!trimmed) return defaultAnswer;
      return trimmed === "y" || trimmed === "yes";
    } finally {
      rl.close();
    }
  };
}

/**
 * Ensure this worktree has a root .env without ever clobbering non-empty values.
 * - Missing file: may copy whole file from primary or .env.example after approval.
 * - Existing file with empty keys: may fill those keys from primary after approval
 *   (`--copy-env` or interactive). Never overwrites keys that already have values.
 *
 * @returns {{ source: "existing" | "primary" | "example" | "merged-primary", path: string, filledKeys?: string[] }}
 */
export async function ensureWorktreeEnv(options) {
  const {
    root,
    flags = {},
    log = console.log,
    fail = (msg) => {
      throw new Error(msg);
    },
    exists = existsSync,
    copyFile = copyFileSync,
    readFile = (p) => readFileSync(p, "utf8"),
    writeFile = (p, contents) => writeFileSync(p, contents, "utf8"),
    runGit,
    promptYesNo,
    detectContext = detectWorktreeContext,
  } = options;

  const dest = envPath(root);

  const resolvePrimaryEnvPath = () => {
    const context = detectContext(root, runGit);
    const primaryEnvFile = envPath(context.primaryPath);
    const usable =
      exists(primaryEnvFile) && !pathsEqual(context.primaryPath, root) ? primaryEnvFile : null;
    return { context, primaryEnv: primaryEnvFile, usable };
  };

  if (exists(dest)) {
    log(`bootstrap: found ${ROOT_ENV_RELATIVE} (will not overwrite non-empty values)`);

    let primaryMeta;
    try {
      primaryMeta = resolvePrimaryEnvPath();
    } catch (err) {
      // Existing .env is enough to continue even if worktree detection fails.
      log(
        `bootstrap: keeping .env; worktree detection failed (${err instanceof Error ? err.message : String(err)})`,
      );
      return { source: "existing", path: dest };
    }

    if (!primaryMeta.usable) {
      return { source: "existing", path: dest };
    }

    const localContents = readFile(dest);
    const primaryContents = readFile(primaryMeta.usable);
    const { contents: merged, filledKeys } = mergeEmptyEnvKeys(localContents, primaryContents);
    if (filledKeys.length === 0) {
      log("bootstrap: no empty keys to fill from primary worktree .env");
      return { source: "existing", path: dest };
    }

    log(
      `bootstrap: primary worktree can fill ${filledKeys.length} empty key(s): ${filledKeys.join(", ")}`,
    );
    log(`  source: ${primaryMeta.usable}`);
    log(`  destination: ${dest}`);

    let approved = Boolean(flags.copyEnv);
    if (!approved) {
      if (typeof promptYesNo !== "function") {
        log(
          "bootstrap: re-run with pnpm bootstrap -- --copy-env to fill empty keys from primary (default is No).",
        );
        return { source: "existing", path: dest, filledKeys: [] };
      }
      approved = await promptYesNo(
        `Fill ${filledKeys.length} empty key(s) in this worktree's .env from the primary worktree?`,
        { defaultAnswer: false },
      );
    }
    if (!approved) {
      log("bootstrap: left empty keys unchanged (declined primary fill)");
      return { source: "existing", path: dest, filledKeys: [] };
    }

    writeFile(dest, merged);
    log(
      `bootstrap: filled ${filledKeys.length} empty key(s) from primary (values not logged): ${filledKeys.join(", ")}`,
    );
    return { source: "merged-primary", path: dest, filledKeys };
  }

  let primaryMeta;
  try {
    primaryMeta = resolvePrimaryEnvPath();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const primaryEnv = primaryMeta.primaryEnv;
  const primaryHasEnv = primaryMeta.usable;

  if (primaryHasEnv) {
    log("bootstrap: this worktree has no .env; primary worktree has one.");
    log(`  source: ${primaryEnv}`);
    log(`  destination: ${dest}`);
    let approved = Boolean(flags.copyEnv);
    if (!approved) {
      if (typeof promptYesNo !== "function") {
        fail(
          [
            "bootstrap: .env missing in this worktree.",
            `Primary .env available at: ${primaryEnv}`,
            "Re-run with explicit approval: pnpm bootstrap -- --copy-env",
            "(default is No — refusing to copy without approval)",
          ].join("\n"),
        );
      }
      approved = await promptYesNo(
        "Copy .env from the primary worktree into this worktree?",
        { defaultAnswer: false },
      );
    }
    if (!approved) {
      fail(
        [
          "bootstrap: .env copy declined.",
          "Create .env manually or re-run with: pnpm bootstrap -- --copy-env",
          missingEnvGuidance(root),
        ].join("\n"),
      );
    }
    if (exists(dest)) {
      fail(`bootstrap: refusing to overwrite existing .env at ${dest}`);
    }
    copyFile(primaryEnv, dest);
    log("bootstrap: copied .env from primary worktree (contents not logged)");
    return { source: "primary", path: dest };
  }

  const example = envExamplePath(root);
  if (!exists(example)) {
    fail(
      `bootstrap: missing ${ROOT_ENV_EXAMPLE_RELATIVE} at ${example}. Cannot create .env.`,
    );
  }

  log("bootstrap: no .env in this worktree or primary worktree.");
  log(`Template: ${example}`);
  log("Will not invent credentials — copy the template and fill secrets locally.");

  let approved = Boolean(flags.fromExample);
  if (!approved) {
    if (typeof promptYesNo !== "function") {
      fail(missingEnvGuidance(root));
    }
    approved = await promptYesNo(`Create ${ROOT_ENV_RELATIVE} from ${ROOT_ENV_EXAMPLE_RELATIVE}?`, {
      defaultAnswer: false,
    });
  }
  if (!approved) {
    fail(missingEnvGuidance(root));
  }
  if (exists(dest)) {
    fail(`bootstrap: refusing to overwrite existing .env at ${dest}`);
  }
  copyFile(example, dest);
  log("bootstrap: created .env from .env.example (fill secrets locally; contents not logged)");
  return { source: "example", path: dest };
}

/**
 * @param {object} options
 * @param {string} options.root
 * @param {(args: string[], opts?: { env?: NodeJS.ProcessEnv }) => void} options.runPnpm
 * @param {(host: string, port: number, timeoutMs: number) => Promise<void>} options.waitForTcp
 * @param {string[]} [options.argv]
 * @param {(msg: string) => void} [options.log]
 * @param {(msg: string) => never} [options.fail]
 * @param {number} [options.waitTimeoutMs]
 */
export async function runBootstrap(options) {
  const {
    root,
    runPnpm,
    waitForTcp,
    argv = process.argv.slice(2),
    log = console.log,
    fail = (msg) => {
      console.error(msg);
      process.exit(1);
    },
    exists = existsSync,
    readFile = (p) => readFileSync(p, "utf8"),
    copyFile = copyFileSync,
    writeFile = (p, contents) => writeFileSync(p, contents, "utf8"),
    runGit = defaultRunGit,
    promptYesNo,
    detectContext = detectWorktreeContext,
    waitTimeoutMs = 90_000,
  } = options;

  const flags = parseBootstrapFlags(argv);
  log("bootstrap: preparing local worktree for pnpm dev");

  await ensureWorktreeEnv({
    root,
    flags,
    log,
    fail,
    exists,
    copyFile,
    readFile,
    writeFile,
    runGit,
    promptYesNo,
    detectContext,
  });

  const dest = envPath(root);
  if (!exists(dest)) {
    fail(missingEnvGuidance(root));
  }

  const fileEnv = parseEnvFile(readFile(dest));
  /** @type {Record<string, string>} */
  const effectiveEnv = { ...fileEnv };
  for (const key of [
    "DATABASE_URL",
    "REDIS_URL",
    "BLIZZARD_CLIENT_ID",
    "BLIZZARD_CLIENT_SECRET",
    "WCL_CLIENT_ID",
    "WCL_CLIENT_SECRET",
  ]) {
    if (typeof process.env[key] === "string" && process.env[key].length > 0) {
      effectiveEnv[key] = process.env[key];
    }
  }

  const caps = summarizeCapabilities(effectiveEnv);
  log(formatCapabilitySummary(caps));
  if (!caps.battleNetOauth) {
    log(
      "Battle.net OAuth disabled: configure BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in this worktree's .env.",
    );
  }

  const databaseUrl = effectiveEnv.DATABASE_URL;
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

  log("bootstrap: applying migrations (pnpm db:migrate)");
  runPnpm(["run", "db:migrate"]);

  log("bootstrap: seeding idempotent fixture data (pnpm db:seed)");
  runPnpm(["run", "db:seed"]);

  log("bootstrap: ready.");
  log("  pnpm dev     — local application (development database)");
  log("  pnpm test    — isolated disposable mplus_itest_* database (never mutates mplus_trust)");
}

export function defaultRunGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
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
    promptYesNo: createPromptYesNo(),
  }).catch((err) => {
    console.error(`bootstrap: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
