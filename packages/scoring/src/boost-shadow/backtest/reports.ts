/**
 * Deterministic JSON / CSV / Markdown artifacts for Phase 2 backtest.
 */

import { anonymizeBacktestReport } from "./anonymize.js";
import type {
  BoostShadowBacktestArtifacts,
  BoostShadowBacktestReportV1,
  Phase2FeatureKey,
} from "./types.js";
import { PHASE2_FEATURE_KEYS } from "./types.js";

function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function reportToJson(report: BoostShadowBacktestReportV1): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function reportToCsv(report: BoostShadowBacktestReportV1): string {
  const headers = [
    "memberId",
    "characterId",
    "seasonId",
    "role",
    "keyBand",
    "split",
    "labelClass",
    "labelSource",
    "labelConfidence",
    "labeledForSupervised",
    "patternClass",
    ...PHASE2_FEATURE_KEYS.flatMap((k) => [k, `${k}_confidence`, `${k}_coverage`]),
    "highKeyRunsEligible",
    "highKeyRunsExcluded",
    "authScore",
    "authBoostSuspected",
    "error",
  ];

  const lines = [headers.join(",")];
  for (const row of report.rows) {
    const featureCols: Array<string | number | boolean | null> = [];
    for (const k of PHASE2_FEATURE_KEYS) {
      featureCols.push(
        row.features[k as Phase2FeatureKey] ?? null,
        row.featureConfidence[k as Phase2FeatureKey] ?? null,
        row.featureCoverage[k as Phase2FeatureKey] ?? null,
      );
    }
    lines.push(
      [
        row.memberId,
        row.characterId,
        row.seasonId,
        row.role,
        row.keyBand,
        row.split,
        row.label.class,
        row.label.source,
        row.label.confidence,
        row.labeledForSupervised,
        row.patternClass,
        ...featureCols,
        row.highKeyRunsEligible,
        row.highKeyRunsExcluded,
        row.productionAuthenticity.authenticityScore,
        row.productionAuthenticity.boostSuspected,
        row.error,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  return n.toFixed(digits);
}

export function reportToMarkdown(report: BoostShadowBacktestReportV1): string {
  const lines: string[] = [];
  lines.push(`# Boost shadow Phase 2 backtest report`);
  lines.push("");
  lines.push(`> ${report.disclaimer}`);
  lines.push("");
  lines.push(`- Schema: \`${report.schemaVersion}\``);
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Cohort: \`${report.cohort.cohortId}\` (n=${report.cohort.memberCount})`);
  lines.push(`- High-key policy: \`${report.highKeyPolicyVersion}\``);
  lines.push(`- Extractor: \`${report.extractorVersion}\``);
  lines.push(`- Experimental classifier: \`${report.experimentalClassifier.label}\``);
  lines.push("");
  lines.push(`## Isolation`);
  lines.push("");
  for (const [k, v] of Object.entries(report.isolation)) {
    lines.push(`- ${k}: \`${v}\``);
  }
  lines.push("");
  lines.push(`## Label distribution`);
  lines.push("");
  for (const [k, v] of Object.entries(report.analysis.labelDistribution)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push(`## Feature availability`);
  lines.push("");
  for (const row of report.analysis.featureAvailability) {
    lines.push(
      `- ${row.featureKey}: computed=${row.computedCount} omitted=${row.omittedCount} missingness=${fmt(row.missingnessRate)}`,
    );
  }
  lines.push("");
  lines.push(`## Feature distributions`);
  lines.push("");
  for (const d of report.analysis.featureDistributions) {
    lines.push(
      `- ${d.featureKey}: n=${d.sampleSize} mean=${fmt(d.mean)} p50=${fmt(d.p50)} min=${fmt(d.min)} max=${fmt(d.max)}`,
    );
  }
  lines.push("");
  lines.push(`## Confusion / precision-recall (research labels only)`);
  lines.push("");
  const cm = report.analysis.confusionMatrix;
  const pr = report.analysis.precisionRecall;
  if (cm) {
    lines.push(
      `- TP=${cm.truePositive} FP=${cm.falsePositive} TN=${cm.trueNegative} FN=${cm.falseNegative} (labeled n=${cm.labeledSampleSize}, unlabeled excluded=${cm.unlabeledExcluded})`,
    );
  }
  if (pr) {
    lines.push(
      `- precision=${fmt(pr.precision)} recall=${fmt(pr.recall)} FPR=${fmt(pr.falsePositiveRate)}`,
    );
    lines.push(`- ${pr.note}`);
  }
  lines.push("");
  lines.push(`## Fixed team vs repeated stronger teammate`);
  lines.push("");
  const ft = report.analysis.fixedTeamVersusStronger;
  lines.push(`- fixed_team_low_gap: ${ft.fixedTeamLowGapCount}`);
  lines.push(`- repeated_stronger_teammate: ${ft.repeatedStrongerTeammateCount}`);
  lines.push(`- high_gap_diverse: ${ft.highGapDiverseCount}`);
  lines.push(`- distinguishable: ${ft.distinguishable}`);
  lines.push(`- ${ft.note}`);
  lines.push("");
  lines.push(`## Split provenance`);
  lines.push("");
  const sp = report.analysis.splitProvenance;
  lines.push(
    `- train=${sp.trainCount} evaluation=${sp.evaluationCount} coverage_only=${sp.coverageOnlyCount}`,
  );
  lines.push("");
  lines.push(`## Authenticity compare (read-only, not ground truth)`);
  lines.push("");
  lines.push(`- ${report.analysis.authenticityCompare.note}`);
  lines.push(
    `- rowsWithAuthenticity=${report.analysis.authenticityCompare.rowsWithAuthenticity}`,
  );
  lines.push("");
  lines.push(`## Evidence coverage`);
  lines.push("");
  const ec = report.analysis.evidenceCoverage;
  lines.push(`- membersRequested=${ec.membersRequested}`);
  lines.push(`- labeledSupervised=${ec.labeledSupervisedCount}`);
  lines.push(`- unlabeledRetainedForCoverage=${ec.unlabeledRetainedForCoverage}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function buildBacktestArtifacts(
  report: BoostShadowBacktestReportV1,
): BoostShadowBacktestArtifacts {
  const publicSafeReport = anonymizeBacktestReport(report);
  return {
    report,
    json: reportToJson(report),
    csv: reportToCsv(report),
    markdown: reportToMarkdown(report),
    publicSafeReport,
    publicSafeJson: reportToJson(publicSafeReport),
    publicSafeMarkdown: reportToMarkdown(publicSafeReport),
    publicSafeCsv: reportToCsv(publicSafeReport),
  };
}
