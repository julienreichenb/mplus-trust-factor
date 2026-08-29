/**
 * Actionable review-item extraction from a shadow CatalogRefreshReport.
 * Does not touch the database or RETAIL_ABILITY_CATALOG.
 *
 * Digest hashing stays in the API/CLI (Node). Pass reportDigest explicitly so this
 * module stays browser-safe when re-exported from the package barrel.
 */

import type { CatalogRefreshReport, CatalogDiffEntry, SourceObservation } from "../types.js";

/** Bump only when import-plan semantics / item identity format changes. */
export const ABILITY_CATALOG_REVIEW_PLAN_SCHEMA_VERSION = "ability-catalog-review-plan-v3";

export type AbilityCatalogReviewItemKind =
  | "NEW_ABILITY_CANDIDATE"
  | "SPELL_BINDING_REVIEW"
  | "TOPOLOGY_REVIEW"
  | "REMOVAL_REVIEW";

export interface ReviewImportItemDraft {
  kind: AbilityCatalogReviewItemKind;
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
  evidence: Record<string, unknown>;
  sourceProvenance: Record<string, unknown>;
}

export interface ReviewImportPlan {
  /** Source report byte digest (evidence). Distinct from reviewPlanDigest. */
  reportDigest: string;
  schemaVersion: string;
  datasetKind: string;
  wowBuild: string | null;
  simcRevision: string | null;
  blizzardNamespace: string | null;
  blizzardRevision: string | null;
  sourceIdentities: unknown[];
  items: ReviewImportItemDraft[];
  summaryCounts: {
    newAbilityCandidates: number;
    spellBindingReviews: number;
    topologyReviews: number;
    removalReviews: number;
    weakExcluded: number;
    notObservedExcluded: number;
  };
}

export function assertPinnedReportForImport(report: CatalogRefreshReport): void {
  if (report.datasetKind !== "PINNED") {
    throw new Error(
      `FIXTURE_OR_MIXED_REJECTED: review import requires datasetKind=PINNED (got ${report.datasetKind})`,
    );
  }
  if (report.publication !== "NONE") {
    throw new Error(`INVALID_REPORT: publication must be NONE (got ${report.publication})`);
  }
  if (!report.validation?.valid) {
    throw new Error("INVALID_REPORT: report.validation.valid must be true");
  }
}

function provenanceFromDiff(entry: CatalogDiffEntry): Record<string, unknown> {
  return {
    sourceObservations: entry.sourceObservations,
    notes: entry.notes,
  };
}

function candidateEvidenceFromDiffEntry(entry: CatalogDiffEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (entry.candidateKey) out.candidateKey = entry.candidateKey;
  if (entry.cooldownSeconds != null) out.cooldownSeconds = entry.cooldownSeconds;
  if (entry.charges != null) out.charges = entry.charges;
  if (entry.isPassive != null) out.isPassive = entry.isPassive;
  if (entry.ownershipKind) out.ownershipKind = entry.ownershipKind;
  if (entry.validFromBuild) out.validFromBuild = entry.validFromBuild;
  if (entry.validToBuild) out.validToBuild = entry.validToBuild;
  if (entry.candidateBindings?.length) out.candidateBindings = entry.candidateBindings;
  if (entry.sourceObservations?.length) {
    out.sourceObservations = entry.sourceObservations as SourceObservation[];
  }
  return out;
}

function fromDiffEntry(
  kind: AbilityCatalogReviewItemKind,
  entry: CatalogDiffEntry,
  reviewReason: string,
  eligibilityState: string | null = null,
  eligibilityReasons: string[] = [],
): ReviewImportItemDraft {
  const spellId = entry.primarySpellId ?? null;
  const isRacial = entry.raceSlugs.length > 0 && entry.classSlug == null;
  const nameSlug = entry.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const identityKey =
    kind === "TOPOLOGY_REVIEW"
      ? `topology:race:${entry.raceSlugs[0] ?? entry.name}`
      : kind === "NEW_ABILITY_CANDIDATE" && isRacial
        ? `NEW_ABILITY_CANDIDATE:racial:${[...entry.raceSlugs].sort().join("+")}:${nameSlug || spellId}`
        : `${kind}:${spellId ?? entry.currentCanonicalKey ?? entry.candidateKey ?? entry.name}`;

  const racialNotes = entry.notes.filter(
    (n) =>
      n.startsWith("racial-variant-") ||
      n.startsWith("current-retail-ids:") ||
      n.startsWith("historical-ids-excluded:") ||
      n.startsWith("ambiguous-ids:") ||
      n.startsWith("variant:"),
  );

  return {
    kind,
    identityKey,
    primarySpellId: spellId,
    name: entry.name,
    matchedCanonicalKey: entry.currentCanonicalKey ?? null,
    classSlug: entry.classSlug,
    specSlugs: entry.specSlugs ?? [],
    raceSlugs: entry.raceSlugs ?? [],
    eligibilityState,
    eligibilityReasons,
    reviewReason,
    evidence: {
      status: entry.status,
      candidateKey: entry.candidateKey ?? null,
      currentCanonicalKey: entry.currentCanonicalKey ?? null,
      bindingChanges: entry.bindingChanges ?? null,
      metadataChanges: entry.metadataChanges ?? null,
      applicabilityChanges: entry.applicabilityChanges ?? null,
      notes: entry.notes,
      ...candidateEvidenceFromDiffEntry(entry),
      racialVariant: racialNotes.length
        ? {
            currentRetailIds: parseIdList(racialNotes, "current-retail-ids:"),
            historicalIdsExcluded: parseIdList(racialNotes, "historical-ids-excluded:"),
            ambiguousIds: parseIdList(racialNotes, "ambiguous-ids:"),
            validity: racialNotes
              .find((n) => n.startsWith("racial-variant-validity:"))
              ?.slice("racial-variant-validity:".length),
          }
        : null,
    },
    sourceProvenance: provenanceFromDiff(entry),
  };
}

function parseIdList(notes: string[], prefix: string): number[] {
  const line = notes.find((n) => n.startsWith(prefix));
  if (!line) return [];
  const raw = line.slice(prefix.length).trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export interface TopologyClassificationLike {
  races?: Array<{ key: string; kind: string }>;
  classes?: Array<{ key: string; kind: string }>;
  specs?: Array<{ key: string; kind: string }>;
}

/**
 * Build an actionable import plan. Weak/unclassified and merely-not-observed rows are counted but not queued.
 */
export function buildReviewImportPlan(
  report: CatalogRefreshReport,
  options: {
    /** SHA-256 hex of the exact report bytes being imported (computed by Node CLI/API). */
    reportDigest: string;
    topologyClassification?: TopologyClassificationLike;
  },
): ReviewImportPlan {
  assertPinnedReportForImport(report);
  if (!/^[a-f0-9]{64}$/.test(options.reportDigest)) {
    throw new Error("INVALID_REPORT: reportDigest must be a 64-char lowercase SHA-256 hex");
  }
  const review = report.review;
  if (!review) {
    throw new Error("INVALID_REPORT: report.review queues are required for import");
  }

  const items: ReviewImportItemDraft[] = [];

  for (const entry of review.strongNewCandidates) {
    items.push(
      fromDiffEntry(
        "NEW_ABILITY_CANDIDATE",
        entry,
        "STRONG_REVIEW_CANDIDATE missing from current AbilityRule catalog",
        "STRONG_REVIEW_CANDIDATE",
        [],
      ),
    );
  }
  for (const entry of review.bindingReview) {
    items.push(
      fromDiffEntry(
        "SPELL_BINDING_REVIEW",
        entry,
        "SPELL_BINDING_CHANGED between current AbilityRule and external candidate",
      ),
    );
  }
  for (const entry of review.removalReview) {
    items.push(
      fromDiffEntry(
        "REMOVAL_REVIEW",
        entry,
        "Temporal present→absent evidence for a current AbilityRule",
      ),
    );
  }

  const topology = options.topologyClassification;
  for (const race of topology?.races ?? []) {
    if (race.kind !== "EXTERNAL_ONLY") continue;
    items.push({
      kind: "TOPOLOGY_REVIEW",
      identityKey: `topology:race:${race.key}`,
      primarySpellId: null,
      name: race.key,
      matchedCanonicalKey: null,
      classSlug: null,
      specSlugs: [],
      raceSlugs: [race.key],
      eligibilityState: null,
      eligibilityReasons: [],
      reviewReason: "EXTERNAL_ONLY official playable race unknown to local Retail race table",
      evidence: {
        topologyKind: "RACE",
        rowKind: race.kind,
        slug: race.key,
        warnings: (report.validation.warnings ?? []).filter((w) =>
          w.message.toLowerCase().includes(race.key),
        ),
      },
      sourceProvenance: {
        snapshots: report.snapshots,
        note: "External-only topology is a review warning, not malformed external data.",
      },
    });
  }

  const simc = report.snapshots.find((s) => s.source === "SIMULATIONCRAFT");
  const blizzard = report.snapshots.find((s) => s.source === "BLIZZARD");
  return {
    reportDigest: options.reportDigest,
    schemaVersion: ABILITY_CATALOG_REVIEW_PLAN_SCHEMA_VERSION,
    datasetKind: report.datasetKind,
    wowBuild: simc?.validFromBuild ?? blizzard?.validFromBuild ?? null,
    simcRevision: simc?.sourceRevision ?? null,
    blizzardNamespace: blizzard?.blizzardNamespace ?? null,
    blizzardRevision: blizzard?.sourceRevision ?? null,
    sourceIdentities: report.snapshots,
    items: items.sort((a, b) => a.identityKey.localeCompare(b.identityKey)),
    summaryCounts: {
      newAbilityCandidates: review.strongNewCandidates.length,
      spellBindingReviews: review.bindingReview.length,
      topologyReviews: items.filter((i) => i.kind === "TOPOLOGY_REVIEW").length,
      removalReviews: review.removalReview.length,
      weakExcluded: review.weakDiscoveries.length,
      notObservedExcluded: review.currentRulesNotObserved.length,
    },
  };
}

export const CANONICAL_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

export function isValidCanonicalKeyFormat(key: string): boolean {
  return CANONICAL_KEY_PATTERN.test(key);
}

export function normalizeAbilityNameSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function suggestCanonicalKey(input: {
  classSlug: string | null;
  specSlugs?: readonly string[];
  raceSlugs?: readonly string[];
  name: string;
  /** @deprecated Category segments are not used for refresh-sourced new abilities. */
  categoryHint?: string | null;
}): string {
  void input.categoryHint;
  const slug = normalizeAbilityNameSlug(input.name);
  if (!slug) {
    throw new Error("Cannot suggest canonicalKey without ability name");
  }

  const raceSlugs = [...(input.raceSlugs ?? [])].filter(Boolean).sort();
  if (raceSlugs.length > 0 && !input.classSlug) {
    return `shared.racial.${slug}`;
  }

  const cls = input.classSlug ?? "shared";
  const specs = [...(input.specSlugs ?? [])].filter(Boolean).sort();
  if (specs.length >= 1) {
    return `${cls}.${specs[0]}.${slug}`;
  }
  return `${cls}.${slug}`;
}

export function resolveCanonicalKeyCollision(
  baseKey: string,
  reservedKeys: ReadonlySet<string>,
  options?: { spellId?: number | null },
): string {
  if (!isValidCanonicalKeyFormat(baseKey)) {
    throw new Error(`Invalid canonical key format: ${baseKey}`);
  }
  if (!reservedKeys.has(baseKey)) return baseKey;

  // Prefer deterministic spell-id suffix when available (stable across drafts).
  if (options?.spellId != null && options.spellId > 0) {
    const candidate = `${baseKey}-${options.spellId}`;
    if (isValidCanonicalKeyFormat(candidate) && !reservedKeys.has(candidate)) {
      return candidate;
    }
  }

  for (let n = 2; n <= 99; n++) {
    const candidate = `${baseKey}-${n}`;
    if (isValidCanonicalKeyFormat(candidate) && !reservedKeys.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve canonical key collision for ${baseKey}`);
}

export function suggestCuratedCanonicalKey(
  input: {
    classSlug: string | null;
    specSlugs?: readonly string[];
    raceSlugs?: readonly string[];
    name: string;
    primarySpellId?: number | null;
  },
  options?: { reservedKeys?: ReadonlySet<string> },
): string {
  const base = suggestCanonicalKey(input);
  const reserved = options?.reservedKeys ?? new Set<string>();
  return resolveCanonicalKeyCollision(base, reserved, { spellId: input.primarySpellId ?? null });
}
