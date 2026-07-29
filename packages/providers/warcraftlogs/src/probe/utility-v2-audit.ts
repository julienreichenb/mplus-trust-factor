import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classSlugFromWclClassId } from "./survival-probe-logic.js";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import { buildUtilityV2AuditDataset } from "./utility-v2-audit-logic.js";
import { UTILITY_V2_AUDIT_CONFIG } from "./utility-v2-config.js";
import type { UtilityV2AuditDataset, UtilityV2RawRunBundle } from "./utility-v2-types.js";

export interface UtilityV2AuditOptions {
  inputDir: string;
  outputDir: string;
  now?: Date;
}

export interface UtilityV2AuditResult {
  dataset: UtilityV2AuditDataset;
  outputFiles: Record<string, string>;
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

type RawCastEntry = {
  runId: string;
  reportCode: string;
  fightId: number;
  dataset?: { events?: Array<Record<string, unknown>> };
};

type RawBuffEntry = {
  runId: string;
  reportCode: string;
  fightId: number;
  buffs?: { events?: Array<Record<string, unknown>> };
  debuffs?: { events?: Array<Record<string, unknown>> };
};

type RawInterruptEntry = {
  runId: string;
  reportCode: string;
  fightId: number;
  dataset?: { events?: Array<Record<string, unknown>> };
};

type MasterReportEntry = {
  actors?: Array<{
    id: number;
    name: string;
    type: string;
    subType?: string | null;
    petOwner?: number | null;
  }>;
};

function indexRawBundles(
  castsRaw: RawCastEntry[],
  buffsRaw: RawBuffEntry[],
  interruptsRaw: RawInterruptEntry[],
): Map<string, UtilityV2RawRunBundle> {
  const byRunId = new Map<string, UtilityV2RawRunBundle>();

  const ensure = (runId: string, reportCode: string, fightId: number): UtilityV2RawRunBundle => {
    let bundle = byRunId.get(runId);
    if (!bundle) {
      bundle = { runId, reportCode, fightId, casts: [], buffs: [], debuffs: [], interrupts: [] };
      byRunId.set(runId, bundle);
    }
    return bundle;
  };

  for (const entry of castsRaw) {
    const bundle = ensure(entry.runId, entry.reportCode, entry.fightId);
    bundle.casts.push(...(entry.dataset?.events ?? []));
  }
  for (const entry of buffsRaw) {
    const bundle = ensure(entry.runId, entry.reportCode, entry.fightId);
    bundle.buffs.push(...(entry.buffs?.events ?? []));
    bundle.debuffs.push(...(entry.debuffs?.events ?? []));
  }
  for (const entry of interruptsRaw) {
    const bundle = ensure(entry.runId, entry.reportCode, entry.fightId);
    bundle.interrupts.push(...(entry.dataset?.events ?? []));
  }

  return byRunId;
}

export async function loadUtilityV2AuditInputs(inputDir: string): Promise<{
  runs: UtilityNormalizedRun[];
  rawByRunId: Map<string, UtilityV2RawRunBundle>;
  masterByReport: Map<string, { actors: MasterReportEntry["actors"] }>;
  subject: UtilityV2AuditDataset["subject"];
}> {
  const runs = JSON.parse(
    await readFile(join(inputDir, "07-utility-normalized-runs.json"), "utf8"),
  ) as UtilityNormalizedRun[];

  const castsRaw = JSON.parse(
    await readFile(join(inputDir, "04-casts-raw.json"), "utf8"),
  ) as RawCastEntry[];
  const buffsRaw = JSON.parse(
    await readFile(join(inputDir, "05-buffs-debuffs-raw.json"), "utf8"),
  ) as RawBuffEntry[];
  const interruptsRaw = JSON.parse(
    await readFile(join(inputDir, "03-interrupts-raw.json"), "utf8"),
  ) as RawInterruptEntry[];

  const masterData = JSON.parse(
    await readFile(join(inputDir, "02-master-data.json"), "utf8"),
  ) as Record<string, MasterReportEntry>;

  const masterByReport = new Map<string, { actors: MasterReportEntry["actors"] }>();
  for (const [reportCode, entry] of Object.entries(masterData)) {
    masterByReport.set(reportCode, { actors: entry.actors ?? [] });
  }

  let subject: UtilityV2AuditDataset["subject"] = {
    region: null,
    realmSlug: null,
    name: null,
    classSlug: runs[0]?.classSlug ?? null,
    specSlug: runs[0]?.specialization ?? null,
  };

  try {
    const selection = JSON.parse(
      await readFile(join(inputDir, "01-utility-run-selection.json"), "utf8"),
    ) as {
      identity?: { region: string; realmSlug: string; name: string };
      character?: { classID?: number | null };
    };
    subject = {
      region: selection.identity?.region ?? null,
      realmSlug: selection.identity?.realmSlug ?? null,
      name: selection.identity?.name ?? null,
      classSlug:
        selection.character?.classID != null
          ? classSlugFromWclClassId(selection.character.classID)
          : (runs[0]?.classSlug ?? null),
      specSlug: runs[0]?.specialization ?? null,
    };
  } catch {
    // optional
  }

  return {
    runs,
    rawByRunId: indexRawBundles(castsRaw, buffsRaw, interruptsRaw),
    masterByReport,
    subject,
  };
}

export async function runUtilityV2Audit(
  options: UtilityV2AuditOptions,
): Promise<UtilityV2AuditResult> {
  const { runs, rawByRunId, masterByReport, subject } = await loadUtilityV2AuditInputs(
    options.inputDir,
  );
  const scoredAt = (options.now ?? new Date()).toISOString();

  const dataset = buildUtilityV2AuditDataset({
    runs,
    rawByRunId,
    masterByReport: masterByReport as Map<
      string,
      {
        actors: Array<{
          id: number;
          name: string;
          type: string;
          subType?: string | null;
          petOwner?: number | null;
        }>;
      }
    >,
    subject,
    scoredAt,
    config: UTILITY_V2_AUDIT_CONFIG,
  });

  await mkdir(options.outputDir, { recursive: true });

  const outputFiles = {
    config: join(options.outputDir, "17-utility-v2-audit-config.json"),
    evidenceInventory: join(options.outputDir, "18-utility-v2-evidence-inventory.json"),
    rubric: join(options.outputDir, "19-utility-v2-rubric.json"),
    simulatedScores: join(options.outputDir, "20-utility-v2-simulated-scores.json"),
    sensitivity: join(options.outputDir, "21-utility-v2-sensitivity.json"),
    summary: join(options.outputDir, "22-utility-v2-audit-summary.json"),
  };

  const rubricPayload = {
    version: dataset.config.version,
    neutralBaseline: dataset.config.neutralBaseline,
    domainWeights: dataset.config.domainWeights,
    evidenceTiers: dataset.config.evidenceTiers,
    absoluteRubric: dataset.config.absoluteRubric,
    missedOpportunityPenalty: dataset.config.missedOpportunityPenalty,
    notes: dataset.config.notes,
  };

  const simulatedScoresPayload = {
    global: dataset.global,
    perDungeon: dataset.perDungeon,
    runs: dataset.runAudits.map((r) => ({
      runId: r.runId,
      dungeonSlug: r.dungeonSlug,
      durationMs: r.durationMs,
      simulatedScore: r.simulatedScore,
      deltaFromNeutral: r.deltaFromNeutral,
      simulatedScoreByDomain: r.simulatedScoreByDomain,
      domainTierCounts: Object.fromEntries(
        Object.entries(r.domains).map(([k, v]) => [k, v.tierCounts]),
      ),
      observabilityByDomain: Object.fromEntries(
        Object.entries(r.domains).map(([k, v]) => [k, v.observability]),
      ),
      confidenceByDomain: Object.fromEntries(
        Object.entries(r.domains).map(([k, v]) => [k, v.confidence]),
      ),
      missedInterruptOpportunities: r.missedInterruptOpportunities,
    })),
  };

  const summaryPayload = {
    auditVersion: dataset.auditVersion,
    scoredAt: dataset.scoredAt,
    subject: dataset.subject,
    rejectedV1: dataset.diagnostics.rejectedV1Reasons,
    globalSimulatedScore: dataset.global.simulatedScore,
    neutralBaseline: dataset.global.neutralBaseline,
    deltaFromNeutral: dataset.global.deltaFromNeutral,
    aggregateTierCounts: dataset.global.aggregateTierCounts,
    aggregateDomainTierCounts: dataset.global.aggregateDomainTierCounts,
    observabilitySummary: dataset.global.observabilitySummary,
    confidenceSummary: dataset.global.confidenceSummary,
    sensitivityHighlights: dataset.sensitivityAnalysis.map((s) => ({
      scenarioId: s.scenarioId,
      label: s.label,
      globalSimulatedScore: s.globalSimulatedScore,
      deltaFromBaselineScenario: s.deltaFromBaselineScenario,
    })),
    evidenceCount: dataset.evidenceInventory.length,
    runCount: dataset.global.runCount,
    dungeonCount: dataset.global.dungeonCount,
    notes: dataset.diagnostics.notes,
  };

  await Promise.all([
    writeJson(outputFiles.config, dataset.config),
    writeJson(outputFiles.evidenceInventory, dataset.evidenceInventory),
    writeJson(outputFiles.rubric, rubricPayload),
    writeJson(outputFiles.simulatedScores, simulatedScoresPayload),
    writeJson(outputFiles.sensitivity, dataset.sensitivityAnalysis),
    writeJson(outputFiles.summary, summaryPayload),
  ]);

  return { dataset, outputFiles };
}
