import {
  RAIDERIO_DOCUMENTED_CURRENT_EXPANSION_ID,
  RAIDERIO_EXPANSION_CATALOG,
  RAIDERIO_EXPANSION_DOCUMENTED_AS_OF,
  RAIDERIO_EXPANSION_PIN_MAX_AGE_DAYS,
} from "./constants.js";
import type { RawStaticDataResponse } from "./raw-types.js";

export interface ExpansionResolution {
  expansionId: number;
  source: "override" | "documented_current" | "catalog_fallback";
  pinAgeDays: number;
  pinStale: boolean;
  warning: string | null;
}

function pinAgeDays(nowMs: number): number {
  const documentedMs = Date.parse(RAIDERIO_EXPANSION_DOCUMENTED_AS_OF);
  if (Number.isNaN(documentedMs)) return Number.POSITIVE_INFINITY;
  return Math.floor((nowMs - documentedMs) / (24 * 60 * 60 * 1000));
}

function seasonLooksActive(raw: RawStaticDataResponse, nowMs: number): boolean {
  const seasons = raw.seasons ?? [];
  if (seasons.length === 0) return false;

  for (const season of seasons) {
    if (season.is_current) return true;
    const starts = season.starts ?? season.starts_at;
    const ends = season.ends ?? season.ends_at;
    const startMs = earliestTimestamp(starts);
    const endMs = latestTimestamp(ends);
    if (startMs !== null && startMs <= nowMs && (endMs === null || endMs >= nowMs)) {
      return true;
    }
  }

  // Midnight/TWW static payloads may omit is_current; non-empty seasons still validate the id.
  return seasons.length > 0;
}

function earliestTimestamp(value: unknown): number | null {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (value && typeof value === "object") {
    const times = Object.values(value as Record<string, unknown>)
      .map((v) => (typeof v === "string" ? Date.parse(v) : Number.NaN))
      .filter((ms) => !Number.isNaN(ms));
    return times.length > 0 ? Math.min(...times) : null;
  }
  return null;
}

function latestTimestamp(value: unknown): number | null {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (value && typeof value === "object") {
    const times = Object.values(value as Record<string, unknown>)
      .map((v) => (typeof v === "string" ? Date.parse(v) : Number.NaN))
      .filter((ms) => !Number.isNaN(ms));
    return times.length > 0 ? Math.max(...times) : null;
  }
  return null;
}

export function buildExpansionResolution(
  expansionId: number,
  source: ExpansionResolution["source"],
  nowMs = Date.now(),
): ExpansionResolution {
  const age = pinAgeDays(nowMs);
  const pinStale = age > RAIDERIO_EXPANSION_PIN_MAX_AGE_DAYS;
  const warning = pinStale
    ? `Raider.IO expansion pin dated ${RAIDERIO_EXPANSION_DOCUMENTED_AS_OF} is ${age} days old; re-verify against OpenAPI.`
    : null;
  return { expansionId, source, pinAgeDays: age, pinStale, warning };
}

export function candidateExpansionIds(overrideId?: number): number[] {
  const ids = [
    ...(overrideId !== undefined ? [overrideId] : []),
    RAIDERIO_DOCUMENTED_CURRENT_EXPANSION_ID,
    ...RAIDERIO_EXPANSION_CATALOG.map((entry) => entry.id),
  ];
  return [...new Set(ids)];
}

export function selectValidatedExpansionId(input: {
  overrideId?: number;
  probe: (expansionId: number) => Promise<RawStaticDataResponse | null>;
  nowMs?: number;
}): Promise<ExpansionResolution> {
  const nowMs = input.nowMs ?? Date.now();
  const candidates = candidateExpansionIds(input.overrideId);

  return (async () => {
    for (const [index, expansionId] of candidates.entries()) {
      const raw = await input.probe(expansionId);
      if (!raw || !seasonLooksActive(raw, nowMs)) continue;
      const source: ExpansionResolution["source"] =
        input.overrideId !== undefined && expansionId === input.overrideId
          ? "override"
          : index === (input.overrideId !== undefined ? 1 : 0)
            ? "documented_current"
            : "catalog_fallback";
      return buildExpansionResolution(expansionId, source, nowMs);
    }

    return buildExpansionResolution(
      input.overrideId ?? RAIDERIO_DOCUMENTED_CURRENT_EXPANSION_ID,
      input.overrideId !== undefined ? "override" : "documented_current",
      nowMs,
    );
  })();
}
