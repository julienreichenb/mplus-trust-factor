import type {
  AuthenticityEvidence,
  AuthenticityResult,
  DimensionScoreResult,
  FinalTrustResult,
  ScoreExplanation,
  ScoreModelConfigV1,
  ScoringContext,
} from "./types.js";

export function explainScore(input: {
  dimensions: DimensionScoreResult[];
  authenticity: AuthenticityResult;
  trust: FinalTrustResult;
  model: ScoreModelConfigV1;
  context: ScoringContext;
}): ScoreExplanation {
  const { dimensions, authenticity, trust, model, context } = input;
  const neutral = model.confidenceNeutralScore;

  const scored = dimensions.flatMap((d) =>
    d.contributors
      .filter((c) => c.normalizedValue != null)
      .map((c) => ({
        metricKey: c.metricKey,
        dimension: d.dimension,
        score: c.normalizedValue!,
        deltaFromNeutral: c.normalizedValue! - neutral,
        weight: c.weight * d.weight,
      })),
  );

  const topPositive = [...scored]
    .filter((c) => c.deltaFromNeutral > 0)
    .sort((a, b) => b.deltaFromNeutral * b.weight - a.deltaFromNeutral * a.weight)
    .slice(0, 3);

  const topNegative = [...scored]
    .filter((c) => c.deltaFromNeutral < 0)
    .sort((a, b) => a.deltaFromNeutral * a.weight - b.deltaFromNeutral * b.weight)
    .slice(0, 3);

  const missingHighImpact = dimensions
    .flatMap((d) =>
      d.missing.map((m) => ({
        metricKey: m.metricKey,
        dimension: d.dimension,
        weight: m.weight * d.weight,
      })),
    )
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const sourceCategories = [
    ...new Set(
      dimensions.flatMap((d) =>
        d.contributors.map((c) => c.sourceProvider).filter((s): s is string => Boolean(s)),
      ),
    ),
  ];

  const authenticityHighlights: AuthenticityEvidence[] = [...authenticity.evidence]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 5);

  const publicSummary = buildPublicSummary(trust, authenticity, topPositive, topNegative);
  const adminDetail = [
    `model=${model.key}@${model.version}`,
    `skill=${trust.skillScore.toFixed(1)} auth=${trust.authenticityScore.toFixed(1)} conf=${(trust.confidence * 100).toFixed(0)}%`,
    `observedTrust=${trust.observedTrust.toFixed(1)} final=${trust.overallScore.toFixed(1)} grade=${trust.grade}`,
    `dims=${dimensions.map((d) => `${d.dimension}:${d.adjustedScore.toFixed(0)}@${(d.confidence * 100).toFixed(0)}%`).join(",")}`,
    `tags=${authenticity.tags.join("|") || "none"}`,
    `missing=${missingHighImpact.map((m) => m.metricKey).join(",") || "none"}`,
  ].join("; ");

  return {
    topPositive,
    topNegative,
    missingHighImpact,
    sourceCategories,
    authenticityHighlights,
    publicSummary,
    adminDetail,
    modelKey: model.key,
    modelVersion: model.version,
    mechanicCatalogVersion: context.mechanicCatalogVersion ?? null,
  };
}

function buildPublicSummary(
  trust: FinalTrustResult,
  authenticity: AuthenticityResult,
  topPositive: Array<{ metricKey: string }>,
  topNegative: Array<{ metricKey: string }>,
): string {
  const parts = [
    `Trust Factor ${trust.overallScore.toFixed(0)} (${trust.grade}) with ${(trust.confidence * 100).toFixed(0)}% confidence.`,
  ];
  if (topPositive[0]) parts.push(`Strength: ${humanize(topPositive[0].metricKey)}.`);
  if (topNegative[0]) parts.push(`Watch: ${humanize(topNegative[0].metricKey)}.`);
  if (authenticity.tags.includes("BOOST_SUSPECTED")) {
    parts.push("Progression patterns look unusual; treat as a suspicion signal, not a proven purchase.");
  } else if (authenticity.tags.includes("ATYPICAL_PROGRESSION")) {
    parts.push("Progression is atypical relative to peers.");
  } else if (authenticity.tags.includes("INSUFFICIENT_DATA")) {
    parts.push("Limited authenticity evidence available.");
  }
  if (authenticity.tags.includes("CONFIRMED_REROLL") || authenticity.tags.includes("PROBABLE_REROLL")) {
    parts.push("Reroll context may explain rapid progression.");
  }
  return parts.join(" ");
}

function humanize(metricKey: string): string {
  return metricKey.replace(/\./g, " ").replace(/_/g, " ");
}
