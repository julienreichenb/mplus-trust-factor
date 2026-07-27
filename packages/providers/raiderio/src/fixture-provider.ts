import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CharacterIdentityInput, RegionCode } from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";
import { BaseRaiderIoProvider, type RaiderIoProviderDeps } from "./provider-base.js";
import type {
  RawCharacterProfileResponse,
  RawPeriodsResponse,
  RawRunDetailsResponse,
  RawSeasonCutoffsResponse,
  RawStaticDataResponse,
} from "./raw-types.js";

const FIXTURE_DIR = path.resolve(
  fileURLToPath(new URL("../../../../tools/fixtures/raiderio", import.meta.url)),
);

async function loadJsonFixture<T>(filename: string): Promise<T> {
  const content = await readFile(path.join(FIXTURE_DIR, filename), "utf8");
  return JSON.parse(content) as T;
}

export class FixtureRaiderIoProvider extends BaseRaiderIoProvider {
  constructor(deps: RaiderIoProviderDeps) {
    super(true, deps);
  }

  protected async fetchCharacterProfile(
    identity: CharacterIdentityInput,
    _fields: string,
  ): Promise<{ raw: RawCharacterProfileResponse; statusCode: number }> {
    const normalizedName = identity.name.toLowerCase();
    if (normalizedName.includes("missing") || normalizedName.includes("notfound")) {
      throw new ExternalApiError({
        message: "Character not found in fixture",
        code: "NOT_FOUND",
        provider: "raiderio",
        retryable: false,
        statusCode: 404,
      });
    }

    if (normalizedName.includes("partial")) {
      const raw = await loadJsonFixture<RawCharacterProfileResponse>("character-profile-partial.json");
      return { raw, statusCode: 200 };
    }

    const raw = await loadJsonFixture<RawCharacterProfileResponse>("character-profile-eu.json");
    return { raw, statusCode: 200 };
  }

  protected async fetchSeasonCutoffs(
    _region: RegionCode,
    _seasonSlug: string,
  ): Promise<{ raw: RawSeasonCutoffsResponse; statusCode: number }> {
    const raw = await loadJsonFixture<RawSeasonCutoffsResponse>("season-cutoffs-eu.json");
    return { raw, statusCode: 200 };
  }

  protected async fetchStaticData(): Promise<{ raw: RawStaticDataResponse; statusCode: number }> {
    const raw = await loadJsonFixture<RawStaticDataResponse>("static-data.json");
    return { raw, statusCode: 200 };
  }

  protected async fetchRunDetails(
    _seasonSlug: string,
    _externalRunId: string,
  ): Promise<{ raw: RawRunDetailsResponse; statusCode: number; region: RegionCode }> {
    const raw = await loadJsonFixture<RawRunDetailsResponse>("run-details.json");
    return { raw, statusCode: 200, region: "EU" };
  }

  protected async fetchPeriods(): Promise<{ raw: RawPeriodsResponse; statusCode: number }> {
    const raw = await loadJsonFixture<RawPeriodsResponse>("periods.json");
    return { raw, statusCode: 200 };
  }
}
