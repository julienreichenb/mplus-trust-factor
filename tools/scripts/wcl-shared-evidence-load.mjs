#!/usr/bin/env node
/**
 * Production-safe shared WCL evidence load (Survival+Utility consumers; Utility scoring disabled).
 *
 * Usage:
 *   pnpm wcl:shared-evidence:load -- --region EU --realm Archimonde --name Wallidrixe --max-runs 2
 *   pnpm wcl:shared-evidence:load -- --simulate-insufficient-quota
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const probeJs = resolve(
  root,
  "packages/providers/warcraftlogs/dist/evidence/run-shared-evidence-load.js",
);

if (!existsSync(probeJs)) {
  console.error(
    "FAIL: shared-evidence load entry not built. Run: pnpm --filter @mplus/provider-warcraftlogs run build",
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
