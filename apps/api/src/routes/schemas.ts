/**
 * Shared Fastify JSON Schema fragments for request/response validation + OpenAPI generation.
 *
 * Fastify's response schemas double as a serialization allow-list (fast-json-stringify), so every
 * DTO field we want to appear in responses must be declared here. Dynamic/unknown-shaped sub-objects
 * (explanation, config, evidence, contributors, ...) intentionally omit `properties` and set
 * `additionalProperties: true` so their contents pass through untouched without over-specifying a
 * shape those internal domains (scoring/mechanics) may still evolve.
 */

export const errorResponseSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" },
        retryable: { type: "boolean" },
        details: {},
      },
      required: ["code", "message", "requestId"],
      additionalProperties: true,
    },
  },
  required: ["error"],
} as const;

export const identityParamsSchema = {
  type: "object",
  properties: {
    region: { type: "string", minLength: 1, maxLength: 8 },
    realm: { type: "string", minLength: 1, maxLength: 64 },
    name: { type: "string", minLength: 1, maxLength: 48 },
  },
  required: ["region", "realm", "name"],
} as const;

export const identitySchema = {
  type: "object",
  properties: {
    region: { type: "string" },
    realmSlug: { type: "string" },
    name: { type: "string" },
  },
  required: ["region", "realmSlug", "name"],
  additionalProperties: false,
} as const;

export const dimensionScoreSchema = {
  type: "object",
  properties: {
    dimension: { type: "string" },
    score: { type: ["number", "null"] },
    confidence: { type: "number" },
    weight: { type: "number" },
    state: {
      type: "string",
      enum: ["AVAILABLE", "PARTIAL", "UNAVAILABLE", "PROCESSING", "ERROR"],
    },
    reason: { type: ["string", "null"] },
    contributors: {},
  },
  additionalProperties: true,
} as const;

export const redFlagSchema = {
  type: "object",
  properties: {
    key: { type: "string" },
    label: { type: "string" },
    severity: { type: "string" },
    confidence: { type: "number" },
    public: { type: "boolean" },
    evidence: {},
  },
  additionalProperties: true,
} as const;

export const scoreSnapshotSchema = {
  type: "object",
  properties: {
    characterId: { type: "string" },
    seasonSlug: { type: "string" },
    modelKey: { type: "string" },
    modelVersion: { type: "number" },
    scopeType: { type: "string" },
    scopeKey: { type: ["string", "null"] },
    overallScore: { type: "number" },
    grade: { type: "string" },
    skillScore: { type: "number" },
    authenticityScore: { type: "number" },
    confidence: { type: "number" },
    calculatedAt: { type: "string" },
    inputFingerprint: { type: "string" },
    dimensions: { type: "array", items: dimensionScoreSchema },
    redFlags: { type: "array", items: redFlagSchema },
    explanation: {},
  },
  additionalProperties: true,
} as const;

export const jobStatusSchema = {
  type: "object",
  properties: {
    jobId: { type: "string" },
    queue: { type: "string" },
    status: { type: "string" },
    dedupeKey: { type: ["string", "null"] },
    createdAt: { type: "string" },
    startedAt: { type: ["string", "null"] },
    finishedAt: { type: ["string", "null"] },
    errorMessage: { type: ["string", "null"] },
    // Stage 4 additive ETA / scheduling read-model (nullable when disabled or unavailable).
    activeRefreshCount: { type: ["number", "null"] },
    effectiveWorkerCapacity: { type: ["number", "null"] },
    observedThroughput: { type: ["number", "null"] },
    queuePosition: { type: ["number", "null"] },
    estimatedWaitSeconds: { type: ["number", "null"] },
    estimateConfidence: { type: ["string", "null"] },
    schedulingState: { type: ["string", "null"] },
  },
  additionalProperties: true,
} as const;

export const sourceAttributionSchema = {
  type: "object",
  properties: {
    provider: { type: "string" },
    fetchedAt: { type: "string" },
    url: { type: ["string", "null"] },
    contributedToScore: { type: "boolean" },
    contributionTypes: { type: "array", items: { type: "string" } },
  },
  additionalProperties: true,
} as const;

export const equipmentItemSchema = {
  type: "object",
  properties: {
    slot: { type: "string" },
    itemId: { type: ["number", "null"] },
    name: { type: ["string", "null"] },
    itemLevel: { type: ["number", "null"] },
    quality: { type: ["string", "null"] },
    iconUrl: { type: ["string", "null"] },
    enchantments: { type: "array", items: { type: "string" } },
    gems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          itemId: { type: ["number", "null"] },
        },
        additionalProperties: true,
      },
    },
    bonusList: { type: "array", items: { type: "number" } },
  },
  additionalProperties: true,
} as const;

export const equipmentSummarySchema = {
  type: "object",
  properties: {
    averageItemLevel: { type: ["number", "null"] },
    equippedItemLevel: { type: ["number", "null"] },
    items: { type: "array", items: equipmentItemSchema },
    keyItems: { type: "array", items: equipmentItemSchema },
  },
  additionalProperties: true,
} as const;

export const talentSummarySchema = {
  type: "object",
  properties: {
    specializationSlug: { type: ["string", "null"] },
    loadoutCode: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    loadoutName: { type: ["string", "null"] },
    heroTalentName: { type: ["string", "null"] },
    selectedTalents: {
      type: ["array", "null"],
      items: {
        type: "object",
        properties: {
          id: { type: ["number", "null"] },
          name: { type: ["string", "null"] },
          spellId: { type: ["number", "null"] },
          rank: { type: ["number", "null"] },
          tree: { type: "string" },
          iconUrl: { type: ["string", "null"] },
        },
        additionalProperties: true,
      },
    },
    sourceProvider: { type: ["string", "null"] },
    fetchedAt: { type: ["string", "null"] },
  },
  additionalProperties: true,
} as const;

export const characterMediaSchema = {
  type: "object",
  properties: {
    avatarUrl: { type: ["string", "null"] },
    insetUrl: { type: ["string", "null"] },
    mainRawUrl: { type: ["string", "null"] },
  },
  additionalProperties: true,
} as const;

export const providerStateSchema = {
  type: "object",
  properties: {
    provider: { type: "string" },
    state: { type: "string" },
    detail: { type: ["string", "null"] },
    lastAttemptAt: { type: "string" },
    lastSuccessAt: { type: ["string", "null"] },
    fetchedAt: { type: ["string", "null"] },
    expiresAt: { type: ["string", "null"] },
    wclVisibility: { type: ["string", "null"] },
    wclDataState: { type: ["string", "null"] },
    warnings: { type: "array", items: { type: "string" } },
    contributedToScore: { type: "boolean" },
    contributionTypes: { type: "array", items: { type: "string" } },
    sourceUrl: { type: ["string", "null"] },
  },
  additionalProperties: true,
} as const;

/** Public explainability V2 — strict Fastify allow-list (no internal IDs/hashes/facts). */
export const scoreExplainabilityV2PublicJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string" },
    modelKey: { type: ["string", "null"] },
    modelVersion: { type: ["number", "null"] },
    dataAsOf: { type: ["string", "null"] },
    evidenceCutoffAt: { type: ["string", "null"] },
    coverage: {
      type: "object",
      additionalProperties: false,
      properties: {
        analyzedRunCount: { type: "number" },
        expectedRunCount: { type: "number" },
        representedDungeonCount: { type: "number" },
        expectedDungeonCount: { type: "number" },
        coverageState: { type: "string" },
        publicationState: { type: "string", enum: ["PROVISIONAL", "PUBLISHED"] },
        provisional: { type: "boolean" },
        stale: { type: "boolean" },
        unavailable: { type: "boolean" },
      },
      required: [
        "analyzedRunCount",
        "expectedRunCount",
        "representedDungeonCount",
        "expectedDungeonCount",
        "coverageState",
        "publicationState",
        "provisional",
        "stale",
        "unavailable",
      ],
    },
    selectedRuns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          dungeonSlug: { type: "string" },
          slotIndex: { type: "number", enum: [0, 1] },
          keyLevel: { type: ["number", "null"] },
          timed: { type: ["boolean", "null"] },
          state: { type: "string" },
          hasWclSource: { type: "boolean" },
        },
        required: ["dungeonSlug", "slotIndex", "keyLevel", "timed", "state", "hasWclSource"],
      },
    },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          dimension: {
            type: "string",
            enum: ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"],
          },
          score: { type: ["number", "null"] },
          confidence: { type: "number" },
          availabilityState: {
            type: "string",
            enum: ["AVAILABLE", "PARTIAL", "UNAVAILABLE"],
          },
          gradeU: { type: "boolean" },
          algorithmVersion: { type: "string" },
          topContributors: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string" },
                dimension: { type: "string" },
                label: { type: "string" },
                score: { type: ["number", "null"] },
                direction: { type: "string", enum: ["positive", "negative", "neutral"] },
              },
              required: ["key", "dimension", "label", "score", "direction"],
            },
          },
          limitations: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "partial_coverage",
                "insufficient_evidence",
                "dimension_unavailable",
                "provisional_sample",
              ],
            },
          },
          utilitySemantics: {
            type: "object",
            additionalProperties: false,
            properties: {
              mode: { type: "string", enum: ["OBSERVED_CONTRIBUTION"] },
              notes: { type: "array", items: { type: "string" } },
            },
            required: ["mode", "notes"],
          },
        },
        required: [
          "dimension",
          "score",
          "confidence",
          "availabilityState",
          "gradeU",
          "algorithmVersion",
          "topContributors",
          "limitations",
        ],
      },
    },
    notes: { type: "array", items: { type: "string" } },
    gradeUMeans: { type: "string", enum: ["unavailable_or_unranked"] },
  },
  required: [
    "schemaVersion",
    "modelKey",
    "modelVersion",
    "dataAsOf",
    "evidenceCutoffAt",
    "coverage",
    "selectedRuns",
    "dimensions",
    "notes",
    "gradeUMeans",
  ],
} as const;

export const characterProfileResponseSchema = {
  type: "object",
  properties: {
    characterId: { type: "string" },
    region: { type: "string" },
    realmSlug: { type: "string" },
    realmName: { type: ["string", "null"] },
    displayName: { type: "string" },
    score: { anyOf: [scoreSnapshotSchema, { type: "null" }] },
    redFlags: { type: "array", items: redFlagSchema },
    dataConfidence: { type: ["number", "null"] },
    lastAnalyzedRunId: { type: ["string", "null"] },
    highestAnalyzedRunId: { type: ["string", "null"] },
    sources: { type: "array", items: sourceAttributionSchema },
    refreshStatus: { type: "string" },
    classSlug: { type: ["string", "null"] },
    specSlug: { type: ["string", "null"] },
    role: { type: ["string", "null"] },
    faction: { type: ["string", "null"] },
    level: { type: ["number", "null"] },
    profileUrl: { type: ["string", "null"] },
    itemLevel: { type: ["number", "null"] },
    freshness: { type: ["number", "null"] },
    lastAnalyzedRun: {},
    highestAnalyzedRun: {},
    scoringRunSelection: {},
    equipment: { anyOf: [equipmentSummarySchema, { type: "null" }] },
    talents: { anyOf: [talentSummarySchema, { type: "null" }] },
    media: { anyOf: [characterMediaSchema, { type: "null" }] },
    seasonSummary: {},
    performanceSummary: {},
    survivalSummary: {},
    entitlements: {},
    warnings: { type: "array" },
    bootstrapRepairRequired: { type: "boolean" },
    raiderIoUsed: { type: "boolean" },
    wclVisibility: { type: ["string", "null"] },
    wclDataState: { type: ["string", "null"] },
    providerStates: { type: "array", items: providerStateSchema },
    sourceDisagreements: { type: "array" },
    /**
     * Scoring V2 public explainability — sanitized, no report codes / IDs / hashes.
     * Strict allow-list: unexpected internal fields are stripped by serialization.
     */
    explainabilityV2: {
      anyOf: [scoreExplainabilityV2PublicJsonSchema, { type: "null" }],
    },
  },
  additionalProperties: true,
} as const;

export const refreshStatusResponseSchema = {
  type: "object",
  properties: {
    characterId: { type: "string" },
    refreshStatus: { type: "string" },
    job: { anyOf: [jobStatusSchema, { type: "null" }] },
    cooldownSecondsRemaining: { type: "number" },
    bootstrapRepairRequired: { type: "boolean" },
  },
  additionalProperties: true,
} as const;

export const searchCharacterResponseSchema = {
  type: "object",
  properties: {
    characterId: { type: ["string", "null"] },
    identity: identitySchema,
    refreshStatus: { type: "string" },
    job: { anyOf: [jobStatusSchema, { type: "null" }] },
    score: { anyOf: [scoreSnapshotSchema, { type: "null" }] },
  },
  additionalProperties: true,
} as const;

export const characterAutocompleteSuggestionSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    realmSlug: { type: "string" },
    region: { type: "string" },
    classSlug: { type: ["string", "null"] },
    specSlug: { type: ["string", "null"] },
    avatarUrl: { type: ["string", "null"] },
    classIconUrl: { type: ["string", "null"] },
    source: { type: "string" },
    kind: { type: "string" },
    realmName: { type: ["string", "null"] },
    label: { type: ["string", "null"] },
  },
  required: ["name", "realmSlug", "region", "classSlug", "specSlug", "avatarUrl", "classIconUrl"],
  additionalProperties: false,
} as const;

export const characterAutocompleteResponseSchema = {
  type: "object",
  properties: {
    suggestions: { type: "array", items: characterAutocompleteSuggestionSchema },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

export const historyResponseSchema = {
  type: "object",
  properties: {
    characterId: { type: "string" },
    snapshots: { type: "array", items: scoreSnapshotSchema },
  },
  additionalProperties: true,
} as const;

export const runSummarySchema = {
  type: "object",
  properties: {
    runId: { type: "string" },
    dungeonSlug: { type: "string" },
    seasonSlug: { type: "string" },
    keyLevel: { type: "number" },
    completedAt: { type: "string" },
    durationMs: { type: "number" },
    timerMs: { type: ["number", "null"] },
    timed: { type: "boolean" },
    scoreValue: { type: ["number", "null"] },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: { provider: { type: "string" }, externalUrl: { type: ["string", "null"] } },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
} as const;

export const comparisonEntrySchema = {
  type: "object",
  properties: {
    identity: identitySchema,
    characterId: { type: ["string", "null"] },
    overallScore: { type: ["number", "null"] },
    grade: { type: ["string", "null"] },
    confidence: { type: ["number", "null"] },
    dimensions: { anyOf: [{ type: "array", items: dimensionScoreSchema }, { type: "null" }] },
    rankingEligibility: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
    rankingIncluded: { type: "boolean" },
    deltasFromMedian: { type: "object", additionalProperties: true },
    deltasFromBest: { type: "object", additionalProperties: true },
  },
  additionalProperties: true,
} as const;

export const comparisonResponseSchema = {
  type: "object",
  properties: {
    modelKey: { type: "string" },
    modelVersion: { type: "number" },
    seasonSlug: { type: "string" },
    calculatedAt: { type: "string" },
    entries: { type: "array", items: comparisonEntrySchema },
  },
  additionalProperties: true,
} as const;

export const adminScoreModelSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    key: { type: "string" },
    version: { type: "number" },
    name: { type: "string" },
    status: { type: "string" },
    config: { type: "object", additionalProperties: true },
    createdAt: { type: "string" },
    activatedAt: { type: ["string", "null"] },
  },
  additionalProperties: true,
} as const;

export const mechanicRuleSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    seasonId: { type: "string" },
    dungeonId: { type: "string" },
    npcId: { type: ["number", "null"] },
    spellId: { type: "number" },
    ruleType: { type: "string" },
    severity: { type: "number" },
    applicableRoles: { type: "array", items: { type: "string" } },
    responseSpellIds: { type: "array", items: { type: "number" } },
    notes: { type: ["string", "null"] },
    source: { type: "string" },
    version: { type: "string" },
    active: { type: "boolean" },
  },
  additionalProperties: true,
} as const;

export const scoreModelConfigSchema = {
  type: "object",
  properties: {
    key: { type: "string" },
    version: { type: "integer", minimum: 1 },
    weights: {
      type: "object",
      properties: {
        performance: { type: "number" },
        survival: { type: "number" },
        utility: { type: "number" },
        experienceConsistency: { type: "number" },
        mythicRaid: { type: "number" },
      },
      required: ["performance", "survival", "utility", "experienceConsistency", "mythicRaid"],
    },
    authenticityBlend: {
      type: "object",
      properties: {
        skillWeight: { type: "number" },
        authenticityWeight: { type: "number" },
      },
      required: ["skillWeight", "authenticityWeight"],
    },
    confidenceNeutralScore: { type: "number" },
    gradeThresholds: {
      type: "object",
      properties: {
        S: { type: "number" },
        A: { type: "number" },
        B: { type: "number" },
        C: { type: "number" },
      },
      required: ["S", "A", "B", "C"],
    },
    /** Canonical per-dimension metric weights (seeded v6 shape). */
    metricWeights: { type: "object", additionalProperties: true },
    minConfidenceForGrade: { type: "number" },
    eligibility: { type: "object", additionalProperties: true },
    utilityPublicationEligibility: { type: "object", additionalProperties: true },
    overallFormula: { type: "string" },
  },
  // key/version live on the ScoreModel row; seeded persisted JSON often omits them.
  required: ["weights", "authenticityBlend", "confidenceNeutralScore", "gradeThresholds"],
  additionalProperties: true,
} as const;

export const realmSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    slug: { type: "string" },
    region: { type: "string" },
    locale: { type: ["string", "null"] },
    connectedRealmId: { type: ["number", "null"] },
    displayLabel: { type: "string" },
    timezone: { type: ["string", "null"] },
    category: { type: ["string", "null"] },
    // Backward-compatible fields still returned by some callers
    id: { type: "string" },
    regionCode: { type: "string" },
  },
  additionalProperties: true,
} as const;

export const characterResolveResponseSchema = {
  type: "object",
  properties: {
    status: { type: "string" },
    characterId: { type: "string" },
    refreshId: { type: "string" },
    profilePath: { type: "string" },
    retryAfterMs: { type: "number" },
    message: { type: "string" },
    retryable: { type: "boolean" },
    reason: { type: "string" },
    bootstrapRepairRequired: { type: "boolean" },
  },
  required: ["status"],
  additionalProperties: true,
} as const;

/** Canonical Fastify/OpenAPI schema for POST /api/v1/admin/misc/realms/sync result rows. */
export const adminRealmSyncResultSchema = {
  type: "object",
  properties: {
    region: { type: "string" },
    indexEntries: { type: "integer" },
    rejectedAtIndex: { type: "integer" },
    detailCandidates: { type: "integer" },
    detailsFetched: { type: "integer" },
    eligible: { type: "integer" },
    rejectedTournament: { type: "integer" },
    rejectedInternal: { type: "integer" },
    detailFailures: { type: "integer" },
    retainedLastKnownGood: { type: "integer" },
    newlyDeactivated: { type: "integer" },
    activeCatalogCount: { type: "integer" },
    rejectedSamples: { type: "array", items: { type: "string" } },
    upserted: { type: "integer" },
    minimallyUpserted: { type: "integer" },
    enriched: { type: "integer" },
    enrichmentFailures: { type: "integer" },
    skippedDetails: { type: "integer" },
    errors: { type: "array", items: { type: "string" } },
  },
  required: [
    "region",
    "indexEntries",
    "rejectedAtIndex",
    "detailCandidates",
    "detailsFetched",
    "eligible",
    "rejectedTournament",
    "rejectedInternal",
    "detailFailures",
    "retainedLastKnownGood",
    "newlyDeactivated",
    "activeCatalogCount",
    "rejectedSamples",
    "upserted",
    "minimallyUpserted",
    "enriched",
    "enrichmentFailures",
    "skippedDetails",
    "errors",
  ],
  additionalProperties: false,
} as const;

export const adminRealmSyncResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    results: {
      type: "array",
      items: adminRealmSyncResultSchema,
    },
  },
  required: ["ok", "results"],
  additionalProperties: false,
} as const;
