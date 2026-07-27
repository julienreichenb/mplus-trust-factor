import type {
  BlizzardProvider,
  CharacterIdentityInput,
  CharacterSnapshotDTO,
  CanonicalCharacter,
  ProviderFetchContext,
  ProviderResult,
} from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";

function notImplemented(method: string): never {
  throw new ExternalApiError({
    message: `BlizzardProvider.${method} is not implemented (Agent 1 owns live integration)`,
    code: "UNKNOWN",
    provider: "blizzard",
    retryable: false,
  });
}

export class FixtureBlizzardProvider implements BlizzardProvider {
  readonly name = "blizzard" as const;

  async getCharacterProfile(
    _identity: CharacterIdentityInput,
    _ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CanonicalCharacter>> {
    notImplemented("getCharacterProfile");
  }

  async getCharacterEquipment(
    _identity: CharacterIdentityInput,
    _ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CharacterSnapshotDTO>> {
    notImplemented("getCharacterEquipment");
  }

  async getMythicKeystoneProfile(
    _identity: CharacterIdentityInput,
    _ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>> {
    notImplemented("getMythicKeystoneProfile");
  }
}

export function createBlizzardProvider(_mode: "fixture" | "live" = "fixture"): BlizzardProvider {
  return new FixtureBlizzardProvider();
}

export type { BlizzardProvider };
