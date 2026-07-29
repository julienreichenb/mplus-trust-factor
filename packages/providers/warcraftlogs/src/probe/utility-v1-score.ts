import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classSlugFromWclClassId } from "./survival-probe-logic.js";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import { UTILITY_STANDALONE_V1_CONFIG } from "./utility-v1-config.js";
import { scoreUtilityV1FromNormalizedRuns } from "./utility-v1-logic.js";
import type { UtilityV1ScoreDataset } from "./utility-v1-types.js";

export interface UtilityV1ScoreOptions {
  inputDir: string;
  outputDir: string;
  now?: Date;
}

export interface UtilityV1ScoreResult {
  dataset: UtilityV1ScoreDataset;
  outputFiles: Record<string, string>;
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function loadUtilityNormalizedRuns(inputDir: string): Promise<{
  runs: UtilityNormalizedRun[];
  identity: { region: string; realmSlug: string; name: string } | null;
  classSlug: string | null;
}> {
  const normalizedPath = join(inputDir, "07-utility-normalized-runs.json");
  const runs = JSON.parse(await readFile(normalizedPath, "utf8")) as UtilityNormalizedRun[];

  let identity: { region: string; realmSlug: string; name: string } | null = null;
  let classSlug: string | null = runs[0]?.classSlug ?? null;

  try {
    const selection = JSON.parse(
      await readFile(join(inputDir, "01-utility-run-selection.json"), "utf8"),
    ) as {
      identity?: { region: string; realmSlug: string; name: string };
      character?: { classID?: number | null };
    };
    identity = selection.identity ?? null;
    if (selection.character?.classID != null) {
      classSlug = classSlugFromWclClassId(selection.character.classID);
    }
  } catch {
    // optional
  }

  return { runs, identity, classSlug };
}

export async function runUtilityV1Score(
  options: UtilityV1ScoreOptions,
): Promise<UtilityV1ScoreResult> {
  const { runs, classSlug } = await loadUtilityNormalizedRuns(options.inputDir);
  const scoredAt = (options.now ?? new Date()).toISOString();

  const { runs: runScores, actions, perDungeon, global, diagnostics } =
    scoreUtilityV1FromNormalizedRuns(runs, {
      classSlug,
      specSlug: runs[0]?.specialization ?? null,
      scoredAt,
    });

  const dataset: UtilityV1ScoreDataset = {
    probeVersion: "utility-standalone-v1",
    scoredAt,
    config: UTILITY_STANDALONE_V1_CONFIG,
    runs: runScores,
    actions,
    perDungeon,
    global,
    diagnostics,
  };

  await mkdir(options.outputDir, { recursive: true });

  const outputFiles = {
    config: join(options.outputDir, "11-utility-v1-config.json"),
    actions: join(options.outputDir, "12-utility-v1-actions.json"),
    runs: join(options.outputDir, "13-utility-v1-runs.json"),
    perDungeon: join(options.outputDir, "14-utility-v1-per-dungeon.json"),
    global: join(options.outputDir, "15-utility-v1-global.json"),
    diagnostics: join(options.outputDir, "16-utility-v1-diagnostics.json"),
  };

  await Promise.all([
    writeJson(outputFiles.config, dataset.config),
    writeJson(outputFiles.actions, dataset.actions),
    writeJson(outputFiles.runs, dataset.runs),
    writeJson(outputFiles.perDungeon, dataset.perDungeon),
    writeJson(outputFiles.global, dataset.global),
    writeJson(outputFiles.diagnostics, dataset.diagnostics),
  ]);

  return { dataset, outputFiles };
}
