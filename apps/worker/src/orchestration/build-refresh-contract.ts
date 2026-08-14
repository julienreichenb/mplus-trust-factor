import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  OBSERVATION_SCHEMA_VERSION,
  RUN_SELECTION_VERSION,
  hashRefreshContract,
  normalizeRefreshContract,
  type RefreshContractVersions,
} from "@mplus/contracts";
import { MINIMAL_SEED_CATALOG } from "@mplus/mechanics";
import { SCHEMA_VERSION as BLIZZARD_ADAPTER_VERSION } from "@mplus/provider-blizzard";
import { RAIDERIO_SCHEMA_VERSION } from "@mplus/provider-raiderio";
import {
  FIXTURE_MPLUS_ZONE_ID,
  POINTS_AND_DAMAGE_ADAPTER_VERSION,
} from "@mplus/provider-warcraftlogs";

export type ProviderModeForRefreshContract = "fixture" | "live" | string;

export interface BuildRefreshContractInput {
  scoringModelKey: string;
  scoringModelVersion: number;
  activeSeasonId: string;
  /**
   * Effective scoring season WCL zone. Required for live.
   * Fixture mode may omit and use FIXTURE_MPLUS_ZONE_ID when allowFixtureZoneDefault.
   */
  zoneId?: number | null;
  partition?: number | null;
  observationSchemaVersion?: string;
  wclAdapterVersion?: string;
  blizzardAdapterVersion?: string;
  raiderIoAdapterVersion?: string;
  runSelectionVersion?: string;
  abilityCatalogVersion?: string;
  mechanicCatalogVersion?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * When omitted, defaults to false. Prefer `resolveActiveRefreshContract` so
   * API and worker share one PROVIDER_MODE-based decision.
   */
  allowFixtureZoneDefault?: boolean;
}

/**
 * Fixture zone defaults are allowed only when PROVIDER_MODE=fixture.
 * APP_ENV=test / NODE_ENV=test must not enable fixture defaults under live providers.
 */
export function allowFixtureZoneDefaultsForProviderMode(
  providerMode: ProviderModeForRefreshContract | null | undefined,
): boolean {
  return providerMode === "fixture";
}

export interface ResolveActiveRefreshContractInput {
  scoringModelKey: string;
  scoringModelVersion: number;
  activeSeasonId: string;
  /** Canonical gate — never infer fixture defaults from APP_ENV/NODE_ENV alone. */
  providerMode: ProviderModeForRefreshContract;
  env?: NodeJS.ProcessEnv;
  /**
   * Effective scoring season WCL zone from persisted catalog.
   * Required for live provider mode — never resolved from process.env.
   */
  zoneId?: number | null;
  partition?: number | null;
  observationSchemaVersion?: string;
  wclAdapterVersion?: string;
  blizzardAdapterVersion?: string;
  raiderIoAdapterVersion?: string;
  runSelectionVersion?: string;
  abilityCatalogVersion?: string;
  mechanicCatalogVersion?: string;
}

export interface ResolvedActiveRefreshContract {
  contract: RefreshContractVersions;
  hash: string;
  allowFixtureZoneDefault: boolean;
}

function resolveContractZoneId(input: {
  zoneId?: number | null;
  allowFixtureZoneDefault: boolean;
}): number {
  if (input.zoneId != null) {
    if (!Number.isInteger(input.zoneId) || input.zoneId <= 0) {
      throw new Error(`Invalid refresh-contract zoneId: ${input.zoneId}`);
    }
    return input.zoneId;
  }
  if (input.allowFixtureZoneDefault) {
    return FIXTURE_MPLUS_ZONE_ID;
  }
  throw new Error(
    "Refresh contract zoneId is required (effective scoring season catalog). " +
      "process.env Mythic+ zone variables are not authoritative.",
  );
}

/**
 * Canonical active refresh-contract resolution for API, worker, discovery, and recalculation.
 * Callers must not re-implement PROVIDER_MODE / APP_ENV fixture branching.
 * zoneId must come from effective scoring season — never from env.
 */
export function resolveActiveRefreshContract(
  input: ResolveActiveRefreshContractInput,
): ResolvedActiveRefreshContract {
  const allowFixtureZoneDefault = allowFixtureZoneDefaultsForProviderMode(input.providerMode);
  const zoneId = resolveContractZoneId({
    zoneId: input.zoneId,
    allowFixtureZoneDefault,
  });
  const partition = input.partition === undefined ? null : input.partition;

  const contract = buildRefreshContract({
    scoringModelKey: input.scoringModelKey,
    scoringModelVersion: input.scoringModelVersion,
    activeSeasonId: input.activeSeasonId,
    zoneId,
    partition,
    observationSchemaVersion: input.observationSchemaVersion,
    wclAdapterVersion: input.wclAdapterVersion,
    blizzardAdapterVersion: input.blizzardAdapterVersion,
    raiderIoAdapterVersion: input.raiderIoAdapterVersion,
    runSelectionVersion: input.runSelectionVersion,
    abilityCatalogVersion: input.abilityCatalogVersion,
    mechanicCatalogVersion: input.mechanicCatalogVersion,
    allowFixtureZoneDefault,
  });

  return {
    contract,
    hash: hashRefreshContract(contract),
    allowFixtureZoneDefault,
  };
}

/** Assemble the active refresh contract from package version pins + runtime season/zone. */
export function buildRefreshContract(input: BuildRefreshContractInput): RefreshContractVersions {
  const allowFixtureDefault = input.allowFixtureZoneDefault ?? false;
  const zoneId = resolveContractZoneId({
    zoneId: input.zoneId,
    allowFixtureZoneDefault: allowFixtureDefault,
  });

  return normalizeRefreshContract({
    scoringModelKey: input.scoringModelKey,
    scoringModelVersion: input.scoringModelVersion,
    observationSchemaVersion: input.observationSchemaVersion ?? OBSERVATION_SCHEMA_VERSION,
    wclAdapterVersion: input.wclAdapterVersion ?? POINTS_AND_DAMAGE_ADAPTER_VERSION,
    blizzardAdapterVersion: input.blizzardAdapterVersion ?? BLIZZARD_ADAPTER_VERSION,
    raiderIoAdapterVersion: input.raiderIoAdapterVersion ?? RAIDERIO_SCHEMA_VERSION,
    runSelectionVersion: input.runSelectionVersion ?? RUN_SELECTION_VERSION,
    abilityCatalogVersion: input.abilityCatalogVersion ?? CURRENT_CATALOG_VERSION_ID,
    mechanicCatalogVersion:
      input.mechanicCatalogVersion ?? MINIMAL_SEED_CATALOG.catalogVersion,
    activeSeasonId: input.activeSeasonId,
    zoneId,
    partition: input.partition === undefined ? null : input.partition,
  });
}

export function buildRefreshContractHash(input: BuildRefreshContractInput): string {
  return hashRefreshContract(buildRefreshContract(input));
}
