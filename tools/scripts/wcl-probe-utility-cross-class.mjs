#!/usr/bin/env node
/**
 * Cross-class Utility V3 validation runner.
 *
 * Runs the full utility probe + V3 simulation for each character in the
 * supplied manifest file, then emits a cross-class comparison report.
 *
 * Usage:
 *   pnpm wcl:probe:utility:cross-class-validate -- \
 *     --characters-file tools/fixtures/cross-class-validation-characters.json \
 *     [--output-root raw-artifacts/wcl-probe-utility] \
 *     [--max-runs-per-dungeon 3] \
 *     [--max-reports-per-dungeon 8] \
 *     [--resume]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertLiveCallsAllowed } from "./live-smoke-lib.mjs";

assertLiveCallsAllowed();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const probeJs = resolve(
  root,
  "packages/providers/warcraftlogs/dist/probe/run-utility-cross-class-validation.js",
);

if (!existsSync(probeJs)) {
  console.error(
    "FAIL: cross-class validation entry not built. Run: pnpm --filter @mplus/provider-warcraftlogs run build",
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
const cmd = ["node", quote(probeJs), ...argv.map(quote)].join(" ");
const result = spawnSync(cmd, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
