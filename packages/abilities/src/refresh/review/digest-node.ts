/**
 * Node-only SHA-256 helpers for review-import idempotency.
 * Keep out of browser bundles (do not import from web).
 */

import { createHash } from "node:crypto";
import type { ReviewImportPlan } from "./import-plan.js";
import { ABILITY_CATALOG_REVIEW_PLAN_SCHEMA_VERSION } from "./import-plan.js";

/** Digest of report bytes as imported (UTF-8 file contents preferred). Source snapshot evidence. */
export function digestReportBytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

/**
 * Digest of normalized review-plan semantics (not raw report bytes).
 * Same source + same interpretation → same digest; code/semantic changes → new digest.
 */
export function digestReviewPlan(plan: Omit<ReviewImportPlan, "reportDigest"> & { reportDigest?: string }): string {
  const items = [...plan.items]
    .map((item) => ({
      kind: item.kind,
      identityKey: item.identityKey,
      primarySpellId: item.primarySpellId,
      name: item.name,
      matchedCanonicalKey: item.matchedCanonicalKey,
      classSlug: item.classSlug,
      specSlugs: item.specSlugs,
      raceSlugs: item.raceSlugs,
      eligibilityState: item.eligibilityState,
      eligibilityReasons: item.eligibilityReasons,
      reviewReason: item.reviewReason,
      evidence: item.evidence,
    }))
    .sort((a, b) => a.identityKey.localeCompare(b.identityKey) || a.kind.localeCompare(b.kind));

  const payload = {
    schemaVersion: plan.schemaVersion ?? ABILITY_CATALOG_REVIEW_PLAN_SCHEMA_VERSION,
    datasetKind: plan.datasetKind,
    wowBuild: plan.wowBuild,
    simcRevision: plan.simcRevision,
    blizzardNamespace: plan.blizzardNamespace,
    blizzardRevision: plan.blizzardRevision,
    summaryCounts: plan.summaryCounts,
    items,
  };
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}
