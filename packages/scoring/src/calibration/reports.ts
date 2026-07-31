import { anonymizeReport } from "./anonymize.js";
import type { CalibrationArtifacts, CalibrationReport } from "./types.js";

function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function reportToCsv(report: CalibrationReport): string {
  const headers = [
    "memberId",
    "region",
    "realm",
    "character",
    "role",
    "classSlug",
    "specSlug",
    "expectedLabel",
    "meta",
    "source",
    "overallScore",
    "grade",
    "confidence",
    "isUnrated",
    "lowConfidence",
    "boostSuspected",
    "evaluationModelKey",
    "evaluationModelVersion",
    "activeModelKey",
    "activeModelVersion",
    "coverageState",
    "refreshState",
    "utilityBaselineCost",
    "utilityFallbackCost",
    "error",
  ];

  const lines = [headers.join(",")];
  for (const row of report.characters) {
    lines.push(
      [
        row.memberId,
        row.region,
        row.realm,
        row.character,
        row.role,
        row.classSlug,
        row.specSlug,
        row.expectedLabel,
        row.meta,
        row.source,
        row.overallScore,
        row.grade,
        row.confidence,
        row.isUnrated,
        row.lowConfidence,
        row.boost.suspected,
        row.evaluationModelKey,
        row.evaluationModelVersion,
        row.activeModelKey,
        row.activeModelVersion,
        row.coverageRefresh?.coverageState,
        row.coverageRefresh?.refreshState,
        row.utilityCost?.baselineRequestCost,
        row.utilityCost?.fallbackRequestCost,
        row.error,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function reportToJson(report: CalibrationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  return n.toFixed(digits);
}

export function reportToMarkdown(report: CalibrationReport): string {
  const lines: string[] = [];
  lines.push(`# Calibration harness report`);
  lines.push("");
  lines.push(`> ${report.disclaimer}`);
  lines.push("");
  lines.push(`- Schema: \`${report.schemaVersion}\``);
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Mode: \`${report.mode}\``);
  lines.push(`- Cohort: \`${report.cohortId}\` (n=${report.cohortSize})`);
  lines.push(`- Evaluated: ${report.evaluatedCount} · errors: ${report.errorCount}`);
  lines.push(
    `- Active model: \`${report.activeModel.key ?? "n/a"}@${report.activeModel.version ?? "n/a"}\` (status=${report.activeModel.status ?? "n/a"})`,
  );
  lines.push(
    `- Evaluation model: \`${report.evaluationModel.key ?? "n/a"}@${report.evaluationModel.version ?? "n/a"}\` (status=${report.evaluationModel.status ?? "n/a"})`,
  );
  lines.push(`- Model activated by harness: **${report.modelActivated}**`);
  lines.push(`- Provider calls made: **${report.providerCallsMade}**`);
  lines.push("");
  lines.push(`## Grade distribution`);
  lines.push("");
  lines.push(report.statistics.gradeDistributionNote);
  lines.push("");
  for (const [grade, count] of Object.entries(report.statistics.gradeDistribution)) {
    lines.push(`- ${grade}: ${count}`);
  }
  lines.push("");
  lines.push(`## Monotonic ordering`);
  lines.push("");
  const mo = report.statistics.monotonicOrdering;
  lines.push(`- Spearman (label vs score rank): ${fmtNum(mo.labelScoreSpearman, 3)}`);
  lines.push(`- Pairwise concordance: ${fmtNum(mo.pairwiseConcordance, 3)}`);
  lines.push(`- Pairwise discordance: ${fmtNum(mo.pairwiseDiscordance, 3)}`);
  lines.push(`- Inversions listed: ${mo.inversions.length}`);
  lines.push("");
  lines.push(`## Outliers`);
  lines.push("");
  if (report.statistics.outliers.length === 0) {
    lines.push("_None_");
  } else {
    for (const o of report.statistics.outliers) {
      lines.push(
        `- \`${o.memberId}\`: ${o.reason} (expected=${o.expectedLabel}, grade=${o.actualGrade}, score=${fmtNum(o.actualScore)})`,
      );
    }
  }
  lines.push("");
  lines.push(`## Meta vs non-meta`);
  lines.push("");
  lines.push(
    `- Meta n=${report.statistics.metaVersusNonMeta.meta.count} meanScore=${fmtNum(report.statistics.metaVersusNonMeta.meta.meanScore)}`,
  );
  lines.push(
    `- Non-meta n=${report.statistics.metaVersusNonMeta.nonMeta.count} meanScore=${fmtNum(report.statistics.metaVersusNonMeta.nonMeta.meanScore)}`,
  );
  lines.push("");
  lines.push(`## Role slices`);
  lines.push("");
  for (const slice of report.statistics.roleSlices) {
    lines.push(
      `- ${slice.key}: n=${slice.count} meanScore=${fmtNum(slice.meanScore)} meanConf=${fmtNum(slice.meanConfidence)}`,
    );
  }
  lines.push("");
  lines.push(`## Dimension saturation / floor`);
  lines.push("");
  for (const d of report.statistics.dimensionSaturation) {
    lines.push(
      `- ${d.dimension}: floor=${fmtNum(d.floorRate, 3)} sat=${fmtNum(d.saturationRate, 3)} missing=${fmtNum(d.missingRate, 3)} mean=${fmtNum(d.meanScore)}`,
    );
  }
  lines.push("");
  lines.push(`## Utility cost`);
  lines.push("");
  lines.push(
    `- Baseline total: ${report.utilityCostAggregate.totalBaseline}; fallback total: ${report.utilityCostAggregate.totalFallback}; fallback triggered: ${report.utilityCostAggregate.fallbackTriggeredCount}`,
  );
  lines.push("");
  lines.push(`## Weight ablation (exploratory)`);
  lines.push("");
  for (const w of report.statistics.weightAblation) {
    lines.push(
      `- ${w.weightKey}: meanScoreDelta=${fmtNum(w.meanScoreDelta)} gradeChangeCount=${w.gradeChangeCount}`,
    );
  }
  lines.push("");
  lines.push(`## Bootstrap intervals (exploratory)`);
  lines.push("");
  if (report.statistics.bootstrapIntervals.length === 0) {
    lines.push("_Sample too small (need ≥5 scored rows)._");
  } else {
    for (const b of report.statistics.bootstrapIntervals) {
      lines.push(
        `- ${b.metric}: estimate=${fmtNum(b.estimate)} CI95=[${fmtNum(b.lower)}, ${fmtNum(b.upper)}] (n=${b.sampleSize}, iters=${b.iterations}) — ${b.note}`,
      );
    }
  }
  lines.push("");
  lines.push(`## Per-character`);
  lines.push("");
  lines.push(
    `| id | role | label | meta | score | grade | conf | boost |`,
  );
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (const row of report.characters) {
    lines.push(
      `| ${row.memberId} | ${row.role} | ${row.expectedLabel} | ${row.meta} | ${fmtNum(row.overallScore)} | ${row.grade ?? "—"} | ${fmtNum(row.confidence, 3)} | ${row.boost.suspected} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function buildCalibrationArtifacts(report: CalibrationReport): CalibrationArtifacts {
  const publicSafeReport = anonymizeReport(report);
  return {
    report,
    json: reportToJson(report),
    csv: reportToCsv(report),
    markdown: reportToMarkdown(report),
    publicSafeReport,
    publicSafeJson: reportToJson(publicSafeReport),
    publicSafeMarkdown: reportToMarkdown(publicSafeReport),
  };
}
