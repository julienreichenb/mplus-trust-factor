import type {
  CanonicalCharacter,
  ExcludedObservationDTO,
  ProviderLifecycleState,
  ProviderName,
  RaiderIoCharacterProfile,
  SourceDisagreementDTO,
  WclDataState,
  WclVisibilityState,
} from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";
import type { RetryClassification } from "./retry-classification.js";
import { classifyError } from "./retry-classification.js";

const ENRICHMENT_SOFT_SKIP_CODES = new Set([
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK",
  "BUDGET_EXCEEDED",
  "INVALID_RESPONSE",
  "SCHEMA_UNSUPPORTED",
  "UNKNOWN",
  "CIRCUIT_OPEN",
  "UNAUTHORIZED",
  "NOT_FOUND",
]);

/** Soft-skip Raider.IO / WCL enrichment failures so Blizzard-backed scores still persist. */
export function isEnrichmentSoftSkip(error: unknown): boolean {
  if (classifyError(error).softSkip) return true;
  if (error instanceof ExternalApiError && ENRICHMENT_SOFT_SKIP_CODES.has(error.code)) {
    return true;
  }
  return false;
}

export function mapErrorToProviderState(error: unknown): ProviderLifecycleState {
  if (!(error instanceof ExternalApiError)) return "UNAVAILABLE";
  switch (error.code) {
    case "RATE_LIMITED":
    case "BUDGET_EXCEEDED":
      return "RATE_LIMITED";
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "UNAUTHORIZED":
      return "PRIVATE_OR_HIDDEN";
    case "TIMEOUT":
    case "NETWORK":
    case "CIRCUIT_OPEN":
    case "INVALID_RESPONSE":
    case "UNKNOWN":
    default:
      return "UNAVAILABLE";
  }
}

export function mapWclVisibilityToState(
  visibility: WclVisibilityState | null,
  dataState: WclDataState | null = null,
): ProviderLifecycleState {
  if (dataState === "RATE_LIMITED") return "RATE_LIMITED";
  if (dataState === "UNAVAILABLE") return "UNAVAILABLE";
  if (visibility === "HIDDEN" || dataState === "NO_PUBLIC_LOGS") return "PRIVATE_OR_HIDDEN";
  if (visibility === "PUBLIC") return "OK";
  if (!visibility && !dataState) return "UNAVAILABLE";
  return "OK";
}

export function providerNameToDb(provider: ProviderName): "BLIZZARD" | "WARCRAFT_LOGS" | "RAIDER_IO" {
  switch (provider) {
    case "blizzard":
      return "BLIZZARD";
    case "warcraftlogs":
      return "WARCRAFT_LOGS";
    case "raiderio":
      return "RAIDER_IO";
  }
}

export interface ReconcileInput {
  blizzard: CanonicalCharacter | null;
  blizzardItemLevel: number | null;
  raiderIo: RaiderIoCharacterProfile | null;
  blizzardMythicRating: number | null;
}

export interface ReconcileResult {
  disagreements: SourceDisagreementDTO[];
  warnings: string[];
}

/** Reconcile identity/gear/rating fields per live-source-policy.md. */
export function reconcileSources(input: ReconcileInput): ReconcileResult {
  const disagreements: SourceDisagreementDTO[] = [];
  const warnings: string[] = [];

  if (input.blizzard && input.raiderIo) {
    if (
      input.blizzard.classSlug &&
      input.raiderIo.classSlug &&
      input.blizzard.classSlug.toLowerCase() !== input.raiderIo.classSlug.toLowerCase()
    ) {
      disagreements.push({
        field: "classSlug",
        primaryProvider: "blizzard",
        primaryValue: input.blizzard.classSlug,
        otherProvider: "raiderio",
        otherValue: input.raiderIo.classSlug,
        resolution: "PRIMARY_WINS",
        message: "Class differs between Blizzard and Raider.IO; Blizzard wins.",
      });
      warnings.push("SOURCE_DISAGREEMENT_CLASS");
    }

    if (
      input.blizzard.specSlug &&
      input.raiderIo.specSlug &&
      input.blizzard.specSlug.toLowerCase() !== input.raiderIo.specSlug.toLowerCase()
    ) {
      disagreements.push({
        field: "activeSpecSlug",
        primaryProvider: "blizzard",
        primaryValue: input.blizzard.specSlug,
        otherProvider: "raiderio",
        otherValue: input.raiderIo.specSlug,
        resolution: "KEEP_BOTH",
        message: "Active Blizzard spec differs from Raider.IO played spec; both retained.",
      });
      warnings.push("SOURCE_DISAGREEMENT_SPEC");
    }

    const rioIlvl = input.raiderIo.gear?.itemLevelEquipped ?? null;
    if (
      input.blizzardItemLevel != null &&
      rioIlvl != null &&
      Math.abs(input.blizzardItemLevel - rioIlvl) >= 5
    ) {
      disagreements.push({
        field: "itemLevelEquipped",
        primaryProvider: "blizzard",
        primaryValue: input.blizzardItemLevel,
        otherProvider: "raiderio",
        otherValue: rioIlvl,
        resolution: "NEWEST_VALID",
        message: "Equipped item level differs by ≥5 between Blizzard and Raider.IO.",
      });
      warnings.push("SOURCE_DISAGREEMENT_ITEM_LEVEL");
    }

    const rioScore = input.raiderIo.currentSeason?.scores.all ?? null;
    if (input.blizzardMythicRating != null && rioScore != null) {
      // Keep both separately — never merge. Record divergence for visibility only.
      disagreements.push({
        field: "mythicRating_vs_raiderIoScore",
        primaryProvider: "blizzard",
        primaryValue: input.blizzardMythicRating,
        otherProvider: "raiderio",
        otherValue: rioScore,
        resolution: "KEEP_BOTH",
        message: "Blizzard Mythic rating and Raider.IO score kept separate; not merged into product score.",
      });
    }

    if (input.raiderIo.crawlStale) {
      warnings.push("RAIDERIO_CRAWL_STALE");
    }
  }

  return { disagreements, warnings };
}

export function enrichmentRetryHint(error: unknown): RetryClassification {
  return classifyError(error);
}

export function excludedLowConfidenceMatch(detail: unknown): ExcludedObservationDTO {
  return {
    reason: "LOW_CONFIDENCE_RUN_MATCH",
    provider: "fusion",
    metricKey: null,
    detail,
  };
}
