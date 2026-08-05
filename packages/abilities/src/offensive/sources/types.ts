/**
 * Source adapter contracts for offensive catalog discovery.
 * Adapters propose candidates; they never write reviewed canonical entries.
 * Candidate DTOs may use tooling-only fields that are not on AbilityRule.
 */

import type {
  AbilityProvenance,
  ActivationEventType,
  ActivationSource,
  ProvenanceSource,
} from "../../types.js";

/** Tooling-only candidate classification (maps onto AbilityCategory when promoted). */
export type OffensiveCandidateCooldownCategory =
  | "MAJOR"
  | "MINOR"
  | "RACIAL"
  | "ITEM_ON_USE"
  | "EXTERNAL_OFFENSIVE";

/** Tooling-only review lifecycle for candidates / exemptions. */
export type CatalogReviewStatus = "CANDIDATE" | "REVIEWED" | "REJECTED" | "EXEMPT";

export type OffensiveSourceKind =
  | "BLIZZARD_GAME_DATA"
  | "EXISTING_CATALOG"
  | "WCL_OBSERVED"
  | "SIMC_ADVISORY";

export interface OffensiveSourceAdapterMeta {
  kind: OffensiveSourceKind;
  /** Human-readable adapter id, e.g. blizzard-playable-talent-snapshot. */
  adapterId: string;
  /** License / ToS note for the consumed material. */
  licenseNote: string;
  /** Whether this adapter may classify offensive semantics (false for WCL/SimC). */
  mayProposeClassification: boolean;
}

export interface OffensiveCandidateProposal {
  proposedCanonicalKey: string;
  canonicalName: string;
  primarySpellId: number;
  aliasSpellIds: number[];
  activationSpellIds: number[];
  activationBuffIds: number[];
  triggeredEffectIds: number[];
  classSlug: string | null;
  allowedSpecSlugs: string[];
  allowedRoleSlugs: string[];
  cooldownCategory: OffensiveCandidateCooldownCategory | null;
  activationEventTypes: ActivationEventType[];
  activationSource: ActivationSource | null;
  expectedCooldownSeconds: number | null;
  charges: number | null;
  /** Adapter confidence that this is an offensive cooldown (not a filler). */
  classificationConfidence: number;
  reviewStatus: CatalogReviewStatus;
  provenance: AbilityProvenance;
  notes: string[];
  /** Existing catalog key when this candidate matches a reviewed entry. */
  matchedCanonicalKey: string | null;
}

export interface OffensiveSourceSnapshot {
  meta: OffensiveSourceAdapterMeta;
  gameVersion: string;
  catalogVersion: string;
  generatedAt: string;
  candidates: OffensiveCandidateProposal[];
}

export interface OffensiveSourceAdapter {
  meta: OffensiveSourceAdapterMeta;
  /**
   * Load a deterministic snapshot for the configured game build.
   * Prefer reading committed/generated snapshots over live network calls.
   */
  loadSnapshot(input: {
    gameVersion: string;
    catalogVersion: string;
  }): Promise<OffensiveSourceSnapshot> | OffensiveSourceSnapshot;
}

export function provenanceSourceForKind(kind: OffensiveSourceKind): ProvenanceSource {
  switch (kind) {
    case "BLIZZARD_GAME_DATA":
      return "BLIZZARD_API";
    case "EXISTING_CATALOG":
      return "CURATED_OVERRIDE";
    case "WCL_OBSERVED":
      return "WCL_OBSERVED";
    case "SIMC_ADVISORY":
      return "SIMC_ADVISORY";
  }
}
