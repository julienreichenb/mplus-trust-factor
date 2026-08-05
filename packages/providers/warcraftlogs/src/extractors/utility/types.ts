import type { AbilityCategory, AbilityRule } from "@mplus/abilities";
import { dimensionTagsForRule } from "@mplus/abilities";
import type {
  UtilityActionOutcome,
  UtilityActionTimelineV1,
  UtilityCapabilityCompleteness,
  UtilityCapabilityKey,
  UtilityCategory,
  UtilityCatalogGapRow,
} from "@mplus/contracts";

export type UtilityOneFightDataset =
  | "Casts"
  | "Buffs"
  | "Interrupts"
  | "Dispels"
  | "Debuffs"
  | "Deaths"
  | "CombatantInfo"
  | "masterData";

export const UTILITY_PROBE_DATASETS: UtilityOneFightDataset[] = [
  "Casts",
  "Buffs",
  "Interrupts",
  "Dispels",
  "Debuffs",
  "Deaths",
  "CombatantInfo",
  "masterData",
];

/** Datasets required for utility extraction (Buffs optional for target context). */
export const UTILITY_PROBE_REQUIRED_DATASETS: UtilityOneFightDataset[] = [
  "Casts",
  "Interrupts",
  "Dispels",
  "Debuffs",
  "Deaths",
  "CombatantInfo",
  "masterData",
];

export interface UtilityProbeParticipant {
  playerActorId: number;
  characterName: string;
  realmSlug: string;
  regionCode: string;
  classSlug: string | null;
  specSlug: string | null;
  ownedPetActorIds: number[];
}

export interface UtilityProbeSourceIdentity {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  dungeonSlug: string | null;
  keyLevel: number | null;
  fightStartMs: number;
  fightEndMs: number | null;
  region: string | null;
}

export interface UtilityDatasetCoverageRow {
  datasetKey: string;
  pageCount: number;
  eventCount: number;
  complete: boolean;
  truncated: boolean;
  stopReason: string | null;
  coverageRatio: number | null;
  /** How persisted pages were chosen (capability vs legacy). */
  selectionKind?: string;
  scopeFingerprints?: string[];
  selectionLimitations?: string[];
}

export interface UtilityProbePersistenceProof {
  mode: "POSTGRES_ROUND_TRIP";
  artifactId: string;
  contentHash: string;
  storageUriScheme: "pg";
  providerCallsDuringProbe: number;
  providerCallsDuringReload: number;
  reloadedContentHash: string;
  reloadMatched: boolean;
}

export interface UtilityOneFightProbeReport {
  schemaVersion: "wcl-utility-one-fight-v1";
  generatedAt: string;
  sourceIdentity: UtilityProbeSourceIdentity;
  timeline: UtilityActionTimelineV1;
  persistence: UtilityProbePersistenceProof;
  providerCallsDuringProbe: number;
  providerCallsDuringReload: number;
}

export function mapAbilityCategoryToUtilityCategory(
  category: AbilityCategory,
): UtilityCategory | null {
  switch (category) {
    case "INTERRUPT":
      return "INTERRUPT";
    case "PURGE":
      return "OFFENSIVE_DISPEL";
    case "DISPEL":
      return "DEFENSIVE_DISPEL";
    case "HARD_CC":
      return "STOP";
    case "SOFT_CC":
      return "CROWD_CONTROL";
    case "BATTLE_REZ":
      return "COMBAT_RES";
    case "EXTERNAL_DEFENSIVE":
    case "BLOODLUST":
      return "EXTERNAL_SUPPORT";
    case "GROUP_UTILITY":
    case "MOVEMENT_UTILITY":
      return "OTHER_UTILITY";
    default:
      return null;
  }
}

export function isUtilityCatalogRule(rule: AbilityRule): boolean {
  const tags = dimensionTagsForRule(rule);
  if (!tags.some((t) => t.startsWith("UTILITY_"))) return false;
  return mapAbilityCategoryToUtilityCategory(rule.category) != null;
}

export function spellIdsForRule(rule: AbilityRule): number[] {
  return [...new Set([...rule.spellIds, ...(rule.aliases ?? [])])];
}

export function defaultOutcomeForCategory(
  category: UtilityCategory,
  eventTypes: string[],
  dataset: string,
): UtilityActionOutcome {
  if (category === "INTERRUPT") {
    if (dataset === "Interrupts" || eventTypes.some((t) => t.includes("interrupt"))) {
      return "SUCCESS";
    }
    return "ATTEMPT";
  }
  if (category === "DEFENSIVE_DISPEL" || category === "OFFENSIVE_DISPEL") {
    if (dataset === "Dispels" || eventTypes.some((t) => t.includes("dispel"))) {
      return "SUCCESS";
    }
    return "ATTEMPT";
  }
  if (
    eventTypes.some(
      (t) =>
        t === "cast" ||
        t === "applybuff" ||
        t === "applydebuff" ||
        t === "apply",
    )
  ) {
    return "SUCCESS";
  }
  return "UNKNOWN";
}

function datasetPresent(row: UtilityDatasetCoverageRow | undefined): boolean {
  return row != null && row.pageCount > 0;
}

function datasetComplete(row: UtilityDatasetCoverageRow | undefined): boolean {
  return datasetPresent(row) && row!.complete && !row!.truncated;
}

function collectSelectionLimitations(
  row: UtilityDatasetCoverageRow | undefined,
): string[] {
  return row?.selectionLimitations ?? [];
}

export function evaluateUtilityCapabilities(
  coverage: UtilityDatasetCoverageRow[],
): UtilityCapabilityCompleteness[] {
  const byKey = new Map(coverage.map((c) => [c.datasetKey, c]));
  const evalOne = (
    capability: UtilityCapabilityKey,
    required: string[],
  ): UtilityCapabilityCompleteness => {
    const present: string[] = [];
    const incomplete: string[] = [];
    const limitations: string[] = [];
    for (const key of required) {
      const row = byKey.get(key);
      if (!datasetPresent(row)) {
        incomplete.push(key);
        limitations.push(`DATASET_MISSING:${key}`);
        continue;
      }
      present.push(key);
      limitations.push(...collectSelectionLimitations(row));
      if (!datasetComplete(row)) {
        incomplete.push(key);
        limitations.push(
          `DATASET_INCOMPLETE:${key}:${row!.stopReason ?? "unknown"}`,
        );
        if (row?.selectionKind) {
          limitations.push(`SELECTION_KIND:${key}:${row.selectionKind}`);
        }
      }
    }
    const status =
      incomplete.length === 0
        ? "COMPLETE"
        : present.length === 0
          ? "UNAVAILABLE"
          : "INCOMPLETE";
    return {
      capability,
      status,
      requiredDatasets: required,
      presentDatasets: present,
      incompleteDatasets: incomplete,
      limitations: [...new Set(limitations)],
    };
  };

  const casts = byKey.get("Casts");
  const debuffs = byKey.get("Debuffs");
  const ccPresent: string[] = [];
  const ccIncomplete: string[] = [];
  const ccLimitations: string[] = [];
  for (const [key, row] of [
    ["Casts", casts] as const,
    ["Debuffs", debuffs] as const,
  ]) {
    if (!datasetPresent(row)) {
      ccIncomplete.push(key);
      ccLimitations.push(`DATASET_MISSING:${key}`);
      continue;
    }
    ccPresent.push(key);
    ccLimitations.push(...collectSelectionLimitations(row));
    if (!datasetComplete(row)) {
      ccIncomplete.push(key);
      ccLimitations.push(`DATASET_INCOMPLETE:${key}:${row!.stopReason ?? "unknown"}`);
      if (row?.selectionKind) {
        ccLimitations.push(`SELECTION_KIND:${key}:${row.selectionKind}`);
      }
    }
  }
  // Catalog activation: Casts and/or Debuffs — complete when either stream is complete.
  const ccStatus =
    datasetComplete(casts) || datasetComplete(debuffs)
      ? "COMPLETE"
      : ccPresent.length === 0
        ? "UNAVAILABLE"
        : "INCOMPLETE";

  return [
    evalOne("UTILITY_INTERRUPTS", ["Interrupts"]),
    evalOne("UTILITY_DISPELS", ["Dispels"]),
    {
      capability: "UTILITY_CROWD_CONTROL",
      status: ccStatus,
      requiredDatasets: ["Casts", "Debuffs"],
      presentDatasets: ccPresent,
      incompleteDatasets: ccIncomplete,
      limitations: ccStatus === "COMPLETE" ? [] : [...new Set(ccLimitations)],
    },
    evalOne("UTILITY_COMBAT_RES", ["Casts"]),
    evalOne("UTILITY_EXTERNAL_CASTS", ["Casts"]),
    evalOne("UTILITY_EXTERNAL_TARGET_CONTEXT", ["Buffs"]),
  ];
}

export function emptyCountsByCategory(): Record<UtilityCategory, number> {
  return {
    INTERRUPT: 0,
    OFFENSIVE_DISPEL: 0,
    DEFENSIVE_DISPEL: 0,
    CROWD_CONTROL: 0,
    STOP: 0,
    COMBAT_RES: 0,
    EXTERNAL_SUPPORT: 0,
    OTHER_UTILITY: 0,
  };
}

export function isLikelyUtilityGapName(rawName: string | null): boolean {
  if (!rawName) return false;
  const n = rawName.toLowerCase();
  // Avoid substring traps like "Rising Sun Kick" / "Spinning Crane Kick".
  return (
    /\binterrupt\b/.test(n) ||
    /\bcounterspell\b/.test(n) ||
    /\bpummel\b/.test(n) ||
    /\bspell lock\b/.test(n) ||
    /\baxe toss\b/.test(n) ||
    /\bdispel\b/.test(n) ||
    /\bpurge\b/.test(n) ||
    /\bcleanse\b/.test(n) ||
    /\bsinge magic\b/.test(n) ||
    /\bstun\b/.test(n) ||
    /\bfear\b/.test(n) ||
    /\bhex\b/.test(n) ||
    /\bpolymorph\b/.test(n) ||
    /\bbanish\b/.test(n) ||
    /\bincapacitat/.test(n) ||
    /\bsilence\b/.test(n) ||
    /\brebirth\b/.test(n) ||
    /\bbattle res/.test(n) ||
    /\bsoulstone\b/.test(n) ||
    /\braise ally\b/.test(n) ||
    /\bintercession\b/.test(n) ||
    /\bcauterizing flame\b/.test(n)
  );
}

export type { UtilityCatalogGapRow };
