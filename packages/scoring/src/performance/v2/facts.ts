/**
 * Parse persisted Performance V2 fact documents into calculator run-parse facts.
 * Provider-free — no WCL dependency.
 */

import type { PerformanceRunParseFactV2, SeasonDifficultyPolicyV2 } from "./types.js";

const PERFORMANCE_EXTRACTOR_FAMILY = "performance";
const PERFORMANCE_FACT_KIND = "performance_run_parse_fact_v2";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Accept bounded Performance fact documents persisted by CP1/CP2 extractors.
 */
export function parsePerformanceRunParseFactV2(
  value: unknown,
): { ok: true; fact: PerformanceRunParseFactV2 } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: "not_object" };
  if (value.kind !== PERFORMANCE_FACT_KIND) {
    return { ok: false, reason: "unexpected_kind" };
  }
  if (value.extractorFamily !== PERFORMANCE_EXTRACTOR_FAMILY) {
    return { ok: false, reason: "unexpected_extractor_family" };
  }
  if (typeof value.slotId !== "string" || typeof value.dungeonSlug !== "string") {
    return { ok: false, reason: "missing_slot_binding" };
  }
  if (typeof value.keyLevel !== "number" || !Number.isFinite(value.keyLevel)) {
    return { ok: false, reason: "invalid_key_level" };
  }
  const semantic = value.semantic;
  if (
    semantic !== "BRACKET_PERCENT" &&
    semantic !== "RANK_PERCENT" &&
    semantic !== "UNAVAILABLE"
  ) {
    return { ok: false, reason: "invalid_semantic" };
  }

  const identity = isRecord(value.identity) ? value.identity : null;
  const reportCode =
    typeof value.reportCode === "string"
      ? value.reportCode
      : identity && typeof identity.reportCode === "string"
        ? identity.reportCode
        : null;
  const fightId =
    typeof value.fightId === "number"
      ? value.fightId
      : identity && typeof identity.fightId === "number"
        ? identity.fightId
        : null;
  const reportRevision =
    typeof value.reportRevision === "number"
      ? value.reportRevision
      : identity && typeof identity.reportRevision === "number"
        ? identity.reportRevision
        : null;

  return {
    ok: true,
    fact: {
      slotId: value.slotId,
      dungeonSlug: value.dungeonSlug,
      keyLevel: value.keyLevel,
      parsePercentile:
        typeof value.parsePercentile === "number" && Number.isFinite(value.parsePercentile)
          ? value.parsePercentile
          : null,
      semantic,
      partition:
        typeof value.partition === "number" && Number.isFinite(value.partition)
          ? value.partition
          : null,
      rawDps:
        typeof value.rawDps === "number" && Number.isFinite(value.rawDps)
          ? value.rawDps
          : null,
      reportCode,
      fightId,
      reportRevision,
    },
  };
}

/** Stable MANUAL difficulty policy for shadow finalization (not live cutoffs). */
export function createManualDifficultyPolicyV2(input: {
  seasonId: string;
  region: string;
  role?: string;
  specSlug?: string | null;
  k50?: number;
  k90?: number;
  k99?: number;
  confidence?: number;
  version?: string;
}): SeasonDifficultyPolicyV2 {
  return {
    id: `difficulty-manual-${input.seasonId}-${input.region.toLowerCase()}`,
    seasonId: input.seasonId,
    region: input.region.toLowerCase(),
    role: input.role ?? "DPS",
    specSlug: input.specSlug ?? null,
    effectiveFrom: "1970-01-01T00:00:00.000Z",
    k50: input.k50 ?? 8,
    k90: input.k90 ?? 12,
    k99: input.k99 ?? 15,
    source: "MANUAL",
    sampleSize: null,
    confidence: input.confidence ?? 0.7,
    version: input.version ?? "difficulty-policy-manual-v1",
  };
}
