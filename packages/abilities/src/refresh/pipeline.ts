import { getAllRegisteredRules } from "../registry.js";
import { auditCurrentRules, auditRacials, diffTotals } from "./audit.js";
import { buildShadowCoverageReport } from "./coverage.js";
import { diffCandidateCatalog } from "./diff.js";
import { assessCatalogEligibility } from "./eligibility.js";
import { normalizeSnapshots } from "./normalize.js";
import { collapseRacialSpellVariants } from "./racial-variants.js";
import { diffSimcSourceSnapshots, removalReviewFromTemporalDiff } from "./source-snapshot-diff.js";
import type { SimcSpellQueryExport } from "./sources/simc.js";
import { compareRetailTopology } from "./topology.js";
import { classifyTopology } from "./topology-classify.js";
import { mergeValidation, validateRefreshCandidates, validateRefreshSnapshots } from "./validate.js";
import type {
  CatalogDiffEntry,
  CatalogRefreshReport,
  CatalogReviewQueues,
  CurrentRulePositiveEvidence,
  ExternalAbilityCandidate,
  ExternalSourceSnapshot,
} from "./types.js";

function candidateToDiffEntry(
  candidate: ExternalAbilityCandidate,
  status: CatalogDiffEntry["status"],
  notes: string[],
): CatalogDiffEntry {
  return {
    status,
    candidateKey: candidate.candidateKey,
    name: candidate.name,
    primarySpellId: candidate.primarySpellId,
    classSlug: candidate.classSlug,
    specSlugs: candidate.specSlugs,
    raceSlugs: candidate.raceSlugs,
    sourceObservations: candidate.sourceObservations,
    notes,
  };
}

function buildReviewQueues(input: {
  candidates: ExternalAbilityCandidate[];
  currentRules: ReturnType<typeof getAllRegisteredRules>;
  diff: CatalogDiffEntry[];
}): CatalogReviewQueues {
  const matchedIds = new Set(
    input.diff
      .filter((d) => d.status !== "MISSING_FROM_CURRENT_CATALOG")
      .map((d) => d.primarySpellId)
      .filter((id): id is number => id != null),
  );
  const currentIds = new Set(input.currentRules.map((r) => r.spellIds[0]));
  const unmatched = input.candidates.filter((c) => !currentIds.has(c.primarySpellId) && !matchedIds.has(c.primarySpellId));
  return {
    strongNewCandidates: input.diff.filter((d) => d.status === "MISSING_FROM_CURRENT_CATALOG"),
    weakDiscoveries: unmatched
      .filter((c) => c.eligibilityState === "WEAK_REVIEW_CANDIDATE" || c.eligibilityState === "UNCLASSIFIED")
      .map((c) =>
        candidateToDiffEntry(c, "MISSING_FROM_CURRENT_CATALOG", [
          `eligibility=${c.eligibilityState} reasons=${c.eligibilityReasons.join(",")}`,
        ]),
      ),
    excludedStructurally: unmatched
      .filter((c) => c.eligibilityState === "EXCLUDED_STRUCTURALLY")
      .map((c) =>
        candidateToDiffEntry(c, "MISSING_FROM_CURRENT_CATALOG", [
          `structurally excluded from player catalog review: ${c.eligibilityReasons.join(",")}`,
        ]),
      ),
    currentRulesNotObserved: input.diff.filter((d) => d.status === "NOT_OBSERVED_IN_CURRENT_QUERIES"),
    removalReview: input.diff.filter((d) => d.status === "REMOVAL_REVIEW_CANDIDATE"),
    bindingReview: input.diff.filter((d) => d.status === "SPELL_BINDING_CHANGED"),
  };
}

function currentRuleEvidence(input: {
  rules: ReturnType<typeof getAllRegisteredRules>;
  candidates: ExternalAbilityCandidate[];
  snapshots: ExternalSourceSnapshot[];
  diff: CatalogDiffEntry[];
}): CurrentRulePositiveEvidence[] {
  const candById = new Map(input.candidates.map((c) => [c.primarySpellId, c]));
  return input.rules.map((rule) => {
    const primary = rule.spellIds[0] ?? 0;
    const candidate = candById.get(primary);
    const notObserved = input.diff.some(
      (d) => d.currentCanonicalKey === rule.canonicalKey && d.status === "NOT_OBSERVED_IN_CURRENT_QUERIES",
    );
    const simcQueryMiss =
      candidate?.sourceObservations.some((o) => o.state === "NOT_OBSERVED_IN_CURRENT_SOURCE_QUERY") ?? false;
    return {
      canonicalKey: rule.canonicalKey,
      identityObserved: candidate != null,
      classApplicabilityObserved: candidate?.classSlug === rule.classSlug,
      specApplicabilityObserved: (candidate?.specSlugs ?? []).some((s) => rule.specSlugs.includes(s)),
      cooldownObserved: candidate?.cooldownSeconds != null,
      bindingObserved: (candidate?.bindings.length ?? 0) > 0,
      activeObserved: candidate?.isPassive === false,
      notObservedInCurrentQueries: notObserved || (candidate != null && simcQueryMiss && !notObserved),
    };
  });
}

export function runShadowCatalogRefresh(input: {
  snapshots: ExternalSourceSnapshot[];
  currentRules?: ReturnType<typeof getAllRegisteredRules>;
  includePassiveDiscoveries?: boolean;
  nowIso?: string;
  failedSources?: string[];
  previousSimc?: SimcSpellQueryExport;
  currentSimc?: SimcSpellQueryExport;
}): {
  report: CatalogRefreshReport;
  candidates: ExternalAbilityCandidate[];
  currentRuleAudit: ReturnType<typeof auditCurrentRules>;
  racialAudit: ReturnType<typeof auditRacials>;
  racialVariantReport: ReturnType<typeof collapseRacialSpellVariants>["report"];
  topologyClassification: ReturnType<typeof classifyTopology>;
  currentRuleEvidence: CurrentRulePositiveEvidence[];
} {
  const currentRules = input.currentRules ?? getAllRegisteredRules();
  const snapshotValidation = validateRefreshSnapshots(input.snapshots);
  const usableSnapshots = snapshotValidation.valid ? input.snapshots : [];
  const normalized = snapshotValidation.valid
    ? normalizeSnapshots(usableSnapshots, { includePassiveDiscoveries: true }).map((c) => ({
        ...c,
        ...assessCatalogEligibility(c, currentRules),
      }))
    : [];
  const targetBuild =
    usableSnapshots.find((s) => s.identity.source === "SIMULATIONCRAFT")?.simulationCraft?.wowBuild ??
    usableSnapshots.find((s) => s.identity.source === "SIMULATIONCRAFT")?.identity.validFromBuild ??
    usableSnapshots[0]?.identity.validFromBuild ??
    null;
  const { candidates: collapsedCandidates, report: racialVariantReport } = collapseRacialSpellVariants(
    normalized,
    { currentRules, targetBuild, snapshots: usableSnapshots },
  );
  const allCandidates = collapsedCandidates;
  const candidates = input.includePassiveDiscoveries
    ? allCandidates
    : allCandidates.filter((c) => c.catalogRelevance !== "PASSIVE_DISCOVERED");
  const candidateValidation = validateRefreshCandidates(candidates);
  const validation = mergeValidation(snapshotValidation, candidateValidation);
  const sourceSnapshotDiff =
    input.previousSimc && input.currentSimc
      ? diffSimcSourceSnapshots({ previous: input.previousSimc, current: input.currentSimc })
      : undefined;
  const removalReviewSpellIds = new Set(
    removalReviewFromTemporalDiff(
      sourceSnapshotDiff,
      new Set(currentRules.map((r) => r.spellIds[0]).filter((id): id is number => id != null)),
    ),
  );
  const diff = diffCandidateCatalog({
    candidates,
    currentRules,
    snapshots: usableSnapshots,
    removalReviewSpellIds,
  });
  const topology = compareRetailTopology(usableSnapshots.flatMap((s) => s.inventories));
  const coverage = buildShadowCoverageReport({
    snapshots: usableSnapshots,
    candidates: allCandidates,
    currentRuleCount: currentRules.length,
    diff,
    topologyOverride: topology,
  });
  const kinds = [...new Set(input.snapshots.map((s) => s.identity.datasetKind))];
  const datasetKind = kinds.length === 1 ? kinds[0]! : kinds.length === 0 ? "PINNED" : "MIXED";
  const totals = diffTotals(diff);
  const currentRuleAudit = auditCurrentRules({ rules: currentRules, candidates: allCandidates, diff });
  const racialAudit = auditRacials({ candidates: allCandidates, diff, snapshots: usableSnapshots });
  const topologyClassification = classifyTopology(topology, coverage.racesDiscovered);
  const review = buildReviewQueues({ candidates: allCandidates, currentRules, diff });
  const evidence = currentRuleEvidence({
    rules: currentRules,
    candidates: allCandidates,
    snapshots: usableSnapshots,
    diff,
  });

  return {
    candidates,
    currentRuleAudit,
    racialAudit,
    racialVariantReport,
    topologyClassification,
    currentRuleEvidence: evidence,
    report: {
      schemaVersion: "ability-catalog-refresh-shadow-v1",
      generatedAt: input.nowIso ?? new Date().toISOString(),
      publication: "NONE",
      datasetKind,
      snapshots: input.snapshots.map((s) => s.identity),
      validation,
      coverage,
      diff,
      diffTotals: totals,
      quality: {
        incompleteScopes: coverage.partialOrUnknownInventories,
        failedSources: [...(input.failedSources ?? [])].sort(),
        unknownClassifications: coverage.candidateUnknownAbilities,
      },
      review,
      sourceSnapshotDiff,
      racialVariantCollapse: {
        rawRacialCandidates: racialVariantReport.rawRacialCandidates,
        conceptualGroups: racialVariantReport.conceptualGroups,
        historicalVariantsExcluded: racialVariantReport.historicalVariantsExcluded,
        currentSingleIdGroups: racialVariantReport.currentSingleIdGroups,
        currentMultiIdGroups: racialVariantReport.currentMultiIdGroups,
        ambiguousGroups: racialVariantReport.ambiguousGroups,
      },
    },
  };
}

export function formatShadowRefreshSummary(report: CatalogRefreshReport): string {
  const fixtureWarning =
    report.datasetKind === "FIXTURE" || report.datasetKind === "MIXED"
      ? [
          "WARNING: FIXTURE / DEMO DATA — not a current-Retail source audit.",
          "SYNTHETIC_CONTRACT fixtures must not be treated as REAL_CAPTURE Live evidence.",
          "NOT_OBSERVED_IN_CURRENT_QUERIES is not removal evidence.",
        ]
      : [];
  const review = report.review;
  const lines = [
    ...fixtureWarning,
    "Shadow ability-catalog refresh",
    `publication: ${report.publication}`,
    `datasetKind: ${report.datasetKind}`,
    `snapshots: ${report.snapshots.map((s) => `${s.datasetKind}:${s.captureProvenance ?? "?"}:${s.source}@${s.sourceRevision.slice(0, 12)}`).join(", ")}`,
    `claimed-complete catalog toolkits: ${report.coverage.claimedCompleteInventories} (SpellQuery inventories are COMPLETE_FOR_QUERY only)`,
    `partial/unknown inventories: ${report.coverage.partialOrUnknownInventories}`,
    `validation: ${report.validation.valid ? "PASS" : "FAIL"} (${report.validation.errors.length} errors / ${report.validation.warnings.length} warnings)`,
    `RAW DISCOVERY candidates: ${report.coverage.candidateAbilities} (active ${report.coverage.candidateActiveAbilities}, passive ${report.coverage.candidatePassiveAbilities}, unknown ${report.coverage.candidateUnknownAbilities}, racial ${report.coverage.racialCandidates})`,
    `CATALOG REVIEW strongNew=${review?.strongNewCandidates.length ?? 0} weak/unclassified=${review?.weakDiscoveries.length ?? 0} excluded=${review?.excludedStructurally.length ?? 0} notObserved=${review?.currentRulesNotObserved.length ?? 0} removalReview=${review?.removalReview.length ?? 0} bindingReview=${review?.bindingReview.length ?? 0}`,
    report.racialVariantCollapse
      ? `RACIAL VARIANTS raw=${report.racialVariantCollapse.rawRacialCandidates} groups=${report.racialVariantCollapse.conceptualGroups} historicalExcluded=${report.racialVariantCollapse.historicalVariantsExcluded} multiCurrent=${report.racialVariantCollapse.currentMultiIdGroups} ambiguous=${report.racialVariantCollapse.ambiguousGroups}`
      : null,
    `diff UNCHANGED=${report.diffTotals.UNCHANGED} MISSING_CURRENT=${report.diffTotals.MISSING_FROM_CURRENT_CATALOG} NOT_OBSERVED=${report.diffTotals.NOT_OBSERVED_IN_CURRENT_QUERIES} REMOVAL_REVIEW=${report.diffTotals.REMOVAL_REVIEW_CANDIDATE} MISSING_EXTERNAL=${report.diffTotals.MISSING_FROM_EXTERNAL_SOURCES} METADATA=${report.diffTotals.METADATA_CHANGED} APPLICABILITY=${report.diffTotals.APPLICABILITY_CHANGED} BINDING=${report.diffTotals.SPELL_BINDING_CHANGED} AMBIGUOUS=${report.diffTotals.AMBIGUOUS} CONFLICT=${report.diffTotals.SOURCE_CONFLICT}`,
    `quality incompleteScopes=${report.quality.incompleteScopes} unknown=${report.quality.unknownClassifications} failedSources=${report.quality.failedSources.join(",") || "none"}`,
    report.sourceSnapshotDiff
      ? `temporal comparable=${report.sourceSnapshotDiff.comparable} REMOVED=${report.sourceSnapshotDiff.totals.REMOVED} ADDED=${report.sourceSnapshotDiff.totals.ADDED}`
      : "temporal source diff: unavailable (no --previous-simc); removal conclusions remain low-confidence",
    "Runtime RETAIL_ABILITY_CATALOG was not modified.",
  ];
  const changed = report.diff.filter((d) => d.status !== "UNCHANGED");
  const highlights = changed.slice(0, 20);
  for (const entry of highlights) {
    lines.push(
      `  [${entry.status}] ${entry.currentCanonicalKey ?? entry.candidateKey} ${entry.name} id=${entry.primarySpellId ?? "?"}`,
    );
  }
  if (changed.length > 20) {
    lines.push(`  … ${changed.length - 20} more`);
  }
  return lines.filter((l): l is string => l != null).join("\n");
}
