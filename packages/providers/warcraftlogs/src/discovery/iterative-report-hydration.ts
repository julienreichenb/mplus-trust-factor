/**
 * Iterative fightUnknown hydration.
 *
 * The initial coverage-aware budget (24) is a first-pass sample only.
 * While any active dungeon lacks TARGET candidates and unhydrated stubs remain,
 * additional admitted batches continue until full coverage, report exhaustion,
 * rate DEFER/STOP, or provider error.
 *
 * Unknown stubs (dungeonSlug=null) cannot claim missing-dungeon-first selection;
 * they are exhausted via deterministic newest/oldest alternation across batches.
 */
import type { WclRunCandidate } from "../types.js";
import {
  INCREMENTAL_HYDRATION_BATCH_SIZE,
  INITIAL_HYDRATION_BUDGET,
  TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON,
} from "./bounds.js";
import {
  hydrateFightUnknownCandidates,
  type FetchReportForHydration,
  type HydrationCoverageDiagnostics,
  type HydrationHint,
  type OmittedHydrationReport,
  prioritizeReportsForHydration,
  roundRobinUnknownStubs,
} from "./report-hydration.js";

export type TerminalHydrationReason =
  | "full_coverage"
  | "reports_exhausted"
  | "rate_admission_defer"
  | "rate_admission_stop"
  | "provider_error"
  | "legacy_fixed_budget";

export type IncrementalAdmissionAction = "OK" | "WARN" | "DEFER" | "STOP";

export interface IncrementalAdmissionDecision {
  allow: boolean;
  action: IncrementalAdmissionAction;
  reasons: string[];
  projectedIncrementalPoints: number;
}

export interface IterativeHydrationDiagnostics {
  initialHydrationBudget: number;
  incrementalBatchSize: number;
  reportsHydratedInitial: number;
  incrementalBatchCount: number;
  reportsHydratedIncrementally: number;
  totalReportsHydrated: number;
  totalReportsListed: number;
  reportsRemaining: number;
  incrementalProviderCalls: number;
  incrementalEstimatedPoints: number;
  terminalHydrationReason: TerminalHydrationReason;
  /** Deterministic exploration order of unique stubs before fetches. */
  listedReportOrder: string[];
  /** Report codes attempted during the initial budget. */
  initialHydrationOrder: string[];
  omittedReports: OmittedHydrationReport[];
  coverage: HydrationCoverageDiagnostics;
  admissionReasons: string[];
}

function uniqueFightUnknownStubs(candidates: WclRunCandidate[]): WclRunCandidate[] {
  const byCode = new Map<string, WclRunCandidate>();
  for (const c of candidates) {
    if (!c.reportCode || !c.incompleteness.fightUnknown) continue;
    if (!byCode.has(c.reportCode)) byCode.set(c.reportCode, c);
  }
  return [...byCode.values()];
}

function remainingUnknownCodes(candidates: WclRunCandidate[]): string[] {
  return uniqueFightUnknownStubs(candidates).map((s) => s.reportCode);
}

function isFullCoverage(
  coverage: HydrationCoverageDiagnostics | null,
  activeSlugs: readonly string[],
  targetPerDungeon: number,
): boolean {
  if (!coverage) return false;
  if (coverage.targetCoverageReached) return true;
  if (activeSlugs.length === 0) return false;
  return activeSlugs.every(
    (slug) =>
      (coverage.distinctCandidatesPerDungeon[slug.trim().toLowerCase()] ?? 0) >=
      targetPerDungeon,
  );
}

/**
 * Deterministic exploration order for stubs across batches.
 */
export function orderStubsForIterativeHydration(
  stubs: WclRunCandidate[],
  hints: HydrationHint[],
  coverage?: ReadonlyMap<string, ReadonlySet<string>>,
  targetPerDungeon = TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON,
): WclRunCandidate[] {
  const unique = uniqueFightUnknownStubs(stubs);
  if (coverage && coverage.size > 0) {
    return prioritizeReportsForHydration(unique, hints, Number.MAX_SAFE_INTEGER, {
      coverage,
      targetCandidatesPerDungeon: targetPerDungeon,
    });
  }
  return roundRobinUnknownStubs(unique);
}

/**
 * Progressive hydration: initial budget, then incremental admitted batches.
 * Already-hydrated reports become fightUnknown=false and are never re-fetched.
 */
export async function hydrateFightUnknownCandidatesIterative(input: {
  candidates: WclRunCandidate[];
  characterName: string;
  realmSlug: string;
  hints?: HydrationHint[];
  activeDungeonSlugs: readonly string[];
  initialBudget?: number;
  incrementalBatchSize?: number;
  pointsPerHydrationReport?: number;
  fetchReport: FetchReportForHydration;
  evaluateIncrementalAdmission: (input: {
    batchSize: number;
    projectedIncrementalPoints: number;
    reportsHydratedSoFar: number;
    reportsRemaining: number;
  }) => Promise<IncrementalAdmissionDecision> | IncrementalAdmissionDecision;
  targetCandidatesPerDungeon?: number;
}): Promise<{
  candidates: WclRunCandidate[];
  hydratedReportCount: number;
  rejectedReasons: string[];
  diagnostics: IterativeHydrationDiagnostics;
}> {
  const hints = input.hints ?? [];
  const initialBudget = input.initialBudget ?? INITIAL_HYDRATION_BUDGET;
  const batchSize = input.incrementalBatchSize ?? INCREMENTAL_HYDRATION_BATCH_SIZE;
  const pointsPer = input.pointsPerHydrationReport ?? 3;
  const targetPerDungeon =
    input.targetCandidatesPerDungeon ?? TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON;
  const activeSlugs = input.activeDungeonSlugs.map((s) => s.trim().toLowerCase());

  const initialStubs = uniqueFightUnknownStubs(input.candidates);
  const listedOrder = orderStubsForIterativeHydration(initialStubs, hints).map(
    (s) => s.reportCode,
  );
  const stubMeta = new Map(
    initialStubs.map((s) => [
      s.reportCode,
      { dungeonSlug: s.dungeonSlug ?? null, startTimeMs: s.startTimeMs ?? null },
    ]),
  );

  let workingCandidates = [...input.candidates];
  let reportsHydratedInitial = 0;
  let reportsHydratedIncrementally = 0;
  let incrementalBatchCount = 0;
  let incrementalProviderCalls = 0;
  let incrementalEstimatedPoints = 0;
  let rejectedReasons: string[] = [];
  let lastCoverage: HydrationCoverageDiagnostics | null = null;
  let terminalHydrationReason: TerminalHydrationReason = "reports_exhausted";
  let admissionReasons: string[] = [];
  const initialHydrationOrder: string[] = [];
  const allAttempted = new Set<string>();

  const runBatch = async (maxReports: number, phase: "initial" | "incremental") => {
    const result = await hydrateFightUnknownCandidates({
      candidates: workingCandidates,
      characterName: input.characterName,
      realmSlug: input.realmSlug,
      hints,
      activeDungeonSlugs: activeSlugs,
      targetCandidatesPerDungeon: targetPerDungeon,
      maxReports,
      fetchReport: async (code) => {
        allAttempted.add(code);
        if (phase === "initial") initialHydrationOrder.push(code);
        return input.fetchReport(code);
      },
    });
    workingCandidates = result.candidates;
    rejectedReasons = [...rejectedReasons, ...result.rejectedReasons].slice(0, 80);
    lastCoverage = result.diagnostics;
    if (phase === "initial") {
      reportsHydratedInitial += result.diagnostics.reportFetchAttempts;
    } else {
      reportsHydratedIncrementally += result.diagnostics.reportFetchAttempts;
      incrementalProviderCalls += result.diagnostics.reportFetchAttempts;
      incrementalEstimatedPoints += result.diagnostics.reportFetchAttempts * pointsPer;
    }
    return result;
  };

  try {
    await runBatch(initialBudget, "initial");
  } catch {
    return finish("provider_error");
  }

  while (true) {
    if (isFullCoverage(lastCoverage, activeSlugs, targetPerDungeon)) {
      return finish("full_coverage");
    }
    const remaining = remainingUnknownCodes(workingCandidates);
    if (remaining.length === 0) {
      return finish("reports_exhausted");
    }

    const thisBatch = Math.min(batchSize, remaining.length);
    const projectedIncrementalPoints = thisBatch * pointsPer;
    const decision = await input.evaluateIncrementalAdmission({
      batchSize: thisBatch,
      projectedIncrementalPoints,
      reportsHydratedSoFar: allAttempted.size,
      reportsRemaining: remaining.length,
    });
    admissionReasons = [...decision.reasons];
    if (!decision.allow) {
      return finish(
        decision.action === "STOP" ? "rate_admission_stop" : "rate_admission_defer",
      );
    }

    incrementalBatchCount += 1;
    const attemptedBefore = allAttempted.size;
    try {
      // Only remaining fightUnknown stubs are eligible; maxReports bounds this batch.
      await runBatch(thisBatch, "incremental");
    } catch {
      return finish("provider_error");
    }
    if (allAttempted.size === attemptedBefore) {
      // No progress — avoid infinite loop.
      return finish("reports_exhausted");
    }
  }

  function finish(reason: TerminalHydrationReason) {
    terminalHydrationReason = reason;
    const remaining = remainingUnknownCodes(workingCandidates);
    const omittedReports: OmittedHydrationReport[] = remaining.map((code) => {
      const meta = stubMeta.get(code);
      let omissionReason: OmittedHydrationReport["reason"] =
        "REPORT_LEFT_UNHYDRATED_NO_MORE_BUDGET";
      if (reason === "full_coverage") {
        omissionReason = "REPORT_ALREADY_COVERED_DUNGEON_DEFERRED";
      } else if (
        reason === "rate_admission_defer" ||
        reason === "rate_admission_stop"
      ) {
        omissionReason = "REPORT_LEFT_UNHYDRATED_NO_MORE_BUDGET";
      } else if (incrementalBatchCount === 0 && reason !== "reports_exhausted") {
        omissionReason = "REPORT_EXCLUDED_BY_HYDRATION_CAP";
      }
      return {
        reportCode: code,
        reason: omissionReason,
        dungeonSlug: meta?.dungeonSlug ?? null,
        startTimeMs: meta?.startTimeMs ?? null,
        listedOrderIndex: listedOrder.indexOf(code),
      };
    });

    const coverage: HydrationCoverageDiagnostics = lastCoverage
      ? {
          ...lastCoverage,
          recentReportsDiscovered: listedOrder.length,
          reportFetchAttempts: allAttempted.size,
          reportsConsideredForHydration: allAttempted.size,
          reportsHydrated: reportsHydratedInitial + reportsHydratedIncrementally,
          // reportFetchAttempts tracks attempts; reportsHydrated in lastCoverage is successes.
          // Prefer attempt totals for operator "hydrated" budget accounting:
          reportsLeftUnhydratedBudget: remaining.length,
          omittedReports,
          targetCoverageReached: reason === "full_coverage",
          stopReason:
            reason === "full_coverage"
              ? "full_coverage"
              : reason === "reports_exhausted"
                ? "no_more_reports"
                : "budget_exhausted",
        }
      : {
          recentReportsDiscovered: listedOrder.length,
          reportsConsideredForHydration: allAttempted.size,
          reportFetchAttempts: allAttempted.size,
          reportsHydrated: reportsHydratedInitial + reportsHydratedIncrementally,
          reportsFailedOrEmpty: 0,
          reportsLeftUnhydratedBudget: remaining.length,
          candidatesProducedPerDungeon: {},
          distinctCandidatesPerDungeon: {},
          targetCandidatesPerDungeon: targetPerDungeon,
          targetCoverageReached: reason === "full_coverage",
          stopReason: "budget_exhausted",
          rejectionCountsByReason: {},
          omittedReports,
        };

    // Operator-facing hydrated counts use successful payloads when available.
    const successHydrated =
      (lastCoverage?.reportsHydrated ?? 0) > 0
        ? // lastCoverage.reportsHydrated is only the last batch — sum via attempts proxy
          reportsHydratedInitial + reportsHydratedIncrementally
        : reportsHydratedInitial + reportsHydratedIncrementally;

    return {
      candidates: workingCandidates,
      hydratedReportCount: successHydrated,
      rejectedReasons,
      diagnostics: {
        initialHydrationBudget: initialBudget,
        incrementalBatchSize: batchSize,
        reportsHydratedInitial,
        incrementalBatchCount,
        reportsHydratedIncrementally,
        totalReportsHydrated: successHydrated,
        totalReportsListed: listedOrder.length,
        reportsRemaining: remaining.length,
        incrementalProviderCalls,
        incrementalEstimatedPoints,
        terminalHydrationReason,
        listedReportOrder: listedOrder,
        initialHydrationOrder,
        omittedReports,
        coverage,
        admissionReasons,
      },
    };
  }
}
