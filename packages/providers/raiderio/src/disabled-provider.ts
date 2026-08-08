import type {
  CharacterIdentityInput,
  ProviderFetchContext,
  ProviderResult,
  RaiderIoCharacterProfile,
  RaiderIoPeriod,
  RaiderIoProvider,
  RaiderIoRunDetails,
  RaiderIoSeasonCutoffs,
  RaiderIoStaticData,
  RegionCode,
} from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";

function disabledError(method: string): never {
  throw new ExternalApiError({
    message: `Raider.IO provider is disabled (${method})`,
    code: "UNKNOWN",
    provider: "raiderio",
    retryable: false,
  });
}

export class DisabledRaiderIoProvider implements RaiderIoProvider {
  readonly name = "raiderio" as const;
  readonly enabled = false;

  async getCharacterProfile(
    _identity: CharacterIdentityInput,
    _ctx: ProviderFetchContext,
  ): Promise<ProviderResult<RaiderIoCharacterProfile>> {
    disabledError("getCharacterProfile");
  }

  async getSeasonCutoffs(
    _region: RegionCode,
    _seasonSlug: string,
    _ctx: ProviderFetchContext,
  ): Promise<ProviderResult<RaiderIoSeasonCutoffs>> {
    disabledError("getSeasonCutoffs");
  }

  async getStaticData(
    _ctx: ProviderFetchContext,
    _options?: { expansionId?: number },
  ): Promise<ProviderResult<RaiderIoStaticData>> {
    disabledError("getStaticData");
  }

  async getRunDetails(
    _seasonSlug: string,
    _externalRunId: string,
    _ctx: ProviderFetchContext,
  ): Promise<ProviderResult<RaiderIoRunDetails>> {
    disabledError("getRunDetails");
  }

  async getPeriods(_ctx: ProviderFetchContext): Promise<ProviderResult<RaiderIoPeriod[]>> {
    disabledError("getPeriods");
  }
}
