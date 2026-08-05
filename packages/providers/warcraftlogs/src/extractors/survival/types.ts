import type { AbilityCategory, AbilityRole, AbilityRule } from "@mplus/abilities";
import { dimensionTagsForRule, normalizeRetailClassSlug } from "@mplus/abilities";
import type {
  SurvivalActivationKind,
  SurvivalCapabilityCompleteness,
  SurvivalCapabilityKey,
  SurvivalCatalogGapRow,
  SurvivalDefensiveCategory,
} from "@mplus/contracts";
import type { CapabilityCoverageV1, CapabilityEvidencePackageV1 } from "@mplus/contracts";
import { isCapabilityCoverageComplete } from "@mplus/contracts";

export type SurvivalOneFightDataset =
  | "Casts"
  | "Buffs"
  | "DamageTaken"
  | "Deaths"
  | "CombatantInfo"
  | "masterData";

export interface SurvivalProbeParticipant {
  playerActorId: number;
  characterName: string;
  realmSlug: string;
  regionCode: string;
  classSlug: string | null;
  specSlug: string | null;
  role?: AbilityRole | null;
  ownedPetActorIds: number[];
}

export interface SurvivalProbeSourceIdentity {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  dungeonSlug: string | null;
  keyLevel: number | null;
  fightStartMs: number;
  fightEndMs: number | null;
  region: string | null;
}

export interface SurvivalProbePersistenceProof {
  mode: "POSTGRES_ROUND_TRIP";
  artifactId: string;
  contentHash: string;
  storageUriScheme: "pg";
  providerCallsDuringProbe: number;
  providerCallsDuringReload: number;
  reloadedContentHash: string;
  reloadMatched: boolean;
  sharedEvidencePackageContentHash: string;
  allParticipantsSamePackage: boolean;
}

export interface SurvivalOneFightProbeReport {
  schemaVersion: "wcl-survival-one-fight-v1";
  generatedAt: string;
  sourceIdentity: SurvivalProbeSourceIdentity;
  timeline: import("@mplus/contracts").SurvivalActionTimelineV1;
  persistence: SurvivalProbePersistenceProof;
  providerCallsDuringProbe: number;
  providerCallsDuringReload: number;
  storageSchemesRead: string[];
}

const PERSONAL_DEFENSIVE_CATEGORIES = new Set<AbilityCategory>([
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
]);

const RECOVERY_CATEGORIES = new Set<AbilityCategory>(["SELF_HEAL", "CONSUMABLE"]);

export function mapAbilityCategoryToSurvivalDefensive(
  category: AbilityCategory,
): SurvivalDefensiveCategory | null {
  switch (category) {
    case "DEFENSIVE_MAJOR":
      return "DEFENSIVE_MAJOR";
    case "DEFENSIVE_MINOR":
      return "DEFENSIVE_MINOR";
    case "IMMUNITY":
      return "IMMUNITY";
    case "SELF_HEAL":
      return "SELF_HEAL";
    case "CONSUMABLE":
      return "CONSUMABLE";
    case "EXTERNAL_DEFENSIVE":
      return "EXTERNAL_DEFENSIVE";
    default:
      return null;
  }
}

export function survivalActivationKindForCategory(
  category: AbilityCategory,
): SurvivalActivationKind | null {
  if (PERSONAL_DEFENSIVE_CATEGORIES.has(category)) return "PERSONAL_DEFENSIVE";
  if (RECOVERY_CATEGORIES.has(category)) return "RECOVERY";
  if (category === "EXTERNAL_DEFENSIVE") return "EXTERNAL_DEFENSIVE_RECEIVED";
  return null;
}

export function isSurvivalCatalogRule(rule: AbilityRule): boolean {
  const tags = dimensionTagsForRule(rule);
  if (
    tags.includes("SURVIVAL_PERSONAL_DEFENSIVE") ||
    tags.includes("SURVIVAL_RECOVERY")
  ) {
    return mapAbilityCategoryToSurvivalDefensive(rule.category) != null;
  }
  if (rule.category === "EXTERNAL_DEFENSIVE") {
    return true;
  }
  return false;
}

export function spellIdsForRule(rule: AbilityRule): number[] {
  return [
    ...new Set([
      ...rule.spellIds,
      ...(rule.aliases ?? []),
      ...(rule.activationSpellIds ?? []),
      ...(rule.activationBuffIds ?? []),
      ...(rule.triggeredEffectIds ?? []),
    ]),
  ];
}

export function evaluateSurvivalCapabilities(
  coverage: readonly CapabilityCoverageV1[],
): SurvivalCapabilityCompleteness[] {
  const byCap = new Map(coverage.map((c) => [c.capability, c]));

  const evalOne = (
    capability: SurvivalCapabilityKey,
    requiredDatasets: string[],
  ): SurvivalCapabilityCompleteness => {
    const row = byCap.get(capability);
    const present: string[] = [];
    const incomplete: string[] = [];
    const limitations: string[] = [];

    if (!row) {
      return {
        capability,
        status: "UNAVAILABLE",
        requiredDatasets,
        presentDatasets: [],
        incompleteDatasets: requiredDatasets,
        limitations: [`CAPABILITY_MISSING:${capability}`],
      };
    }

    for (const ds of requiredDatasets) {
      if (row.requiredDatasets.includes(ds) || row.pageCount > 0) {
        present.push(ds);
      }
    }
    // Prefer package coverage row completeness over inventing dataset presence.
    if (!isCapabilityCoverageComplete(row)) {
      incomplete.push(...row.requiredDatasets);
      limitations.push(...row.limitations);
      if (row.stopReason) limitations.push(`STOP:${row.stopReason}`);
    } else {
      present.push(...row.requiredDatasets);
    }

    const status = isCapabilityCoverageComplete(row)
      ? "COMPLETE"
      : row.pageCount === 0 && row.eventCount === 0
        ? "UNAVAILABLE"
        : "INCOMPLETE";

    return {
      capability,
      status,
      requiredDatasets,
      presentDatasets: [...new Set(present.length ? present : row.requiredDatasets)],
      incompleteDatasets: [...new Set(incomplete)],
      limitations: [...new Set(limitations)],
    };
  };

  return [
    evalOne("SURVIVAL_DAMAGE_TAKEN", ["DamageTaken"]),
    evalOne("SURVIVAL_DEATHS", ["Deaths"]),
    evalOne("SURVIVAL_DEFENSIVE_ACTIVATIONS", ["Casts", "Buffs"]),
    evalOne("SURVIVAL_RECOVERY_ACTIVATIONS", ["Casts", "Buffs"]),
    evalOne("UTILITY_EXTERNAL_CASTS", ["Casts", "Buffs"]),
    evalOne("UTILITY_EXTERNAL_TARGET_CONTEXT", ["Buffs"]),
    evalOne("PARTICIPANT_METADATA", ["masterData", "CombatantInfo"]),
    evalOne("ACTOR_OWNERSHIP", ["masterData"]),
  ];
}

export function isLikelySurvivalGapName(rawName: string | null): boolean {
  if (!rawName) return false;
  const n = rawName.toLowerCase();
  return (
    /\bshield wall\b/.test(n) ||
    /\bicebound\b/.test(n) ||
    /\bbarkskin\b/.test(n) ||
    /\bsurvival instincts\b/.test(n) ||
    /\bdivine protection\b/.test(n) ||
    /\bdivine shield\b/.test(n) ||
    /\bevasion\b/.test(n) ||
    /\bcloak of shadows\b/.test(n) ||
    /\banti-magic shell\b/.test(n) ||
    /\bfortifying brew\b/.test(n) ||
    /\bdiffuse magic\b/.test(n) ||
    /\bblur\b/.test(n) ||
    /\bastral shift\b/.test(n) ||
    /\bhealthstone\b/.test(n) ||
    /\bhealing potion\b/.test(n) ||
    /\bhealth potion\b/.test(n) ||
    /\bexhilaration\b/.test(n) ||
    /\blay on hands\b/.test(n) ||
    /\bironbark\b/.test(n) ||
    /\bpain suppression\b/.test(n) ||
    /\blife cocoon\b/.test(n) ||
    /\bblessing of protection\b/.test(n) ||
    /\bblessing of sacrifice\b/.test(n) ||
    /\bguardian spirit\b/.test(n)
  );
}

export function proposeGapCategory(
  rawName: string | null,
): SurvivalCatalogGapRow["proposedCategory"] {
  if (!rawName) return "UNKNOWN";
  const n = rawName.toLowerCase();
  if (
    /\bhealthstone\b/.test(n) ||
    /\bhealing potion\b/.test(n) ||
    /\bhealth potion\b/.test(n) ||
    /\bexhilaration\b/.test(n)
  ) {
    return "RECOVERY";
  }
  if (
    /\bironbark\b/.test(n) ||
    /\bpain suppression\b/.test(n) ||
    /\blife cocoon\b/.test(n) ||
    /\bblessing of\b/.test(n) ||
    /\bguardian spirit\b/.test(n) ||
    /\bexternal\b/.test(n)
  ) {
    return "EXTERNAL_DEFENSIVE";
  }
  if (isLikelySurvivalGapName(rawName)) return "PERSONAL_DEFENSIVE";
  return "UNKNOWN";
}

export function gapConfidence(
  proposed: SurvivalCatalogGapRow["proposedCategory"],
  count: number,
): SurvivalCatalogGapRow["proposedConfidence"] {
  if (proposed === "UNKNOWN") return "LOW";
  if (count >= 5) return "HIGH";
  if (count >= 2) return "MEDIUM";
  return "LOW";
}

export function sharedPackageParticipantProof(
  pkg: CapabilityEvidencePackageV1,
  participants: SurvivalProbeParticipant[],
): { allSamePackage: boolean; packageContentHash: string; actorIds: number[] } {
  const actorIds = participants.map((p) => p.playerActorId).sort((a, b) => a - b);
  const packageActors = [...pkg.friendlyPlayerActorIds].sort((a, b) => a - b);
  const allSamePackage =
    actorIds.length === packageActors.length &&
    actorIds.every((id, i) => id === packageActors[i]) &&
    participants.every((p) => pkg.friendlyPlayerActorIds.includes(p.playerActorId));
  return {
    allSamePackage,
    packageContentHash: pkg.contentHash,
    actorIds,
  };
}

export type { SurvivalCatalogGapRow };
