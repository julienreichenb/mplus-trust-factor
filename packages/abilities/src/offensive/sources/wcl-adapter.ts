import {
  CATALOG_GAME_VERSION,
  CATALOG_VERIFIED_AT,
  CURRENT_CATALOG_VERSION_ID,
} from "../../version.js";
import type {
  OffensiveCandidateProposal,
  OffensiveSourceAdapter,
  OffensiveSourceSnapshot,
} from "./types.js";
import { provenanceSourceForKind } from "./types.js";

export interface WclUnmatchedAbilityRow {
  spellId: number;
  observedRawNames: string[];
  eventTypes: string[];
  count: number;
  classSlug?: string | null;
  specSlug?: string | null;
}

/**
 * Warcraft Logs adapter — observed-ID validation only.
 * Never classifies an unmatched spell as an offensive cooldown by itself.
 */
export function createWclObservedAdapter(
  unmatched: WclUnmatchedAbilityRow[] = [],
): OffensiveSourceAdapter {
  return {
    meta: {
      kind: "WCL_OBSERVED",
      adapterId: "wcl-unmatched-ability-summary",
      licenseNote:
        "Warcraft Logs observed spell IDs from persisted evidence — validation source only.",
      mayProposeClassification: false,
    },

    loadSnapshot(input): OffensiveSourceSnapshot {
      const gameVersion = input.gameVersion || CATALOG_GAME_VERSION;
      const catalogVersion = input.catalogVersion || CURRENT_CATALOG_VERSION_ID;
      const candidates: OffensiveCandidateProposal[] = unmatched.map((row) => ({
        proposedCanonicalKey: `wcl.unmatched.${row.spellId}`,
        canonicalName: row.observedRawNames[0] ?? `WCL spell ${row.spellId}`,
        primarySpellId: row.spellId,
        aliasSpellIds: [],
        activationSpellIds: [row.spellId],
        activationBuffIds: [],
        triggeredEffectIds: [],
        classSlug: row.classSlug ?? null,
        allowedSpecSlugs: row.specSlug ? [row.specSlug] : [],
        allowedRoleSlugs: [],
        cooldownCategory: null,
        activationEventTypes: row.eventTypes.includes("cast")
          ? ["cast"]
          : ["applybuff"],
        activationSource: null,
        expectedCooldownSeconds: null,
        charges: null,
        classificationConfidence: 0,
        reviewStatus: "CANDIDATE",
        provenance: {
          source: provenanceSourceForKind("WCL_OBSERVED"),
          sourceId: `spell:${row.spellId}`,
          verifiedAt: CATALOG_VERIFIED_AT,
          gameVersion,
          notes: `Observed ${row.count} time(s) in WCL evidence; not a semantic authority.`,
          certainty: "uncertain",
        },
        notes: [
          "WCL unmatched / observed ID — requires human review before canonical promotion.",
          ...row.observedRawNames.map((n) => `rawName=${n}`),
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
}

/** Default empty WCL adapter (no live requests). */
export const wclObservedAdapter = createWclObservedAdapter([]);
