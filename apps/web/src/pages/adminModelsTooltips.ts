/**
 * Tooltip copy for the Admin Models catalog and editor. Centralized so every
 * model option and lifecycle action gets a consistent "what it means" +
 * "technical details" pair (see FieldTooltip.vue). Keep in sync with
 * apps/web/src/api/model-config validation rules and apps/api/src/routes/admin.ts.
 */
export interface TooltipCopy {
  whatItMeans: string;
  technical: string;
}

export const CATALOG_SEARCH: TooltipCopy = {
  whatItMeans: "Finds models by name, key, or version as you type.",
  technical: "Case-insensitive, trimmed substring match against name, key, and \"v{version}\".",
};

export const CATALOG_STATUS_FILTER: TooltipCopy = {
  whatItMeans:
    "Shows only models in the selected lifecycle state. ACTIVE is the live scoring model; DRAFT is editable and unpublished; ARCHIVED is an immutable prior version.",
  technical: "Filters the local catalog list only — does not change any server-side model state.",
};

export const STATUS_BADGE: Record<"ACTIVE" | "DRAFT" | "ARCHIVED", TooltipCopy> = {
  ACTIVE: {
    whatItMeans: "The single model currently used to score every character. Immutable — clone it to make changes.",
    technical: "Exactly one ACTIVE row per model key; enforced transactionally on activation.",
  },
  DRAFT: {
    whatItMeans: "An editable, unpublished model version. Safe to edit, validate, and backtest before activating.",
    technical: "Never used for live scoring. Deletable only while DRAFT and only if unreferenced by durable history.",
  },
  ARCHIVED: {
    whatItMeans: "A previously ACTIVE model, kept for history. Immutable and cannot be deleted or reactivated.",
    technical: "Set automatically when a newer DRAFT is activated for the same model key.",
  },
};

export const CATALOG_ORDER: TooltipCopy = {
  whatItMeans: "ACTIVE first, then DRAFT (newest first), then ARCHIVED (newest first).",
  technical: "Sort key: status priority (ACTIVE=0, DRAFT=1, ARCHIVED=2), then createdAt descending.",
};

export const ACTION_CLONE: TooltipCopy = {
  whatItMeans: "Creates a new editable DRAFT copy of the ACTIVE model so you can change it safely.",
  technical: "POST /api/v1/admin/score-models/:id/clone — copies config verbatim, allocates the next version.",
};

export const ACTION_VALIDATE_LOCAL: TooltipCopy = {
  whatItMeans: "Checks weights, thresholds, and metric configuration in your browser, without saving anything.",
  technical: "Runs validateModelConfigForm() client-side: weight sums, grade ordering, metricWeights sums per dimension.",
};

export const ACTION_VALIDATE_SERVER: TooltipCopy = {
  whatItMeans: "Saves the draft, then asks the server to validate it using the same rules as activation.",
  technical: "PUT then POST /api/v1/admin/score-models/:id/validate.",
};

export const ACTION_SAVE_DRAFT: TooltipCopy = {
  whatItMeans: "Persists your edits to this DRAFT. Does not affect live scoring.",
  technical: "PUT /api/v1/admin/score-models/:id — rejected if the model is not DRAFT.",
};

export const ACTION_BACKTEST: TooltipCopy = {
  whatItMeans: "Runs this configuration against a sanitized cohort of real characters to preview grade distribution before activating.",
  technical: "POST /api/v1/admin/score-models/:id/backtest — read-only, no scoring recalculation for live characters.",
};

export const ACTION_ACTIVATE: TooltipCopy = {
  whatItMeans:
    "Makes this DRAFT the live scoring model. The current ACTIVE model (if any) becomes ARCHIVED. Enqueues a background recalculation of existing characters.",
  technical: "POST /api/v1/admin/score-models/:id/activate — transactional swap; enqueues RECALCULATE_ONLY bulk operation.",
};

export const ACTION_DELETE_DRAFT: TooltipCopy = {
  whatItMeans:
    "Permanently deletes this DRAFT. Only available for models that were never activated. ACTIVE and ARCHIVED models can never be deleted.",
  technical:
    "DELETE /api/v1/admin/score-models/:id — 409 SCORE_MODEL_NOT_DELETABLE if not DRAFT; 409 SCORE_MODEL_DRAFT_IN_USE with dependency counts if referenced by durable history (snapshots, batches, addon exports, ...).",
};

export const WEIGHTS_GROUP: TooltipCopy = {
  whatItMeans: "How much each of the five skill dimensions contributes to the overall Trust Score. Must add up to 1 (100%).",
  technical: "form.weights.{performance,survival,utility,experienceConsistency,mythicRaid}; validated to sum to ~1 (±0.01).",
};

export const WEIGHT_FIELD: Record<
  "performance" | "survival" | "utility" | "experienceConsistency" | "mythicRaid",
  TooltipCopy
> = {
  performance: {
    whatItMeans: "Weight of dungeon run parse performance (how well runs go) in the overall score.",
    technical: "weights.performance — combined via metricWeights.PERFORMANCE.",
  },
  survival: {
    whatItMeans: "Weight of survivability — deaths, defensive usage, and recovery under pressure.",
    technical: "weights.survival — combined via metricWeights.SURVIVAL.",
  },
  utility: {
    whatItMeans: "Weight of role-specific utility contribution (interrupts, externals, and similar).",
    technical: "weights.utility — combined via metricWeights.UTILITY.",
  },
  experienceConsistency: {
    whatItMeans: "Weight of breadth and consistency of Mythic+ activity across the season and history.",
    technical: "weights.experienceConsistency — combined via metricWeights.EXPERIENCE.",
  },
  mythicRaid: {
    whatItMeans: "Weight of Mythic raid progression.",
    technical: "weights.mythicRaid — combined via metricWeights.RAID.",
  },
};

export const METRIC_WEIGHTS_GROUP: Record<"PERFORMANCE" | "SURVIVAL" | "UTILITY" | "EXPERIENCE" | "RAID", TooltipCopy> = {
  PERFORMANCE: {
    whatItMeans: "The individual signals that make up the Performance dimension score, and how much each counts.",
    technical: "metricWeights.PERFORMANCE — array of { metricKey, weight }; must sum to 1 per dimension.",
  },
  SURVIVAL: {
    whatItMeans: "The individual signals that make up the Survival dimension score, and how much each counts.",
    technical: "metricWeights.SURVIVAL — array of { metricKey, weight }; must sum to 1 per dimension.",
  },
  UTILITY: {
    whatItMeans: "The individual signals that make up the Utility dimension score, and how much each counts.",
    technical: "metricWeights.UTILITY — array of { metricKey, weight }; must sum to 1 per dimension.",
  },
  EXPERIENCE: {
    whatItMeans: "The individual signals that make up the Experience dimension score, and how much each counts.",
    technical: "metricWeights.EXPERIENCE — array of { metricKey, weight }; must sum to 1 per dimension.",
  },
  RAID: {
    whatItMeans: "The individual signals that make up the Mythic Raid dimension score, and how much each counts.",
    technical: "metricWeights.RAID — array of { metricKey, weight }; must sum to 1 per dimension.",
  },
};

export const GRADE_THRESHOLDS_GROUP: TooltipCopy = {
  whatItMeans: "The minimum overall score (0-100) required to earn each letter grade. Must be non-increasing: S ≥ A ≥ B ≥ C.",
  technical: "gradeThresholds.{S,A,B,C}; grades below C fall through to D, and U is reserved for insufficient-confidence results.",
};

export const GRADE_THRESHOLD_FIELD: Record<"S" | "A" | "B" | "C", TooltipCopy> = {
  S: { whatItMeans: "Minimum overall score to earn an S grade.", technical: "gradeThresholds.S" },
  A: { whatItMeans: "Minimum overall score to earn an A grade.", technical: "gradeThresholds.A" },
  B: { whatItMeans: "Minimum overall score to earn a B grade.", technical: "gradeThresholds.B" },
  C: { whatItMeans: "Minimum overall score to earn a C grade.", technical: "gradeThresholds.C" },
};

export const CONFIDENCE_FOR_GRADE: TooltipCopy = {
  whatItMeans: "The minimum confidence a character's score needs before a letter grade (instead of grade U) is shown.",
  technical: "config.minConfidenceForGrade — 0 to 1; below this threshold the published grade is U (unrated).",
};

export const AUTHENTICITY_BLEND_GROUP: TooltipCopy = {
  whatItMeans:
    "How the raw skill score is blended with the authenticity signal (accounting for suspected boosting) to produce the final overall score.",
  technical: "authenticityBlend.{skillWeight,authenticityWeight}; must sum to ~1 (±0.01).",
};

export const AUTHENTICITY_BLEND_FIELD = {
  skillWeight: {
    whatItMeans: "Share of the overall score coming from raw skill performance.",
    technical: "authenticityBlend.skillWeight",
  },
  authenticityWeight: {
    whatItMeans: "Share of the overall score coming from the authenticity (anti-boosting) signal.",
    technical: "authenticityBlend.authenticityWeight",
  },
  confidenceNeutralScore: {
    whatItMeans: "The overall score assumed for a character when there isn't enough data to compute a confident authenticity signal.",
    technical: "confidenceNeutralScore — 0 to 100, used as a neutral fallback rather than penalizing missing data.",
  },
} satisfies Record<string, TooltipCopy>;

export const AUTHENTICITY_TAGS_GROUP: TooltipCopy = {
  whatItMeans:
    "Thresholds that decide when a character is tagged as a suspected boost or an atypical progression pattern for review.",
  technical: "config.authenticityTags.{boostSuspectedBelow,atypicalBelow}; boostSuspectedBelow must be < atypicalBelow.",
};

export const AUTHENTICITY_TAGS_FIELD = {
  boostSuspectedBelow: {
    whatItMeans: "Authenticity scores below this value are flagged as a suspected boost (probabilistic, not a ban).",
    technical: "authenticityTags.boostSuspectedBelow",
  },
  atypicalBelow: {
    whatItMeans: "Authenticity scores below this value (but above the boost threshold) are flagged as atypical progression.",
    technical: "authenticityTags.atypicalBelow",
  },
} satisfies Record<string, TooltipCopy>;

export const CANONICAL_OVERALL_FORMULA: TooltipCopy = {
  whatItMeans: "How the five dimension scores are combined into one overall Trust Score. Read-only — not editable from this UI.",
  technical: "config.overallFormula — e.g. \"WEIGHTED_DIMENSIONS\" combines dimension scores using the weights above.",
};

export const CANONICAL_ELIGIBILITY: TooltipCopy = {
  whatItMeans: "Server-side rules for which characters are eligible to be scored and ranked at all. Read-only from this UI.",
  technical: "config.eligibility — canonical scoring-package defaults; not exposed for editing to avoid drift from the ranking engine.",
};

export const CANONICAL_UTILITY_ELIGIBILITY: TooltipCopy = {
  whatItMeans:
    "Server-side rules for when a character has enough evidence to publish a Utility score at all, instead of showing it as unavailable.",
  technical:
    "config.utilityPublicationEligibility — e.g. minAnalyzedRuns, minConfidence, minEvidenceCoverage, minObservedDomains. Read-only from this UI.",
};

export const DELETE_CONFIRM_INTRO: TooltipCopy = {
  whatItMeans: "This permanently removes the draft. There is no undo.",
  technical: "Deletion is transactional: the server re-checks status and durable-history references at delete time, not at page-load time.",
};
