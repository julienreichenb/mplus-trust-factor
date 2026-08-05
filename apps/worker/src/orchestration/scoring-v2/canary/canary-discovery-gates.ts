/**
 * Safety gates for the discovery-only Scoring V2 canary phase.
 * SCORING_V2_CANARY_EXECUTE must NOT authorize discovery.
 */
import type { AppEnv } from "@mplus/config";
import {
  assertPublicationBlocked,
  isScoringV2ShadowOrchestrationEnabled,
} from "../acquisition.js";
import { evaluateRateBudget, type RateBudgetConfig } from "@mplus/provider-warcraftlogs";
import type { WclRateLimitSnapshot } from "@mplus/provider-warcraftlogs";

export type CanaryDiscoveryGateDenial =
  | "MISSING_CONFIRM_DISCOVERY"
  | "DISCOVERY_EXECUTE_NOT_ARMED"
  | "PROVIDER_MODE_NOT_LIVE"
  | "ALLOW_LIVE_PROVIDER_CALLS_FALSE"
  | "SHADOW_FLAGS_DISABLED"
  | "PUBLICATION_ENABLED"
  | "MULTIPLE_CHARACTERS"
  | "WCL_CREDENTIALS_MISSING"
  | "WCL_DISABLED"
  | "RATE_ADMISSION_STOP"
  | "RATE_ADMISSION_DEFER"
  | "REPOSITORY_MODE_FORBIDDEN";

export interface CanaryDiscoveryGateInput {
  env: Pick<
    AppEnv,
    | "PROVIDER_MODE"
    | "WCL_ENABLED"
    | "ALLOW_LIVE_PROVIDER_CALLS"
    | "SCORING_V2_ENABLED"
    | "SCORING_V2_SELECTION_ENABLED"
    | "SCORING_V2_PUBLICATION_ENABLED"
    | "WCL_CLIENT_ID"
    | "WCL_CLIENT_SECRET"
  > & {
    SCORING_V2_CANARY_DISCOVERY_EXECUTE?: boolean | string;
  };
  /** Process env / argv arm — must be explicit "true". */
  discoveryExecuteArmed: boolean;
  confirmDiscovery: boolean;
  characterCount: number;
  repositoryMode: "PRODUCTION" | "MEMORY" | "FIXTURE";
}

export function isDiscoveryExecuteArmed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  return env.SCORING_V2_CANARY_DISCOVERY_EXECUTE === "true";
}

export function evaluateCanaryDiscoveryGates(
  input: CanaryDiscoveryGateInput,
): { allowed: true } | { allowed: false; reasons: CanaryDiscoveryGateDenial[] } {
  const reasons: CanaryDiscoveryGateDenial[] = [];
  if (!input.confirmDiscovery) reasons.push("MISSING_CONFIRM_DISCOVERY");
  if (!input.discoveryExecuteArmed) reasons.push("DISCOVERY_EXECUTE_NOT_ARMED");
  if (input.env.PROVIDER_MODE !== "live") reasons.push("PROVIDER_MODE_NOT_LIVE");
  if (!input.env.ALLOW_LIVE_PROVIDER_CALLS) {
    reasons.push("ALLOW_LIVE_PROVIDER_CALLS_FALSE");
  }
  if (!isScoringV2ShadowOrchestrationEnabled(input.env as never)) {
    reasons.push("SHADOW_FLAGS_DISABLED");
  }
  if (input.env.SCORING_V2_PUBLICATION_ENABLED) {
    reasons.push("PUBLICATION_ENABLED");
  }
  if (input.characterCount !== 1) reasons.push("MULTIPLE_CHARACTERS");
  if (!input.env.WCL_ENABLED) reasons.push("WCL_DISABLED");
  if (!input.env.WCL_CLIENT_ID || !input.env.WCL_CLIENT_SECRET) {
    reasons.push("WCL_CREDENTIALS_MISSING");
  }
  if (input.repositoryMode !== "PRODUCTION") {
    reasons.push("REPOSITORY_MODE_FORBIDDEN");
  }
  if (reasons.length > 0) return { allowed: false, reasons };
  try {
    assertPublicationBlocked(input.env as never);
  } catch {
    return { allowed: false, reasons: ["PUBLICATION_ENABLED"] };
  }
  return { allowed: true };
}

/**
 * Discovery may proceed on ALLOW or WARN. DEFER and STOP refuse before WCL.
 */
export function assertDiscoveryRateAdmission(input: {
  snapshot: WclRateLimitSnapshot | null;
  rateBudgetConfig: RateBudgetConfig;
  /** When true, missing snapshot refuses (cold discovery needs a budget view). */
  requireSnapshot?: boolean;
}): { admission: "ALLOW" | "WARN_ALLOW"; reasons: string[] } {
  const requireSnapshot = input.requireSnapshot !== false;
  if (!input.snapshot) {
    if (requireSnapshot) {
      throw Object.assign(
        new Error("canary_discovery_rate_admission_refused:DEFER"),
        {
          code: "CANARY_DISCOVERY_RATE_ADMISSION_REFUSED",
          admission: "DEFER" as const,
          reasons: ["rate_limit_snapshot_absent"],
        },
      );
    }
    return { admission: "ALLOW", reasons: ["snapshot_optional_test"] };
  }
  const decision = evaluateRateBudget(input.snapshot, input.rateBudgetConfig);
  if (decision.action === "STOP") {
    throw Object.assign(
      new Error("canary_discovery_rate_admission_refused:STOP"),
      {
        code: "CANARY_DISCOVERY_RATE_ADMISSION_REFUSED",
        admission: "STOP" as const,
        reasons: ["rate_budget_STOP"],
      },
    );
  }
  if (decision.action === "DEFER") {
    throw Object.assign(
      new Error("canary_discovery_rate_admission_refused:DEFER"),
      {
        code: "CANARY_DISCOVERY_RATE_ADMISSION_REFUSED",
        admission: "DEFER" as const,
        reasons: ["rate_budget_DEFER"],
      },
    );
  }
  if (decision.action === "WARN") {
    return {
      admission: "WARN_ALLOW",
      reasons: ["rate_budget_WARN_explicitly_permitted_for_discovery"],
    };
  }
  return { admission: "ALLOW", reasons: ["rate_budget_ALLOW"] };
}
