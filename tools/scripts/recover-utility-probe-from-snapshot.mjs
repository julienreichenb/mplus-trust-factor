#!/usr/bin/env node
/**
 * Restore Utility probe artifacts from the latest .resume-snapshot-* directory.
 *
 * Usage:
 *   node tools/scripts/recover-utility-probe-from-snapshot.mjs \
 *     --artifact-dir raw-artifacts/wcl-probe-utility/eu-ysondre-lfgaddict
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  atomicPublishProbeArtifacts,
  findLatestSnapshotDir,
} from "../../packages/providers/warcraftlogs/dist/probe/utility-probe-resume-merge.js";

function parseArgs(argv) {
  let artifactDir = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--artifact-dir") artifactDir = argv[i + 1];
  }
  if (!artifactDir) {
    console.error("Usage: --artifact-dir <path>");
    process.exit(2);
  }
  return { artifactDir: resolve(artifactDir) };
}

async function main() {
  const { artifactDir } = parseArgs(process.argv.slice(2));
  if (!existsSync(artifactDir)) {
    console.error(`Artifact dir not found: ${artifactDir}`);
    process.exit(1);
  }

  const snapshotDir = await findLatestSnapshotDir(artifactDir);
  if (!snapshotDir) {
    console.error("No .resume-snapshot-* directory found. Pre-resume artifacts were not snapshotted.");
    const runsPath = join(artifactDir, "07-utility-normalized-runs.json");
    if (existsSync(runsPath)) {
      const runs = JSON.parse(await readFile(runsPath, "utf8"));
      const dungeons = [...new Set(runs.map((r) => r.dungeonSlug))];
      console.error(`Current canonical state: ${runs.length} run(s), dungeons: ${dungeons.join(", ")}`);
    }
    process.exit(1);
  }

  console.log(`Restoring from snapshot: ${snapshotDir}`);
  await atomicPublishProbeArtifacts(snapshotDir, artifactDir);

  const runs = JSON.parse(await readFile(join(artifactDir, "07-utility-normalized-runs.json"), "utf8"));
  const dungeons = [...new Set(runs.map((r) => r.dungeonSlug))].sort();
  console.log(`Restored ${runs.length} run(s) across ${dungeons.length} dungeon(s): ${dungeons.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
