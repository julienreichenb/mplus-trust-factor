import type { ReviewImportItemDraft } from "./review/import-plan.js";

export const MPLUS_RELEVANCE_STATES = ["INCLUDED", "EXCLUDED", "UNCLASSIFIED"] as const;
export type MplusRelevance = (typeof MPLUS_RELEVANCE_STATES)[number];

export interface StableAbilityIdentityInput {
  canonicalKey?: string | null;
  primarySpellId?: number | null;
}

/**
 * Canonical durable identity for M+ business decisions.
 * Prefer catalog key when known; otherwise anchor on primary spell id.
 */
export function stableAbilityIdentity(input: StableAbilityIdentityInput): string {
  const canonicalKey = input.canonicalKey?.trim();
  if (canonicalKey) return `canonical:${canonicalKey}`;
  if (input.primarySpellId != null && input.primarySpellId > 0) {
    return `spell:${input.primarySpellId}`;
  }
  throw new Error("Cannot derive stable ability identity without canonicalKey or primarySpellId");
}

export interface MplusRelevanceContext {
  activeCanonicalKeys: ReadonlySet<string>;
  activeSpellIds: ReadonlySet<number>;
  excludedIdentities: ReadonlySet<string>;
}

export function resolveMplusRelevance(
  input: StableAbilityIdentityInput & MplusRelevanceContext,
): MplusRelevance {
  const identities: string[] = [];
  const canonicalKey = input.canonicalKey?.trim() || null;
  if (canonicalKey) identities.push(`canonical:${canonicalKey}`);
  if (input.primarySpellId != null && input.primarySpellId > 0) {
    identities.push(`spell:${input.primarySpellId}`);
  }
  if (identities.some((id) => input.excludedIdentities.has(id))) {
    return "EXCLUDED";
  }
  const inActive =
    (canonicalKey != null && input.activeCanonicalKeys.has(canonicalKey)) ||
    (input.primarySpellId != null &&
      input.primarySpellId > 0 &&
      input.activeSpellIds.has(input.primarySpellId));
  if (inActive) return "INCLUDED";
  return "UNCLASSIFIED";
}

/** Drop review items that should not be re-queued after durable business classification. */
export function filterReviewImportItems(
  items: readonly ReviewImportItemDraft[],
  ctx: MplusRelevanceContext,
): ReviewImportItemDraft[] {
  return items.filter((item) => {
    const relevance = resolveMplusRelevance({
      canonicalKey: item.matchedCanonicalKey,
      primarySpellId: item.primarySpellId,
      ...ctx,
    });
    if (item.kind === "NEW_ABILITY_CANDIDATE") {
      return relevance === "UNCLASSIFIED";
    }
    if (item.kind === "REMOVAL_REVIEW") {
      return relevance !== "EXCLUDED";
    }
    return true;
  });
}

export function collectStableIdentities(input: StableAbilityIdentityInput): string[] {
  const out: string[] = [];
  const canonicalKey = input.canonicalKey?.trim();
  if (canonicalKey) out.push(`canonical:${canonicalKey}`);
  if (input.primarySpellId != null && input.primarySpellId > 0) {
    out.push(`spell:${input.primarySpellId}`);
  }
  return out;
}
