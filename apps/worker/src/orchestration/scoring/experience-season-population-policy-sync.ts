/**
 * Experience Phase 1 — explicit SeasonPopulationPolicy sync from Raider.IO cutoffs.
 *
 * Not wired into refresh, scoring, cron, or worker bootstrap.
 * Caller must supply the Raider.IO season slug explicitly (never inferred from Blizzard IDs).
 */

import type {
  ProviderFetchContext,
  ProviderResult,
  RaiderIoProvider,
  RaiderIoSeasonCutoffs,
  RegionCode,
} from "@mplus/contracts";
import type { Prisma, PrismaClient } from "@mplus/database";
import {
  buildSeasonPopulationPolicy,
  type SeasonPopulationPolicy,
} from "@mplus/scoring";
import {
  EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION,
  hashSeasonPopulationPolicyContent,
  mergeExperiencePopulationPolicyMetadata,
  readExperiencePopulationPolicyMetadata,
  type PersistedExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";

export type SeasonPopulationPolicyRaiderIoPort = Pick<RaiderIoProvider, "getSeasonCutoffs">;

export type PersistProviderResultFn = (
  result: ProviderResult<unknown>,
) => Promise<string | null>;

export interface SynchronizeSeasonPopulationPolicyInput {
  prisma: Pick<PrismaClient, "season">;
  seasonId: string;
  regionCode: RegionCode;
  /** Explicit Raider.IO season slug — never derived from internal Season.slug / blizzardSeasonId. */
  raiderIoSeasonSlug: string;
  raiderIo: SeasonPopulationPolicyRaiderIoPort;
  ctx: ProviderFetchContext;
  persistProviderResult: PersistProviderResultFn;
  /** Optional clock for synchronizedAt (tests). Defaults to Date.now ISO. */
  now?: Date;
}

export type SeasonPopulationPolicySyncResult =
  | {
      status: "UPDATED";
      seasonId: string;
      policy: SeasonPopulationPolicy;
      policyContentHash: string;
      sourcePayloadId: string | null;
    }
  | {
      status: "RETAINED_LAST_KNOWN_GOOD";
      seasonId: string;
      reason: string;
      retainedPolicy: SeasonPopulationPolicy;
      retainedPolicyContentHash: string;
    }
  | {
      status: "NO_USABLE_POLICY";
      seasonId: string;
      reason: string;
    }
  | {
      status: "VALIDATION_FAILED";
      seasonId: string;
      reason:
        | "SEASON_NOT_FOUND"
        | "SEASON_REGION_NULL"
        | "REGION_NOT_FOUND"
        | "REGION_MISMATCH"
        | "BLANK_RAIDER_IO_SEASON_SLUG";
    }
  | {
      status: "PROVIDER_FAILURE";
      seasonId: string;
      reason: string;
      cause: unknown;
    }
  | {
      status: "PROVIDER_PERSISTENCE_FAILED";
      seasonId: string;
      reason: string;
      cause: unknown;
    };

function normalizeRegionCode(code: string): string {
  return code.trim().toUpperCase();
}

function retainedOrNone(
  seasonId: string,
  reason: string,
  existing: PersistedExperiencePopulationPolicyMetadata | null,
): SeasonPopulationPolicySyncResult {
  if (existing) {
    return {
      status: "RETAINED_LAST_KNOWN_GOOD",
      seasonId,
      reason,
      retainedPolicy: existing.policy,
      retainedPolicyContentHash: existing.policyContentHash,
    };
  }
  return { status: "NO_USABLE_POLICY", seasonId, reason };
}

/**
 * Fetch Raider.IO season cutoffs once, persist the provider result, and store a
 * COMPLETE/PARTIAL SeasonPopulationPolicy on Season.metadata as Last Known Good.
 *
 * Incomplete / invalid policies never overwrite a prior valid LKG document.
 */
export async function synchronizeSeasonPopulationPolicy(
  input: SynchronizeSeasonPopulationPolicyInput,
): Promise<SeasonPopulationPolicySyncResult> {
  const seasonId = input.seasonId;
  const raiderIoSeasonSlug = input.raiderIoSeasonSlug.trim();
  if (!raiderIoSeasonSlug) {
    return {
      status: "VALIDATION_FAILED",
      seasonId,
      reason: "BLANK_RAIDER_IO_SEASON_SLUG",
    };
  }

  const expectedRegion = normalizeRegionCode(String(input.regionCode));
  if (!expectedRegion) {
    return {
      status: "VALIDATION_FAILED",
      seasonId,
      reason: "REGION_MISMATCH",
    };
  }

  const season = await input.prisma.season.findUnique({
    where: { id: seasonId },
    include: { region: true },
  });

  if (!season) {
    return { status: "VALIDATION_FAILED", seasonId, reason: "SEASON_NOT_FOUND" };
  }
  if (season.regionId == null) {
    return { status: "VALIDATION_FAILED", seasonId, reason: "SEASON_REGION_NULL" };
  }
  if (!season.region) {
    return { status: "VALIDATION_FAILED", seasonId, reason: "REGION_NOT_FOUND" };
  }
  if (normalizeRegionCode(season.region.code) !== expectedRegion) {
    return { status: "VALIDATION_FAILED", seasonId, reason: "REGION_MISMATCH" };
  }

  const priorLkg = readExperiencePopulationPolicyMetadata(season.metadata);

  let providerResult: ProviderResult<RaiderIoSeasonCutoffs>;
  try {
    providerResult = await input.raiderIo.getSeasonCutoffs(
      expectedRegion,
      raiderIoSeasonSlug,
      input.ctx,
    );
  } catch (cause) {
    return {
      status: "PROVIDER_FAILURE",
      seasonId,
      reason: "GET_SEASON_CUTOFFS_THREW",
      cause,
    };
  }

  let sourcePayloadId: string | null;
  try {
    sourcePayloadId = await input.persistProviderResult(providerResult);
  } catch (cause) {
    return {
      status: "PROVIDER_PERSISTENCE_FAILED",
      seasonId,
      reason: "PERSIST_PROVIDER_RESULT_FAILED",
      cause,
    };
  }

  const built = buildSeasonPopulationPolicy(providerResult.data, {
    seasonSlug: raiderIoSeasonSlug,
  });

  if (!built.ok) {
    return retainedOrNone(seasonId, built.reason, priorLkg);
  }

  if (normalizeRegionCode(String(built.policy.region)) !== expectedRegion) {
    return retainedOrNone(seasonId, "POLICY_REGION_MISMATCH", priorLkg);
  }

  if (built.policy.quality === "INSUFFICIENT") {
    return retainedOrNone(seasonId, "INSUFFICIENT_POLICY", priorLkg);
  }

  const now = input.now ?? new Date();
  const synchronizedAt = now.toISOString();
  const policyContentHash = hashSeasonPopulationPolicyContent(built.policy);
  const document: PersistedExperiencePopulationPolicyMetadata = {
    schemaVersion: EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION,
    policy: built.policy,
    raiderIoSeasonSlug,
    policyContentHash,
    sourceRequestFingerprint: providerResult.metadata.requestFingerprint,
    sourcePayloadId,
    sourceFetchedAt: providerResult.freshness.fetchedAt,
    synchronizedAt,
    lastKnownGood: true,
  };

  // Re-read immediately before write to minimize lost updates on unrelated metadata keys.
  const latest = await input.prisma.season.findUnique({
    where: { id: seasonId },
    select: { metadata: true },
  });
  if (!latest) {
    return { status: "VALIDATION_FAILED", seasonId, reason: "SEASON_NOT_FOUND" };
  }

  const merged = mergeExperiencePopulationPolicyMetadata(latest.metadata, document);
  await input.prisma.season.update({
    where: { id: seasonId },
    data: { metadata: merged as Prisma.InputJsonValue },
  });

  return {
    status: "UPDATED",
    seasonId,
    policy: built.policy,
    policyContentHash,
    sourcePayloadId,
  };
}
