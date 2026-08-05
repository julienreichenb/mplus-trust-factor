import { dimensionTagsForRule } from "../catalog/rule.js";
import { getAllRegisteredRules } from "../registry.js";
import {
  CATALOG_GAME_VERSION,
  CURRENT_CATALOG_VERSION_ID,
} from "../version.js";
import {
  blizzardGameDataAdapter,
  existingCatalogAdapter,
  simcAdvisoryAdapter,
  wclObservedAdapter,
  type OffensiveCandidateProposal,
  type OffensiveSourceAdapter,
  type OffensiveSourceSnapshot,
} from "./sources/index.js";

export interface OffensiveBuildInput {
  gameVersion?: string;
  catalogVersion?: string;
  adapters?: OffensiveSourceAdapter[];
  /** Stable clock for deterministic tests. */
  nowIso?: string;
}

export interface OffensiveCandidateCatalog {
  schemaVersion: "offensive-candidates-v1";
  gameVersion: string;
  catalogVersion: string;
  generatedAt: string;
  sourceSnapshots: OffensiveSourceSnapshot[];
  candidates: OffensiveCandidateProposal[];
  stats: {
    sourceCount: number;
    candidateCount: number;
    matchedReviewedCount: number;
    unmatchedCandidateCount: number;
    coverageSeedCount: number;
  };
}

export interface OffensiveReviewReport {
  schemaVersion: "offensive-review-report-v1";
  gameVersion: string;
  catalogVersion: string;
  generatedAt: string;
  reviewedCanonicalKeys: string[];
  newCandidates: OffensiveCandidateProposal[];
  matchedExisting: OffensiveCandidateProposal[];
  coverageSeeds: OffensiveCandidateProposal[];
  notes: string[];
}

function stableSortCandidates(
  candidates: OffensiveCandidateProposal[],
): OffensiveCandidateProposal[] {
  return [...candidates].sort((a, b) => {
    const keyCmp = a.proposedCanonicalKey.localeCompare(b.proposedCanonicalKey);
    if (keyCmp !== 0) return keyCmp;
    return a.primarySpellId - b.primarySpellId;
  });
}

function dedupeCandidates(
  candidates: OffensiveCandidateProposal[],
): OffensiveCandidateProposal[] {
  const byKey = new Map<string, OffensiveCandidateProposal>();
  for (const c of candidates) {
    const existing = byKey.get(c.proposedCanonicalKey);
    if (!existing) {
      byKey.set(c.proposedCanonicalKey, c);
      continue;
    }
    // Prefer reviewed / higher confidence; never drop matched canonical linkage.
    const prefer =
      (c.reviewStatus === "REVIEWED" && existing.reviewStatus !== "REVIEWED") ||
      (c.matchedCanonicalKey && !existing.matchedCanonicalKey) ||
      c.classificationConfidence > existing.classificationConfidence;
    if (prefer) byKey.set(c.proposedCanonicalKey, c);
  }
  return stableSortCandidates([...byKey.values()]);
}

/** Default adapter set for `pnpm catalog:build:offensive`. */
export function defaultOffensiveAdapters(): OffensiveSourceAdapter[] {
  return [
    blizzardGameDataAdapter,
    existingCatalogAdapter,
    wclObservedAdapter,
    simcAdvisoryAdapter,
  ];
}

/**
 * Build a deterministic offensive candidate catalog + review report.
 * Never mutates reviewed canonical entries in source.
 */
export async function buildOffensiveCandidateCatalog(
  input: OffensiveBuildInput = {},
): Promise<{ catalog: OffensiveCandidateCatalog; review: OffensiveReviewReport }> {
  const gameVersion = input.gameVersion ?? CATALOG_GAME_VERSION;
  const catalogVersion = input.catalogVersion ?? CURRENT_CATALOG_VERSION_ID;
  const generatedAt = input.nowIso ?? new Date().toISOString();
  const adapters = input.adapters ?? defaultOffensiveAdapters();

  const sourceSnapshots: OffensiveSourceSnapshot[] = [];
  for (const adapter of adapters) {
    const snap = await adapter.loadSnapshot({ gameVersion, catalogVersion });
    sourceSnapshots.push({
      ...snap,
      generatedAt,
      candidates: stableSortCandidates(snap.candidates),
    });
  }

  const merged = dedupeCandidates(sourceSnapshots.flatMap((s) => s.candidates));
  const reviewedKeys = new Set(
    getAllRegisteredRules()
      .filter((r) => dimensionTagsForRule(r).includes("PERFORMANCE_OFFENSIVE_COOLDOWN"))
      .map((r) => r.canonicalKey),
  );

  const coverageSeeds = merged.filter((c) => c.primarySpellId === 0);
  const matchedExisting = merged.filter(
    (c) => c.matchedCanonicalKey != null && c.primarySpellId !== 0,
  );
  const newCandidates = merged.filter(
    (c) =>
      c.primarySpellId !== 0 &&
      c.matchedCanonicalKey == null &&
      !reviewedKeys.has(c.proposedCanonicalKey),
  );

  const catalog: OffensiveCandidateCatalog = {
    schemaVersion: "offensive-candidates-v1",
    gameVersion,
    catalogVersion,
    generatedAt,
    sourceSnapshots,
    candidates: merged,
    stats: {
      sourceCount: sourceSnapshots.length,
      candidateCount: merged.length,
      matchedReviewedCount: matchedExisting.length,
      unmatchedCandidateCount: newCandidates.length,
      coverageSeedCount: coverageSeeds.length,
    },
  };

  const review: OffensiveReviewReport = {
    schemaVersion: "offensive-review-report-v1",
    gameVersion,
    catalogVersion,
    generatedAt,
    reviewedCanonicalKeys: [...reviewedKeys].sort(),
    newCandidates,
    matchedExisting,
    coverageSeeds,
    notes: [
      "Reviewed canonical entries are never overwritten by this builder.",
      "Promote candidates by editing packages/abilities/src/catalog/classes/*.ts (or shared racials) after human review.",
      "WCL and SimC adapters are advisory / validation-only for classification.",
    ],
  };

  return { catalog, review };
}
