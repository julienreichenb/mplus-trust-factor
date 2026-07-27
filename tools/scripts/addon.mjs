#!/usr/bin/env node
/**
 * Cross-platform entrypoint for @mplus/addon-exporter commands.
 *
 * Usage: node tools/scripts/addon.mjs <export|test|check|benchmark|package> [args...]
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {Record<string, string>} */
const COMMANDS = {
  export: "export",
  test: "test",
  check: "lua:check",
  benchmark: "benchmark",
  package: "package",
};

const command = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!command || !(command in COMMANDS)) {
  console.error(
    `Usage: node tools/scripts/addon.mjs <${Object.keys(COMMANDS).join("|")}> [args...]`,
  );
  process.exit(1);
}

const pnpmArgs = ["--filter", "@mplus/addon-exporter", "run", COMMANDS[command]];
if (extraArgs.length > 0) {
  pnpmArgs.push("--", ...extraArgs);
}

const result = spawnSync("pnpm", pnpmArgs, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
