import type {
  CharacterIdentityInput,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderResult,
  WarcraftLogsProvider,
} from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";

function notImplemented(method: string): never {
  throw new ExternalApiError({
    message: `WarcraftLogsProvider.${method} is not implemented (Agent 2 owns live integration)`,
    code: "UNKNOWN",
    provider: "warcraftlogs",
    retryable: false,
  });
}

export class FixtureWarcraftLogsProvider implements WarcraftLogsProvider {
  readonly name = "warcraftlogs" as const;

  async discoverCharacterRuns(
    _identity: CharacterIdentityInput,
    _ctx: ProviderFetchContext,
  ): Promise<ProviderResult<MythicRunDTO[]>> {
    notImplemented("discoverCharacterRuns");
  }

  async getReportFightDetails(
    _reportCode: string,
    _fightId: number,
    _ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>> {
    notImplemented("getReportFightDetails");
  }
}

export function createWarcraftLogsProvider(
  _mode: "fixture" | "live" = "fixture",
): WarcraftLogsProvider {
  return new FixtureWarcraftLogsProvider();
}

export type { WarcraftLogsProvider };
