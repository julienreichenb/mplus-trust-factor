import type {
  CharacterIdentityInput,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderResult,
  WarcraftLogsProvider,
  WclVisibilityState,
} from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";
import { computeRunFingerprint } from "@mplus/domain";
import {
  buildCharacterDiscovery,
  deriveVisibility,
  mapCharacterSummary,
  mapRegionToWcl,
  mapZoneRankings,
  mythicRunPlaceholders,
  rankingsToCandidates,
  recentReportsToCandidates,
  type ZoneRankingsPayload,
} from "../discovery/run-discovery.js";
import { mapZoneRankingAggregates } from "../discovery/zone-ranking-aggregates.js";
import { FIXTURE_MPLUS_ZONE_ID } from "../discovery/mplus-zone.js";
import {
  characterResolveSchema,
  parseWithSchema,
  rateLimitDataSchema,
  recentReportsSchema,
  reportFightSchema,
  zoneRankingsSchema,
} from "../client/graphql-client.js";
import { wclError } from "../client/errors.js";
import { buildRunCombatFacts } from "../analysis/combat-facts.js";
import { ReportRevisionCache } from "../analysis/revision-cache.js";
import { evaluateRateBudget, parseRateLimitSnapshot } from "../rate/rate-budget.js";
import { hydrateFightUnknownCandidates } from "../discovery/report-hydration.js";
import type {
  WclCharacterDiscoveryResult,
  WclRateBudgetDecision,
  WclReportFightDetails,
} from "../types.js";
import { loadFixtureByIdentity, loadReportFixture } from "./loader.js";

function emptyProviderResult<T>(
  data: T,
  endpointKey: string,
  fingerprint: string,
  ctx: ProviderFetchContext,
): ProviderResult<T> {
  const fetchedAt = ctx.now;
  return {
    data,
    provenance: {
      provider: "warcraftlogs",
      externalRequestId: null,
      sourcePayloadId: null,
      sourceUrl: "fixture://warcraftlogs",
      fetchedAt,
      schemaVersion: "wcl-fixture-v1",
    },
    freshness: {
      fetchedAt,
      expiresAt: null,
      stale: false,
    },
    metadata: {
      provider: "warcraftlogs",
      endpointKey,
      requestFingerprint: fingerprint,
      requestedAt: fetchedAt,
      completedAt: fetchedAt,
      statusCode: 200,
      cacheHit: true,
      retryCount: 0,
      costUnits: 0,
      etag: null,
      expiresAt: null,
    },
  };
}

function requireTargetCharacter(ctx: ProviderFetchContext): CharacterIdentityInput {
  if (!ctx.targetCharacter) {
    throw wclError(
      "INVALID_RESPONSE",
      "ProviderFetchContext.targetCharacter is required for WCL report/fight analysis",
    );
  }
  return ctx.targetCharacter;
}

export class FixtureWarcraftLogsProvider implements WarcraftLogsProvider {
  readonly name = "warcraftlogs" as const;
  private readonly revisionCache = new ReportRevisionCache();
  private readonly fetchedReports = new Set<string>();

  async discoverCharacterRuns(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<MythicRunDTO[]>> {
    const discovery = this.discoverCharacter(identity, ctx);
    const hydrated = await hydrateFightUnknownCandidates({
      candidates: discovery.candidates,
      characterName: identity.name,
      realmSlug: identity.realmSlug,
      hints: ctx.wclHydrationHints,
      fetchReport: async (code) => {
        const fixture = loadReportFixture(code);
        const raw = (fixture.report as { data: unknown } | undefined)?.data;
        if (!raw) return null;
        const parsed = parseWithSchema(reportFightSchema, raw, "Report");
        const report = parsed.reportData.report;
        if (!report) return null;
        return {
          code: report.code,
          startTime: report.startTime,
          endTime: report.endTime,
          visibility: report.visibility,
          zone: report.zone ?? null,
          fights: report.fights.map((f) => ({
            id: f.id,
            encounterID: f.encounterID,
            name: f.name,
            difficulty: f.difficulty,
            kill: f.kill,
            startTime: f.startTime,
            endTime: f.endTime,
            keystoneLevel: f.keystoneLevel,
            friendlyPlayers: f.friendlyPlayers ?? undefined,
          })),
          masterData: report.masterData
            ? {
                actors: (report.masterData.actors ?? []).map((a) => ({
                  id: a.id,
                  name: a.name,
                  type: a.type,
                  server: a.server,
                })),
              }
            : null,
        };
      },
    });
    const runs = hydrated.candidates
      .filter((c) => !c.incompleteness.fightUnknown && c.fightId > 0)
      .map((c) => this.candidateToMythicRun(c, identity, ctx));
    return emptyProviderResult(runs, "discoverCharacterRuns", `fixture-discover-${identity.name}`, ctx);
  }

  async discoverCharacterSummary(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<{ visibility: WclVisibilityState; warnings: string[]; dungeonAggregates: WclCharacterDiscoveryResult["dungeonAggregates"] }>> {
    const discovery = this.discoverCharacter(identity, ctx);
    return emptyProviderResult(
      {
        visibility: discovery.summary.visibility,
        warnings: discovery.summary.warnings,
        dungeonAggregates: discovery.dungeonAggregates,
      },
      "discoverCharacterSummary",
      `fixture-summary-${identity.name}`,
      ctx,
    );
  }

  async getReportFightDetails(
    reportCode: string,
    fightId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<WclReportFightDetails>> {
    const identity = requireTargetCharacter(ctx);
    const details = await this.fetchReportFightDetails(
      reportCode,
      fightId,
      identity.name,
      identity.realmSlug,
      ctx,
    );
    return emptyProviderResult(
      details,
      "getReportFightDetails",
      `fixture-report-${reportCode}-${fightId}`,
      ctx,
    );
  }

  discoverCharacter(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): WclCharacterDiscoveryResult {
    const fixture = loadFixtureByIdentity(identity.name, identity.realmSlug);
    const characterRaw = (fixture.resolveCharacter as { data: unknown }).data;
    const parsed = parseWithSchema(characterResolveSchema, characterRaw, "ResolveCharacter");
    const character = parsed.characterData.character;

    if (!character) {
      throw new ExternalApiError({
        message: "Character not found on Warcraft Logs",
        code: "NOT_FOUND",
        provider: "warcraftlogs",
        retryable: false,
      });
    }

    const rankingsRaw = (fixture.zoneRankings as { data: unknown }).data;
    const rankingsParsed = parseWithSchema(zoneRankingsSchema, rankingsRaw, "ZoneRankings");
    const rankings = mapZoneRankings(
      (rankingsParsed.characterData.character?.zoneRankings ?? null) as ZoneRankingsPayload | null,
      FIXTURE_MPLUS_ZONE_ID,
    );
    const aggregatePayload = (rankingsParsed.characterData.character?.zoneRankings ??
      null) as ZoneRankingsPayload | null;
    const dungeonAggregates = mapZoneRankingAggregates(aggregatePayload).dungeons.map((d) => ({
      dungeonSlug: d.dungeonSlug,
      dungeonName: d.dungeonName,
      encounterId: d.encounterId,
      bestParsePercentile: d.bestParsePercentile,
      medianParsePercentile: d.medianParsePercentile,
      loggedRunCount: d.loggedRunCount,
      specSlug: d.specSlug,
      roleSlug: d.roleSlug,
    }));

    const recentRaw = (fixture.recentReports as { data: unknown }).data;
    const recentParsed = parseWithSchema(recentReportsSchema, recentRaw, "RecentReports");
    const recentMapped = recentReportsToCandidates(
      recentParsed.characterData.character?.recentReports,
    );

    const visibility = deriveVisibility(character, rankings, recentMapped.candidates.length, {
      privateSkipped: recentMapped.privateSkipped + recentMapped.unlistedSkipped,
    });
    const summary = mapCharacterSummary(character, identity.region, ctx.now, visibility);

    return buildCharacterDiscovery({
      summary,
      rankings,
      dungeonAggregates,
      rankingCandidates: rankingsToCandidates(rankings),
      recentCandidates: recentMapped.candidates,
      privateReportsSkipped: recentMapped.privateSkipped + recentMapped.unlistedSkipped,
    });
  }

  getRateBudgetDecision(_ctx: ProviderFetchContext): WclRateBudgetDecision {
    const fixture = loadFixtureByIdentity("fixtureplayer", "tarren-mill");
    const raw = (fixture.rateLimitData as { data: unknown }).data;
    const parsed = parseWithSchema(rateLimitDataSchema, raw, "RateLimitData");
    const snapshot = parseRateLimitSnapshot(parsed.rateLimitData);
    return evaluateRateBudget(snapshot, {
      warnPercent: 70,
      deferPercent: 80,
      stopPercent: 90,
    });
  }

  async fetchReportFightDetails(
    reportCode: string,
    fightId: number,
    characterName: string,
    realmSlug: string,
    ctx: ProviderFetchContext,
    analysisVersion = "v1",
  ): Promise<WclReportFightDetails> {
    const cacheKey = `${reportCode}:${fightId}`;
    const fixture = loadReportFixture(reportCode);
    const reportRaw = (fixture.report as { data: unknown }).data;
    const parsed = parseWithSchema(reportFightSchema, reportRaw, "Report");
    const report = parsed.reportData.report;
    if (!report) {
      throw new ExternalApiError({
        message: "Report not found",
        code: "NOT_FOUND",
        provider: "warcraftlogs",
        retryable: false,
      });
    }

    this.revisionCache.setRevision(reportCode, report.revision);
    if (this.revisionCache.hasAnalysis(reportCode, fightId, report.revision, analysisVersion)) {
      // Still return data in fixture mode but note dedupe via limitations
    } else {
      this.revisionCache.markAnalysis(reportCode, fightId, report.revision, analysisVersion);
    }

    const fight = report.fights.find((f) => f.id === fightId);
    if (!fight) {
      throw new ExternalApiError({
        message: `Fight ${fightId} not found in report ${reportCode}`,
        code: "NOT_FOUND",
        provider: "warcraftlogs",
        retryable: false,
      });
    }

    const eventsFixture = fixture.events ?? {};
    const combatFacts = buildRunCombatFacts({
      reportCode,
      fightId,
      revision: report.revision,
      characterName,
      realmSlug,
      actors: report.masterData?.actors ?? [],
      eventsByType: eventsFixture,
      alreadyFetched: this.fetchedReports.has(cacheKey),
    });
    this.fetchedReports.add(cacheKey);

    return {
      report: {
        code: report.code,
        title: report.title,
        revision: report.revision,
        startTimeMs: report.startTime,
        endTimeMs: report.endTime,
        visibility: report.visibility,
        zoneId: report.zone?.id ?? null,
        zoneName: report.zone?.name ?? null,
      },
      fight: {
        id: fight.id,
        encounterId: fight.encounterID ?? null,
        name: fight.name ?? null,
        difficulty: fight.difficulty ?? null,
        kill: fight.kill ?? null,
        startTime: fight.startTime,
        endTime: fight.endTime,
        bracket: fight.keystoneLevel ?? null,
        keystoneLevel: fight.keystoneLevel ?? null,
        friendlyPlayers: (fight.friendlyPlayers ?? []).map((p) =>
          typeof p === "number"
            ? { id: p, name: "", server: "", type: "Player", icon: null }
            : {
                id: p.id,
                name: p.name,
                server: p.server,
                type: p.type,
                icon: p.icon ?? null,
              },
        ),
      },
      combatFacts,
    };
  }

  getRevisionCache(): ReportRevisionCache {
    return this.revisionCache;
  }

  private candidateToMythicRun(
    candidate: WclCharacterDiscoveryResult["candidates"][number],
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): MythicRunDTO {
    const completedAt = candidate.completedAt ?? ctx.now;
    const placeholders = mythicRunPlaceholders(candidate);
    const rosterKey = `${mapRegionToWcl(identity.region)}|${identity.realmSlug}|${identity.name}`;
    return {
      id: `${candidate.reportCode}-${candidate.fightId}`,
      region: identity.region,
      seasonSlug: placeholders.seasonSlug,
      dungeonSlug: placeholders.dungeonSlug,
      keyLevel: placeholders.keyLevel,
      completedAt,
      durationMs: placeholders.durationMs,
      timerMs: null,
      timed: placeholders.timed,
      scoreValue: candidate.score,
      canonicalFingerprint: computeRunFingerprint({
        region: identity.region,
        seasonKey: placeholders.seasonSlug,
        dungeonKey: placeholders.dungeonSlug,
        completedAtMs: new Date(completedAt).getTime(),
        keyLevel: placeholders.keyLevel,
        durationMs: placeholders.durationMs,
        rosterCanonicalKeys: [rosterKey],
      }),
      affixes: [],
      participants: [
        {
          providerCharacterKey: rosterKey,
          displayName: identity.name,
          realmSlug: identity.realmSlug,
          region: identity.region,
          classSlug: null,
          specSlug: null,
          role: "DPS",
          itemLevel: null,
          mythicRatingAtRun: candidate.score ?? null,
          isTargetCharacter: true,
          characterId: null,
        },
      ],
      sources: [
        {
          provider: "WARCRAFT_LOGS",
          externalRunId: `${candidate.reportCode}:${candidate.fightId}`,
          externalUrl: `https://www.warcraftlogs.com/reports/${candidate.reportCode}?fight=${candidate.fightId}`,
          reportCode: candidate.reportCode,
          fightId: candidate.fightId,
          revision: null,
        },
      ],
    };
  }
}
