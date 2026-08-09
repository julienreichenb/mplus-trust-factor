/**
 * Active Mythic+ season authority — single production contract for season,
 * WCL zone, and dungeon-pool lineage. Callers must not independently choose
 * season rows, zones, or static dungeon arrays.
 */
import { createHash } from "node:crypto";
import { EVIDENCE_SLOTS_PER_DUNGEON } from "@mplus/contracts";

export const ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION = "active-mplus-season-authority-v1";

export type ActiveMplusResolutionMode = "AUTO" | "PINNED";

export type ActiveMplusOperationalState =
  | "ACTIVE_SEASON_CURRENT"
  | "ACTIVE_SEASON_METADATA_STALE"
  | "NEW_SEASON_DETECTED"
  | "NEW_SEASON_VALIDATING"
  | "NEW_SEASON_CATALOG_INCOMPLETE"
  | "NEW_SEASON_MODEL_INCOMPATIBLE"
  | "NEW_SEASON_ACTIVATED"
  | "SEASON_DUNGEON_BINDINGS_MISSING"
  | "ACTIVE_MPLUS_SEASON_AMBIGUOUS"
  | "ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE"
  | "PINNED_ZONE_MISMATCH"
  | "DIAGNOSTIC_ZONE_MISMATCH";

export type ActiveMplusCatalogSource =
  | "season_dungeon_bindings"
  | "synchronized_metadata"
  | "none";

export interface ActiveMplusDungeonIdentity {
  slug: string;
  dungeonId: string;
  sortOrder: number;
  wclEncounterId: number | null;
}

export interface ActiveMythicPlusSeasonAuthority {
  authorityVersion: typeof ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION;
  resolutionMode: ActiveMplusResolutionMode;
  operationalState: ActiveMplusOperationalState;
  applicationSeasonId: string;
  seasonSlug: string;
  seasonDisplayName: string;
  expansionIdentity: string | null;
  blizzardSeasonId: number | null;
  raiderIoSeasonSlug: string | null;
  wclZoneId: number;
  active: boolean;
  frozen: boolean;
  validFrom: string | null;
  validUntil: string | null;
  catalogSource: ActiveMplusCatalogSource;
  catalogVersion: string;
  sourceMetadataHash: string;
  dungeonPoolHash: string;
  dungeons: ActiveMplusDungeonIdentity[];
  activeDungeonSlugs: string[];
  expectedDungeonCount: number;
  runsPerDungeon: typeof EVIDENCE_SLOTS_PER_DUNGEON;
  expectedSlotCount: number;
  synchronizedAt: string | null;
  validatedAt: string;
  lastKnownGood: boolean;
  /** Present when WCL_MPLUS_ZONE_ID is set in AUTO mode for diagnostics. */
  diagnosticExpectedZoneId: number | null;
  diagnosticZoneMatch: boolean | null;
  /** PINNED mode: auto-detected zone when available for comparison. */
  autoDetectedZoneId: number | null;
  lineage: {
    regionCode: string;
    regionId: string;
    seasonRowId: string;
    dungeonPoolHash: string;
    catalogVersion: string;
    wclZoneId: number;
  };
  warnings: string[];
}

export function computeDungeonPoolHash(orderedSlugs: readonly string[]): string {
  const normalized = orderedSlugs.map((s) => s.trim().toLowerCase()).filter(Boolean);
  return createHash("sha256").update(normalized.join("\n"), "utf8").digest("hex");
}

export function computeSourceMetadataHash(input: {
  blizzardSeasonId: number | null;
  wclZoneId: number;
  dungeonPoolHash: string;
  catalogVersion: string;
}): string {
  return createHash("sha256")
    .update(
      [
        `blizzard=${input.blizzardSeasonId ?? "null"}`,
        `wclZone=${input.wclZoneId}`,
        `pool=${input.dungeonPoolHash}`,
        `catalog=${input.catalogVersion}`,
      ].join("|"),
      "utf8",
    )
    .digest("hex");
}

export function expectedSlotsForDungeonCount(dungeonCount: number): number {
  const n = Math.max(0, Math.floor(dungeonCount));
  return n * EVIDENCE_SLOTS_PER_DUNGEON;
}

/**
 * Authoritative dungeonSlug → WCL encounterId bindings for WCL discovery.
 * Throws when any active dungeon lacks a positive encounter ID.
 */
export function requireAuthorityDungeonEncounterBindings(
  dungeons: readonly ActiveMplusDungeonIdentity[],
): Array<{ dungeonSlug: string; encounterId: number }> {
  const missing: string[] = [];
  const out: Array<{ dungeonSlug: string; encounterId: number }> = [];
  for (const d of dungeons) {
    const dungeonSlug = d.slug.trim().toLowerCase();
    const encounterId = d.wclEncounterId;
    if (
      !dungeonSlug ||
      encounterId == null ||
      !Number.isFinite(encounterId) ||
      encounterId <= 0
    ) {
      missing.push(dungeonSlug || "(empty-slug)");
      continue;
    }
    out.push({ dungeonSlug, encounterId });
  }
  if (missing.length > 0) {
    throw new SeasonDungeonBindingsMissingError(
      `Season dungeon(s) missing WCL encounter ID: ${missing.join(", ")}`,
    );
  }
  return out;
}

/** Current score model evidence shape (v6): 16 slots / 8 dungeons. */
export const SCORE_MODEL_V6_MAX_EVIDENCE_SLOTS = 16;

export function evaluateScoreModelSeasonShapeCompatibility(input: {
  expectedSlotCount: number;
  maxSupportedEvidenceSlots?: number;
}): { ok: true } | { ok: false; code: "SCORE_MODEL_SEASON_SHAPE_INCOMPATIBLE"; message: string } {
  const max = input.maxSupportedEvidenceSlots ?? SCORE_MODEL_V6_MAX_EVIDENCE_SLOTS;
  if (input.expectedSlotCount <= max) return { ok: true };
  return {
    ok: false,
    code: "SCORE_MODEL_SEASON_SHAPE_INCOMPATIBLE",
    message: `expectedSlotCount=${input.expectedSlotCount} exceeds score-model max=${max}`,
  };
}

export class SeasonDungeonBindingsMissingError extends Error {
  readonly code = "SEASON_DUNGEON_BINDINGS_MISSING" as const;
  constructor(message: string) {
    super(message);
    this.name = "SeasonDungeonBindingsMissingError";
  }
}

export class ActiveMplusSeasonAmbiguousError extends Error {
  readonly code = "ACTIVE_MPLUS_SEASON_AMBIGUOUS" as const;
  constructor(message: string) {
    super(message);
    this.name = "ActiveMplusSeasonAmbiguousError";
  }
}

export class ActiveMplusSeasonCatalogIncompleteError extends Error {
  readonly code = "ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE" as const;
  constructor(message: string) {
    super(message);
    this.name = "ActiveMplusSeasonCatalogIncompleteError";
  }
}

export class ScoreModelSeasonShapeIncompatibleError extends Error {
  readonly code = "SCORE_MODEL_SEASON_SHAPE_INCOMPATIBLE" as const;
  constructor(message: string) {
    super(message);
    this.name = "ScoreModelSeasonShapeIncompatibleError";
  }
}
