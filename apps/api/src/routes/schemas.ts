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
    region: { type: "string", minLength: 1 },
    realm: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
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
    score: { type: "number" },
    confidence: { type: "number" },
    weight: { type: "number" },
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
  },
  additionalProperties: true,
} as const;

export const sourceAttributionSchema = {
  type: "object",
  properties: {
    provider: { type: "string" },
    fetchedAt: { type: "string" },
    url: { type: ["string", "null"] },
  },
  additionalProperties: true,
} as const;

export const characterProfileResponseSchema = {
  type: "object",
  properties: {
    characterId: { type: "string" },
    region: { type: "string" },
    realmSlug: { type: "string" },
    displayName: { type: "string" },
    score: { anyOf: [scoreSnapshotSchema, { type: "null" }] },
    redFlags: { type: "array", items: redFlagSchema },
    dataConfidence: { type: ["number", "null"] },
    lastAnalyzedRunId: { type: ["string", "null"] },
    highestAnalyzedRunId: { type: ["string", "null"] },
    sources: { type: "array", items: sourceAttributionSchema },
    refreshStatus: { type: "string" },
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
  },
  required: ["key", "version", "weights", "authenticityBlend", "confidenceNeutralScore", "gradeThresholds"],
} as const;

export const realmSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    regionCode: { type: "string" },
    slug: { type: "string" },
    name: { type: "string" },
  },
  additionalProperties: true,
} as const;
