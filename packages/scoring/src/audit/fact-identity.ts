/**
 * Parse fact-document identity separately from DB slot / manifest identity.
 * Never copy slot identity into fact audit fields and compare with itself.
 */

import { parseSurvivalFactDocumentV2 } from "../survival/v2/index.js";
import { parsePerformanceRunParseFactV2 } from "../performance/v2/facts.js";
import { UTILITY_V2_EXTRACTOR_FAMILY } from "../utility/v2/constants.js";

export interface FactDocumentIdentity {
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  parseOk: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asUtilityIdentity(facts: unknown): FactDocumentIdentity | null {
  if (!isRecord(facts)) return null;
  if (
    facts.extractorFamily !== UTILITY_V2_EXTRACTOR_FAMILY &&
    facts.extractorFamily !== "utility" &&
    typeof facts.runId !== "string"
  ) {
    return null;
  }
  if (typeof facts.runId !== "string" || typeof facts.dungeonSlug !== "string") return null;
  return {
    reportCode: typeof facts.reportCode === "string" ? facts.reportCode : null,
    fightId: typeof facts.fightId === "number" ? facts.fightId : null,
    reportRevision:
      typeof facts.reportRevision === "number" ? facts.reportRevision : null,
    parseOk: true,
  };
}

export function parseFactDocumentIdentity(
  family: "PERFORMANCE" | "SURVIVAL" | "UTILITY",
  facts: unknown,
): FactDocumentIdentity {
  if (family === "SURVIVAL") {
    const parsed = parseSurvivalFactDocumentV2(facts);
    if (!parsed.ok) {
      return { reportCode: null, fightId: null, reportRevision: null, parseOk: false };
    }
    return {
      reportCode: parsed.document.identity.reportCode,
      fightId: parsed.document.identity.fightId,
      reportRevision: parsed.document.identity.reportRevision,
      parseOk: true,
    };
  }
  if (family === "UTILITY") {
    return (
      asUtilityIdentity(facts) ?? {
        reportCode: null,
        fightId: null,
        reportRevision: null,
        parseOk: false,
      }
    );
  }
  const parsed = parsePerformanceRunParseFactV2(facts);
  if (parsed.ok) {
    return {
      reportCode: parsed.fact.reportCode,
      fightId: parsed.fact.fightId,
      reportRevision: parsed.fact.reportRevision,
      parseOk: true,
    };
  }
  if (isRecord(facts)) {
    return {
      reportCode: typeof facts.reportCode === "string" ? facts.reportCode : null,
      fightId: typeof facts.fightId === "number" ? facts.fightId : null,
      reportRevision:
        typeof facts.reportRevision === "number" ? facts.reportRevision : null,
      parseOk: false,
    };
  }
  return { reportCode: null, fightId: null, reportRevision: null, parseOk: false };
}

export function identitiesMatch(
  a: { reportCode: string | null; fightId: number | null; reportRevision: number | null },
  b: { reportCode: string | null; fightId: number | null; reportRevision: number | null },
): boolean {
  if (a.reportCode == null || a.fightId == null || a.reportRevision == null) return false;
  if (b.reportCode == null || b.fightId == null || b.reportRevision == null) return false;
  return (
    a.reportCode === b.reportCode &&
    a.fightId === b.fightId &&
    a.reportRevision === b.reportRevision
  );
}

/** Resolve artifact ids from RunFactSet.coverage without embedding raw payloads. */
export function artifactIdsFromCoverage(coverage: unknown): string[] {
  if (!isRecord(coverage)) return [];
  const ids = coverage.artifactIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}
