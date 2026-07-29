#!/usr/bin/env node
/**
 * Offline Utility V3.2 opportunity-engine calibration — zero live provider calls.
 *
 * Usage:
 *   pnpm wcl:probe:utility:v3_2-calibration -- \
 *     --characters-file tools/fixtures/cross-class-validation-characters.json \
 *     --output-root raw-artifacts/wcl-probe-utility
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const probeJs = resolve(
  root,
  "packages/providers/warcraftlogs/dist/probe/run-utility-v3_2-calibration.js",
);

if (!existsSync(probeJs)) {
  console.error(
    "FAIL: V3.2 calibration entry not built. Run: pnpm --filter @mplus/provider-warcraftlogs run build",
  );
  process.exit(1);
}

if (process.env.V3_2_FORCE_LIVE === "1") {
  console.error("FAIL: V3.2 calibration must remain offline (V3_2_FORCE_LIVE is set).");
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
