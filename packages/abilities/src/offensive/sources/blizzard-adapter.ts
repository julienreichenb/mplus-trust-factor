import { RETAIL_CLASS_MATRIX } from "../../catalog/classes-matrix.js";
import {
  CATALOG_GAME_VERSION,
  CATALOG_VERIFIED_AT,
  CURRENT_CATALOG_VERSION_ID,
} from "../../version.js";
import type { OffensiveSourceAdapter, OffensiveSourceSnapshot } from "./types.js";
import { provenanceSourceForKind } from "./types.js";

/**
 * Authoritative Blizzard playable class/spec rows emitted by this adapter.
 * Source: curated Game Data playable-class + specialization index snapshot
 * mirrored in RETAIL_CLASS_MATRIX (never invent class/spec counts elsewhere).
 */
export interface BlizzardPlayableSpecRow {
  classSlug: string;
  className: string;
  blizzardClassId: number;
  specSlug: string;
  specName: string;
  blizzardSpecId: number;
  role: string;
  supportState: string;
}

/** Load the authoritative Retail playable matrix from the Blizzard adapter snapshot. */
export function loadAuthoritativeBlizzardPlayableMatrix(): {
  gameVersion: string;
  catalogVersion: string;
  verifiedAt: string;
  provenance: string;
  classes: number;
  specializations: number;
  rows: BlizzardPlayableSpecRow[];
} {
  const rows: BlizzardPlayableSpecRow[] = RETAIL_CLASS_MATRIX.flatMap((cls) =>
    cls.specs.map((spec) => ({
      classSlug: cls.slug,
      className: cls.name,
      blizzardClassId: cls.blizzardClassId,
      specSlug: spec.slug,
      specName: spec.name,
      blizzardSpecId: spec.blizzardSpecId,
      role: spec.role,
      supportState: spec.supportState,
    })),
  );
  return {
    gameVersion: CATALOG_GAME_VERSION,
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    verifiedAt: CATALOG_VERIFIED_AT,
    provenance:
      "BLIZZARD_API playable-class + playable-specialization indexes (curated snapshot in RETAIL_CLASS_MATRIX)",
    classes: RETAIL_CLASS_MATRIX.length,
    specializations: rows.length,
    rows,
  };
}

/**
 * Blizzard Game Data adapter.
 *
 * Consumes the curated playable class/spec matrix (derived from Blizzard
 * playable-class / specialization indexes). Live talent-tree pulls are optional
 * and must write a generated snapshot — never silently mutate the canonical catalog.
 *
 * License: Blizzard API terms of use — curated matrix snapshot only; no client binary redistribution.
 */
export const blizzardGameDataAdapter: OffensiveSourceAdapter = {
  meta: {
    kind: "BLIZZARD_GAME_DATA",
    adapterId: "blizzard-playable-class-spec-matrix",
    licenseNote:
      "Blizzard Game Data API ToS — curated matrix snapshot only; no client binary redistribution.",
    mayProposeClassification: false,
  },

  loadSnapshot(input): OffensiveSourceSnapshot {
    const gameVersion = input.gameVersion || CATALOG_GAME_VERSION;
    const catalogVersion = input.catalogVersion || CURRENT_CATALOG_VERSION_ID;
    const matrix = loadAuthoritativeBlizzardPlayableMatrix();
    const candidates = matrix.rows.map((row) => ({
      proposedCanonicalKey: `${row.classSlug}.offensive._spec-coverage-seed.${row.specSlug}`,
      canonicalName: `${row.className} ${row.specName} offensive coverage seed`,
      primarySpellId: 0,
      aliasSpellIds: [] as number[],
      activationSpellIds: [] as number[],
      activationBuffIds: [] as number[],
      triggeredEffectIds: [] as number[],
      classSlug: row.classSlug,
      allowedSpecSlugs: [row.specSlug],
      allowedRoleSlugs: [row.role],
      cooldownCategory: null,
      activationEventTypes: ["cast" as const],
      activationSource: null,
      expectedCooldownSeconds: null,
      charges: null,
      classificationConfidence: 0,
      reviewStatus: "CANDIDATE" as const,
      provenance: {
        source: provenanceSourceForKind("BLIZZARD_GAME_DATA"),
        sourceId: `playable-class:${row.blizzardClassId}/spec:${row.blizzardSpecId}`,
        verifiedAt: CATALOG_VERIFIED_AT,
        gameVersion,
        notes: "Class/spec coverage seed from Blizzard playable indexes — not an ability.",
        certainty: "verified" as const,
      },
      notes: [
        "Coverage seed only — ensures builder enumerates every playable specialization.",
        `blizzardClassId=${row.blizzardClassId}`,
        `blizzardSpecId=${row.blizzardSpecId}`,
        `classSupport=${row.supportState}`,
      ],
      matchedCanonicalKey: null,
    }));

    return {
      meta: this.meta,
      gameVersion,
      catalogVersion,
      generatedAt: new Date().toISOString(),
      candidates,
    };
  },
};
