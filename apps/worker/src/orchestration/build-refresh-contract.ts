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
  POINTS_AND_DAMAGE_ADAPTER_VERSION,
  resolveMplusZoneConfig,
} from "@mplus/provider-warcraftlogs";

export type ProviderModeForRefreshContract = "fixture" | "live" | string;

export interface BuildRefreshContractInput {
  scoringModelKey: string;
  scoringModelVersion: number;
  activeSeasonId: string;
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
  /** Prefer explicit values to avoid divergent process.env interpretation. */
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

/**
 * Canonical active refresh-contract resolution for API, worker, discovery, and recalculation.
 * Callers must not re-implement PROVIDER_MODE / APP_ENV fixture branching.
 */
export function resolveActiveRefreshContract(
  input: ResolveActiveRefreshContractInput,
): ResolvedActiveRefreshContract {
  const allowFixtureZoneDefault = allowFixtureZoneDefaultsForProviderMode(input.providerMode);
  const env = input.env ?? process.env;

  const zoneId =
    input.zoneId !== undefined
      ? input.zoneId
      : resolveMplusZoneConfig({
          env,
          allowFixtureDefault: allowFixtureZoneDefault,
        }).zoneId;

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
    env,
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
  const zoneId =
    input.zoneId !== undefined
      ? input.zoneId
      : resolveMplusZoneConfig({
          env: input.env ?? process.env,
          allowFixtureDefault,
        }).zoneId;

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
