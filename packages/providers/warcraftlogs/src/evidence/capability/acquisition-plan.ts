/**
 * Versioned capability → minimum WCL dataset + filter plan.
 * Does not require every dataset for every dimension.
 */
import {
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
  type AcquisitionMode,
  type EvidenceCapability,
} from "@mplus/contracts";
import type { SharedEvidenceDatasetKey } from "../wcl-run-evidence-types.js";

export type CapabilityFilterStrategy =
  | "NONE"
  | "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"
  | "FRIENDLY_DAMAGE_TAKEN"
  | "FRIENDLY_DEATHS"
  | "METADATA_ONLY";

export interface CapabilityDatasetRequirement {
  dataset: SharedEvidenceDatasetKey;
  required: boolean;
  filterStrategy: CapabilityFilterStrategy;
  includeResources: boolean;
  hostilityType: "Friendlies" | "Enemies" | null;
  /** When true, GraphQL sourceID stays null; multi-actor via filterExpression. */
  partyWide: boolean;
}

export interface CapabilityPlanEntry {
  capability: EvidenceCapability;
  datasets: CapabilityDatasetRequirement[];
}

export interface CapabilityAcquisitionPlanV1 {
  version: typeof CAPABILITY_ACQUISITION_PLAN_VERSION;
  graphqlQueryVersion: typeof WCL_GRAPHQL_QUERY_VERSION;
  mode: AcquisitionMode;
  capabilities: EvidenceCapability[];
  entries: CapabilityPlanEntry[];
  /** Deduped fetch units derived from entries (one shared job). */
  fetchUnits: CapabilityFetchUnit[];
}

export interface CapabilityFetchUnit {
  unitId: string;
  dataset: SharedEvidenceDatasetKey;
  filterStrategy: CapabilityFilterStrategy;
  includeResources: boolean;
  hostilityType: "Friendlies" | "Enemies" | null;
  partyWide: boolean;
  capabilities: EvidenceCapability[];
}

const PRODUCTION_DEFAULT_CAPABILITIES: EvidenceCapability[] = [
  "PERFORMANCE_OFFENSIVE_ACTIVATIONS",
  "SURVIVAL_DEFENSIVE_ACTIVATIONS",
  "SURVIVAL_RECOVERY_ACTIVATIONS",
  "SURVIVAL_DAMAGE_TAKEN",
  "SURVIVAL_DEATHS",
  "UTILITY_INTERRUPTS",
  "UTILITY_DISPELS",
  "UTILITY_CROWD_CONTROL",
  "UTILITY_EXTERNAL_CASTS",
  "UTILITY_EXTERNAL_TARGET_CONTEXT",
  "UTILITY_HOSTILE_CASTS",
  "PARTICIPANT_METADATA",
  "ACTOR_OWNERSHIP",
];

function entry(
  capability: EvidenceCapability,
  datasets: CapabilityDatasetRequirement[],
): CapabilityPlanEntry {
  return { capability, datasets };
}

function req(
  dataset: SharedEvidenceDatasetKey,
  filterStrategy: CapabilityFilterStrategy,
  opts?: Partial<
    Pick<
      CapabilityDatasetRequirement,
      "required" | "includeResources" | "hostilityType" | "partyWide"
    >
  >,
): CapabilityDatasetRequirement {
  return {
    dataset,
    filterStrategy,
    required: opts?.required ?? true,
    includeResources: opts?.includeResources ?? false,
    hostilityType: opts?.hostilityType ?? null,
    partyWide: opts?.partyWide ?? true,
  };
}

const PLAN_BY_CAPABILITY: Record<EvidenceCapability, CapabilityDatasetRequirement[]> = {
  PERFORMANCE_OFFENSIVE_ACTIVATIONS: [
    req("Casts", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
    req("Buffs", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
  ],
  SURVIVAL_DEFENSIVE_ACTIVATIONS: [
    req("Casts", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
    req("Buffs", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
  ],
  SURVIVAL_RECOVERY_ACTIVATIONS: [
    req("Casts", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
    req("Buffs", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
  ],
  SURVIVAL_DAMAGE_TAKEN: [
    req("DamageTaken", "FRIENDLY_DAMAGE_TAKEN", { includeResources: true }),
  ],
  SURVIVAL_DEATHS: [req("Deaths", "FRIENDLY_DEATHS", { includeResources: true })],
  UTILITY_INTERRUPTS: [req("Interrupts", "NONE"), req("Casts", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS")],
  UTILITY_DISPELS: [req("Dispels", "NONE"), req("Casts", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS")],
  UTILITY_CROWD_CONTROL: [
    req("Casts", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
    req("Debuffs", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
  ],
  UTILITY_EXTERNAL_CASTS: [
    req("Casts", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
    req("Buffs", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
  ],
  UTILITY_EXTERNAL_TARGET_CONTEXT: [
    req("Buffs", "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"),
  ],
  UTILITY_HOSTILE_CASTS: [
    req("HostileCasts", "NONE", { hostilityType: "Enemies" }),
  ],
  PARTICIPANT_METADATA: [
    req("masterData", "METADATA_ONLY"),
    req("CombatantInfo", "NONE"),
  ],
  ACTOR_OWNERSHIP: [req("masterData", "METADATA_ONLY")],
};

function fetchUnitKey(reqRow: CapabilityDatasetRequirement): string {
  return [
    reqRow.dataset,
    reqRow.filterStrategy,
    reqRow.includeResources ? "res1" : "res0",
    reqRow.hostilityType ?? "default",
  ].join("|");
}

export function buildCapabilityAcquisitionPlan(input: {
  mode: AcquisitionMode;
  capabilities?: readonly EvidenceCapability[];
}): CapabilityAcquisitionPlanV1 {
  const capabilities = [
    ...(input.capabilities ?? PRODUCTION_DEFAULT_CAPABILITIES),
  ].sort() as EvidenceCapability[];

  const entries: CapabilityPlanEntry[] = capabilities.map((capability) =>
    entry(capability, PLAN_BY_CAPABILITY[capability]),
  );

  // Probe mode may broaden Buffs/Casts to unfiltered streams (explicitly marked).
  if (input.mode === "PROBE_DISCOVERY_ACQUISITION") {
    for (const e of entries) {
      e.datasets = e.datasets.map((d) =>
        d.filterStrategy === "CATALOG_ABILITY_AND_FRIENDLY_ACTORS"
          ? { ...d, filterStrategy: "NONE" as const }
          : d,
      );
    }
  }

  const unitMap = new Map<string, CapabilityFetchUnit>();
  for (const e of entries) {
    for (const d of e.datasets) {
      const key = fetchUnitKey(d);
      const existing = unitMap.get(key);
      if (existing) {
        if (!existing.capabilities.includes(e.capability)) {
          existing.capabilities.push(e.capability);
          existing.capabilities.sort();
        }
        continue;
      }
      unitMap.set(key, {
        unitId: key,
        dataset: d.dataset,
        filterStrategy: d.filterStrategy,
        includeResources: d.includeResources,
        hostilityType: d.hostilityType,
        partyWide: d.partyWide,
        capabilities: [e.capability],
      });
    }
  }

  const fetchUnits = [...unitMap.values()].sort((a, b) =>
    a.unitId.localeCompare(b.unitId),
  );

  return {
    version: CAPABILITY_ACQUISITION_PLAN_VERSION,
    graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
    mode: input.mode,
    capabilities,
    entries,
    fetchUnits,
  };
}

export function productionDefaultCapabilities(): EvidenceCapability[] {
  return [...PRODUCTION_DEFAULT_CAPABILITIES];
}
