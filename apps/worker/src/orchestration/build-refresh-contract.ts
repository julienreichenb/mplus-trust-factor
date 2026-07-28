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
  allowFixtureZoneDefault?: boolean;
}

/** Assemble the active refresh contract from package version pins + runtime season/zone. */
export function buildRefreshContract(input: BuildRefreshContractInput): RefreshContractVersions {
  const zoneId =
    input.zoneId !== undefined
      ? input.zoneId
      : resolveMplusZoneConfig({
          env: input.env ?? process.env,
          allowFixtureDefault: input.allowFixtureZoneDefault ?? true,
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
