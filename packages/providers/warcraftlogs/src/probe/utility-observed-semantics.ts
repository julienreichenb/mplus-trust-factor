/**
 * Utility OBSERVED_CONTRIBUTION — formal score semantics (production-candidate).
 *
 * This is an observed-positive-contribution score, NOT a complete
 * personal utility-efficiency score. It must never claim to measure misses.
 */
export const UTILITY_OBSERVED_SCORE_SEMANTICS = {
  version: "utility-observed-semantics-v1",
  scoreKind: "observed_positive_contribution" as const,
  notACompleteEfficiencyScore: true,
  rules: [
    "Directly observed useful player actions may raise the score above neutral (50).",
    "Absence of an observed action must not lower any domain or the aggregate below 50.",
    "Zero attributable evidence ⇒ aggregate remains 50 with low confidence.",
    "SUCCESS_OTHER_PLAYER is never credited to the evaluated player.",
    "Unobservable non-actions (range/LoS misses) are never scored as penalties.",
    "Toolkit-inapplicable domains are neutral (excluded from weight renormalization) and must not reduce confidence as missing evidence.",
  ],
  trustWeightAssessment: {
    configuredUtilityWeight: 0.25,
    weightsChanged: false,
    oneSidedSuitability:
      "Conditional. Suitable for shadow diagnostics. Not yet suitable as a full 25% published Trust dimension without broader bias validation, because observable toolkit density differs by role/class and the model cannot punish true misses.",
    maxSkillPointImpactIfPublishedAtCap: {
      /** |contribution| caps imply raw roughly ≤ 50+8 after renormalization of applicable domains. */
      approxRawCeiling: 66,
      /** 0.25 × (66 − 50) if Utility is included at full weight vs neutral 50. */
      approxMaxSkillDeltaVsNeutral50: 4,
      /** If Utility was UNAVAILABLE (renormalized away) and becomes 66, impact depends on other dims; upper bound ~4–8 skill points. */
      note: "Does not change global Trust weights. Authenticity/confidence blends further damp published Trust.",
    },
    playersWithNoObservableEvidence: {
      preferredPublicationBehavior: "UNAVAILABLE (exclude from skill renormalization) — zero penalty",
      ifForcedNeutral50LowConfidence:
        "Skill contribution ~0 when dimension confidence→0; Trust confidence blend pulls toward neutral",
      mustNot: "Must not score below 50 or invent miss penalties",
    },
  },
} as const;
