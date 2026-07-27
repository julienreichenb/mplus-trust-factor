import type { CharacterIdentityInput, RegionCode } from "@mplus/contracts";
import { BaseRaiderIoProvider, type RaiderIoProviderDeps } from "./provider-base.js";
import type { RaiderIoHttpClient } from "./http-client.js";
import type {
  RawCharacterProfileResponse,
  RawPeriodsResponse,
  RawRunDetailsResponse,
  RawSeasonCutoffsResponse,
  RawStaticDataResponse,
} from "./raw-types.js";
import { RAIDERIO_DOCUMENTED_CURRENT_EXPANSION_ID } from "./constants.js";

export interface LiveRaiderIoProviderDeps extends RaiderIoProviderDeps {
  http: RaiderIoHttpClient;
}

export class LiveRaiderIoProvider extends BaseRaiderIoProvider {
  private readonly http: RaiderIoHttpClient;

  constructor(deps: LiveRaiderIoProviderDeps) {
    super(true, deps);
    this.http = deps.http;
  }

  protected async fetchCharacterProfile(
    identity: CharacterIdentityInput,
    fields: string,
  ): Promise<{ raw: RawCharacterProfileResponse; statusCode: number }> {
    const response = await this.http.getJson<RawCharacterProfileResponse>(
      "/api/v1/characters/profile",
      {
        region: identity.region.toLowerCase(),
        realm: identity.realmSlug,
        name: identity.name,
        fields,
      },
      "characters.profile",
    );
    return { raw: response.body, statusCode: response.statusCode };
  }

  protected async fetchSeasonCutoffs(
    region: RegionCode,
    seasonSlug: string,
  ): Promise<{ raw: RawSeasonCutoffsResponse; statusCode: number }> {
    const response = await this.http.getJson<RawSeasonCutoffsResponse>(
      "/api/v1/mythic-plus/season-cutoffs",
      {
        region: region.toLowerCase(),
        season: seasonSlug || undefined,
      },
      "mythic-plus.season-cutoffs",
    );
    return { raw: response.body, statusCode: response.statusCode };
  }

  protected async fetchStaticData(
    expansionId = RAIDERIO_DOCUMENTED_CURRENT_EXPANSION_ID,
  ): Promise<{ raw: RawStaticDataResponse; statusCode: number }> {
    const response = await this.http.getJson<RawStaticDataResponse>(
      "/api/v1/mythic-plus/static-data",
      { expansion_id: String(expansionId) },
      "mythic-plus.static-data",
    );
    return { raw: response.body, statusCode: response.statusCode };
  }

  protected async fetchRunDetails(
    seasonSlug: string,
    externalRunId: string,
    _region: RegionCode,
  ): Promise<{ raw: RawRunDetailsResponse; statusCode: number }> {
    const response = await this.http.getJson<RawRunDetailsResponse>(
      "/api/v1/mythic-plus/run-details",
      { season: seasonSlug, id: externalRunId },
      "mythic-plus.run-details",
    );
    return { raw: response.body, statusCode: response.statusCode };
  }

  protected async fetchPeriods(): Promise<{ raw: RawPeriodsResponse; statusCode: number }> {
    const response = await this.http.getJson<RawPeriodsResponse>(
      "/api/v1/periods",
      {},
      "periods",
    );
    return { raw: response.body, statusCode: response.statusCode };
  }
}
