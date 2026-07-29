import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildUtilityV3SimulationDataset } from "./utility-v3-scoring-logic.js";
import { UTILITY_V3_SIMULATION_CONFIG } from "./utility-v3-config.js";
import type { UtilityV3SimulationDataset } from "./utility-v3-types.js";
import { loadUtilityV2AuditInputs } from "./utility-v2-audit.js";

export interface UtilityV3SimulationOptions {
  inputDir: string;
  outputDir: string;
  now?: Date;
}

export interface UtilityV3SimulationResult {
  dataset: UtilityV3SimulationDataset;
  outputFiles: Record<string, string>;
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function runUtilityV3Simulation(
  options: UtilityV3SimulationOptions,
): Promise<UtilityV3SimulationResult> {
  const { runs, rawByRunId, masterByReport, subject } = await loadUtilityV2AuditInputs(
    options.inputDir,
  );
  const scoredAt = (options.now ?? new Date()).toISOString();

  const dataset = buildUtilityV3SimulationDataset({
    runs,
    rawByRunId,
    masterByReport: masterByReport as Parameters<
      typeof buildUtilityV3SimulationDataset
    >[0]["masterByReport"],
    subject,
    scoredAt,
    config: UTILITY_V3_SIMULATION_CONFIG,
  });

  await mkdir(options.outputDir, { recursive: true });

  const outputFiles = {
    config: join(options.outputDir, "23-utility-v3-simulation-config.json"),
    evidenceInventory: join(options.outputDir, "24-utility-v3-evidence-inventory.json"),
    domainScores: join(options.outputDir, "25-utility-v3-domain-scores.json"),
    runs: join(options.outputDir, "26-utility-v3-runs.json"),
    perDungeon: join(options.outputDir, "27-utility-v3-per-dungeon.json"),
    global: join(options.outputDir, "28-utility-v3-global.json"),
    sensitivity: join(options.outputDir, "29-utility-v3-sensitivity.json"),
    summary: join(options.outputDir, "30-utility-v3-simulation-summary.json"),
  };

  const domainScoresPayload = {
    domainScores: dataset.global.domainScores,
    redistributedWeights: dataset.global.redistributedWeights,
    scoredVsExcludedDomains: dataset.global.scoredVsExcludedDomains,
    perDungeon: dataset.perDungeon.map((d) => ({
      dungeonSlug: d.dungeonSlug,
      domainMedians: d.domainMedians,
      eligibilitySummary: d.eligibilitySummary,
    })),
  };

  const summaryPayload = {
    simulationVersion: dataset.simulationVersion,
    scoredAt: dataset.scoredAt,
    subject: dataset.subject,
    behaviorScore: dataset.global.behaviorScore,
    confidence: dataset.global.confidence,
    semanticBand: dataset.global.semanticBand,
    semanticExplanation: dataset.global.semanticExplanation,
    aggregateTierCounts: dataset.global.aggregateTierCounts,
    evidenceContributionByType: dataset.global.evidenceContributionByType,
    scoredVsExcludedDomains: dataset.global.scoredVsExcludedDomains,
    domainScores: dataset.global.domainScores,
    redistributedWeights: dataset.global.redistributedWeights,
    sensitivityHighlights: dataset.sensitivityAnalysis,
    rejectedV2: dataset.diagnostics.rejectedV2Reasons,
    evidenceCount: dataset.evidenceInventory.length,
    runCount: dataset.global.runCount,
    notes: dataset.diagnostics.notes,
  };

  await Promise.all([
    writeJson(outputFiles.config, dataset.config),
    writeJson(outputFiles.evidenceInventory, dataset.evidenceInventory),
    writeJson(outputFiles.domainScores, domainScoresPayload),
    writeJson(outputFiles.runs, dataset.runSimulations),
    writeJson(outputFiles.perDungeon, dataset.perDungeon),
    writeJson(outputFiles.global, dataset.global),
    writeJson(outputFiles.sensitivity, dataset.sensitivityAnalysis),
    writeJson(outputFiles.summary, summaryPayload),
  ]);

  return { dataset, outputFiles };
}
