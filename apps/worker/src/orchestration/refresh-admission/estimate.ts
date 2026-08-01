/**
 * Conservative WCL point envelope for admission Option A (worst-case before first spend).
 * Uses calibrated operation costs when available; never reserves 0 for WCL-required work.
 */

import {
  DEFAULT_WCL_OPERATION_COSTS,
  type WclBudgetManager,
} from "../wcl-budget-manager.js";
import { BASELINE_COST_SCENARIOS } from "../refresh-cost-ledger.js";

const WARM_BASELINE =
  BASELINE_COST_SCENARIOS.find((s) => s.scenario === "warm_refresh")?.wclPoints ?? 35;

export function estimateRefreshAdmissionWclPoints(input: {
  wclRequired: boolean;
  /** Optional budget manager with calibrated historical costs. */
  budgetManager?: WclBudgetManager | null;
  needsSummary?: boolean;
  needsRunDiscovery?: boolean;
  fightDetailCount?: number;
  needsSurvivalAnalysis?: boolean;
}): number {
  if (!input.wclRequired) return 0;

  if (input.budgetManager) {
    const estimated = input.budgetManager.estimateCharacterRefreshCost({
      needsSummary: input.needsSummary ?? true,
      needsRunDiscovery: input.needsRunDiscovery ?? true,
      fightDetailCount: input.fightDetailCount ?? 8,
      needsSurvivalAnalysis: input.needsSurvivalAnalysis ?? true,
    });
    return Math.max(1, Math.floor(estimated));
  }

  // Conservative warm envelope from ledger baselines + default op table floor.
  const fromOps =
    (DEFAULT_WCL_OPERATION_COSTS.rate_limit_preflight ?? 1) +
    (DEFAULT_WCL_OPERATION_COSTS.discoverCharacterSummary ?? 5) +
    (DEFAULT_WCL_OPERATION_COSTS.discoverCharacterRuns ?? 8) +
    (DEFAULT_WCL_OPERATION_COSTS.getReportFightDetails ?? 15) * 8 +
    (DEFAULT_WCL_OPERATION_COSTS.survivalAnalysis ?? 20);

  return Math.max(1, Math.floor(Math.max(WARM_BASELINE, fromOps)));
}
