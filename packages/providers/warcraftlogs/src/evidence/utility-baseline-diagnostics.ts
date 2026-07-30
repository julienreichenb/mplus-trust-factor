/**
 * Utility baseline audit diagnostics (Agent 06).
 *
 * Pure classification + fallback selection policy for the shared-run sample.
 * Does not fetch WCL, mutate scores, or trigger fallback — Agent 07 wires this
 * into refresh after taxonomy review.
 *
 * Only INSUFFICIENT_EVIDENCE_RETRYABLE should normally trigger extra-run fallback.
 */
import {
  SURVIVAL_EVIDENCE_CONSUMERS,
  UTILITY_EVIDENCE_CONSUMERS,
  type SharedEvidenceDatasetKey,
  type WclRunEvidenceBundle,
} from "./wcl-run-evidence-types.js";
import { utilityEvidencePresentInBundle } from "./utility-from-shared-evidence.js";
import {
  MODEL_V6_UTILITY_PUBLICATION_GATES,
  normalizeUtilityConfidence,
  type UtilityPublicationGateConfig,
} from "../probe/utility-publication-eligibility.js";
import { CONSERVATIVE_POINTS_PER_EVENT_PAGE } from "./wcl-batch-cost-accounting.js";

/** Explicit baseline publication / failure states (programme contract). */
export const UTILITY_BASELINE_STATES = [
  "PUBLISHABLE",
  "COMPLETE_ZERO_CONTRIBUTION",
  "INSUFFICIENT_EVIDENCE_RETRYABLE",
  "WCL_UNAVAILABLE",
  "RATE_LIMITED",
  "BUDGET_EXHAUSTED",
  "NO_PUBLIC_LOGS",
  "IDENTITY_OR_MATCH_FAILURE",
] as const;

export type UtilityBaselineState = (typeof UTILITY_BASELINE_STATES)[number];

/** Datasets Utility needs that Survival-only ingest does not fetch. */
export const UTILITY_ONLY_DATASET_KEYS: SharedEvidenceDatasetKey[] = UTILITY_EVIDENCE_CONSUMERS.filter(
  (k) => !SURVIVAL_EVIDENCE_CONSUMERS.includes(k),
);

/** Datasets shared by Survival and Utility consumers. */
export const UTILITY_SURVIVAL_OVERLAP_DATASET_KEYS: SharedEvidenceDatasetKey[] =
  UTILITY_EVIDENCE_CONSUMERS.filter((k) => SURVIVAL_EVIDENCE_CONSUMERS.includes(k));

export const UTILITY_BASELINE_DIAGNOSTIC_SCHEMA_VERSION = "1.0.0";
export const UTILITY_BASELINE_DIAGNOSTIC_ANALYSIS_VERSION = "utility-baseline-diagnostics-v1";

/** Conservative request-cost model used for planning (never coerce unknown→0 at runtime). */
export const UTILITY_BASELINE_REQUEST_COST_TABLE = {
  schemaVersion: "1.0.0",
  unit: "wcl_points_conservative_estimate",
  notes: [
    "Prefer measured rateLimitData delta / per-request costUnits when available.",
    "Conservative fallback: 1 point per event page (CONSERVATIVE_POINTS_PER_EVENT_PAGE).",
    "Survival-parity ingest uses maxPages=200; Utility-only probe defaults maxPages=12.",
    "Shared ingest with consumers=[survival,utility] fetches the union once — Utility-only datasets are the incremental cost when Survival already ran.",
  ],
  rows: [
    {
      operation: "masterData",
      typicalRequests: 1,
      typicalPages: 1,
      conservativePoints: CONSERVATIVE_POINTS_PER_EVENT_PAGE,
      notes: "Often reusable across fights in the same report revision.",
    },
    {
      operation: "Casts (Friendlies)",
      typicalRequests: "1–N pages",
      typicalPages: "1–8",
      conservativePointsPerPage: CONSERVATIVE_POINTS_PER_EVENT_PAGE,
      notes: "Shared with Survival; usually already present on dual-consumer ingest.",
    },
    {
      operation: "HostileCasts (Enemies)",
      typicalRequests: "1–N pages",
      typicalPages: "2–20+",
      conservativePointsPerPage: CONSERVATIVE_POINTS_PER_EVENT_PAGE,
      notes: "Utility-only; often the largest incremental cost vs Survival.",
    },
    {
      operation: "Interrupts",
      typicalRequests: "1–3 pages",
      typicalPages: "1–3",
      conservativePointsPerPage: CONSERVATIVE_POINTS_PER_EVENT_PAGE,
      notes: "Utility-only; sourceId=null (party-wide).",
    },
    {
      operation: "Dispels",
      typicalRequests: "1–2 pages",
      typicalPages: "1–2",
      conservativePointsPerPage: CONSERVATIVE_POINTS_PER_EVENT_PAGE,
      notes: "Utility-only; sourceId=null.",
    },
    {
      operation: "DamageDone",
      typicalRequests: "1–N pages",
      typicalPages: "1–10",
      conservativePointsPerPage: CONSERVATIVE_POINTS_PER_EVENT_PAGE,
      notes: "Utility-only; used for hostile validation / attribution context.",
    },
    {
      operation: "Deaths / Buffs / Debuffs / CombatantInfo",
      typicalRequests: "1–N pages each",
      typicalPages: "1–4 each",
      conservativePointsPerPage: CONSERVATIVE_POINTS_PER_EVENT_PAGE,
      notes: "Overlap with Survival when dual-consumer ingest ran.",
    },
    {
      operation: "full dual-consumer run (cold)",
      typicalRequests: "≈10–40+",
      typicalPages: "≈10–40+",
      conservativePoints: "pages × 1 (estimated)",
      notes: "One shared bundle for Survival+Utility; second compatible refresh → 0 provider calls.",
    },
    {
      operation: "Utility-only gap fill after Survival-only cache",
      typicalRequests: "4 datasets × pages",
      typicalPages: "HostileCasts + Interrupts + Dispels + DamageDone",
      conservativePoints: "sum of Utility-only pages",
      notes: "Survival-only bundles cannot satisfy Utility without these fetches.",
    },
    {
      operation: "fallback extra run (max 4)",
      typicalRequests: "same as cold dual-consumer when uncached",
      typicalPages: "same as cold run",
      conservativePoints: "per extra run; stop when publishable",
      notes: "Prefer runs predicted to reuse report revision / persisted datasets.",
    },
  ],
} as const;

export type UtilityEvidenceAbsenceCause =
  | "no_public_report"
  | "report_matching_failed"
  | "actor_resolution_failed"
  | "event_pagination_truncation"
  | "wrong_event_types_queried"
  | "unsupported_spell_catalog"
  | "truly_zero_observed_contribution"
  | "rate_or_budget_stop"
  | "cache_incompatibility"
  | "incomplete_utility_datasets"
  | "survival_only_bundle"
  | "unknown";

export interface UtilityBaselineRunDiagnostic {
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  reportRevision: number | null;
  playerActorId: number | null;
  evidenceComplete: boolean;
  missingDatasets: SharedEvidenceDatasetKey[];
  truncatedDatasets: SharedEvidenceDatasetKey[];
  providerCalls: number;
  pages: number;
  pointsConsumed: number | null;
  costSource: "measured" | "estimated" | "unknown";
  persistedHits: number;
  cacheHits: number;
  absenceCauses: UtilityEvidenceAbsenceCause[];
  selectionReason?: string | null;
}

export interface UtilityBaselineDiagnosticInput {
  /** Selected baseline runs (canonical shared sample). */
  candidateRunCount: number;
  /** Bundles with complete Utility datasets + masterData. */
  compatibleEvidenceCount: number;
  /** Runs that produced normalized Utility inputs. */
  analyzedRunCount: number;
  incompleteEvidenceCount?: number;
  missingMasterDataCount?: number;
  /** Distinct dungeons represented in analyzed sample. */
  dungeonCount?: number;
  /** Expected active-season dungeon pool size (default 8). */
  expectedDungeonCount?: number;
  attributableEvents?: number | null;
  observedDomainCount?: number | null;
  applicableDomainCount?: number | null;
  confidence?: number | null;
  reliabilityAdjustedScore?: number | null;
  shadowStatus?: string | null;
  gates?: UtilityPublicationGateConfig | null;
  /** Character / discovery level. */
  wclDataState?: string | null;
  rateBudgetAction?: "ALLOW" | "DEFER" | "STOP" | null;
  identityOrMatchFailure?: boolean;
  skipReasons?: string[];
  notes?: string[];
  runDiagnostics?: UtilityBaselineRunDiagnostic[];
}

export interface UtilityBaselineDiagnosticResult {
  schemaVersion: typeof UTILITY_BASELINE_DIAGNOSTIC_SCHEMA_VERSION;
  analysisVersion: typeof UTILITY_BASELINE_DIAGNOSTIC_ANALYSIS_VERSION;
  state: UtilityBaselineState;
  /** True only for INSUFFICIENT_EVIDENCE_RETRYABLE. */
  fallbackAllowed: boolean;
  publishable: boolean;
  /** Neutral 50 + low confidence path — must not fallback. */
  completeZeroContribution: boolean;
  evidenceCoverage: number;
  confidence01: number;
  analyzedRunCount: number;
  compatibleEvidenceCount: number;
  candidateRunCount: number;
  observedDomainCount: number;
  attributableEvents: number;
  absenceCauses: UtilityEvidenceAbsenceCause[];
  missingUtilityOnlyDatasets: SharedEvidenceDatasetKey[];
  survivalBundleCanSatisfyUtility: boolean;
  estimatedExtraRunsToPublishable: number | null;
  reasons: string[];
  gates: UtilityPublicationGateConfig;
}

/**
 * Whether a Survival-only evidence bundle already includes Utility-required streams.
 * Dual-consumer ingest (includeUtilityDatasets) → true when complete; Survival-only → false.
 */
export function survivalBundleSatisfiesUtility(bundle: WclRunEvidenceBundle): boolean {
  return utilityEvidencePresentInBundle(bundle).complete;
}

export function classifyUtilityEvidenceAbsence(input: {
  bundle?: WclRunEvidenceBundle | null;
  skipReasons?: string[];
  notes?: string[];
  wclDataState?: string | null;
  rateBudgetAction?: "ALLOW" | "DEFER" | "STOP" | null;
  identityOrMatchFailure?: boolean;
}): UtilityEvidenceAbsenceCause[] {
  const causes = new Set<UtilityEvidenceAbsenceCause>();
  const hay = [...(input.skipReasons ?? []), ...(input.notes ?? [])].join(" ").toLowerCase();
  const dataState = (input.wclDataState ?? "").toUpperCase();

  if (dataState === "NO_PUBLIC_LOGS" || hay.includes("no_public")) {
    causes.add("no_public_report");
  }
  if (
    input.identityOrMatchFailure ||
    hay.includes("report_match") ||
    hay.includes("matching_failed") ||
    hay.includes("wcl_report_matched\":false")
  ) {
    causes.add("report_matching_failed");
  }
  if (
    hay.includes("actor_attribution_failed") ||
    hay.includes("missing_player_actor") ||
    hay.includes("identity")
  ) {
    causes.add("actor_resolution_failed");
  }
  if (input.rateBudgetAction === "STOP" || input.rateBudgetAction === "DEFER") {
    causes.add("rate_or_budget_stop");
  }
  if (hay.includes("rate_limit") || hay.includes("budget")) {
    causes.add("rate_or_budget_stop");
  }
  if (
    hay.includes("incompatible") ||
    hay.includes("revision_mismatch") ||
    hay.includes("stale_revision") ||
    hay.includes("cache")
  ) {
    causes.add("cache_incompatibility");
  }
  if (hay.includes("unsupported_class") || hay.includes("unsupported_spec") || hay.includes("catalog")) {
    causes.add("unsupported_spell_catalog");
  }
  if (hay.includes("wrong_event") || hay.includes("hostilitytype")) {
    causes.add("wrong_event_types_queried");
  }

  if (input.bundle) {
    const check = utilityEvidencePresentInBundle(input.bundle);
    if (!check.complete) {
      causes.add("incomplete_utility_datasets");
      const missingUtilityOnly = check.missing.filter((k) =>
        UTILITY_ONLY_DATASET_KEYS.includes(k),
      );
      if (missingUtilityOnly.length > 0 && check.missing.every((k) => UTILITY_ONLY_DATASET_KEYS.includes(k) || k === "masterData")) {
        causes.add("survival_only_bundle");
      }
    }
    const truncated = Object.values(input.bundle.eventDatasets)
      .filter((ds): ds is NonNullable<typeof ds> => ds != null && ds.truncated)
      .map((ds) => ds.key);
    if (truncated.length > 0) {
      causes.add("event_pagination_truncation");
    }
  }

  if (causes.size === 0) causes.add("unknown");
  return [...causes];
}

function meetsPublicationGates(input: {
  analyzedRunCount: number;
  confidence01: number;
  evidenceCoverage: number;
  observedDomainCount: number;
  gates: UtilityPublicationGateConfig;
}): boolean {
  return (
    input.analyzedRunCount >= input.gates.minAnalyzedRuns &&
    input.confidence01 >= input.gates.minConfidence &&
    input.evidenceCoverage >= input.gates.minEvidenceCoverage &&
    input.observedDomainCount >= input.gates.minObservedDomains
  );
}

/**
 * Classify the baseline shared-run sample into an explicit Utility baseline state.
 *
 * Precedence (hard failures first):
 * 1. NO_PUBLIC_LOGS / RATE_LIMITED / BUDGET_EXHAUSTED / WCL_UNAVAILABLE / IDENTITY_OR_MATCH_FAILURE
 * 2. COMPLETE_ZERO_CONTRIBUTION (complete analyzable sample, zero attributable events)
 * 3. PUBLISHABLE (gates met, attributable events > 0 OR observed domains satisfy gates)
 * 4. INSUFFICIENT_EVIDENCE_RETRYABLE (otherwise, when extra runs could help)
 */
export function classifyUtilityBaselineState(
  input: UtilityBaselineDiagnosticInput,
): UtilityBaselineDiagnosticResult {
  const gates = input.gates ?? MODEL_V6_UTILITY_PUBLICATION_GATES;
  const candidateRunCount = Math.max(0, input.candidateRunCount);
  const compatibleEvidenceCount = Math.max(0, input.compatibleEvidenceCount);
  const analyzedRunCount = Math.max(0, input.analyzedRunCount);
  const evidenceCoverage =
    candidateRunCount === 0 ? 0 : compatibleEvidenceCount / candidateRunCount;
  const confidence01 = normalizeUtilityConfidence(input.confidence);
  const attributableEvents = Math.max(0, input.attributableEvents ?? 0);
  const observedDomainCount = Math.max(0, input.observedDomainCount ?? 0);
  const expectedDungeonCount = input.expectedDungeonCount ?? 8;
  const reasons: string[] = [];
  const absenceCauses = new Set<UtilityEvidenceAbsenceCause>(
    classifyUtilityEvidenceAbsence({
      skipReasons: input.skipReasons,
      notes: input.notes,
      wclDataState: input.wclDataState,
      rateBudgetAction: input.rateBudgetAction,
      identityOrMatchFailure: input.identityOrMatchFailure,
    }),
  );

  const missingUtilityOnly = new Set<SharedEvidenceDatasetKey>();
  for (const run of input.runDiagnostics ?? []) {
    for (const m of run.missingDatasets) {
      if (UTILITY_ONLY_DATASET_KEYS.includes(m)) missingUtilityOnly.add(m);
    }
    for (const c of run.absenceCauses) absenceCauses.add(c);
  }

  const dataState = (input.wclDataState ?? "").toUpperCase();
  let state: UtilityBaselineState;
  let estimatedExtraRunsToPublishable: number | null = null;

  if (dataState === "NO_PUBLIC_LOGS") {
    state = "NO_PUBLIC_LOGS";
    reasons.push("wcl_data_state_no_public_logs");
  } else if (dataState === "RATE_LIMITED" || input.rateBudgetAction === "DEFER") {
    state = "RATE_LIMITED";
    reasons.push("wcl_rate_limited_or_deferred");
  } else if (input.rateBudgetAction === "STOP") {
    state = "BUDGET_EXHAUSTED";
    reasons.push("wcl_rate_budget_stop");
  } else if (
    dataState === "UNAVAILABLE" ||
    dataState === "WCL_UNAVAILABLE" ||
    dataState === "PRIVATE_SKIPPED"
  ) {
    state = "WCL_UNAVAILABLE";
    reasons.push(`wcl_data_state_${dataState.toLowerCase()}`);
  } else if (input.identityOrMatchFailure === true) {
    state = "IDENTITY_OR_MATCH_FAILURE";
    reasons.push("identity_or_report_match_failure");
  } else if (
    analyzedRunCount >= gates.minAnalyzedRuns &&
    evidenceCoverage >= gates.minEvidenceCoverage &&
    attributableEvents === 0 &&
    (input.shadowStatus === "SHADOW_SCORED" || analyzedRunCount > 0)
  ) {
    // Complete analyzable sample with zero attributable positives — publish neutral, no fallback.
    state = "COMPLETE_ZERO_CONTRIBUTION";
    reasons.push("complete_sample_zero_attributable_events");
    absenceCauses.add("truly_zero_observed_contribution");
  } else if (
    meetsPublicationGates({
      analyzedRunCount,
      confidence01,
      evidenceCoverage,
      observedDomainCount,
      gates,
    }) &&
    attributableEvents > 0
  ) {
    state = "PUBLISHABLE";
    reasons.push("publication_gates_met");
  } else if (
    meetsPublicationGates({
      analyzedRunCount,
      confidence01,
      evidenceCoverage,
      observedDomainCount,
      gates,
    })
  ) {
    // Gates met but zero events — still complete-zero (confidence may be capped ≤35).
    state = "COMPLETE_ZERO_CONTRIBUTION";
    reasons.push("gates_met_but_zero_attributable");
    absenceCauses.add("truly_zero_observed_contribution");
  } else {
    state = "INSUFFICIENT_EVIDENCE_RETRYABLE";
    if (analyzedRunCount < gates.minAnalyzedRuns) {
      reasons.push("insufficient_analyzed_runs");
    }
    if (evidenceCoverage < gates.minEvidenceCoverage) {
      reasons.push("insufficient_evidence_coverage");
    }
    if (confidence01 < gates.minConfidence && attributableEvents > 0) {
      reasons.push("insufficient_confidence");
    }
    if (observedDomainCount < gates.minObservedDomains && attributableEvents > 0) {
      reasons.push("insufficient_observed_domains");
    }
    if (candidateRunCount === 0) {
      reasons.push("no_baseline_candidate_runs");
    }

    const runsShort = Math.max(0, gates.minAnalyzedRuns - analyzedRunCount);
    const coverageShort =
      evidenceCoverage < gates.minEvidenceCoverage
        ? Math.ceil(gates.minEvidenceCoverage * Math.max(candidateRunCount, expectedDungeonCount)) -
          compatibleEvidenceCount
        : 0;
    const dungeonGap = Math.max(
      0,
      (input.dungeonCount != null ? expectedDungeonCount - input.dungeonCount : 0),
    );
    estimatedExtraRunsToPublishable = Math.min(
      4,
      Math.max(runsShort, coverageShort, dungeonGap > 0 ? Math.min(dungeonGap, 4) : 0, 1),
    );
  }

  const completeZeroContribution = state === "COMPLETE_ZERO_CONTRIBUTION";
  const publishable = state === "PUBLISHABLE" || completeZeroContribution;
  const fallbackAllowed = state === "INSUFFICIENT_EVIDENCE_RETRYABLE";

  // Survival-only bundles never satisfy Utility without Utility-only datasets.
  const survivalBundleCanSatisfyUtility =
    missingUtilityOnly.size === 0 &&
    compatibleEvidenceCount > 0 &&
    !absenceCauses.has("survival_only_bundle");

  return {
    schemaVersion: UTILITY_BASELINE_DIAGNOSTIC_SCHEMA_VERSION,
    analysisVersion: UTILITY_BASELINE_DIAGNOSTIC_ANALYSIS_VERSION,
    state,
    fallbackAllowed,
    publishable,
    completeZeroContribution,
    evidenceCoverage,
    confidence01,
    analyzedRunCount,
    compatibleEvidenceCount,
    candidateRunCount,
    observedDomainCount,
    attributableEvents,
    absenceCauses: [...absenceCauses],
    missingUtilityOnlyDatasets: [...missingUtilityOnly],
    survivalBundleCanSatisfyUtility,
    estimatedExtraRunsToPublishable,
    reasons,
    gates,
  };
}

export interface UtilityFallbackCandidateRun {
  dungeonSlug: string;
  reportCode: string;
  fightId: number;
  reportRevision: number | null;
  /** Prefer higher scores. */
  scoreValue?: number | null;
  completedAt?: string | null;
  hasPublicReport: boolean;
  alreadyInBaseline: boolean;
  /** Predicted persisted Utility datasets available (0 WCL). */
  predictedUtilityEvidenceComplete?: boolean;
  predictedProviderCalls?: number | null;
}

export interface UtilityFallbackSelectionResult {
  selected: UtilityFallbackCandidateRun[];
  stoppedReason:
    | "not_retryable"
    | "no_candidates"
    | "cap_reached"
    | "publishable_after_selection"
    | "budget"
    | "rate_limited";
  selectionReasons: string[];
  maxExtraRuns: number;
}

/**
 * Deterministic fallback run selection (Agent 07 wiring).
 * Prefer missing/underrepresented dungeons; one extra per dungeon before duplicating;
 * prefer predicted complete/cached evidence; cap at maxExtraRuns (default 4).
 */
export function selectUtilityFallbackRuns(input: {
  baselineState: UtilityBaselineState;
  baselineDungeonSlugs: string[];
  activeDungeonPool: string[];
  candidates: UtilityFallbackCandidateRun[];
  maxExtraRuns?: number;
  /** Stop planning once this many additional complete runs are selected. */
  targetExtraCompleteRuns?: number;
}): UtilityFallbackSelectionResult {
  const maxExtraRuns = input.maxExtraRuns ?? 4;
  const selectionReasons: string[] = [];

  if (input.baselineState !== "INSUFFICIENT_EVIDENCE_RETRYABLE") {
    return {
      selected: [],
      stoppedReason: "not_retryable",
      selectionReasons: [`baseline_state_${input.baselineState}_no_fallback`],
      maxExtraRuns,
    };
  }

  const baselineSet = new Set(input.baselineDungeonSlugs);
  const selectedDungeonCount = new Map<string, number>();
  for (const d of input.baselineDungeonSlugs) {
    selectedDungeonCount.set(d, (selectedDungeonCount.get(d) ?? 0) + 1);
  }

  const pool = new Set(input.activeDungeonPool);
  const eligible = input.candidates.filter(
    (c) =>
      c.hasPublicReport &&
      !c.alreadyInBaseline &&
      (pool.size === 0 || pool.has(c.dungeonSlug)),
  );

  if (eligible.length === 0) {
    return {
      selected: [],
      stoppedReason: "no_candidates",
      selectionReasons: ["no_public_fallback_candidates"],
      maxExtraRuns,
    };
  }

  const rank = (c: UtilityFallbackCandidateRun): number[] => {
    const missingDungeon = baselineSet.has(c.dungeonSlug) ? 0 : 1;
    const underrepresented = (selectedDungeonCount.get(c.dungeonSlug) ?? 0) === 0 ? 1 : 0;
    const cached = c.predictedUtilityEvidenceComplete ? 1 : 0;
    const lowCost =
      c.predictedProviderCalls == null
        ? 0
        : Math.max(0, 100 - c.predictedProviderCalls);
    const score = c.scoreValue ?? 0;
    const completedAt = c.completedAt ? Date.parse(c.completedAt) || 0 : 0;
    // Lexicographic: missing dungeon > underrepresented > cached > low cost > score > recent
    return [missingDungeon, underrepresented, cached, lowCost, score, completedAt];
  };

  const sorted = [...eligible].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) {
      if (rb[i]! !== ra[i]!) return rb[i]! - ra[i]!;
    }
    // Stable tie-break
    const keyA = `${a.reportCode}:${a.fightId}`;
    const keyB = `${b.reportCode}:${b.fightId}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const selected: UtilityFallbackCandidateRun[] = [];
  const target = input.targetExtraCompleteRuns ?? maxExtraRuns;

  // Pass 1: at most one extra per dungeon.
  for (const c of sorted) {
    if (selected.length >= maxExtraRuns || selected.length >= target) break;
    if ((selectedDungeonCount.get(c.dungeonSlug) ?? 0) >= 1) continue;
    selected.push(c);
    selectedDungeonCount.set(c.dungeonSlug, (selectedDungeonCount.get(c.dungeonSlug) ?? 0) + 1);
    selectionReasons.push(
      `pass1_missing_or_first_extra:${c.dungeonSlug}:${c.reportCode}:${c.fightId}`,
    );
  }

  // Pass 2: allow a second from same dungeon only after all dungeons considered.
  if (selected.length < maxExtraRuns && selected.length < target) {
    for (const c of sorted) {
      if (selected.length >= maxExtraRuns || selected.length >= target) break;
      if (selected.some((s) => s.reportCode === c.reportCode && s.fightId === c.fightId)) {
        continue;
      }
      if ((selectedDungeonCount.get(c.dungeonSlug) ?? 0) >= 2) continue;
      selected.push(c);
      selectedDungeonCount.set(c.dungeonSlug, (selectedDungeonCount.get(c.dungeonSlug) ?? 0) + 1);
      selectionReasons.push(
        `pass2_second_from_dungeon:${c.dungeonSlug}:${c.reportCode}:${c.fightId}`,
      );
    }
  }

  return {
    selected,
    stoppedReason:
      selected.length === 0
        ? "no_candidates"
        : selected.length >= maxExtraRuns
          ? "cap_reached"
          : "publishable_after_selection",
    selectionReasons,
    maxExtraRuns,
  };
}

/** Build per-run diagnostic row from a shared evidence bundle. */
export function diagnoseUtilityBaselineRun(
  bundle: WclRunEvidenceBundle,
  opts?: { selectionReason?: string | null; skipReasons?: string[]; notes?: string[] },
): UtilityBaselineRunDiagnostic {
  const check = utilityEvidencePresentInBundle(bundle);
  const truncatedDatasets = Object.values(bundle.eventDatasets)
    .filter((ds): ds is NonNullable<typeof ds> => ds != null && ds.truncated)
    .map((ds) => ds.key);
  const absenceCauses = classifyUtilityEvidenceAbsence({
    bundle,
    skipReasons: opts?.skipReasons,
    notes: opts?.notes,
  });
  if (check.complete && absenceCauses.length === 1 && absenceCauses[0] === "unknown") {
    // Complete bundle — clear unknown placeholder when no failure signals.
    return {
      reportCode: bundle.reportCode,
      fightId: bundle.fightId,
      dungeonSlug: bundle.dungeonSlug,
      reportRevision: bundle.reportRevision,
      playerActorId: bundle.playerActorId,
      evidenceComplete: true,
      missingDatasets: check.missing,
      truncatedDatasets,
      providerCalls: bundle.accounting.providerCalls,
      pages: bundle.accounting.pages,
      pointsConsumed: bundle.accounting.pointsConsumed,
      costSource: bundle.accounting.costSource,
      persistedHits: bundle.accounting.persistedHits,
      cacheHits: bundle.accounting.cacheHits,
      absenceCauses: [],
      selectionReason: opts?.selectionReason ?? null,
    };
  }
  return {
    reportCode: bundle.reportCode,
    fightId: bundle.fightId,
    dungeonSlug: bundle.dungeonSlug,
    reportRevision: bundle.reportRevision,
    playerActorId: bundle.playerActorId,
    evidenceComplete: check.complete,
    missingDatasets: check.missing,
    truncatedDatasets,
    providerCalls: bundle.accounting.providerCalls,
    pages: bundle.accounting.pages,
    pointsConsumed: bundle.accounting.pointsConsumed,
    costSource: bundle.accounting.costSource,
    persistedHits: bundle.accounting.persistedHits,
    cacheHits: bundle.accounting.cacheHits,
    absenceCauses,
    selectionReason: opts?.selectionReason ?? null,
  };
}
