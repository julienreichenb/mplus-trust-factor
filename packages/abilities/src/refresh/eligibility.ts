import type { AbilityRule } from "../types.js";
import { classifyRecordOwnership } from "./scope-classify.js";
import type {
  CatalogEligibilityReason,
  CatalogEligibilityState,
  ExternalAbilityCandidate,
} from "./types.js";

export function assessCatalogEligibility(
  candidate: Omit<ExternalAbilityCandidate, "eligibilityState" | "eligibilityReasons" | "ownershipKind"> &
    Partial<Pick<ExternalAbilityCandidate, "eligibilityState" | "eligibilityReasons" | "ownershipKind">>,
  currentRules: AbilityRule[] = [],
): Pick<ExternalAbilityCandidate, "eligibilityState" | "eligibilityReasons" | "ownershipKind"> {
  const ownershipKind = classifyRecordOwnership({
    classSlug: candidate.classSlug,
    specSlugs: candidate.specSlugs,
    raceSlugs: candidate.raceSlugs,
  });
  const reasons: CatalogEligibilityReason[] = [];
  if (candidate.isPassive === true) reasons.push("PASSIVE");
  if (candidate.isPassive === false) reasons.push("ACTIVE");
  if (candidate.cooldownSeconds != null && candidate.cooldownSeconds > 0) reasons.push("HAS_COOLDOWN");
  if (candidate.charges != null && candidate.charges > 0) reasons.push("HAS_CHARGES");
  if (candidate.classSlug) reasons.push("PLAYABLE_CLASS_OWNED");
  if (ownershipKind === "PLAYABLE_PLAYER" && candidate.specSlugs.length > 0) reasons.push("PLAYABLE_SPEC_OWNED");
  if (ownershipKind === "PLAYABLE_RACE" && candidate.isPassive !== true) reasons.push("RACIAL_ACTIVE");
  if (ownershipKind === "PET_TALENT_TREE") reasons.push("PET_OWNED");
  if (ownershipKind === "PSEUDO_SPEC") reasons.push("PSEUDO_SPEC");
  const matched = currentRules.some(
    (r) => r.spellIds[0] === candidate.primarySpellId || r.canonicalKey === candidate.candidateKey,
  );
  if (matched) reasons.push("MATCHED_CURRENT_RULE");
  if (!candidate.classSlug && candidate.raceSlugs.length === 0 && ownershipKind !== "PET_TALENT_TREE") {
    reasons.push("NO_PLAYABLE_OWNERSHIP");
  }

  let eligibilityState: CatalogEligibilityState = "UNCLASSIFIED";
  if (ownershipKind === "PET_TALENT_TREE" || ownershipKind === "PSEUDO_SPEC" || candidate.isPassive === true) {
    eligibilityState = "EXCLUDED_STRUCTURALLY";
  } else if (
    candidate.isPassive === false &&
    (reasons.includes("PLAYABLE_SPEC_OWNED") || reasons.includes("RACIAL_ACTIVE") || matched) &&
    (reasons.includes("HAS_COOLDOWN") || reasons.includes("HAS_CHARGES") || matched)
  ) {
    eligibilityState = "STRONG_REVIEW_CANDIDATE";
  } else if (candidate.isPassive === false && (ownershipKind === "PLAYABLE_PLAYER" || ownershipKind === "PLAYABLE_RACE")) {
    eligibilityState = "WEAK_REVIEW_CANDIDATE";
  }

  return { eligibilityState, eligibilityReasons: reasons, ownershipKind };
}
