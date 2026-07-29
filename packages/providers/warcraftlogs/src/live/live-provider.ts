import type { AbilityCatalog } from "@mplus/abilities";
import type {
  CharacterIdentityInput,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderResult,
  WarcraftLogsProvider,
  WclDataState,
  WclVisibilityState,
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
import { isUnavailableEvidenceError, wclError } from "../client/errors.js";
import { OPERATIONS } from "../operations/queries.js";
import {
  buildCharacterDiscovery,
  classifyReportVisibility,
  deriveWclProvenance,
  mapCharacterSummary,
  mapRegionToWcl,
  mapZoneRankings,
  mythicRunPlaceholders,
  rankingsToCandidates,
  recentReportsToCandidates,
  countParseStyleRankingRows,
  type ZoneRankingsPayload,
} from "../discovery/run-discovery.js";
import {
  adaptPointsAndDamagePerformance,
  buildWclSummaryRequestFingerprint,
  pointsAndDamageErrorRecord,
  POINTS_AND_DAMAGE_ADAPTER_VERSION,
  type PointsAndDamagePerformanceRecord,
} from "../discovery/points-and-damage-performance.js";
import { parseJsonScalar } from "../probe/performance-probe-logic.js";
import {
  MAX_RECENT_REPORTS_LIMIT,
  MAX_RECENT_REPORT_PAGES,
  MAX_HYDRATION_REPORTS,
} from "../discovery/bounds.js";
import {
  hydrateFightUnknownCandidates,
  type HydrationReportPayload,
} from "../discovery/report-hydration.js";
import {
  resolveMplusZoneConfig,
  shouldQueryZoneRankings,
  type MplusZoneConfig,
} from "../discovery/mplus-zone.js";
import { buildRunCombatFactsFromEvents } from "../analysis/event-fetcher.js";
import { fetchDamageTakenWithResources } from "../analysis/survival-run-analysis.js";
import {
  buildCanonicalSurvivalAnalysis,
  fetchSurvivalCanonicalDatasets,
} from "../analysis/survival-canonical-analysis.js";
import { ReportRevisionCache } from "../analysis/revision-cache.js";
import {
  evaluateRateBudget,
  parseRateLimitSnapshot,
  shouldDeferExpensiveWork,
} from "../rate/rate-budget.js";
import type { WclCharacterDiscoveryResult, WclDungeonPerformanceAggregate, WclReportFightDetails } from "../types.js";

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
  /** Explicit current M+ zone ID (preferred over WCL_MPLUS_ZONE_ID env). */
  zoneId?: number;
  zoneExpiresAt?: string | null;
  /** Override MAX_HYDRATION_REPORTS bound. */
  maxHydrationReports?: number;
  processEnv?: NodeJS.ProcessEnv;
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

function requireTargetCharacter(ctx: ProviderFetchContext): CharacterIdentityInput {
  if (!ctx.targetCharacter) {
    throw wclError(
      "INVALID_RESPONSE",
      "ProviderFetchContext.targetCharacter is required for WCL report/fight analysis",
    );
  }
  return ctx.targetCharacter;
}

/** Live WCL returns friendlyPlayers as actor IDs; fixtures may still embed player objects. */
function resolveFriendlyPlayers(
  friendlyPlayers:
    | Array<
        | number
        | {
            id: number;
            name: string;
            server: string;
            type: string;
            icon?: string | null;
          }
      >
    | null
    | undefined,
  actors: Array<{
    id: number;
    name: string;
    type: string;
    subType?: string | null;
    server?: string | null;
  }>,
): Array<{ id: number; name: string; server: string; type: string; icon: string | null }> {
  const byId = new Map(actors.map((a) => [a.id, a]));
  return (friendlyPlayers ?? []).map((entry) => {
    if (typeof entry === "number") {
      const actor = byId.get(entry);
      return {
        id: entry,
        name: actor?.name ?? "",
        server: actor?.server ?? "",
        type: actor?.type ?? "Player",
        icon: null,
      };
    }
    return {
      id: entry.id,
      name: entry.name,
      server: entry.server,
      type: entry.type,
      icon: entry.icon ?? null,
    };
  });
}

export class LiveWarcraftLogsProvider implements WarcraftLogsProvider {
  readonly name = "warcraftlogs" as const;
  private readonly client: WclGraphQlClient;
  private readonly revisionCache = new ReportRevisionCache();
  private readonly zoneConfig: MplusZoneConfig;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private readonly maxHydrationReports: number;

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
    this.logger = config.logger ?? console;
    const envMax = Number((config.processEnv ?? process.env).WCL_MAX_HYDRATION_REPORTS);
    this.maxHydrationReports =
      config.maxHydrationReports ??
      (Number.isInteger(envMax) && envMax > 0 ? envMax : MAX_HYDRATION_REPORTS);
    this.zoneConfig = resolveMplusZoneConfig({
      zoneId: config.zoneId,
      expiresAt: config.zoneExpiresAt,
      env: config.processEnv ?? process.env,
      allowFixtureDefault: false,
    });
    if (this.zoneConfig.warning) {
      this.logger.warn({ warning: this.zoneConfig.warning }, "wcl.mplus_zone.warning");
    }
  }

  getZoneConfig(): MplusZoneConfig {
    return this.zoneConfig;
  }

  async discoverCharacterRuns(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<MythicRunDTO[]>> {
    const discovery = await this.discoverCharacter(identity, ctx);
    const hydrated = await hydrateFightUnknownCandidates({
      candidates: discovery.candidates,
      characterName: identity.name,
      realmSlug: identity.realmSlug,
      hints: ctx.wclHydrationHints,
      maxReports: this.maxHydrationReports,
      fetchReport: (code) => this.fetchReportPayloadForHydration(code),
    });
    if (hydrated.hydratedReportCount > 0) {
      this.logger.info(
        {
          identity,
          hydratedReportCount: hydrated.hydratedReportCount,
          knownFightCandidates: hydrated.candidates.filter((c) => !c.incompleteness.fightUnknown)
            .length,
        },
        "wcl.discovery.hydration",
      );
    }
    const runs = hydrated.candidates
      .filter((c) => !c.incompleteness.fightUnknown && c.fightId > 0)
      .map((c) => this.candidateToMythicRun(c, identity, ctx));
    const envelope = providerEnvelope(
      runs,
      "discoverCharacterRuns",
      `live-discover-${identity.region}-${identity.realmSlug}-${identity.name}`,
      ctx,
      null,
      this.config.env.WCL_CHARACTER_TTL_SECONDS,
    );
    return { ...envelope, wclRankings: discovery.rankings } as ProviderResult<MythicRunDTO[]> & {
      wclRankings: typeof discovery.rankings;
    };
  }

  private async fetchReportPayloadForHydration(
    reportCode: string,
  ): Promise<HydrationReportPayload | null> {
    const reportResult = await this.client.request({
      operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
      query: OPERATIONS.ReportWithFightAndMasterData.query,
      variables: { code: reportCode },
    });
    const parsed = parseWithSchema(reportFightSchema, reportResult.response.data, "Report");
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
  }

  async discoverCharacterSummary(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<
    ProviderResult<{
      visibility: WclVisibilityState | null;
      dataState: WclDataState;
      warnings: string[];
      dungeonAggregates: WclDungeonPerformanceAggregate[];
      performance: PointsAndDamagePerformanceRecord | null;
      rawZoneRankingsPointsAndDamage: unknown;
    }>
  > {
    const discovery = await this.discoverCharacter(identity, ctx);
    // Partition is part of the logical query identity as "current" — do not bind the
    // cache key to the response partition value or legacy/current keys diverge.
    const fingerprint = buildWclSummaryRequestFingerprint({
      region: identity.region,
      realmSlug: identity.realmSlug,
      name: identity.name,
      zoneId: this.zoneConfig.zoneId,
      partition: null,
    });
    const envelope = providerEnvelope(
      {
        visibility: discovery.summary.visibility,
        dataState: discovery.summary.dataState,
        warnings: discovery.summary.warnings,
        dungeonAggregates: discovery.dungeonAggregates,
        performance: discovery.performance ?? null,
        rawZoneRankingsPointsAndDamage: discovery.performance?.raw ?? null,
      },
      "discoverCharacterSummary",
      fingerprint,
      ctx,
      null,
      this.config.env.WCL_CHARACTER_TTL_SECONDS,
    );
    return {
      ...envelope,
      provenance: {
        ...envelope.provenance,
        schemaVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
      },
    };
  }

  async getReportFightDetails(
    reportCode: string,
    fightId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<WclReportFightDetails>> {
    const identity = requireTargetCharacter(ctx);
    try {
      const details = await this.fetchReportFightDetails(
        reportCode,
        fightId,
        identity.name,
        identity.realmSlug,
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
    } catch (error) {
      if (isUnavailableEvidenceError(error)) {
        throw wclError("INVALID_RESPONSE", "WCL report detail unavailable (archived/gated)", {
          visibility: "UNAVAILABLE",
          reportCode,
          fightId,
          cause: error instanceof Error ? error.message : error,
        });
      }
      throw error;
    }
  }

  async fetchSurvivalHealthSnapshots(
    input: { reportCode: string; fightId: number; sourceId: number },
    ctx: ProviderFetchContext,
  ) {
    const result = await fetchDamageTakenWithResources(this.client, {
      ...input,
      maxEventPages: 200,
      maxEventsPerCategory: 200_000,
    });
    return providerEnvelope(
      {
        snapshots: result.snapshots.map(({ rawFragment: _rawFragment, ...snapshot }) => snapshot),
        truncated: result.truncated,
        eventCount: result.events.length,
        events: result.events,
      },
      "fetchSurvivalHealthSnapshots",
      `live-survival-health-${input.reportCode}-${input.fightId}-${input.sourceId}`,
      ctx,
      null,
      this.config.env.WCL_CHARACTER_TTL_SECONDS,
    );
  }

  /**
   * Probe-parity Survival analysis: full Casts/Buffs/Deaths/Healing + DamageTaken resources,
   * normalized through the shared canonical analyzer.
   */
  async analyzeSurvivalCanonicalRun(
    input: {
      identity: { region: "EU" | "US" | "KR" | "TW"; realmSlug: string; name: string };
      characterId: string;
      reportCode: string;
      fightId: number;
      reportRevision: number | string;
      dungeonSlug: string;
      keyLevel: number | null;
      playerActorId: number;
      ownedPetActorIds: number[];
      fightStartTime: number;
      fightEndTime: number;
      encounterId?: number | null;
      encounterName?: string | null;
      catalog: AbilityCatalog;
      classSlug: string | null;
      specSlug: string | null;
      timed?: boolean | null;
      completed?: boolean | null;
      score?: number | null;
    },
    ctx: ProviderFetchContext,
  ) {
    const fetched = await fetchSurvivalCanonicalDatasets(this.client, {
      identity: input.identity,
      reportCode: input.reportCode,
      fightId: input.fightId,
      playerActorId: input.playerActorId,
      fightStartTime: input.fightStartTime,
      fightEndTime: input.fightEndTime,
    });
    const analyzed = buildCanonicalSurvivalAnalysis({
      characterId: input.characterId,
      identity: input.identity,
      reportCode: input.reportCode,
      fightId: input.fightId,
      reportRevision: input.reportRevision,
      dungeonSlug: input.dungeonSlug,
      keyLevel: input.keyLevel,
      playerActorId: input.playerActorId,
      ownedPetActorIds: input.ownedPetActorIds,
      fightStartTime: input.fightStartTime,
      fightEndTime: input.fightEndTime,
      encounterId: input.encounterId,
      encounterName: input.encounterName,
      timed: input.timed,
      completed: input.completed,
      score: input.score,
      datasets: fetched.datasets,
      snapshots: fetched.snapshots,
      catalog: input.catalog,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      eventPagesComplete: !fetched.truncated,
      maxHpFailureReason: fetched.maxHpFailureReason,
      snapshotSourceCounts: fetched.snapshotSourceCounts,
    });
    return providerEnvelope(
      {
        summary: analyzed.summary,
        requestCount: fetched.requestCount,
        maxHpFailureReason: fetched.maxHpFailureReason,
        truncated: fetched.truncated,
        snapshotCount: fetched.snapshots.length,
        snapshotSourceCounts: fetched.snapshotSourceCounts,
        playerActorId: input.playerActorId,
        deathCount: analyzed.summary.deathCount,
        pressureClusterCount: analyzed.summary.pressureClusterCount,
        behavioralSurvivalScore: analyzed.summary.behavioralSurvivalScore,
      },
      "analyzeSurvivalCanonicalRun",
      `live-survival-canonical-${input.reportCode}-${input.fightId}`,
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
    if (budget.action === "STOP") {
      // Hard stop before expensive work — character-level RATE_LIMITED state, not player error
      return {
        summary: {
          wclCharacterId: 0,
          canonicalId: 0,
          name: identity.name,
          realmSlug: identity.realmSlug,
          region: identity.region,
          classId: null,
          level: null,
          hidden: false,
          visibility: null,
          dataState: "RATE_LIMITED",
          fetchedAt: ctx.now,
          warnings: [
            `WCL rate budget STOP at ${budget.utilizationPercent.toFixed(1)}% — discovery deferred`,
          ],
        },
        rankings: [],
        dungeonAggregates: [],
        performance: pointsAndDamageErrorRecord(
          "SKIPPED",
          null,
          "WCL rate budget STOP — points_and_damage Performance deferred",
        ),
        candidates: [],
        latest: null,
        highest: null,
        candidatesTruncated: false,
        privateReportsSkipped: 0,
      };
    }
    if (shouldDeferExpensiveWork(budget)) {
      throw wclError("BUDGET_EXCEEDED", "WCL rate budget exceeded — deferring character discovery", {
        visibility: "RATE_LIMITED",
        utilizationPercent: budget.utilizationPercent,
      });
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

    const warnings: string[] = [];
    if (this.zoneConfig.warning) {
      warnings.push(this.zoneConfig.warning);
    }

    let rankings: ReturnType<typeof mapZoneRankings> = [];
    let performance: PointsAndDamagePerformanceRecord = pointsAndDamageErrorRecord(
      "SKIPPED",
      null,
      "points_and_damage not queried",
    );
    if (shouldQueryZoneRankings(this.zoneConfig)) {
      // Bounded: Parses query for run discovery only (not Performance percentiles).
      const rankingsResult = await this.client.request({
        operationName: OPERATIONS.CharacterZoneRankings.operationName,
        query: OPERATIONS.CharacterZoneRankings.query,
        variables: {
          name: identity.name,
          serverSlug: identity.realmSlug,
          serverRegion,
          zoneID: this.zoneConfig.zoneId,
        },
        region: identity.region,
      });
      const rankingsParsed = parseWithSchema(
        zoneRankingsSchema,
        rankingsResult.response.data,
        "ZoneRankings",
      );
      const zonePayload = (rankingsParsed.characterData.character?.zoneRankings ??
        null) as ZoneRankingsPayload | null;
      const rowCounts = countParseStyleRankingRows(zonePayload);
      if (rowCounts.totalRows > 0 && rowCounts.parseRows === 0) {
        warnings.push(
          `zoneRankings returned ${rowCounts.totalRows} aggregate row(s) without report/fightID — Parses compare payload unavailable; falling back to recentReports stubs`,
        );
      }
      rankings = mapZoneRankings(zonePayload, this.zoneConfig.zoneId);

      // Performance: points_and_damage only (Points & Damage By Level). Never soft-empty on failure.
      try {
        const perfResult = await this.client.request({
          operationName: OPERATIONS.CharacterZoneRankingsPointsAndDamage.operationName,
          query: OPERATIONS.CharacterZoneRankingsPointsAndDamage.query,
          variables: {
            name: identity.name,
            serverSlug: identity.realmSlug,
            serverRegion,
            zoneID: this.zoneConfig.zoneId,
          },
          region: identity.region,
        });
        if (perfResult.response.errors && perfResult.response.errors.length > 0) {
          const messages = perfResult.response.errors.map((e) => e.message);
          performance = pointsAndDamageErrorRecord(
            "ERROR",
            null,
            `CharacterZoneRankingsPointsAndDamage GraphQL error: ${messages.join("; ")}`,
          );
          warnings.push(performance.diagnostics.errorMessage ?? "points_and_damage GraphQL error");
        } else {
          const data = perfResult.response.data as
            | { characterData?: { character?: { zoneRankings?: unknown } | null } }
            | null
            | undefined;
          const raw = parseJsonScalar(data?.characterData?.character?.zoneRankings ?? null);
          performance = adaptPointsAndDamagePerformance({ raw });
          if (performance.state === "SCHEMA_UNSUPPORTED") {
            warnings.push(
              performance.diagnostics.errorMessage ?? "points_and_damage SCHEMA_UNSUPPORTED",
            );
          } else if (performance.state === "EMPTY") {
            warnings.push(
              performance.diagnostics.errorMessage ?? "points_and_damage payload empty",
            );
            // Treat empty as ERROR for scoring — never a fabricated valid dataset.
            performance = { ...performance, state: "ERROR" };
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        const schemaUnsupported =
          error instanceof ExternalApiError && error.code === "SCHEMA_UNSUPPORTED";
        performance = pointsAndDamageErrorRecord(
          schemaUnsupported ? "SCHEMA_UNSUPPORTED" : "ERROR",
          null,
          `points_and_damage query failed — PERFORMANCE unavailable (${message})`,
        );
        warnings.push(performance.diagnostics.errorMessage ?? message);
      }
    } else {
      warnings.push(
        `Skipped zoneRankings — configured zone ${this.zoneConfig.zoneId} is expired`,
      );
      performance = pointsAndDamageErrorRecord(
        "SKIPPED",
        null,
        `Skipped points_and_damage — configured zone ${this.zoneConfig.zoneId} is expired`,
      );
    }

    // Bounded: one recentReports page only (limit documented in bounds.ts)
    const recentResult = await this.client.request({
      operationName: OPERATIONS.CharacterRecentReports.operationName,
      query: OPERATIONS.CharacterRecentReports.query,
      variables: {
        name: identity.name,
        serverSlug: identity.realmSlug,
        serverRegion,
        limit: MAX_RECENT_REPORTS_LIMIT,
        page: MAX_RECENT_REPORT_PAGES,
      },
      region: identity.region,
    });
    const recentParsed = parseWithSchema(recentReportsSchema, recentResult.response.data, "RecentReports");
    const recentMapped = recentReportsToCandidates(
      recentParsed.characterData.character?.recentReports,
    );
    const recentPublicCount = recentMapped.candidates.length;
    const privateSkipped = recentMapped.privateSkipped + recentMapped.unlistedSkipped;
    if (recentMapped.unlistedSkipped > 0) {
      warnings.push(
        `Skipped ${recentMapped.unlistedSkipped} unlisted report(s) — never probed with allowUnlisted`,
      );
    }
    if (recentMapped.privateSkipped > 0) {
      warnings.push(`Skipped ${recentMapped.privateSkipped} private report(s)`);
    }

    const provenance = deriveWclProvenance(character, rankings, recentPublicCount, {
      privateSkipped,
    });
    const summary = mapCharacterSummary(
      character,
      identity.region,
      ctx.now,
      provenance.visibility,
      warnings,
      provenance.dataState,
    );

    return buildCharacterDiscovery({
      summary,
      rankings,
      dungeonAggregates: performance.state === "OK" ? performance.dungeonAggregates : [],
      performance,
      rankingCandidates: rankingsToCandidates(rankings),
      recentCandidates: recentMapped.candidates,
      privateReportsSkipped: privateSkipped,
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
      throw wclError("BUDGET_EXCEEDED", "WCL rate budget exceeded — deferring detailed analysis", {
        visibility: "RATE_LIMITED",
      });
    }

    // Public client only: report(code) without allowUnlisted — never probe unlisted/private codes
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

    const vis = classifyReportVisibility(report.visibility);
    if (!vis.isPublic) {
      throw wclError(
        "INVALID_RESPONSE",
        `Refusing to analyze non-public report (visibility=${report.visibility})`,
        { visibility: "PRIVATE_SKIPPED", reportCode },
      );
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

    const actors = report.masterData?.actors ?? [];
    const combatFacts = await buildRunCombatFactsFromEvents(this.client, {
      reportCode,
      fightId,
      revision: report.revision,
      characterName,
      realmSlug,
      actors,
      includeHealing,
      rateBudget: budget,
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
        friendlyPlayers: resolveFriendlyPlayers(fight.friendlyPlayers, actors),
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
    const placeholders = mythicRunPlaceholders(candidate);
    const rosterKeys =
      candidate.incompleteness.rosterIncomplete
        ? [`${mapRegionToWcl(identity.region)}|${identity.realmSlug}|${identity.name}`]
        : [`${mapRegionToWcl(identity.region)}|${identity.realmSlug}|${identity.name}`];

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
        rosterCanonicalKeys: rosterKeys,
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
