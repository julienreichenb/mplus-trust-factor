import { z } from "zod";
import type { IsoDateTime } from "./identity.js";

export const ABILITY_CATALOG_REVIEW_ITEM_KINDS = [
  "NEW_ABILITY_CANDIDATE",
  "SPELL_BINDING_REVIEW",
  "TOPOLOGY_REVIEW",
  "REMOVAL_REVIEW",
] as const;

export const abilityCatalogReviewItemKindSchema = z.enum(ABILITY_CATALOG_REVIEW_ITEM_KINDS);

export const NEW_ABILITY_DECISIONS = ["ACCEPT", "REJECT", "DEFER"] as const;
export const BINDING_DECISIONS = ["ACCEPT_PROPOSED", "KEEP_CURRENT", "CUSTOMIZE", "DEFER"] as const;
export const TOPOLOGY_DECISIONS = ["ACCEPT", "REJECT", "DEFER"] as const;
export const REMOVAL_DECISIONS = ["CONFIRM_REMOVAL", "KEEP_CURRENT", "DEFER"] as const;

export const abilitySpellBindingRoleSchema = z.enum([
  "PRIMARY_ACTIVATION",
  "CAST_ALIAS",
  "ACTIVATION_AURA",
  "STACK_AURA",
  "TRIGGERED_EFFECT",
  "SUMMON",
]);

export const draftBindingSchema = z
  .object({
    spellId: z.number().int().positive(),
    role: abilitySpellBindingRoleSchema,
  })
  .strict();

export const curatedDraftFieldsSchema = z
  .object({
    canonicalKey: z.string().min(1).max(200).optional().nullable(),
    name: z.string().min(1).max(200).optional(),
    spellIds: z.array(z.number().int().positive()).optional(),
    bindings: z.array(draftBindingSchema).optional(),
    iconName: z.string().max(120).optional().nullable(),
    classSlug: z.string().max(64).optional().nullable(),
    specSlugs: z.array(z.string().max(64)).optional(),
    raceSlugs: z.array(z.string().max(64)).optional(),
    category: z.string().max(64).optional().nullable(),
    dimensionTags: z.array(z.string().max(64)).optional(),
    availability: z.string().max(64).optional().nullable(),
    cooldownSeconds: z.number().int().nonnegative().optional().nullable(),
    charges: z.number().int().nonnegative().optional().nullable(),
    sourceOwnership: z.string().max(64).optional().nullable(),
    notes: z.string().max(4000).optional().nullable(),
    validFromBuild: z.string().max(64).optional().nullable(),
    validToBuild: z.string().max(64).optional().nullable(),
    provenance: z
      .object({
        source: z.string().max(128).optional().nullable(),
        verifiedAt: z.string().max(64).optional().nullable(),
        gameVersion: z.string().max(128).optional().nullable(),
        notes: z.string().max(4000).optional().nullable(),
      })
      .strict()
      .optional()
      .nullable(),
  })
  .strict();

export const decideAbilityCatalogReviewItemRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    action: z.string().min(1),
    note: z.string().max(4000).optional(),
    draft: curatedDraftFieldsSchema.optional(),
  })
  .strict();

export type DecideAbilityCatalogReviewItemRequest = z.infer<
  typeof decideAbilityCatalogReviewItemRequestSchema
>;

export const updateAbilityCatalogDraftRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    draft: curatedDraftFieldsSchema,
    note: z.string().max(4000).optional(),
  })
  .strict();

export type UpdateAbilityCatalogDraftRequest = z.infer<typeof updateAbilityCatalogDraftRequestSchema>;

export const validateAbilityCatalogDraftRequestSchema = z
  .object({
    draft: curatedDraftFieldsSchema.optional(),
  })
  .strict();

export type ValidateAbilityCatalogDraftRequest = z.infer<
  typeof validateAbilityCatalogDraftRequestSchema
>;

export const designateAbilityCatalogBaselineRequestSchema = z
  .object({
    source: z.enum(["SIMULATIONCRAFT", "BLIZZARD"]),
    sourceRevision: z.string().min(1).max(128),
    wowBuild: z.string().max(64).optional().nullable(),
    dataMode: z.string().max(32).optional().nullable(),
    retrievedAt: z.string().datetime(),
    schemaVersion: z.string().max(128).optional().nullable(),
    extractorVersion: z.string().max(128).optional().nullable(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    artifactId: z.string().uuid().optional().nullable(),
    notes: z.string().max(4000).optional().nullable(),
    activate: z.boolean().optional(),
  })
  .strict();

export type DesignateAbilityCatalogBaselineRequest = z.infer<
  typeof designateAbilityCatalogBaselineRequestSchema
>;

export interface AbilityCatalogDraftValidationDTO {
  status: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW";
  readyForPublishReview: boolean;
  reasonCodes: string[];
  errors: Array<{ severity: "error" | "warning"; code: string; message: string; field?: string }>;
  warnings: Array<{ severity: "error" | "warning"; code: string; message: string; field?: string }>;
}

export interface AbilityCatalogReviewDecisionEventDTO {
  id: string;
  actorUserId: string | null;
  actorType: string;
  previousState: unknown;
  newState: unknown;
  note: string | null;
  createdAt: IsoDateTime;
}

export interface AbilityCatalogReviewBatchDTO {
  id: string;
  reportDigest: string;
  reviewPlanDigest: string;
  datasetKind: string;
  wowBuild: string | null;
  simcRevision: string | null;
  blizzardNamespace: string | null;
  blizzardRevision: string | null;
  status: string;
  summaryCounts: Record<string, number>;
  decisionCounts: {
    total: number;
    pending: number;
    decided: number;
    accepted: number;
    rejected: number;
    deferred: number;
    draftsNeedsMetadata: number;
    draftsReadyForPublishReview: number;
  };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface AbilityCatalogReviewItemDTO {
  id: string;
  batchId: string;
  kind: (typeof ABILITY_CATALOG_REVIEW_ITEM_KINDS)[number];
  identityKey: string;
  primarySpellId: number | null;
  name: string;
  matchedCanonicalKey: string | null;
  classSlug: string | null;
  specSlugs: string[];
  raceSlugs: string[];
  eligibilityState: string | null;
  eligibilityReasons: string[];
  reviewReason: string;
  evidence: unknown;
  sourceProvenance: unknown;
  decisionAction: string | null;
  decisionNote: string | null;
  decidedAt: IsoDateTime | null;
  version: number;
  draftRule: unknown | null;
  draftTopology: unknown | null;
  draftStatus: string | null;
  draftValidation: AbilityCatalogDraftValidationDTO | null;
  decisionEvents: AbilityCatalogReviewDecisionEventDTO[];
  wowheadUrl: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const saveManualCatalogEditRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
    draft: curatedDraftFieldsSchema,
    note: z.string().max(4000).optional(),
  })
  .strict();

export type SaveManualCatalogEditRequest = z.infer<typeof saveManualCatalogEditRequestSchema>;

export interface ManualCatalogEditSummary {
  canonicalKey: string;
  draftRuleId: string;
  version: number;
  status: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW";
  name: string;
}

export interface ManualCatalogEditDetail {
  canonicalKey: string;
  activeRule: unknown;
  draft: unknown | null;
  draftRuleId: string | null;
  draftVersion: number | null;
  draftStatus: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW" | null;
  draftValidation: AbilityCatalogDraftValidationDTO | null;
}
