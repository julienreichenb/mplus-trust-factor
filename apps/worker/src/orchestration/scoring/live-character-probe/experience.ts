/**
 * Experience V3 inputs from live Blizzard / Raider.IO (not WCL slots).
 * Read-only — no DB writes, no publication.
 */

import type {
  CharacterIdentityInput,
  CharacterSeasonEvidenceManifestV2,
  ProviderFetchContext,
  RaiderIoCharacterProfile,
} from "@mplus/contracts";
import { LiveBlizzardProvider } from "@mplus/provider-blizzard";
import { createRaiderIoProvider } from "@mplus/provider-raiderio";
import {
  computeExperienceV3,
  createHistoricalRankPolicyV3,
  createPreviousSeasonPolicyV3,
  resolveExperienceProvenance,
  selectScoringRuns,
  type ExperienceHistoryInputs,
  type ExperienceV3ComputeResult,
  type ExperienceV3CurrentExposureFact,
  type ExperienceV3EliteHistoryFact,
  type ExperienceV3PreviousSeasonFact,
} from "@mplus/scoring";

export interface ExperienceProbeResult {
  input: ExperienceHistoryInputs | null;
  result: ExperienceV3ComputeResult | null;
  missingFields: string[];
  failureReasons: string[];
  sourceStatuses: Record<string, string>;
  limitations: string[];
}

function maxIso(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) {
    if (!v) continue;
    if (best == null || v > best) best = v;
  }
  return best;
}

export async function collectAndComputeExperienceV3(input: {
  identity: CharacterIdentityInput;
  ctx: ProviderFetchContext;
  manifest: CharacterSeasonEvidenceManifestV2;
  activeDungeonSlugs: string[];
  computedAt: string;
}): Promise<ExperienceProbeResult> {
  const missingFields: string[] = [];
  const failureReasons: string[] = [];
  const limitations: string[] = [];
  const sourceStatuses: Record<string, string> = {};

  const clientId = process.env.BLIZZARD_CLIENT_ID ?? "";
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    return {
      input: null,
      result: null,
      missingFields: ["BLIZZARD_CLIENT_ID", "BLIZZARD_CLIENT_SECRET"],
      failureReasons: ["blizzard_credentials_missing"],
      sourceStatuses: { blizzard: "NOT_CONFIGURED" },
      limitations: ["blizzard_credentials_missing"],
    };
  }

  const blizzard = new LiveBlizzardProvider({
    clientId,
    clientSecret,
    defaultRegion: input.identity.region.toLowerCase() as "eu" | "us" | "kr" | "tw",
  });

  let seasonSlug = input.manifest.seasonSlug;
  let blizzardRuns: Array<{
    dungeonSlug: string;
    keyLevel: number;
    completedAt: string;
    durationMs: number | null;
    scoreValue: number | null;
    timed: boolean | null;
    canonicalFingerprint: string;
  }> = [];

  try {
    const seasonAuth = await blizzard.resolveAuthoritativeCurrentSeasonId(input.ctx);
    seasonSlug = seasonAuth.data.slug;
    sourceStatuses.blizzardSeason = "OK";

    const seasonProfile = await blizzard.getMythicKeystoneSeasonProfile(
      input.identity,
      seasonAuth.data.seasonId,
      input.ctx,
    );
    sourceStatuses.blizzardSeasonProfile = "OK";
    blizzardRuns = seasonProfile.data.runs.map((r) => ({
      dungeonSlug: r.dungeonSlug,
      keyLevel: r.keyLevel,
      completedAt: r.completedAt,
      durationMs: r.durationMs > 0 ? r.durationMs : null,
      scoreValue: r.scoreValue,
      timed: r.timed,
      canonicalFingerprint: r.canonicalFingerprint,
    }));
  } catch (error) {
    sourceStatuses.blizzard = "FAILED";
    failureReasons.push("blizzard_history_fetch_failed");
    limitations.push(
      error instanceof Error ? `blizzard:${error.message.slice(0, 120)}` : "blizzard_error",
    );
  }

  let rioProfile: RaiderIoCharacterProfile | null = null;
  try {
    const raiderio = createRaiderIoProvider("live");
    const rio = await raiderio.getCharacterProfile(input.identity, input.ctx);
    rioProfile = rio.data;
    sourceStatuses.raiderio = "OK";
  } catch (error) {
    sourceStatuses.raiderio = "FAILED";
    limitations.push(
      error instanceof Error ? `raiderio:${error.message.slice(0, 120)}` : "raiderio_error",
    );
  }

  const expectedDungeonCount = Math.max(1, input.activeDungeonSlugs.length || 8);
  const selection = selectScoringRuns(
    blizzardRuns.map((r) => ({
      canonicalRunId: r.canonicalFingerprint,
      dungeonSlug: r.dungeonSlug,
      keyLevel: r.keyLevel,
      timed: r.timed,
      completedAt: r.completedAt,
      durationMs: r.durationMs,
      scoreValue: r.scoreValue,
      hasWclSource: false,
    })),
    {
      seasonSlug,
      expectedDungeonCount,
      allowedDungeonSlugs: input.activeDungeonSlugs,
    },
  );

  const selectedRuns = selection.selectedRuns.map((r) => ({
    dungeonSlug: r.dungeonSlug,
    keyLevel: r.keyLevel,
    completedAt: r.completedAt,
  }));
  const seasonRuns = blizzardRuns.map((r) => ({
    dungeonSlug: r.dungeonSlug,
    keyLevel: r.keyLevel,
    completedAt: r.completedAt,
  }));

  const rioPrior =
    rioProfile?.previousSeason != null &&
    rioProfile.previousSeason.seasonSlug !== seasonSlug
      ? 1
      : 0;
  const priorSeasonCount = rioPrior;
  const hasHistorySignal =
    selectedRuns.length > 0 || seasonRuns.length > 0 || priorSeasonCount > 0;

  const blizzardOk = sourceStatuses.blizzardSeasonProfile === "OK";
  const raiderIoOk = sourceStatuses.raiderio === "OK";
  const provenance = resolveExperienceProvenance({
    blizzardOk,
    raiderIoOk,
    hasAnyHistorySignal: hasHistorySignal,
  });

  if (!blizzardOk && !hasHistorySignal) {
    missingFields.push("blizzard_current_season_runs");
  }

  const observedAt =
    maxIso(input.computedAt, selectedRuns[0]?.completedAt, rioProfile?.lastCrawledAt) ??
    input.computedAt;

  const currentExposure: ExperienceV3CurrentExposureFact = {
    expectedDungeonCount,
    selectedRuns,
    seasonRuns,
    priorSeasonCount,
    priorSeasonSourceDepth: rioPrior > 0 ? 1 : 0,
    provenance,
    observedAt,
  };

  let previousSeason: ExperienceV3PreviousSeasonFact;
  const rioPrevScore = rioProfile?.previousSeason?.scores?.all ?? null;
  if (rioPrevScore != null) {
    previousSeason = {
      evidenceState: "HAS_VALUE",
      score: rioPrevScore,
      seasonId: rioProfile?.previousSeason?.seasonSlug ?? null,
      seasonSlug: rioProfile?.previousSeason?.seasonSlug ?? null,
      source: "RAIDER_IO",
      sourceConfidence: 0.85,
      fetchedAt: rioProfile?.lastCrawledAt ?? input.computedAt,
    };
  } else if (raiderIoOk) {
    previousSeason = {
      evidenceState: "CONFIRMED_NO_ACTIVITY",
      score: 0,
      seasonId: null,
      seasonSlug: null,
      source: "RAIDER_IO",
      sourceConfidence: 0.8,
      fetchedAt: rioProfile?.lastCrawledAt ?? input.computedAt,
    };
    limitations.push("previous_season_score_absent");
  } else {
    previousSeason = {
      evidenceState: "UNKNOWN",
      score: null,
      seasonId: null,
      seasonSlug: null,
      source: "UNKNOWN",
      sourceConfidence: 0,
      fetchedAt: null,
    };
    missingFields.push("previous_season_score");
  }

  const eliteHistory: ExperienceV3EliteHistoryFact = {
    evidenceState: "UNKNOWN",
    achievements: [],
  };
  limitations.push("elite_achievements_not_collected_in_probe");

  const previousSeasonPolicy = createPreviousSeasonPolicyV3({
    seasonId: previousSeason.seasonId ?? `unknown-prev-${seasonSlug}`,
    seasonSlug: previousSeason.seasonSlug ?? "previous-season-unknown",
    region: input.identity.region.toLowerCase(),
    k50: 2000,
    k90: 2800,
    k99: 3200,
    source: previousSeason.source === "RAIDER_IO" ? "RAIDER_IO" : "MANUAL",
    confidence: 0.7,
  });

  const history: ExperienceHistoryInputs = {
    currentExposure,
    previousSeason,
    previousSeasonPolicy,
    eliteHistory,
    historicalRank: null,
    historicalRankPolicy: createHistoricalRankPolicyV3({ confidence: 0.65 }),
  };

  try {
    const result = computeExperienceV3({
      manifest: {
        contentHash: input.manifest.contentHash,
        schemaVersion: input.manifest.schemaVersion,
        selectorVersion: input.manifest.selectorVersion,
        characterId: input.manifest.characterId,
        seasonId: input.manifest.seasonId,
        seasonSlug: input.manifest.seasonSlug,
        highKeyPolicyId: input.manifest.highKeyPolicyId,
        evidenceCutoffAt: input.manifest.evidenceCutoffAt,
      },
      currentExposure: history.currentExposure,
      previousSeason: history.previousSeason,
      previousSeasonPolicy: history.previousSeasonPolicy,
      eliteHistory: history.eliteHistory,
      historicalRank: history.historicalRank,
      historicalRankPolicy: history.historicalRankPolicy,
      computedAt: input.computedAt,
    });
    return {
      input: history,
      result,
      missingFields,
      failureReasons,
      sourceStatuses,
      limitations,
    };
  } catch (error) {
    failureReasons.push("experience_calculator_threw");
    return {
      input: history,
      result: null,
      missingFields,
      failureReasons,
      sourceStatuses,
      limitations: [
        ...limitations,
        error instanceof Error ? error.message.slice(0, 160) : "compute_error",
      ],
    };
  }
}
