/**
 * Standalone Survival V1 scorer CLI (offline on calibration artifacts).
 *
 * Usage:
 *   pnpm wcl:probe:survival:v1 -- --input-dir raw-artifacts/wcl-probe-survival-calibration/eu-archimonde-wallidrixe
 */
import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  loadCalibrationSummary,
  runSurvivalV1Score,
} from "./survival-v1-score.js";

function parseArgs(argv: string[]): { inputDir: string; outputDir: string | null } {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    flags[key] = next;
    i += 1;
  }
  const inputDir = flags["input-dir"]?.trim();
  if (!inputDir) {
    throw new Error(
      "Usage: --input-dir <calibration-artifact-dir> [--output-dir <path>]",
    );
  }
  return { inputDir, outputDir: flags["output-dir"]?.trim() || null };
}

async function collectFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".zip")) continue;
      out.push(...(await collectFiles(full, base)));
    } else if (entry.isFile() && !entry.name.endsWith(".zip")) {
      out.push(full);
    }
  }
  return out;
}

async function zipDirectoryContents(sourceDir: string, zipPath: string): Promise<void> {
  // Prefer PowerShell Compress-Archive on Windows for reliability.
  if (process.platform === "win32") {
    const ps = `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`Compress-Archive failed with status ${result.status}`);
    }
    return;
  }

  // Fallback: write a simple listing note — zip via tar if available
  const tar = spawnSync("tar", ["-a", "-cf", zipPath, "-C", sourceDir, "."], {
    stdio: "inherit",
  });
  if (tar.status !== 0) {
    throw new Error("Failed to create ZIP (tar unavailable)");
  }
  void createWriteStream;
  void relative;
  void stat;
  void collectFiles;
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const outputDir = args.outputDir ?? args.inputDir;
  mkdirSync(outputDir, { recursive: true });

  const calibration = await loadCalibrationSummary(args.inputDir);
  const { dataset, outputFiles } = await runSurvivalV1Score({
    calibration,
    outputDir,
  });

  const zipPath = join(
    outputDir,
    `${calibration.identity.region.toLowerCase()}-${calibration.identity.realmSlug}-${calibration.identity.name.toLowerCase()}-survival-v1.zip`,
  );
  await zipDirectoryContents(outputDir, zipPath);

  const sampleWindows = dataset.dangerWindows.slice(0, 3).map((w) => ({
    windowId: w.windowId,
    dungeonSlug: w.dungeonSlug,
    triggers: w.triggerTypes,
    deathOutcome: w.deathOutcome,
    defensive: w.componentResult.defensive,
    recovery: w.componentResult.recovery,
    confirmedDefensives: w.confirmedAvailableDefensives.map((d) => d.canonicalKey),
    recoveryActions: w.recoveryActionsDetected.map((a) => a.kind),
  }));

  console.log("wcl.probe.survival.v1");
  console.log(
    JSON.stringify(
      {
        configVersion: dataset.config.version,
        globalScore: dataset.global.score,
        availableDungeonCount: dataset.global.availableDungeonCount,
        expectedDungeonCount: dataset.global.expectedDungeonCount,
        perDungeon: dataset.perDungeon.map((d) => ({
          dungeonSlug: d.dungeonSlug,
          runCount: d.runCount,
          medianScore: d.medianScore,
        })),
        runCount: dataset.runs.length,
        deathsDetected: dataset.diagnostics.deathsDetected,
        dangerWindows: dataset.diagnostics.totalDangerWindows,
        defensiveCoverage: {
          eligible: dataset.diagnostics.eligibleDefensiveWindows,
          covered: dataset.diagnostics.coveredDefensiveWindows,
        },
        recoveryCoverage: {
          eligible: dataset.diagnostics.eligibleRecoveryWindows,
          covered: dataset.diagnostics.coveredRecoveryWindows,
        },
        notApplicableCounts: dataset.diagnostics.notApplicableCounts,
        notApplicableReasons: dataset.diagnostics.notApplicableReasons,
        runsWithValidMaxHp: dataset.diagnostics.runsWithValidMaxHp,
        sampleDangerWindows: sampleWindows,
        outputFiles,
        zipPath,
      },
      null,
      2,
    ),
  );
  console.log("OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
