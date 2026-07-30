/**
 * Bounded Utility fallback inside a single refresh-character execution.
 *
 * Option A product decision:
 * - Only INSUFFICIENT_EVIDENCE_RETRYABLE may fetch extra runs (cap 4).
 * - COMPLETE_ZERO_CONTRIBUTION → Utility U / non-calculable (no fabricated 50/0, no fallback).
 * - After fallback, still-insufficient evidence (including complete-zero) stays non-calculable.
 * - Never mutates Performance canonical run selection.
 * - Never enqueues a second top-level character refresh.
 */
import {
  classifyUtilityBaselineFromShadowCoverage,
  diagnoseUtilityBaselineRun,
  selectUtilityFallbackRuns,
  shouldStopUtilityFallback,
  type UtilityBaselineDiagnosticResult,
  type UtilityBaselineState,
  type UtilityFallbackCandidateRun,
  type UtilityFallbackSelectionResult,
  type UtilityPublicationGateConfig,
  type UtilityShadowPassResult,
  type WclRunEvidenceBundle,
  buildUtilityShadowInputsFromBundles,
  runUtilityObservedShadowPass,
  getUtilityPublicationMode,
} from "@mplus/provider-warcraftlogs";

export const UTILITY_FALLBACK_MAX_EXTRA_RUNS = 4;

/**
 * Fallback ingest consumer gate.
 *
 * `consumers` on `ingestSharedEvidenceBundle` controls:
 * 1. which datasets are requested (`unionRequiredDatasets`);
 * 2. Survival pagination/filter parity (`survivalParity` → maxPages 200 + resource filters);
 * 3. accounting/provenance tags on the bundle.
 *
 * It does NOT push rows into Survival scoring. Survival observations are built only from
 * the baseline Survival loop (`survivalRows`) before fallback runs.
 *
 * Fallback must request Utility datasets only — never `"survival"` — so we do not
 * fetch Survival-only streams (DamageTaken / Healing) or Survival-parity pagination.
 */
export const UTILITY_FALLBACK_INGEST_CONSUMERS = ["utility"] as const;

export type UtilityFallbackIngestConsumer = (typeof UTILITY_FALLBACK_INGEST_CONSUMERS)[number];

/** Stable ingest options for Utility-fallback shared-evidence fetches. */
export function buildUtilityFallbackIngestConsumers(): Array<"utility"> {
  return [...UTILITY_FALLBACK_INGEST_CONSUMERS];
}

/**
 * Datasets a Utility-fallback ingest may request (Utility set only).
 * Survival-only keys (DamageTaken, Healing) must not appear.
 */
export function utilityFallbackAllowedDatasetKeys(): readonly string[] {
  return [
    "masterData",
    "Casts",
    "HostileCasts",
    "Interrupts",
    "Deaths",
    "Buffs",
    "Debuffs",
    "Dispels",
    "DamageDone",
    "CombatantInfo",
  ];
}

export function assertUtilityFallbackBundleIsUtilityOnly(bundle: {
  accounting: { consumers: ReadonlyArray<string> };
  eventDatasets: Partial<Record<string, unknown>>;
}): { ok: true } | { ok: false; reason: string } {
  if (bundle.accounting.consumers.includes("survival")) {
    return { ok: false, reason: "bundle_tagged_with_survival_consumer" };
  }
  if (!bundle.accounting.consumers.includes("utility")) {
    return { ok: false, reason: "bundle_missing_utility_consumer" };
  }
  const allowed = new Set(utilityFallbackAllowedDatasetKeys());
  for (const key of Object.keys(bundle.eventDatasets)) {
    if (!allowed.has(key)) {
      return { ok: false, reason: `disallowed_dataset:${key}` };
    }
  }
  return { ok: true };
}

/**
 * Pure isolation check: Survival observation inputs must ignore Utility-fallback bundles.
 * Fallback evidence may only feed Utility shadow/publication.
 */
export function partitionEvidenceForScoringConsumers(input: {
  survivalRows: ReadonlyArray<{ runId: string }>;
  utilityBundles: ReadonlyArray<{ reportCode: string; fightId: number }>;
  fallbackReportFightKeys: ReadonlyArray<string>;
}): {
  survivalRunIds: string[];
  utilityOnlyFallbackKeys: string[];
  survivalTouchedByFallback: boolean;
} {
  const survivalRunIds = input.survivalRows.map((r) => r.runId);
  const utilityOnlyFallbackKeys = input.utilityBundles
    .map((b) => `${b.reportCode}:${b.fightId}`)
    .filter((k) => input.fallbackReportFightKeys.includes(k));
  return {
    survivalRunIds,
    utilityOnlyFallbackKeys,
    survivalTouchedByFallback: false,
  };
}

export interface UtilityFallbackCostLedgerEntry {
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  selectionReason: string;
  newlyFetched: boolean;
  providerCalls: number;
  pages: number;
  pointsConsumed: number | null;
  costSource: "measured" | "estimated" | "unknown";
}

export interface UtilityFallbackDiagnostics {
  triggered: boolean;
  baselineState: UtilityBaselineState;
  finalState: UtilityBaselineState;
  maxExtraRuns: number;
  selected: Array<{
    reportCode: string;
    fightId: number;
    dungeonSlug: string;
    selectionReason: string;
  }>;
  selectionReasons: string[];
  stoppedReason: string;
  ingestedCount: number;
  newlyFetchedCount: number;
  cachedReuseCount: number;
  providerCalls: number;
  pages: number;
  pointsConsumed: number | null;
  costLedger: UtilityFallbackCostLedgerEntry[];
  remainingEvidenceGaps: string[];
  confidenceRationale: string[];
}

export interface UtilityFallbackIngestRequest {
  candidate: UtilityFallbackCandidateRun;
  selectionReason: string;
}

export interface UtilityFallbackIngestResult {
  bundle: WclRunEvidenceBundle | null;
  skippedReason?: string;
}

export function emptyUtilityFallbackDiagnostics(
  baselineState: UtilityBaselineState,
  stoppedReason = "not_triggered",
): UtilityFallbackDiagnostics {
  return {
    triggered: false,
    baselineState,
    finalState: baselineState,
    maxExtraRuns: UTILITY_FALLBACK_MAX_EXTRA_RUNS,
    selected: [],
    selectionReasons: [],
    stoppedReason,
    ingestedCount: 0,
    newlyFetchedCount: 0,
    cachedReuseCount: 0,
    providerCalls: 0,
    pages: 0,
    pointsConsumed: null,
    costLedger: [],
    remainingEvidenceGaps: [],
    confidenceRationale: [],
  };
}

export function classifyUtilitySampleState(input: {
  coverage: {
    candidateRunCount?: number;
    compatibleEvidenceCount?: number;
    analyzedRunCount?: number;
    incompleteEvidenceCount?: number;
    missingMasterDataCount?: number;
    observedDomainCount?: number | null;
    skipReasons?: string[];
    notes?: string[];
  };
  shadow: UtilityShadowPassResult;
  gates?: UtilityPublicationGateConfig | null;
  expectedDungeonCount?: number;
  wclDataState?: string | null;
  rateBudgetAction?: "ALLOW" | "DEFER" | "STOP" | null;
  identityOrMatchFailure?: boolean;
  bundles?: WclRunEvidenceBundle[];
}): UtilityBaselineDiagnosticResult {
  const dungeonCount = new Set(
    (input.bundles ?? [])
      .filter((b) => b.dungeonSlug)
      .map((b) => b.dungeonSlug.trim().toLowerCase()),
  ).size;
  const attributableEvents =
    typeof input.shadow.score?.context?.attributableEvents === "number"
      ? input.shadow.score.context.attributableEvents
      : null;
  const observedDomainCount =
    input.coverage.observedDomainCount ??
    (input.shadow.score?.domainBreakdown ?? []).filter(
      (d) => d.applicable && (d.events ?? 0) > 0,
    ).length;

  return classifyUtilityBaselineFromShadowCoverage({
    coverage: {
      ...input.coverage,
      observedDomainCount,
    },
    shadowStatus: input.shadow.status,
    attributableEvents,
    confidence: input.shadow.score?.confidence ?? null,
    reliabilityAdjustedScore: input.shadow.score?.reliabilityAdjustedScore ?? null,
    dungeonCount,
    expectedDungeonCount: input.expectedDungeonCount,
    gates: input.gates,
    wclDataState: input.wclDataState,
    rateBudgetAction: input.rateBudgetAction,
    identityOrMatchFailure: input.identityOrMatchFailure,
    runDiagnostics: (input.bundles ?? []).map((b) => diagnoseUtilityBaselineRun(b)),
  });
}

/**
 * Deterministic candidate list for Utility fallback (excludes baseline report/fights).
 */
export function buildUtilityFallbackCandidateList(input: {
  baselineBundles: WclRunEvidenceBundle[];
  candidates: UtilityFallbackCandidateRun[];
}): UtilityFallbackCandidateRun[] {
  const baselineKeys = new Set(
    input.baselineBundles.map((b) => `${b.reportCode}:${b.fightId}`),
  );
  return input.candidates.map((c) => ({
    ...c,
    alreadyInBaseline:
      c.alreadyInBaseline || baselineKeys.has(`${c.reportCode}:${c.fightId}`),
  }));
}

export async function runUtilityFallbackEvidencePass(input: {
  baselineState: UtilityBaselineState;
  baselineBundles: WclRunEvidenceBundle[];
  baselineDungeonSlugs: string[];
  activeDungeonPool: string[];
  candidates: UtilityFallbackCandidateRun[];
  maxExtraRuns?: number;
  targetExtraCompleteRuns?: number;
  rateBudgetAction?: "ALLOW" | "DEFER" | "STOP" | null;
  wclDataState?: string | null;
  classSlug: string | null;
  specSlug: string | null;
  roleSlug: string | null;
  detailedWclEventCallsMade: number;
  gates?: UtilityPublicationGateConfig | null;
  expectedDungeonCount?: number;
  /** Injected ingest — keeps extra evidence inside this refresh only. */
  ingestExtraRun: (req: UtilityFallbackIngestRequest) => Promise<UtilityFallbackIngestResult>;
  /** Optional: re-check rate budget before each extra ingest. */
  checkRateBudget?: () => Promise<"ALLOW" | "DEFER" | "STOP">;
}): Promise<{
  bundles: WclRunEvidenceBundle[];
  shadow: UtilityShadowPassResult;
  baseline: UtilityBaselineDiagnosticResult;
  selection: UtilityFallbackSelectionResult;
  diagnostics: UtilityFallbackDiagnostics;
  detailedWclEventCallsMade: number;
}> {
  const maxExtraRuns = input.maxExtraRuns ?? UTILITY_FALLBACK_MAX_EXTRA_RUNS;
  const bundles = [...input.baselineBundles];
  let detailedCalls = input.detailedWclEventCallsMade;

  const rebuild = () => {
    const shadowInputs = buildUtilityShadowInputsFromBundles({
      bundles,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      roleSlug: input.roleSlug,
      detailedWclEventCallsMade: detailedCalls,
    });
    const shadow = runUtilityObservedShadowPass({
      mode: getUtilityPublicationMode(),
      hasPersistedSharedEvidence: shadowInputs.hasPersistedSharedEvidence,
      runs: shadowInputs.runs,
      rawByRunId: shadowInputs.rawByRunId,
      masterByReport: shadowInputs.masterByReport,
      opportunities: shadowInputs.opportunities,
      hostileCastEventsByRun: shadowInputs.hostileCastEventsByRun,
      detailedWclEventCallsMade: shadowInputs.detailedWclEventCallsMade,
    });
    const baseline = classifyUtilitySampleState({
      coverage: shadowInputs.coverage,
      shadow,
      gates: input.gates,
      expectedDungeonCount: input.expectedDungeonCount,
      wclDataState: input.wclDataState,
      rateBudgetAction: input.rateBudgetAction,
      bundles,
    });
    return { shadowInputs, shadow, baseline };
  };

  let { shadow, baseline } = rebuild();

  // Honour the caller's reviewed baseline gate (pipeline already classified).
  if (input.baselineState !== "INSUFFICIENT_EVIDENCE_RETRYABLE") {
    return {
      bundles,
      shadow,
      baseline:
        input.baselineState === baseline.state
          ? baseline
          : {
              ...baseline,
              state: input.baselineState,
              fallbackAllowed: false,
              publishable: input.baselineState === "PUBLISHABLE",
              completeZeroContribution:
                input.baselineState === "COMPLETE_ZERO_CONTRIBUTION",
            },
      selection: {
        selected: [],
        stoppedReason: "not_retryable",
        selectionReasons: [`baseline_state_${input.baselineState}_no_fallback`],
        maxExtraRuns,
      },
      diagnostics: emptyUtilityFallbackDiagnostics(input.baselineState, "not_retryable"),
      detailedWclEventCallsMade: detailedCalls,
    };
  }

  if (input.rateBudgetAction === "DEFER") {
    return {
      bundles,
      shadow,
      baseline: {
        ...baseline,
        state: "RATE_LIMITED",
        fallbackAllowed: false,
        publishable: false,
      },
      selection: {
        selected: [],
        stoppedReason: "rate_limited",
        selectionReasons: ["rate_budget_defer"],
        maxExtraRuns,
      },
      diagnostics: {
        ...emptyUtilityFallbackDiagnostics(input.baselineState, "rate_limited"),
        finalState: "RATE_LIMITED",
        remainingEvidenceGaps: baseline.reasons,
      },
      detailedWclEventCallsMade: detailedCalls,
    };
  }
  if (input.rateBudgetAction === "STOP") {
    return {
      bundles,
      shadow,
      baseline: {
        ...baseline,
        state: "BUDGET_EXHAUSTED",
        fallbackAllowed: false,
        publishable: false,
      },
      selection: {
        selected: [],
        stoppedReason: "budget",
        selectionReasons: ["rate_budget_stop"],
        maxExtraRuns,
      },
      diagnostics: {
        ...emptyUtilityFallbackDiagnostics(input.baselineState, "budget"),
        finalState: "BUDGET_EXHAUSTED",
        remainingEvidenceGaps: baseline.reasons,
      },
      detailedWclEventCallsMade: detailedCalls,
    };
  }

  const dataState = (input.wclDataState ?? "").toUpperCase();
  if (dataState === "NO_PUBLIC_LOGS" || dataState === "PRIVATE_SKIPPED") {
    return {
      bundles,
      shadow,
      baseline,
      selection: {
        selected: [],
        stoppedReason: "not_retryable",
        selectionReasons: [`wcl_data_state_${dataState.toLowerCase()}_no_fallback`],
        maxExtraRuns,
      },
      diagnostics: emptyUtilityFallbackDiagnostics(baseline.state, "no_public_logs"),
      detailedWclEventCallsMade: detailedCalls,
    };
  }

  if (!baseline.fallbackAllowed && baseline.state !== "INSUFFICIENT_EVIDENCE_RETRYABLE") {
    return {
      bundles,
      shadow,
      baseline,
      selection: {
        selected: [],
        stoppedReason: "not_retryable",
        selectionReasons: [`baseline_state_${baseline.state}_no_fallback`],
        maxExtraRuns,
      },
      diagnostics: emptyUtilityFallbackDiagnostics(baseline.state, "not_retryable"),
      detailedWclEventCallsMade: detailedCalls,
    };
  }

  const candidates = buildUtilityFallbackCandidateList({
    baselineBundles: bundles,
    candidates: input.candidates,
  });
  const selection = selectUtilityFallbackRuns({
    baselineState: "INSUFFICIENT_EVIDENCE_RETRYABLE",
    baselineDungeonSlugs: input.baselineDungeonSlugs,
    activeDungeonPool: input.activeDungeonPool,
    candidates,
    maxExtraRuns,
    targetExtraCompleteRuns:
      input.targetExtraCompleteRuns ?? baseline.estimatedExtraRunsToPublishable ?? maxExtraRuns,
  });

  const costLedger: UtilityFallbackCostLedgerEntry[] = [];
  const selectedMeta: UtilityFallbackDiagnostics["selected"] = [];
  let newlyFetchedCount = 0;
  let cachedReuseCount = 0;
  let providerCalls = 0;
  let pages = 0;
  let pointsConsumed: number | null = 0;
  let stoppedReason: string = selection.stoppedReason;
  let ingestedCount = 0;

  for (let i = 0; i < selection.selected.length; i += 1) {
    const candidate = selection.selected[i]!;
    if (input.checkRateBudget) {
      const action = await input.checkRateBudget();
      if (action === "DEFER") {
        stoppedReason = "rate_limited";
        break;
      }
      if (action === "STOP") {
        stoppedReason = "budget";
        break;
      }
    }

    const selectionReason =
      selection.selectionReasons[i] ??
      `fallback:${candidate.dungeonSlug}:${candidate.reportCode}:${candidate.fightId}`;
    selectedMeta.push({
      reportCode: candidate.reportCode,
      fightId: candidate.fightId,
      dungeonSlug: candidate.dungeonSlug,
      selectionReason,
    });

    const ingested = await input.ingestExtraRun({ candidate, selectionReason });
    if (!ingested.bundle) {
      costLedger.push({
        reportCode: candidate.reportCode,
        fightId: candidate.fightId,
        dungeonSlug: candidate.dungeonSlug,
        selectionReason,
        newlyFetched: false,
        providerCalls: 0,
        pages: 0,
        pointsConsumed: null,
        costSource: "unknown",
      });
      continue;
    }

    ingestedCount += 1;
    const bundle = ingested.bundle;
    const already = bundles.some(
      (b) => b.reportCode === bundle.reportCode && b.fightId === bundle.fightId,
    );
    if (!already) bundles.push(bundle);

    const newlyFetched = bundle.accounting.providerCalls > 0;
    if (newlyFetched) newlyFetchedCount += 1;
    else cachedReuseCount += 1;
    providerCalls += bundle.accounting.providerCalls;
    pages += bundle.accounting.pages;
    detailedCalls += bundle.accounting.providerCalls;
    if (bundle.accounting.pointsConsumed != null) {
      pointsConsumed = (pointsConsumed ?? 0) + bundle.accounting.pointsConsumed;
    } else if (pointsConsumed === 0) {
      pointsConsumed = null;
    }

    costLedger.push({
      reportCode: candidate.reportCode,
      fightId: candidate.fightId,
      dungeonSlug: candidate.dungeonSlug,
      selectionReason,
      newlyFetched,
      providerCalls: bundle.accounting.providerCalls,
      pages: bundle.accounting.pages,
      pointsConsumed: bundle.accounting.pointsConsumed,
      costSource: bundle.accounting.costSource,
    });

    ({ shadow, baseline } = rebuild());
    if (shouldStopUtilityFallback(baseline.state)) {
      stoppedReason =
        baseline.state === "PUBLISHABLE"
          ? "publishable_after_ingest"
          : baseline.completeZeroContribution
            ? "complete_zero_after_ingest"
            : `stopped_${baseline.state.toLowerCase()}`;
      break;
    }
  }

  if (selection.selected.length === 0) {
    stoppedReason = selection.stoppedReason;
  } else if (
    ingestedCount >= maxExtraRuns &&
    !shouldStopUtilityFallback(baseline.state)
  ) {
    stoppedReason = "cap_reached";
  }

  const diagnostics: UtilityFallbackDiagnostics = {
    triggered: true,
    baselineState: input.baselineState,
    finalState: baseline.state,
    maxExtraRuns,
    selected: selectedMeta,
    selectionReasons: selection.selectionReasons,
    stoppedReason,
    ingestedCount,
    newlyFetchedCount,
    cachedReuseCount,
    providerCalls,
    pages,
    pointsConsumed,
    costLedger,
    remainingEvidenceGaps: baseline.reasons,
    confidenceRationale: [
      `final_state=${baseline.state}`,
      `confidence01=${baseline.confidence01}`,
      `attributableEvents=${baseline.attributableEvents}`,
      `analyzedRunCount=${baseline.analyzedRunCount}`,
      `evidenceCoverage=${baseline.evidenceCoverage}`,
      ...baseline.absenceCauses.map((c) => `absence:${c}`),
    ],
  };

  return {
    bundles,
    shadow,
    baseline,
    selection,
    diagnostics,
    detailedWclEventCallsMade: detailedCalls,
  };
}
