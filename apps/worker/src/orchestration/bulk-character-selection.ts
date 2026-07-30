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

export function buildBulkLogicalKey(input: {
  mode: BulkMode;
  minMythicPlusScore: number | null;
  scoreModelId?: string | null;
  dryRun?: boolean;
  allowFullRefreshOnIncompatible?: boolean;
  logicalKey?: string | null;
}): string {
  if (input.logicalKey && input.logicalKey.trim().length > 0) {
    return input.logicalKey.trim();
  }
  const threshold = input.minMythicPlusScore === null ? "all" : String(input.minMythicPlusScore);
  const model = input.scoreModelId ?? "active";
  const dry = input.dryRun === true ? "dry" : "live";
  const convert = input.allowFullRefreshOnIncompatible === true ? "convert" : "skip-incompat";
  return `bulk:${input.mode}:${threshold}:${model}:${dry}:${convert}`;
}

export function selectBulkCharacters(input: BulkSelectionInput): BulkSelectionResult {
  const filtered = filterByMythicPlusThreshold(input.characters, input.minMythicPlusScore).sort(
    compareCharacters,
  );
  const capped =
    input.maxCharacters != null && input.maxCharacters > 0
      ? filtered.slice(0, input.maxCharacters)
      : filtered;

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
    input.minMythicPlusScore === null ? "null" : String(input.minMythicPlusScore),
    String(input.maxCharacters ?? ""),
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
