#!/usr/bin/env node
/**
 * Standalone Utility V2 strategic-utility audit (offline on utility probe artifacts).
 *
 * Usage:
 *   pnpm wcl:probe:utility:v2-audit -- --input-dir raw-artifacts/wcl-probe-utility/eu-archimonde-wallidrixe
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const probeJs = resolve(
  root,
  "packages/providers/warcraftlogs/dist/probe/run-utility-v2-audit.js",
);

if (!existsSync(probeJs)) {
  console.error(
    "FAIL: utility V2 audit not built. Run: pnpm --filter @mplus/provider-warcraftlogs run build",
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
