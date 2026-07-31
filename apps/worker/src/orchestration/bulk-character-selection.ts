import { createHash } from "node:crypto";
import type { BulkMode } from "@mplus/contracts";

/** Conservative baseline provider-call estimate for FULL_REFRESH dry-run planning. */
export const ESTIMATED_WCL_CALLS_PER_FULL_REFRESH = 8;

export interface BulkSelectableCharacter {
  characterId: string;
  region: string;
  realmSlug: string;
  name: string;
  mythicPlusScore: number | null;
  /**
   * Precomputed RECALCULATE_ONLY compatibility.
   * FULL_REFRESH ignores this flag.
   */
  hasCompatibleEvidence: boolean;
  /** Explicit incompatibility reason when hasCompatibleEvidence is false. */
  incompatibilityReason?: string | null;
}

export interface BulkSelectionInput {
  mode: BulkMode;
  minMythicPlusScore: number | null;
  maxCharacters?: number | null;
  allowFullRefreshOnIncompatible?: boolean;
  characters: BulkSelectableCharacter[];
  /**
   * When non-empty, process exactly these IDs in picker order.
   * Cohort threshold / maxCharacters filters are ignored.
   */
  characterIds?: string[] | null;
}

export type BulkSelectionDisposition =
  | "PROCESS"
  | "SKIP_INCOMPATIBLE"
  | "CONVERT_TO_FULL_REFRESH";

export interface BulkSelectedItem {
  characterId: string;
  region: string;
  realmSlug: string;
  name: string;
  mythicPlusScore: number | null;
  position: number;
  disposition: BulkSelectionDisposition;
  evidenceCompatible: boolean;
  skipReason: string | null;
  /** Effective child mode after incompatibility handling. */
  effectiveMode: BulkMode;
}

export interface BulkSelectionResult {
  items: BulkSelectedItem[];
  selectedCount: number;
  skippedIncompatibleCount: number;
  estimatedChildJobs: number;
  estimatedWclCalls: number;
  selectionFingerprint: string;
}

function compareCharacters(a: BulkSelectableCharacter, b: BulkSelectableCharacter): number {
  const scoreA = a.mythicPlusScore ?? Number.NEGATIVE_INFINITY;
  const scoreB = b.mythicPlusScore ?? Number.NEGATIVE_INFINITY;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  if (a.region !== b.region) {
    return a.region.localeCompare(b.region);
  }
  if (a.realmSlug !== b.realmSlug) {
    return a.realmSlug.localeCompare(b.realmSlug);
  }
  if (a.name !== b.name) {
    return a.name.localeCompare(b.name);
  }
  return a.characterId.localeCompare(b.characterId);
}

/** Numeric threshold keeps characters at/above; null keeps all persisted characters. */
export function filterByMythicPlusThreshold(
  characters: BulkSelectableCharacter[],
  minMythicPlusScore: number | null,
): BulkSelectableCharacter[] {
  if (minMythicPlusScore === null) {
    return [...characters];
  }
  return characters.filter(
    (c) => c.mythicPlusScore !== null && c.mythicPlusScore >= minMythicPlusScore,
  );
}

/** Order-independent fingerprint of unique character IDs (SHA-256 hex). */
export function fingerprintCharacterIds(ids: string[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  return createHash("sha256").update(sorted.join("|"), "utf8").digest("hex");
}

export function buildBulkLogicalKey(input: {
  mode: BulkMode;
  minMythicPlusScore: number | null;
  scoreModelId?: string | null;
  dryRun?: boolean;
  allowFullRefreshOnIncompatible?: boolean;
  logicalKey?: string | null;
  characterIds?: string[] | null;
}): string {
  if (input.logicalKey && input.logicalKey.trim().length > 0) {
    return input.logicalKey.trim();
  }
  const model = input.scoreModelId ?? "active";
  const dry = input.dryRun === true ? "dry" : "live";
  const convert = input.allowFullRefreshOnIncompatible === true ? "convert" : "skip-incompat";
  if (input.characterIds != null && input.characterIds.length > 0) {
    const fp = fingerprintCharacterIds(input.characterIds);
    return `bulk:${input.mode}:explicit:${fp}:${model}:${dry}:${convert}`;
  }
  const threshold = input.minMythicPlusScore === null ? "all" : String(input.minMythicPlusScore);
  return `bulk:${input.mode}:${threshold}:${model}:${dry}:${convert}`;
}

function resolveCohortCandidates(input: BulkSelectionInput): BulkSelectableCharacter[] {
  const filtered = filterByMythicPlusThreshold(input.characters, input.minMythicPlusScore).sort(
    compareCharacters,
  );
  if (input.maxCharacters != null && input.maxCharacters > 0) {
    return filtered.slice(0, input.maxCharacters);
  }
  return filtered;
}

function resolveExplicitCandidates(input: BulkSelectionInput): BulkSelectableCharacter[] {
  const ids = input.characterIds ?? [];
  const byId = new Map(input.characters.map((c) => [c.characterId, c]));
  const ordered: BulkSelectableCharacter[] = [];
  for (const id of ids) {
    const character = byId.get(id);
    if (character) {
      ordered.push(character);
    }
  }
  return ordered;
}

export function selectBulkCharacters(input: BulkSelectionInput): BulkSelectionResult {
  const explicit = input.characterIds != null && input.characterIds.length > 0;
  const capped = explicit ? resolveExplicitCandidates(input) : resolveCohortCandidates(input);

  const allowConvert = input.allowFullRefreshOnIncompatible === true;
  const items: BulkSelectedItem[] = [];
  let skippedIncompatibleCount = 0;
  let estimatedChildJobs = 0;
  let estimatedWclCalls = 0;

  for (let i = 0; i < capped.length; i += 1) {
    const character = capped[i]!;
    if (input.mode === "RECALCULATE_ONLY" && !character.hasCompatibleEvidence) {
      const reason = character.incompatibilityReason ?? "INCOMPATIBLE_OR_MISSING_EVIDENCE";
      if (allowConvert) {
        items.push({
          characterId: character.characterId,
          region: character.region,
          realmSlug: character.realmSlug,
          name: character.name,
          mythicPlusScore: character.mythicPlusScore,
          position: i,
          disposition: "CONVERT_TO_FULL_REFRESH",
          evidenceCompatible: false,
          skipReason: `INCOMPATIBLE_EVIDENCE_CONVERTED:${reason}`,
          effectiveMode: "FULL_REFRESH",
        });
        estimatedChildJobs += 1;
        estimatedWclCalls += ESTIMATED_WCL_CALLS_PER_FULL_REFRESH;
        continue;
      }
      skippedIncompatibleCount += 1;
      items.push({
        characterId: character.characterId,
        region: character.region,
        realmSlug: character.realmSlug,
        name: character.name,
        mythicPlusScore: character.mythicPlusScore,
        position: i,
        disposition: "SKIP_INCOMPATIBLE",
        evidenceCompatible: false,
        skipReason: reason,
        effectiveMode: "RECALCULATE_ONLY",
      });
      continue;
    }

    const effectiveMode = input.mode;
    items.push({
      characterId: character.characterId,
      region: character.region,
      realmSlug: character.realmSlug,
      name: character.name,
      mythicPlusScore: character.mythicPlusScore,
      position: i,
      disposition: "PROCESS",
      evidenceCompatible: character.hasCompatibleEvidence,
      skipReason: null,
      effectiveMode,
    });
    estimatedChildJobs += 1;
    if (effectiveMode === "FULL_REFRESH") {
      estimatedWclCalls += ESTIMATED_WCL_CALLS_PER_FULL_REFRESH;
    }
  }

  const fingerprintMaterial = [
    input.mode,
    explicit ? "explicit" : "cohort",
    explicit
      ? fingerprintCharacterIds(input.characterIds ?? [])
      : input.minMythicPlusScore === null
        ? "null"
        : String(input.minMythicPlusScore),
    explicit ? "" : String(input.maxCharacters ?? ""),
    String(allowConvert),
    ...items.map((item) => `${item.position}:${item.characterId}:${item.disposition}`),
  ].join("|");

  return {
    items,
    selectedCount: items.length,
    skippedIncompatibleCount,
    estimatedChildJobs,
    estimatedWclCalls,
    selectionFingerprint: createHash("sha256").update(fingerprintMaterial, "utf8").digest("hex"),
  };
}
