/**
 * Standalone Utility V3 scoring simulation CLI (offline on probe artifacts).
 *
 * Usage:
 *   pnpm wcl:probe:utility:v3-simulation -- --input-dir raw-artifacts/wcl-probe-utility/eu-archimonde-wallidrixe
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runUtilityV3Simulation } from "./utility-v3-simulation.js";

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
      "Usage: --input-dir <utility-probe-artifact-dir> [--output-dir <path>]",
    );
  }
  return { inputDir, outputDir: flags["output-dir"]?.trim() || null };
}

function zipDirectoryContents(sourceDir: string, zipPath: string): void {
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
  if (tar.status !== 0) throw new Error("Failed to create ZIP (tar unavailable)");
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

  const { dataset, outputFiles } = await runUtilityV3Simulation({
    inputDir: args.inputDir,
    outputDir,
  });

  const zipPath = join(
    outputDir,
    `${outputDir.split(/[/\\]/).pop() ?? "utility"}-utility-v3-simulation.zip`,
  );
  zipDirectoryContents(outputDir, zipPath);

  console.log("wcl.probe.utility.v3-simulation");
  console.log(
    JSON.stringify(
      {
        simulationVersion: dataset.simulationVersion,
        behaviorScore: dataset.global.behaviorScore,
        confidence: dataset.global.confidence,
        semanticBand: dataset.global.semanticBand,
        domainScores: dataset.global.domainScores,
        redistributedWeights: dataset.global.redistributedWeights,
        aggregateTierCounts: dataset.global.aggregateTierCounts,
        evidenceContributionByType: dataset.global.evidenceContributionByType,
        scoredVsExcludedDomains: dataset.global.scoredVsExcludedDomains,
        perDungeon: dataset.perDungeon
          .filter((d) => d.runCount > 0)
          .map((d) => ({
            dungeonSlug: d.dungeonSlug,
            medianBehaviorScore: d.medianBehaviorScore,
            domainMedians: d.domainMedians,
          })),
        sensitivity: dataset.sensitivityAnalysis,
        semanticExplanation: dataset.global.semanticExplanation,
        outputFiles,
        zipPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
