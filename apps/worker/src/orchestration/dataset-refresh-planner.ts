/**
 * Dataset-aware refresh planning — refresh only stale / required datasets.
 * Never deletes or invalidates the current published score when planning begins.
 */

import type { FreshnessConfig, FreshnessDataset } from "@mplus/config";
import { isDatasetFresh } from "@mplus/config";

export type RefreshPlanMode =
  | "FULL_PROVIDER_REFRESH"
  | "RATING_ONLY"
  | "MODEL_ONLY_RECALCULATION"
  | "PARTIAL_REPORT_REFRESH"
  | "REUSE_HISTORY"
  | "DEFER_MISSING_DATASETS"
  | "SKIP_ALREADY_FRESH";

export type RefreshReason =
  | "public_on_demand"
  | "owner_refresh"
  | "admin_force_recalculation"
  | "admin_provider_refetch"
  | "scheduled_refresh"
  | "stale_while_revalidate"
  | "dry_run";

export interface DatasetFreshnessSnapshot {
  dataset: FreshnessDataset;
  fetchedAt: Date | string | null;
}

export interface DatasetRefreshPlanInput {
  reason: RefreshReason;
  /** When true, skip providers and recalculate from persisted observations. */
  modelChangedObservationsCompatible?: boolean;
  /** Rating/profile datasets stale while combat evidence still fresh. */
  ratingStaleCombatFresh?: boolean;
  /** Specific report codes whose revision changed. */
  changedReportCodes?: string[];
  /** Immutable history still valid for reuse. */
  immutableHistoryValid?: boolean;
  /** Provider unavailable — keep published score, defer datasets. */
  wclUnavailable?: boolean;
  /** Force provider refetch (admin). Still subject to global WCL safety. */
  forceProviderRefetch?: boolean;
  datasetStates?: DatasetFreshnessSnapshot[];
  freshnessConfig?: FreshnessConfig;
  nowMs?: number;
}

export interface DatasetRefreshPlan {
  mode: RefreshPlanMode;
  datasetsToRefresh: FreshnessDataset[];
  datasetsToReuse: FreshnessDataset[];
  providerCallsRequired: boolean;
  modelRecalculationOnly: boolean;
  preservePublishedScore: true;
  deferredDatasets: FreshnessDataset[];
  estimatedWclOperations: string[];
  notes: string[];
}

const RATING_DATASETS: FreshnessDataset[] = [
  "blizzard.character_profile",
  "blizzard.seasonal_runs",
  "raiderio.profile",
  "wcl.zone_rankings",
];

const COMBAT_DATASETS: FreshnessDataset[] = [
  "wcl.combat_events",
  "wcl.report_master",
  "normalized.run_analysis",
];

export function planDatasetRefresh(input: DatasetRefreshPlanInput): DatasetRefreshPlan {
  const notes: string[] = [];
  const preservePublishedScore = true as const;

  if (input.wclUnavailable && !input.forceProviderRefetch) {
    notes.push("WCL unavailable — keep published score and defer combat datasets");
    return {
      mode: "DEFER_MISSING_DATASETS",
      datasetsToRefresh: RATING_DATASETS.filter((d) => d !== "wcl.zone_rankings"),
      datasetsToReuse: [...COMBAT_DATASETS],
      providerCallsRequired: true,
      modelRecalculationOnly: false,
      preservePublishedScore,
      deferredDatasets: ["wcl.zone_rankings", ...COMBAT_DATASETS],
      estimatedWclOperations: [],
      notes,
    };
  }

  if (input.modelChangedObservationsCompatible && !input.forceProviderRefetch) {
    notes.push("Model changed with compatible observations — local recalculation only");
    return {
      mode: "MODEL_ONLY_RECALCULATION",
      datasetsToRefresh: ["calculated.score_snapshot"],
      datasetsToReuse: [
        ...RATING_DATASETS,
        ...COMBAT_DATASETS,
        "blizzard.equipment",
        "blizzard.talents",
      ],
      providerCallsRequired: false,
      modelRecalculationOnly: true,
      preservePublishedScore,
      deferredDatasets: [],
      estimatedWclOperations: [],
      notes,
    };
  }

  if (input.changedReportCodes && input.changedReportCodes.length > 0) {
    notes.push(`Refresh affected reports only: ${input.changedReportCodes.join(",")}`);
    return {
      mode: "PARTIAL_REPORT_REFRESH",
      datasetsToRefresh: ["wcl.report_master", "wcl.combat_events", "normalized.run_analysis"],
      datasetsToReuse: [...RATING_DATASETS],
      providerCallsRequired: true,
      modelRecalculationOnly: false,
      preservePublishedScore,
      deferredDatasets: [],
      estimatedWclOperations: input.changedReportCodes.flatMap(() => [
        "getReportMaster",
        "getReportFightDetails",
      ]),
      notes,
    };
  }

  if (input.ratingStaleCombatFresh) {
    notes.push("Rating stale, combat evidence fresh — refresh rating only");
    return {
      mode: "RATING_ONLY",
      datasetsToRefresh: [...RATING_DATASETS],
      datasetsToReuse: [...COMBAT_DATASETS],
      providerCallsRequired: true,
      modelRecalculationOnly: false,
      preservePublishedScore,
      deferredDatasets: [],
      estimatedWclOperations: ["discoverCharacterSummary", "discoverCharacterRuns"],
      notes,
    };
  }

  if (input.immutableHistoryValid && input.datasetStates && input.freshnessConfig) {
    const nowMs = input.nowMs ?? Date.now();
    const stale = input.datasetStates.filter(
      (s) => !isDatasetFresh(s.fetchedAt, s.dataset, input.freshnessConfig!, nowMs),
    );
    const fresh = input.datasetStates.filter((s) =>
      isDatasetFresh(s.fetchedAt, s.dataset, input.freshnessConfig!, nowMs),
    );
    if (stale.length === 0) {
      notes.push("All datasets fresh — skip provider work");
      return {
        mode: "SKIP_ALREADY_FRESH",
        datasetsToRefresh: [],
        datasetsToReuse: fresh.map((s) => s.dataset),
        providerCallsRequired: false,
        modelRecalculationOnly: false,
        preservePublishedScore,
        deferredDatasets: [],
        estimatedWclOperations: [],
        notes,
      };
    }
    if (fresh.some((s) => COMBAT_DATASETS.includes(s.dataset))) {
      notes.push("Profile stale, immutable history valid — reuse combat history");
      return {
        mode: "REUSE_HISTORY",
        datasetsToRefresh: stale.map((s) => s.dataset),
        datasetsToReuse: fresh.map((s) => s.dataset),
        providerCallsRequired: stale.some((s) => s.dataset.startsWith("wcl.") || s.dataset.startsWith("blizzard.") || s.dataset.startsWith("raiderio.")),
        modelRecalculationOnly: false,
        preservePublishedScore,
        deferredDatasets: [],
        estimatedWclOperations: stale
          .filter((s) => s.dataset.startsWith("wcl."))
          .map(() => "discoverCharacterSummary"),
        notes,
      };
    }
  }

  notes.push("Default full provider refresh plan");
  return {
    mode: "FULL_PROVIDER_REFRESH",
    datasetsToRefresh: [
      ...RATING_DATASETS,
      ...COMBAT_DATASETS,
      "blizzard.equipment",
      "blizzard.talents",
      "calculated.score_snapshot",
    ],
    datasetsToReuse: [],
    providerCallsRequired: true,
    modelRecalculationOnly: false,
    preservePublishedScore,
    deferredDatasets: [],
    estimatedWclOperations: [
      "rate_limit_preflight",
      "discoverCharacterSummary",
      "discoverCharacterRuns",
      "getReportFightDetails",
      "survivalAnalysis",
    ],
    notes,
  };
}

/**
 * Distinct refresh semantics. Admin/premium never bypasses global WCL safety.
 */
export interface RefreshRequestSemantics {
  reason: RefreshReason;
  allowCooldownBypass: boolean;
  forceProviderRefetch: boolean;
  modelOnlyPreferred: boolean;
  /** Global WCL safety always applies — including admin. */
  respectGlobalWclSafety: true;
  mayEnqueueScheduledWork: boolean;
}

export function resolveRefreshSemantics(reason: RefreshReason): RefreshRequestSemantics {
  switch (reason) {
    case "admin_force_recalculation":
      return {
        reason,
        allowCooldownBypass: true,
        forceProviderRefetch: false,
        modelOnlyPreferred: true,
        respectGlobalWclSafety: true,
        mayEnqueueScheduledWork: false,
      };
    case "admin_provider_refetch":
      return {
        reason,
        allowCooldownBypass: true,
        forceProviderRefetch: true,
        modelOnlyPreferred: false,
        respectGlobalWclSafety: true,
        mayEnqueueScheduledWork: false,
      };
    case "owner_refresh":
      return {
        reason,
        allowCooldownBypass: false,
        forceProviderRefetch: false,
        modelOnlyPreferred: false,
        respectGlobalWclSafety: true,
        mayEnqueueScheduledWork: false,
      };
    case "scheduled_refresh":
      return {
        reason,
        allowCooldownBypass: false,
        forceProviderRefetch: false,
        modelOnlyPreferred: false,
        respectGlobalWclSafety: true,
        mayEnqueueScheduledWork: true,
      };
    case "dry_run":
      return {
        reason,
        allowCooldownBypass: true,
        forceProviderRefetch: false,
        modelOnlyPreferred: false,
        respectGlobalWclSafety: true,
        mayEnqueueScheduledWork: false,
      };
    case "stale_while_revalidate":
    case "public_on_demand":
    default:
      return {
        reason: reason === "stale_while_revalidate" ? reason : "public_on_demand",
        allowCooldownBypass: false,
        forceProviderRefetch: false,
        modelOnlyPreferred: false,
        respectGlobalWclSafety: true,
        mayEnqueueScheduledWork: false,
      };
  }
}
