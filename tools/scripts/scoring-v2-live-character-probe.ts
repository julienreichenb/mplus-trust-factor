#!/usr/bin/env node
/**
 * Live Scoring V2 character probe — one character, up to 16 Evidence Manifest V2 slots.
 *
 * Preferred invocation (loads .env, runs via worker package for workspace resolution):
 *   node tools/scripts/with-env.mjs pnpm --filter @mplus/worker exec tsx src/orchestration/scoring/live-character-probe/cli.ts --region eu --realm archimonde --name Wallidrixe
 *
 * This file re-exports the same CLI for:
 *   pnpm exec tsx tools/scripts/scoring-live-character-probe.ts --region eu --realm archimonde --name Wallidrixe
 * when run with NODE_PATH / from a package that resolves @mplus/* (use the with-env + worker form above).
 *
 * Requires ALLOW_LIVE_PROVIDER_CALLS=true. Does not publish scores or enable V2 flags.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);

const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@mplus/worker",
    "exec",
    "tsx",
    "src/orchestration/scoring/live-character-probe/cli.ts",
    ...argv,
  ],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: true,
  },
);

process.exit(result.status ?? 1);
