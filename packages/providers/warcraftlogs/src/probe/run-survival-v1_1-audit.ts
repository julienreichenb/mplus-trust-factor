/**
 * Survival V1.1 hardening audit CLI (offline).
 *
 * Usage:
 *   pnpm wcl:probe:survival:v1.1:audit -- \
 *     --calibration-dir raw-artifacts/wcl-probe-survival-calibration/eu-archimonde-wallidrixe \
 *     --v11-dir raw-artifacts/wcl-probe-survival-v1_1/eu-archimonde-wallidrixe
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runSurvivalV1_1Audit } from "./survival-v1_1-audit-score.js";

function parseArgs(argv: string[]): {
  calibrationDir: string;
  v11Dir: string;
  outputDir: string | null;
} {
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
  const calibrationDir = flags["calibration-dir"]?.trim();
  const v11Dir = flags["v11-dir"]?.trim();
  if (!calibrationDir || !v11Dir) {
    throw new Error(
      "Usage: --calibration-dir <path> --v11-dir <path> [--output-dir <path>]",
    );
  }
  return {
    calibrationDir,
    v11Dir,
    outputDir: flags["output-dir"]?.trim() || null,
  };
}

async function zipDirectoryContents(sourceDir: string, zipPath: string): Promise<void> {
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
  const tar = spawnSync("tar", ["-a", "-cf", zipPath, "-C", sourceDir, "."], {
    stdio: "inherit",
  });
  if (tar.status !== 0) throw new Error("Failed to create ZIP");
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const outputDir = args.outputDir ?? join(args.v11Dir, "audit");
  mkdirSync(outputDir, { recursive: true });

  const { outputFiles, summary } = await runSurvivalV1_1Audit({
    calibrationDir: args.calibrationDir,
    v11Dir: args.v11Dir,
    outputDir,
  });

  const zipPath = join(outputDir, "eu-archimonde-wallidrixe-survival-v1.1-audit.zip");
  await zipDirectoryContents(outputDir, zipPath);

  console.log("wcl.probe.survival.v1.1.audit");
  console.log(JSON.stringify({ summary, outputFiles, zipPath }, null, 2));
  console.log("OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
