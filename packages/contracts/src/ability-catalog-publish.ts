import { z } from "zod";
import type { IsoDateTime } from "./identity.js";

export const ABILITY_CATALOG_PUBLISH_STATUSES = [
  "NO_CHANGES",
  "READY",
  "NEEDS_CLASSIFICATION",
  "BLOCKED",
] as const;

export type AbilityCatalogPublishStatusKind = (typeof ABILITY_CATALOG_PUBLISH_STATUSES)[number];

export const publishAbilityCatalogRequestSchema = z
  .object({
    expectedPreviousActiveId: z.string().uuid().nullable().optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();

export type PublishAbilityCatalogRequest = z.infer<typeof publishAbilityCatalogRequestSchema>;

export interface AbilityCatalogPublishPendingSummary {
  readyDraftCount: number;
  pendingExclusionCount: number;
  confirmedRemovalCount: number;
  readyTopologyCount: number;
  incompleteAcceptedCount: number;
  unclassifiedCandidateCount: number;
  hasPublishableChanges: boolean;
}

export interface AbilityCatalogPublishBlockingIssue {
  code: string;
  message: string;
  reviewItemId?: string;
  canonicalKey?: string;
}

export interface AbilityCatalogPublishStatusDTO {
  status: AbilityCatalogPublishStatusKind;
  activeReleaseId: string | null;
  activeReleaseKey: string | null;
  activeContentDigestShort: string | null;
  pending: AbilityCatalogPublishPendingSummary;
  blockingIssues: AbilityCatalogPublishBlockingIssue[];
  lastSyncAt: IsoDateTime | null;
  lastSyncSimcRevision: string | null;
  lastSyncWowBuild: string | null;
}

export type AbilityCatalogPublishStage =
  | "COMPILE"
  | "VALIDATION"
  | "REPLAY"
  | "ACTIVATION";

export interface AbilityCatalogPublishResultDTO {
  success: boolean;
  stage: AbilityCatalogPublishStage | "COMPLETE";
  previousActive: {
    id: string;
    releaseKey: string;
    contentDigest: string;
  } | null;
  candidateRelease: {
    id: string;
    releaseKey: string;
    contentDigest: string;
    validationStatus: string | null;
    status: string;
  } | null;
  newActive: {
    id: string;
    releaseKey: string;
    contentDigest: string;
    activatedAt: IsoDateTime;
  } | null;
  replay: {
    id: string;
    status: string;
  } | null;
  message: string;
  errors?: string[];
}
