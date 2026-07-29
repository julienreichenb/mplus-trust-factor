import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAbilityCatalog } from "@mplus/abilities";
import { CURRENT_MPLUS_ZONE_DUNGEON_SLUGS } from "../discovery/run-discovery.js";
import { activeSeasonDungeonPool, classSlugFromWclClassId } from "./survival-probe-logic.js";
import type { SurvivalCalibrationDataset, SurvivalCalibrationRun } from "./survival-calibration-types.js";
import { SURVIVAL_STANDALONE_V1_CONFIG } from "./survival-v1-config.js";
import {
  aggregateSurvivalV1Dungeons,
  scoreSurvivalV1Run,
} from "./survival-v1-logic.js";
import type {
  SurvivalV1ConfidenceDiagnostics,
  SurvivalV1ScoreDataset,
} from "./survival-v1-types.js";

export interface SurvivalV1ScoreOptions {
  /** Calibration summary dataset (from 00-calibration-summary.json) or runs array. */
  calibration: Pick<SurvivalCalibrationDataset, "runs" | "identity" | "character">;
  outputDir: string;
  expectedDungeonSlugs?: string[];
  now?: Date;
}

export interface SurvivalV1ScoreResult {
  dataset: SurvivalV1ScoreDataset;
  outputFiles: Record<string, string>;
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function scoreSurvivalV1FromCalibrationRuns(
  runs: SurvivalCalibrationRun[],
  options: {
    classSlug: string | null;
    expectedDungeonSlugs?: string[];
    scoredAt?: string;
  },
): SurvivalV1ScoreDataset {
  const expected = activeSeasonDungeonPool(
    options.expectedDungeonSlugs ?? CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
  );
  const catalog = getAbilityCatalog({
    classSlug: options.classSlug,
    specSlug: runs[0]?.specialization ?? null,
  });

  const allWindows = [];
  const runScores = [];
  for (const run of runs) {
    const runCatalog = getAbilityCatalog({
      classSlug: options.classSlug,
      specSlug: run.specialization,
    });
    const scored = scoreSurvivalV1Run({
      run,
      catalog: runCatalog.supported ? runCatalog : catalog,
      classSlug: options.classSlug,
      config: SURVIVAL_STANDALONE_V1_CONFIG,
    });
    runScores.push(scored.runScore);
    allWindows.push(...scored.dangerWindows);
  }

  const { perDungeon, global } = aggregateSurvivalV1Dungeons(runScores, expected);

  const unavailableComponents: SurvivalV1ConfidenceDiagnostics["unavailableComponents"] = [];
  const notApplicableReasons: Record<string, number> = {};
  for (const r of runScores) {
    if (r.defensiveResponse.state === "NOT_APPLICABLE") {
      const reason = r.defensiveResponse.reason ?? "unknown";
      notApplicableReasons[reason] = (notApplicableReasons[reason] ?? 0) + 1;
      unavailableComponents.push({
        runId: r.runId,
        component: "defensiveResponse",
        reason,
      });
    }
    if (r.emergencyRecovery.state === "NOT_APPLICABLE") {
      const reason = r.emergencyRecovery.reason ?? "unknown";
      notApplicableReasons[reason] = (notApplicableReasons[reason] ?? 0) + 1;
      unavailableComponents.push({
        runId: r.runId,
        component: "emergencyRecovery",
        reason,
      });
    }
    if (r.maxHp == null) {
      unavailableComponents.push({
        runId: r.runId,
        component: "dangerDetection",
        reason: "max_hp_unavailable_hp_percentage_triggers_disabled",
      });
    }
  }

  const completeWindows = allWindows.filter((w) => w.eventDataComplete).length;

  const diagnostics: SurvivalV1ConfidenceDiagnostics = {
    dungeonCoverage: {
      available: global.availableDungeonCount,
      expected: global.expectedDungeonCount,
      missing: expected.filter(
        (slug) => !perDungeon.some((d) => d.dungeonSlug === slug && d.runCount > 0),
      ),
    },
    runCount: runScores.length,
    runsWithValidMaxHp: runScores.filter((r) => r.maxHp != null).length,
    totalDangerWindows: allWindows.length,
    eligibleDefensiveWindows: runScores.reduce((s, r) => s + r.eligibleDefensiveWindows, 0),
    eligibleRecoveryWindows: runScores.reduce((s, r) => s + r.eligibleRecoveryWindows, 0),
    coveredDefensiveWindows: runScores.reduce((s, r) => s + r.coveredDefensiveWindows, 0),
    coveredRecoveryWindows: runScores.reduce((s, r) => s + r.coveredRecoveryWindows, 0),
    percentWindowsWithCompleteEventData:
      allWindows.length === 0 ? null : (completeWindows / allWindows.length) * 100,
    unavailableComponents,
    deathsDetected: runScores.reduce((s, r) => s + r.deathCount, 0),
    notApplicableCounts: {
      defensiveResponse: runScores.filter((r) => r.defensiveResponse.state === "NOT_APPLICABLE")
        .length,
      emergencyRecovery: runScores.filter((r) => r.emergencyRecovery.state === "NOT_APPLICABLE")
        .length,
    },
    notApplicableReasons,
    configVersion: SURVIVAL_STANDALONE_V1_CONFIG.version,
  };

  return {
    probeVersion: "survival-standalone-v1",
    scoredAt: options.scoredAt ?? new Date().toISOString(),
    config: SURVIVAL_STANDALONE_V1_CONFIG,
    runs: runScores,
    dangerWindows: allWindows,
    perDungeon,
    global,
    diagnostics,
  };
}

export async function runSurvivalV1Score(
  options: SurvivalV1ScoreOptions,
): Promise<SurvivalV1ScoreResult> {
  const classSlug = classSlugFromWclClassId(options.calibration.character?.classID ?? null);
  const dataset = scoreSurvivalV1FromCalibrationRuns(options.calibration.runs, {
    classSlug,
    expectedDungeonSlugs: options.expectedDungeonSlugs,
    scoredAt: (options.now ?? new Date()).toISOString(),
  });

  await mkdir(options.outputDir, { recursive: true });

  const outputFiles = {
    config: join(options.outputDir, "05-survival-v1-config.json"),
    runs: join(options.outputDir, "06-survival-v1-runs.json"),
    dangerWindows: join(options.outputDir, "07-survival-v1-danger-windows.json"),
    perDungeon: join(options.outputDir, "08-survival-v1-per-dungeon.json"),
    global: join(options.outputDir, "09-survival-v1-global.json"),
    diagnostics: join(options.outputDir, "10-survival-v1-diagnostics.json"),
  };

  await Promise.all([
    writeJson(outputFiles.config, dataset.config),
    writeJson(outputFiles.runs, dataset.runs),
    writeJson(outputFiles.dangerWindows, dataset.dangerWindows),
    writeJson(outputFiles.perDungeon, dataset.perDungeon),
    writeJson(outputFiles.global, dataset.global),
    writeJson(outputFiles.diagnostics, dataset.diagnostics),
  ]);

  return { dataset, outputFiles };
}

export async function loadCalibrationSummary(
  inputDir: string,
): Promise<Pick<SurvivalCalibrationDataset, "runs" | "identity" | "character">> {
  const { readFile } = await import("node:fs/promises");
  const summaryPath = join(inputDir, "00-calibration-summary.json");
  const raw = JSON.parse(await readFile(summaryPath, "utf8")) as SurvivalCalibrationDataset;
  return {
    runs: raw.runs,
    identity: raw.identity,
    character: raw.character,
  };
}

/** List existing calibration artifact files to include in a combined ZIP. */
export async function listCalibrationArtifactFiles(inputDir: string): Promise<string[]> {
  const entries = await readdir(inputDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) files.push(join(inputDir, entry.name));
  }
  return files;
}
