import type { EvidenceRole } from "@mplus/contracts";
import { PERFORMANCE_V2_MODEL_CONFIG, type PerformanceV2ModelConfig } from "./constants.js";
import type { PerformanceRoleAdapterResultV2 } from "./types.js";

/**
 * Spec/role adapter gate.
 * - DPS: supported only after field validation (config flag).
 * - Tank/healer: fail unavailable unless verified — never fall back to raw HPS / unscoped DPS.
 */
export function resolvePerformanceRoleAdapter(input: {
  role: EvidenceRole;
  specSlug: string | null;
  config?: PerformanceV2ModelConfig;
}): PerformanceRoleAdapterResultV2 {
  const config = input.config ?? PERFORMANCE_V2_MODEL_CONFIG;

  if (input.role === "UNKNOWN") {
    return {
      role: input.role,
      state: "UNSUPPORTED_ROLE",
      runParseAllowed: false,
      reason: "role_identity_unknown",
    };
  }

  if (input.specSlug == null || input.specSlug.trim() === "") {
    return {
      role: input.role,
      state: "SPEC_UNRESOLVED",
      runParseAllowed: false,
      reason: "specialization_unresolved",
    };
  }

  if (input.role === "DPS") {
    if (!config.role.dpsFieldValidated) {
      return {
        role: input.role,
        state: "ADAPTER_UNVERIFIED",
        runParseAllowed: false,
        reason: "dps_adapter_not_field_validated",
      };
    }
    return {
      role: input.role,
      state: "SUPPORTED",
      runParseAllowed: true,
      reason: null,
    };
  }

  if (input.role === "TANK") {
    if (!config.role.tankAdapterVerified) {
      return {
        role: input.role,
        state: "ADAPTER_UNVERIFIED",
        runParseAllowed: false,
        reason: "tank_adapter_unverified_no_raw_dps_fallback",
      };
    }
    return {
      role: input.role,
      state: "SUPPORTED",
      runParseAllowed: true,
      reason: null,
    };
  }

  // HEALER
  if (!config.role.healerAdapterVerified) {
    return {
      role: input.role,
      state: "ADAPTER_UNVERIFIED",
      runParseAllowed: false,
      reason: "healer_adapter_unverified_no_raw_hps_fallback",
    };
  }
  return {
    role: input.role,
    state: "SUPPORTED",
    runParseAllowed: true,
    reason: null,
  };
}

/**
 * Resolve a single run parse fact into a validated percentile.
 * Fallback order: validated bracket → validated rank → unavailable.
 * Raw DPS is never accepted.
 */
export function resolveValidatedParsePercentile(input: {
  parsePercentile: number | null;
  semantic: "BRACKET_PERCENT" | "RANK_PERCENT" | "UNAVAILABLE";
}): { parsePercentile: number | null; accepted: boolean; reason: string | null } {
  if (
    input.parsePercentile == null ||
    !Number.isFinite(input.parsePercentile) ||
    input.semantic === "UNAVAILABLE"
  ) {
    return { parsePercentile: null, accepted: false, reason: "parse_unavailable" };
  }
  if (input.semantic !== "BRACKET_PERCENT" && input.semantic !== "RANK_PERCENT") {
    return { parsePercentile: null, accepted: false, reason: "unsupported_parse_semantic" };
  }
  if (input.parsePercentile < 0 || input.parsePercentile > 100) {
    return { parsePercentile: null, accepted: false, reason: "parse_out_of_bounds" };
  }
  return { parsePercentile: input.parsePercentile, accepted: true, reason: null };
}
