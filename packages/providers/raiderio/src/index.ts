import type {
  CharacterIdentityInput,
  ProviderFetchContext,
  ProviderResult,
  RaiderIoProvider,
  RegionCode,
} from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";

function notImplemented(method: string): never {
  throw new ExternalApiError({
    message: `RaiderIoProvider.${method} is not implemented (Agent 3 owns live integration)`,
    code: "UNKNOWN",
    provider: "raiderio",
    retryable: false,
  });
}

export class FixtureRaiderIoProvider implements RaiderIoProvider {
  readonly name = "raiderio" as const;

  async getCharacterProfile(
    _identity: CharacterIdentityInput,
    _ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>> {
    notImplemented("getCharacterProfile");
  }

  async getSeasonCutoffs(
    _region: RegionCode,
    _seasonSlug: string,
    _ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>> {
    notImplemented("getSeasonCutoffs");
  }
}

export function createRaiderIoProvider(_mode: "fixture" | "live" = "fixture"): RaiderIoProvider {
  return new FixtureRaiderIoProvider();
}

export type { RaiderIoProvider };
