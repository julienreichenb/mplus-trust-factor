import type { AppEnv } from "@mplus/config";
import type { WarcraftLogsProvider } from "@mplus/contracts";
import { FixtureWarcraftLogsProvider } from "./fixture/fixture-provider.js";
import { LiveWarcraftLogsProvider } from "./live/live-provider.js";

export function createWarcraftLogsProvider(
  mode: "fixture" | "live" = "fixture",
  env?: Pick<
    AppEnv,
    | "WCL_CLIENT_ID"
    | "WCL_CLIENT_SECRET"
    | "WCL_PUBLIC_GRAPHQL_URL"
    | "WCL_TOKEN_URL"
    | "WCL_RATE_WARN_PERCENT"
    | "WCL_RATE_DEFER_PERCENT"
    | "WCL_RATE_STOP_PERCENT"
    | "WCL_CHARACTER_TTL_SECONDS"
  >,
  options?: { zoneId?: number; zoneExpiresAt?: string | null },
): WarcraftLogsProvider {
  if (mode === "live") {
    if (!env?.WCL_CLIENT_ID || !env?.WCL_CLIENT_SECRET) {
      throw new Error("WCL credentials required for live provider mode");
    }
    return new LiveWarcraftLogsProvider({
      env,
      zoneId: options?.zoneId,
      zoneExpiresAt: options?.zoneExpiresAt,
    });
  }
  return new FixtureWarcraftLogsProvider();
}

export { FixtureWarcraftLogsProvider } from "./fixture/fixture-provider.js";
export { LiveWarcraftLogsProvider } from "./live/live-provider.js";
export * from "./types.js";
export * from "./client/token-manager.js";
export * from "./client/fingerprint.js";
export * from "./client/graphql-client.js";
export * from "./client/errors.js";
export * from "./operations/queries.js";
export * from "./discovery/run-discovery.js";
export * from "./discovery/run-matching.js";
export * from "./discovery/mplus-zone.js";
export * from "./discovery/zone-ranking-aggregates.js";
export * from "./discovery/points-and-damage-performance.js";
export * from "./discovery/bounds.js";
export * from "./discovery/report-hydration.js";
export * from "./analysis/revision-cache.js";
export * from "./analysis/combat-facts.js";
export * from "./analysis/combat-facts-to-survival-run.js";
export { buildRunCombatFactsFromEvents, fetchAllEventPages } from "./analysis/event-fetcher.js";
export * from "./analysis/survival-canonical-analysis.js";
export * from "./analysis/survival-run-analysis.js";
export * from "./analysis/survival-request-cost.js";
export * from "./rate/rate-budget.js";
export * from "./fixture/loader.js";
export * from "./probe/performance-probe.js";
export * from "./probe/performance-probe-logic.js";
export * from "./probe/survival-probe.js";
export * from "./probe/survival-probe-logic.js";
export * from "./probe/survival-probe-types.js";
export * from "./probe/survival-calibration-probe.js";
export * from "./probe/survival-calibration-logic.js";
export * from "./probe/survival-calibration-types.js";
export * from "./probe/utility-probe.js";
export * from "./probe/utility-probe-logic.js";
export * from "./probe/utility-probe-types.js";
export * from "./probe/survival-v1-config.js";
export * from "./probe/survival-v1-types.js";
export * from "./probe/survival-v1-logic.js";
export * from "./probe/survival-v1-score.js";
export * from "./probe/survival-v1_1-config.js";
export * from "./probe/survival-v1_1-types.js";
export * from "./probe/survival-v1_1-health.js";
export * from "./probe/survival-v1_1-logic.js";
export {
  runSurvivalV1_1Pipeline,
} from "./probe/survival-v1_1-score.js";
export * from "./probe/survival-v1_1-discovery.js";
export * from "./probe/survival-v1_1-audit-config.js";
export {
  auditFragmentationPairs,
  auditDefensiveActivations,
  auditRecoveryDetection,
  clusterWindowsByCandidateRule,
} from "./probe/survival-v1_1-audit.js";
export { runSurvivalV1_1Audit } from "./probe/survival-v1_1-audit-score.js";
export * from "./probe/survival-v1_1_1-config.js";
export * from "./probe/survival-v1_1_1-maxhp.js";
export * from "./probe/survival-v1_1_1-logic.js";
export * from "./probe/types.js";

export type { WarcraftLogsProvider };
