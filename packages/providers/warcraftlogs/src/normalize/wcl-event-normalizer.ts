/**
 * Canonical WCL event field normalizer for all supported JSON shapes.
 * Identity is spell-ID based only — never matches abilities by name.
 */

export type WclResolvedField<T> = {
  value: T;
  sourcePath: string | null;
};

export type NormalizedWclEventFields = {
  abilityId: WclResolvedField<number | null>;
  extraAbilityId: WclResolvedField<number | null>;
  sourceActorId: WclResolvedField<number | null>;
  targetActorId: WclResolvedField<number | null>;
  timestampMs: WclResolvedField<number | null>;
  eventType: WclResolvedField<string | null>;
  rawAbilityName: WclResolvedField<string | null>;
};

const ABILITY_ID_PATHS = [
  "abilityGameID",
  "abilityGameId",
  "ability.gameID",
  "ability.abilityGameID",
  "ability.abilityGameId",
  "ability.guid",
  "ability.id",
] as const;

const EXTRA_ABILITY_ID_PATHS = [
  "extraAbilityGameID",
  "extraAbilityGameId",
  "extraAbility.gameID",
  "extraAbility.abilityGameID",
  "extraAbility.abilityGameId",
  "extraAbility.guid",
  "extraAbility.id",
] as const;

const SOURCE_ACTOR_PATHS = ["sourceID", "source.id"] as const;
const TARGET_ACTOR_PATHS = ["targetID", "target.id"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPath(row: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = row;
  for (const part of parts) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[part];
  }
  return current;
}

function resolveFirst<T>(
  row: Record<string, unknown>,
  paths: readonly string[],
  coerce: (value: unknown) => T | null,
): WclResolvedField<T | null> {
  for (const path of paths) {
    const raw = readPath(row, path);
    const value = coerce(raw);
    if (value != null) {
      return { value, sourcePath: path };
    }
  }
  return { value: null, sourcePath: null };
}

export function normalizeWclEventFields(row: Record<string, unknown>): NormalizedWclEventFields {
  return {
    abilityId: resolveFirst(row, ABILITY_ID_PATHS, asFiniteNumber),
    extraAbilityId: resolveFirst(row, EXTRA_ABILITY_ID_PATHS, asFiniteNumber),
    sourceActorId: resolveFirst(row, SOURCE_ACTOR_PATHS, asFiniteNumber),
    targetActorId: resolveFirst(row, TARGET_ACTOR_PATHS, asFiniteNumber),
    timestampMs: resolveFirst(row, ["timestamp"], asFiniteNumber),
    eventType: resolveFirst(row, ["type"], asNonEmptyString),
    rawAbilityName: resolveFirst(row, ["ability.name", "abilityName"], asNonEmptyString),
  };
}

export function isMalformedTimestamp(timestampMs: number | null): boolean {
  return timestampMs == null || !Number.isFinite(timestampMs) || timestampMs < 0;
}

/** Strip sensitive or excessively large fields for diagnostic samples. */
export function sanitizeUnresolvedEventShape(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const allowTop = new Set([
    "timestamp",
    "type",
    "sourceID",
    "targetID",
    "abilityGameID",
    "abilityGameId",
    "extraAbilityGameID",
    "extraAbilityGameId",
    "hitType",
  ]);
  for (const [key, value] of Object.entries(row)) {
    if (allowTop.has(key)) {
      out[key] = value;
      continue;
    }
    if (key === "ability" || key === "extraAbility" || key === "source" || key === "target") {
      const nested = asRecord(value);
      if (!nested) continue;
      const trimmed: Record<string, unknown> = {};
      for (const nestedKey of [
        "id",
        "guid",
        "gameID",
        "abilityGameID",
        "abilityGameId",
        "name",
        "type",
        "petOwner",
      ]) {
        if (nested[nestedKey] !== undefined) trimmed[nestedKey] = nested[nestedKey];
      }
      if (Object.keys(trimmed).length > 0) out[key] = trimmed;
      continue;
    }
  }
  return out;
}

export const WCL_ABILITY_ID_SOURCE_PATHS = ABILITY_ID_PATHS;
export const WCL_EXTRA_ABILITY_ID_SOURCE_PATHS = EXTRA_ABILITY_ID_PATHS;
export const WCL_SOURCE_ACTOR_ID_SOURCE_PATHS = SOURCE_ACTOR_PATHS;
export const WCL_TARGET_ACTOR_ID_SOURCE_PATHS = TARGET_ACTOR_PATHS;
