import type {
  CharacterIdentityInput,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderResult,
  WarcraftLogsProvider,
} from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";
import { computeRunFingerprint } from "@mplus/domain";
import type { AppEnv } from "@mplus/config";
import {
  WclGraphQlClient,
  characterResolveSchema,
  parseWithSchema,
  rateLimitDataSchema,
  recentReportsSchema,
  reportFightSchema,
  zoneRankingsSchema,
} from "../client/graphql-client.js";
import { WclTokenManager } from "../client/token-manager.js";
import { wclError } from "../client/errors.js";
import { OPERATIONS } from "../operations/queries.js";
import {
  DEFAULT_MPLUS_ZONE_ID,
  buildCharacterDiscovery,
  deriveVisibility,
  mapCharacterSummary,
  mapRegionToWcl,
  mapZoneRankings,
  rankingsToCandidates,
  recentReportsToCandidates,
} from "../discovery/run-discovery.js";
import { buildRunCombatFactsFromEvents } from "../analysis/event-fetcher.js";
import { ReportRevisionCache } from "../analysis/revision-cache.js";
import {
  evaluateRateBudget,
  parseRateLimitSnapshot,
  shouldDeferExpensiveWork,
} from "../rate/rate-budget.js";
import type { WclCharacterDiscoveryResult, WclReportFightDetails } from "../types.js";

export interface LiveWarcraftLogsProviderConfig {
  env: Pick<
    AppEnv,
    | "WCL_CLIENT_ID"
    | "WCL_CLIENT_SECRET"
    | "WCL_PUBLIC_GRAPHQL_URL"
    | "WCL_TOKEN_URL"
    | "WCL_RATE_WARN_PERCENT"
    | "WCL_RATE_DEFER_PERCENT"
    | "WCL_RATE_STOP_PERCENT"
    | "WCL_CHARACTER_TTL_SECONDS"
  >;
  zoneId?: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

function providerEnvelope<T>(
  data: T,
  endpointKey: string,
  fingerprint: string,
  ctx: ProviderFetchContext,
  costUnits: number | null,
  ttlSeconds: number,
): ProviderResult<T> {
  const fetchedAt = ctx.now;
  const expiresAt = new Date(new Date(fetchedAt).getTime() + ttlSeconds * 1000).toISOString();
  return {
    data,
    provenance: {
      provider: "warcraftlogs",
      externalRequestId: null,
      sourcePayloadId: null,
      sourceUrl: "https://www.warcraftlogs.com/api/v2/client",
      fetchedAt,
      schemaVersion: "wcl-v2",
    },
    freshness: {
      fetchedAt,
      expiresAt,
      stale: false,
    },
    metadata: {
      provider: "warcraftlogs",
      endpointKey,
      requestFingerprint: fingerprint,
      requestedAt: fetchedAt,
      completedAt: fetchedAt,
      statusCode: 200,
      cacheHit: false,
      retryCount: 0,
      costUnits,
      etag: null,
      expiresAt,
    },
  };
}

export class LiveWarcraftLogsProvider implements WarcraftLogsProvider {
  readonly name = "warcraftlogs" as const;
  private readonly client: WclGraphQlClient;
  private readonly revisionCache = new ReportRevisionCache();
  private readonly zoneId: number;

  constructor(private readonly config: LiveWarcraftLogsProviderConfig) {
    const tokenManager = new WclTokenManager({
      clientId: config.env.WCL_CLIENT_ID,
      clientSecret: config.env.WCL_CLIENT_SECRET,
      tokenUrl: config.env.WCL_TOKEN_URL,
    });
    this.client = new WclGraphQlClient({
      graphqlUrl: config.env.WCL_PUBLIC_GRAPHQL_URL,
      tokenManager,
      logger: config.logger,
    });
    this.zoneId = config.zoneId ?? DEFAULT_MPLUS_ZONE_ID;
  }

  async discoverCharacterRuns(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<MythicRunDTO[]>> {
    const discovery = await this.discoverCharacter(identity, ctx);
    const runs = discovery.candidates.map((c) => this.candidateToMythicRun(c, identity, ctx));
    return providerEnvelope(
      runs,
      "discoverCharacterRuns",
      `live-discover-${identity.region}-${identity.realmSlug}-${identity.name}`,
      ctx,
      null,
      this.config.env.WCL_CHARACTER_TTL_SECONDS,
    );
  }

  async getReportFightDetails(
    reportCode: string,
    fightId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<WclReportFightDetails>> {
    const characterName = process.env.WCL_DEFAULT_CHARACTER_NAME ?? "Fixtureplayer";
    const realmSlug = process.env.WCL_DEFAULT_REALM_SLUG ?? "tarren-mill";
    const details = await this.fetchReportFightDetails(
      reportCode,
      fightId,
      characterName,
      realmSlug,
      ctx,
    );
    return providerEnvelope(
      details,
      "getReportFightDetails",
      `live-report-${reportCode}-${fightId}`,
      ctx,
      null,
      this.config.env.WCL_CHARACTER_TTL_SECONDS,
    );
  }

  async fetchRateLimit(_ctx: ProviderFetchContext) {
    const result = await this.client.request({
      operationName: OPERATIONS.RateLimitData.operationName,
      query: OPERATIONS.RateLimitData.query,
      region: "global",
    });
    const parsed = parseWithSchema(rateLimitDataSchema, result.response.data, "RateLimitData");
    const snapshot = parseRateLimitSnapshot(parsed.rateLimitData);
    return evaluateRateBudget(snapshot, {
      warnPercent: this.config.env.WCL_RATE_WARN_PERCENT,
      deferPercent: this.config.env.WCL_RATE_DEFER_PERCENT,
      stopPercent: this.config.env.WCL_RATE_STOP_PERCENT,
    });
  }

  async discoverCharacter(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<WclCharacterDiscoveryResult> {
    const budget = await this.fetchRateLimit(ctx);
    if (shouldDeferExpensiveWork(budget)) {
      throw wclError("BUDGET_EXCEEDED", "WCL rate budget exceeded — deferring character discovery");
    }

    const serverRegion = mapRegionToWcl(identity.region);
    const resolveResult = await this.client.request({
      operationName: OPERATIONS.ResolveCharacter.operationName,
      query: OPERATIONS.ResolveCharacter.query,
      variables: {
        name: identity.name,
        serverSlug: identity.realmSlug,
        serverRegion,
      },
      region: identity.region,
    });
    const resolved = parseWithSchema(characterResolveSchema, resolveResult.response.data, "ResolveCharacter");
    const character = resolved.characterData.character;
    if (!character) {
      throw new ExternalApiError({
        message: "Character not found on Warcraft Logs",
        code: "NOT_FOUND",
        provider: "warcraftlogs",
        retryable: false,
      });
    }

    const rankingsResult = await this.client.request({
      operationName: OPERATIONS.CharacterZoneRankings.operationName,
      query: OPERATIONS.CharacterZoneRankings.query,
      variables: {
        name: identity.name,
        serverSlug: identity.realmSlug,
        serverRegion,
        zoneID: this.zoneId,
      },
      region: identity.region,
    });
    const rankingsParsed = parseWithSchema(
      zoneRankingsSchema,
      rankingsResult.response.data,
      "ZoneRankings",
    );
    const rankings = mapZoneRankings(
      rankingsParsed.characterData.character?.zoneRankings,
      this.zoneId,
    );

    const recentResult = await this.client.request({
      operationName: OPERATIONS.CharacterRecentReports.operationName,
      query: OPERATIONS.CharacterRecentReports.query,
      variables: {
        name: identity.name,
        serverSlug: identity.realmSlug,
        serverRegion,
        limit: 20,
        page: 1,
      },
      region: identity.region,
    });
    const recentParsed = parseWithSchema(recentReportsSchema, recentResult.response.data, "RecentReports");
    const recentPublicCount =
      recentParsed.characterData.character?.recentReports?.data?.filter(
        (r) => (r.visibility ?? "public") === "public",
      ).length ?? 0;

    const visibility = deriveVisibility(character, rankings, recentPublicCount);
    const summary = mapCharacterSummary(character, identity.region, ctx.now, visibility);

    return buildCharacterDiscovery({
      summary,
      rankings,
      rankingCandidates: rankingsToCandidates(rankings),
      recentCandidates: recentReportsToCandidates(
        recentParsed.characterData.character?.recentReports,
      ),
    });
  }

  async fetchReportFightDetails(
    reportCode: string,
    fightId: number,
    characterName: string,
    realmSlug: string,
    ctx: ProviderFetchContext,
    analysisVersion = "v1",
    includeHealing = false,
  ): Promise<WclReportFightDetails> {
    const budget = await this.fetchRateLimit(ctx);
    if (shouldDeferExpensiveWork(budget)) {
      throw wclError("BUDGET_EXCEEDED", "WCL rate budget exceeded — deferring detailed analysis");
    }

    const reportResult = await this.client.request({
      operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
      query: OPERATIONS.ReportWithFightAndMasterData.query,
      variables: { code: reportCode, fightIDs: [fightId] },
    });
    const parsed = parseWithSchema(reportFightSchema, reportResult.response.data, "Report");
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
      throw wclError(
        "INVALID_RESPONSE",
        "Detailed analysis already cached for this report revision",
      );
    }

    const fight = report.fights.find((f) => f.id === fightId);
    if (!fight) {
      throw new ExternalApiError({
        message: `Fight ${fightId} not found`,
        code: "NOT_FOUND",
        provider: "warcraftlogs",
        retryable: false,
      });
    }

    const combatFacts = await buildRunCombatFactsFromEvents(this.client, {
      reportCode,
      fightId,
      revision: report.revision,
      characterName,
      realmSlug,
      actors: report.masterData?.actors ?? [],
      includeHealing,
    });

    this.revisionCache.markAnalysis(reportCode, fightId, report.revision, analysisVersion);

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
        friendlyPlayers: (fight.friendlyPlayers ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          server: p.server,
          type: p.type,
          icon: p.icon ?? null,
        })),
      },
      combatFacts,
    };
  }

  getRevisionCache(): ReportRevisionCache {
    return this.revisionCache;
  }

  getGraphQlClient(): WclGraphQlClient {
    return this.client;
  }

  private candidateToMythicRun(
    candidate: WclCharacterDiscoveryResult["candidates"][number],
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): MythicRunDTO {
    const completedAt = candidate.completedAt ?? ctx.now;
    const rosterKey = `${mapRegionToWcl(identity.region)}|${identity.realmSlug}|${identity.name}`;
    return {
      id: `${candidate.reportCode}-${candidate.fightId}`,
      region: identity.region,
      seasonSlug: "current",
      dungeonSlug: candidate.dungeonSlug ?? "unknown",
      keyLevel: candidate.keyLevel ?? 0,
      completedAt,
      durationMs: candidate.durationMs ?? 0,
      timerMs: null,
      timed: true,
      scoreValue: candidate.score,
      canonicalFingerprint: computeRunFingerprint({
        region: identity.region,
        seasonKey: "current",
        dungeonKey: candidate.dungeonSlug ?? "unknown",
        completedAtMs: new Date(completedAt).getTime(),
        keyLevel: candidate.keyLevel ?? 0,
        durationMs: candidate.durationMs ?? 0,
        rosterCanonicalKeys: [rosterKey],
      }),
      affixes: [],
      participants: [],
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
