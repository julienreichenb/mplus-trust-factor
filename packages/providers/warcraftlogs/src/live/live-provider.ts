import type { AbilityCatalog } from "@mplus/abilities";
import type {
  CharacterIdentityInput,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderResult,
  RegionCode,
  WarcraftLogsProvider,
  WclDataState,
  WclRateBudgetDecisionDTO,
  WclVisibilityState,
} from "@mplus/contracts";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
  ExternalApiError,
} from "@mplus/contracts";
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
import type { RankingParseEvidenceV2 } from "../extractors/v2/types.js";
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
  buildAliasedEncounterRankingsQuery,
  encounterObservationsToZoneRankingsPayload,
  mapAliasedEncounterRankings,
  MissingDungeonEncounterMappingError,
  rankingsToEncounterCandidates,
  requireActiveDungeonEncounters,
  timedEligibleCoverageByDungeon,
  type ActiveDungeonEncounterBinding,
} from "../discovery/encounter-rankings.js";
import {
  adaptPointsAndDamagePerformance,
  buildWclSummaryRequestFingerprint,
  buildPerformanceAggregateRequestFingerprint,
  pointsAndDamageErrorRecord,
  POINTS_AND_DAMAGE_ADAPTER_VERSION,
  type PointsAndDamagePerformanceRecord,
} from "../discovery/points-and-damage-performance.js";
import {
  ROLE_AWARE_THROUGHPUT_ADAPTER_VERSION,
  buildRoleAwareAggregateFromRaw,
  buildRoleAwarePerformanceAggregateRequestFingerprint,
} from "../discovery/role-aware-performance-aggregate.js";
import { parseJsonScalar } from "../probe/performance-probe-logic.js";
import {
  INCREMENTAL_HYDRATION_BATCH_SIZE,
  INITIAL_HYDRATION_BUDGET,
  MAX_HYDRATION_REPORTS,
} from "../discovery/bounds.js";
import {
  hydrateFightUnknownCandidates,
  type HydrationReportPayload,
} from "../discovery/report-hydration.js";
import { hydrateFightUnknownCandidatesIterative } from "../discovery/iterative-report-hydration.js";
import { collectBoundedRecentReportCodes } from "../discovery/recent-reports-pagination.js";
import {
  extractFriendlyPlayerActorIds,
  fightOwnershipRejectionDetail,
  resolveFightOwnership,
} from "../discovery/fight-ownership.js";
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
import { resolveRankingParseFromZoneRankings } from "../evidence/ranking-parse.js";
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
  /** Explicit opt-in for admission rate-limit capability (see contracts type guard). */
  readonly rateLimitSupported = true as const;
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
    const activeDungeonSlugs = (ctx.wclActiveDungeonSlugs ?? [])
      .map((slug) => slug.trim().toLowerCase())
      .filter((slug) => slug.length > 0);
    const fetchReport = (code: string) => this.fetchReportPayloadForHydration(code);

    // Coverage-aware iterative path (V2 cold production): open reports until each
    // active dungeon has TARGET candidates or stubs/rate budget are exhausted.
    // Legacy fixed budget (MAX_HYDRATION_REPORTS=5) is insufficient for 2×8 slots.
    let hydratedCandidates = discovery.candidates;
    let hydratedReportCount = 0;
    let terminalHydrationReason: string | null = null;
    let totalReportsHydrated: number | null = null;
    let reportsRemaining: number | null = null;

    const preCoverage =
      activeDungeonSlugs.length > 0
        ? timedEligibleCoverageByDungeon(discovery.candidates, activeDungeonSlugs)
        : null;
    const fightUnknownRemaining = discovery.candidates.some((c) => c.incompleteness.fightUnknown);

    if (activeDungeonSlugs.length > 0 && preCoverage?.fullCoverage && !fightUnknownRemaining) {
      // encounterRankings already supplied timed fight-known candidates — skip mass hydration.
      hydratedCandidates = discovery.candidates;
      hydratedReportCount = 0;
      terminalHydrationReason = "full_coverage";
      totalReportsHydrated = 0;
      reportsRemaining = 0;
      this.logger.info(
        {
          identity,
          activeDungeonCount: activeDungeonSlugs.length,
          distinctTimedPerDungeon: preCoverage.distinctTimedPerDungeon,
          terminalHydrationReason,
        },
        "wcl.discovery.hydration_skipped_encounter_rankings_coverage",
      );
    } else if (activeDungeonSlugs.length > 0) {
      const iterative = await hydrateFightUnknownCandidatesIterative({
        candidates: discovery.candidates,
        characterName: identity.name,
        realmSlug: identity.realmSlug,
        hints: ctx.wclHydrationHints,
        activeDungeonSlugs,
        initialBudget:
          this.maxHydrationReports > MAX_HYDRATION_REPORTS
            ? this.maxHydrationReports
            : INITIAL_HYDRATION_BUDGET,
        incrementalBatchSize: INCREMENTAL_HYDRATION_BATCH_SIZE,
        fetchReport,
        evaluateIncrementalAdmission: (args) => ({
          allow: true,
          action: "OK" as const,
          reasons: ["live_discover_incremental_default_allow"],
          projectedIncrementalPoints: args.projectedIncrementalPoints,
        }),
      });
      hydratedCandidates = iterative.candidates;
      hydratedReportCount = iterative.hydratedReportCount;
      terminalHydrationReason = iterative.diagnostics.terminalHydrationReason;
      totalReportsHydrated = iterative.diagnostics.totalReportsHydrated;
      reportsRemaining = iterative.diagnostics.reportsRemaining;
    } else {
      const legacy = await hydrateFightUnknownCandidates({
        candidates: discovery.candidates,
        characterName: identity.name,
        realmSlug: identity.realmSlug,
        hints: ctx.wclHydrationHints,
        maxReports: this.maxHydrationReports,
        fetchReport,
      });
      hydratedCandidates = legacy.candidates;
      hydratedReportCount = legacy.hydratedReportCount;
    }

    const knownFightCandidates = hydratedCandidates.filter(
      (c) => !c.incompleteness.fightUnknown,
    ).length;
    if (hydratedReportCount > 0) {
      this.logger.info(
        {
          identity,
          hydratedReportCount,
          knownFightCandidates,
          coverageAware: activeDungeonSlugs.length > 0,
          activeDungeonCount: activeDungeonSlugs.length,
          ...(terminalHydrationReason != null
            ? {
                terminalHydrationReason,
                totalReportsHydrated,
                reportsRemaining,
              }
            : {}),
        },
        "wcl.discovery.hydration",
      );
    }
    const runs = hydratedCandidates
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

  /**
   * Resolve active-season dungeon → WCL encounter bindings from the fetch context.
   * Prefer `wclActiveDungeonEncounters` (SeasonDungeon authority); catalog map is
   * fallback only. Missing bindings throw {@link MissingDungeonEncounterMappingError}.
   */
  private resolveEncounterBindingsFromContext(
    ctx: ProviderFetchContext,
  ): ActiveDungeonEncounterBinding[] {
    const activeDungeonSlugs = (ctx.wclActiveDungeonSlugs ?? [])
      .map((slug) => slug.trim().toLowerCase())
      .filter((slug) => slug.length > 0);
    const authoritative = ctx.wclActiveDungeonEncounters;
    if (activeDungeonSlugs.length === 0 && (authoritative?.length ?? 0) === 0) {
      return [];
    }
    const slugs =
      activeDungeonSlugs.length > 0
        ? activeDungeonSlugs
        : (authoritative ?? []).map((e) => e.dungeonSlug);
    return requireActiveDungeonEncounters({
      activeDungeonSlugs: slugs,
      authoritativeEncounters: authoritative,
    });
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
      revision: report.revision,
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
        keystoneBonus: f.keystoneBonus,
        keystoneTime: f.keystoneTime,
        inProgress: f.inProgress ?? false,
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

  /**
   * Dedicated Character.zoneRankings role-aware throughput aggregate.
   * DPS/Tank: one points_and_damage field. Healer: aliased healing + damage in one HTTP call.
   * Does not resolve character, query recent reports, hydrate fights, or fetch events.
   */
  async fetchCharacterPerformanceAggregate(input: {
    character: CharacterIdentityInput;
    zoneId: number;
    partition: number | null;
    role: "DPS" | "TANK" | "HEALER";
    specSlug: string | null;
    ctx: ProviderFetchContext;
  }): Promise<{
    record: {
      state: "OK" | "ERROR" | "SCHEMA_UNSUPPORTED" | "SKIPPED" | "EMPTY";
      adapterVersion: string;
      metric: string;
      compact: unknown | null;
      raw: unknown;
      errorMessage?: string;
    };
    rawPayload: unknown;
    sourceRequestFingerprint: string;
    providerCalls: number;
  }> {
    const fingerprint = buildRoleAwarePerformanceAggregateRequestFingerprint({
      region: input.character.region,
      realmSlug: input.character.realmSlug,
      name: input.character.name,
      zoneId: input.zoneId,
      partition: input.partition,
      role: input.role,
      specSlug: input.specSlug,
    });

    const serverRegion = mapRegionToWcl(input.character.region);
    const variables: Record<string, unknown> = {
      name: input.character.name,
      serverSlug: input.character.realmSlug,
      serverRegion,
      zoneID: input.zoneId,
    };
    if (input.partition != null) {
      variables.partition = input.partition;
    }

    const budget = await this.fetchRateLimit(input.ctx);
    if (budget.action === "STOP") {
      return {
        record: {
          state: "SKIPPED",
          adapterVersion: ROLE_AWARE_THROUGHPUT_ADAPTER_VERSION,
          metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
          compact: null,
          raw: null,
          errorMessage:
            "WCL rate budget STOP — role-aware Performance aggregate deferred",
        },
        rawPayload: null,
        sourceRequestFingerprint: fingerprint,
        providerCalls: 1,
      };
    }
    if (shouldDeferExpensiveWork(budget)) {
      throw wclError(
        "BUDGET_EXCEEDED",
        "WCL rate budget exceeded — deferring role-aware Performance fetch",
        {
          visibility: "RATE_LIMITED",
          utilizationPercent: budget.utilizationPercent,
        },
      );
    }

    const op =
      input.role === "HEALER"
        ? OPERATIONS.CharacterZoneRankingsRoleAwareHealer
        : OPERATIONS.CharacterZoneRankingsRoleAwareDamage;

    try {
      const perfResult = await this.client.request({
        operationName: op.operationName,
        query: op.query,
        variables,
        region: input.character.region,
      });

      if (perfResult.response.errors && perfResult.response.errors.length > 0) {
        const messages = perfResult.response.errors.map((e) => e.message);
        return {
          record: {
            state: "ERROR",
            adapterVersion: ROLE_AWARE_THROUGHPUT_ADAPTER_VERSION,
            metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
            compact: null,
            raw: null,
            errorMessage: `${op.operationName} GraphQL error: ${messages.join("; ")}`,
          },
          rawPayload: null,
          sourceRequestFingerprint: fingerprint,
          providerCalls: 1,
        };
      }

      const data = perfResult.response.data as
        | {
            characterData?: {
              character?: {
                damage?: unknown;
                healing?: unknown;
              } | null;
            };
          }
        | null
        | undefined;
      const damageRaw = parseJsonScalar(
        data?.characterData?.character?.damage ?? null,
      );
      const healingRaw =
        input.role === "HEALER"
          ? parseJsonScalar(data?.characterData?.character?.healing ?? null)
          : null;

      const built = buildRoleAwareAggregateFromRaw({
        role: input.role,
        targetSpecSlug: input.specSlug,
        zoneId: input.zoneId,
        partition: input.partition,
        damageRaw,
        healingRaw,
      });

      if (built.state !== "OK" || built.compact == null) {
        return {
          record: {
            state: built.state,
            adapterVersion: ROLE_AWARE_THROUGHPUT_ADAPTER_VERSION,
            metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
            compact: null,
            raw: built.rawPayload,
            errorMessage: built.errorMessage,
          },
          rawPayload: built.rawPayload,
          sourceRequestFingerprint: fingerprint,
          providerCalls: 1,
        };
      }

      return {
        record: {
          state: "OK",
          adapterVersion: ROLE_AWARE_THROUGHPUT_ADAPTER_VERSION,
          metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
          compact: built.compact,
          raw: built.rawPayload,
        },
        rawPayload: built.rawPayload,
        sourceRequestFingerprint: fingerprint,
        providerCalls: 1,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const schemaUnsupported =
        error instanceof ExternalApiError && error.code === "SCHEMA_UNSUPPORTED";
      return {
        record: {
          state: schemaUnsupported ? "SCHEMA_UNSUPPORTED" : "ERROR",
          adapterVersion: ROLE_AWARE_THROUGHPUT_ADAPTER_VERSION,
          metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
          compact: null,
          raw: null,
          errorMessage: `role-aware Performance query failed (${message})`,
        },
        rawPayload: null,
        sourceRequestFingerprint: fingerprint,
        providerCalls: 1,
      };
    }
  }

  /** Discovery-path pad-only fetch (not the scoring V2 aggregate). */
  private async fetchPointsAndDamageForDiscovery(input: {
    character: CharacterIdentityInput;
    zoneId: number;
    partition: number | null;
    ctx: ProviderFetchContext;
  }): Promise<PointsAndDamagePerformanceRecord> {
    const serverRegion = mapRegionToWcl(input.character.region);
    const variables: Record<string, unknown> = {
      name: input.character.name,
      serverSlug: input.character.realmSlug,
      serverRegion,
      zoneID: input.zoneId,
    };
    if (input.partition != null) {
      variables.partition = input.partition;
    }
    try {
      const perfResult = await this.client.request({
        operationName: OPERATIONS.CharacterZoneRankingsPointsAndDamage.operationName,
        query: OPERATIONS.CharacterZoneRankingsPointsAndDamage.query,
        variables,
        region: input.character.region,
      });
      if (perfResult.response.errors && perfResult.response.errors.length > 0) {
        return pointsAndDamageErrorRecord(
          "ERROR",
          null,
          `CharacterZoneRankingsPointsAndDamage GraphQL error: ${perfResult.response.errors
            .map((e) => e.message)
            .join("; ")}`,
        );
      }
      const data = perfResult.response.data as
        | { characterData?: { character?: { zoneRankings?: unknown } | null } }
        | null
        | undefined;
      const raw = parseJsonScalar(
        data?.characterData?.character?.zoneRankings ?? null,
      );
      let record = adaptPointsAndDamagePerformance({ raw });
      if (record.state === "EMPTY") {
        record = { ...record, state: "ERROR" };
      } else if (record.state === "OK" && record.dungeonAggregates.length === 0) {
        record = pointsAndDamageErrorRecord(
          "ERROR",
          raw,
          "points_and_damage returned OK with zero usable dungeon aggregates",
        );
      }
      return record;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const schemaUnsupported =
        error instanceof ExternalApiError && error.code === "SCHEMA_UNSUPPORTED";
      return pointsAndDamageErrorRecord(
        schemaUnsupported ? "SCHEMA_UNSUPPORTED" : "ERROR",
        null,
        `points_and_damage query failed (${message})`,
      );
    }
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

  /**
   * Fight-local ranking parse slices for the character/zone.
   * Prefers aliased Character.encounterRankings (per-dungeon ranks with rankPercent);
   * falls back to zoneRankings compare:Parses when encounter IDs are unavailable.
   */
  async fetchCharacterZoneRankingsParse(input: {
    character: { name: string; realmSlug: string; region: RegionCode };
    zoneId: number;
    ctx: ProviderFetchContext;
  }): Promise<{
    payload: ZoneRankingsPayload | null;
    providerCalls: number;
    unavailableReason: string | null;
  }> {
    if (!shouldQueryZoneRankings(this.zoneConfig)) {
      return {
        payload: null,
        providerCalls: 0,
        unavailableReason: "ranking_parse_zone_payload_empty",
      };
    }
    const serverRegion = mapRegionToWcl(input.character.region);
    const encounters = this.resolveEncounterBindingsFromContext(input.ctx);
    if (encounters.length > 0) {
      const aliased = buildAliasedEncounterRankingsQuery(encounters);
      const erResult = await this.client.request<{
        characterData: { character: Record<string, unknown> | null };
      }>({
        operationName: aliased.operationName,
        query: aliased.query,
        variables: {
          name: input.character.name,
          serverSlug: input.character.realmSlug,
          serverRegion,
        },
        region: input.character.region,
      });
      const observations = mapAliasedEncounterRankings({
        characterPayload: erResult.response.data?.characterData?.character ?? null,
        encounters,
        zoneId: input.zoneId,
      });
      const payload = encounterObservationsToZoneRankingsPayload(
        observations,
        input.zoneId,
        "playerscore",
      );
      return {
        payload,
        providerCalls: 1,
        unavailableReason: observations.length > 0 ? null : "ranking_parse_zone_payload_empty",
      };
    }

    const rankingsResult = await this.client.request({
      operationName: OPERATIONS.CharacterZoneRankings.operationName,
      query: OPERATIONS.CharacterZoneRankings.query,
      variables: {
        name: input.character.name,
        serverSlug: input.character.realmSlug,
        serverRegion,
        zoneID: input.zoneId,
      },
      region: input.character.region,
    });
    const rankingsParsed = parseWithSchema(
      zoneRankingsSchema,
      rankingsResult.response.data,
      "ZoneRankings",
    );
    const zonePayload = (rankingsParsed.characterData.character?.zoneRankings ??
      null) as ZoneRankingsPayload | null;
    return {
      payload: zonePayload,
      providerCalls: 1,
      unavailableReason: zonePayload?.rankings?.length
        ? null
        : "ranking_parse_zone_payload_empty",
    };
  }

  /**
   * First-class per-run RANKING_PARSE: zoneRankings row bound to reportCode+fightId+revision.
   * Not a dungeon aggregate — requires an exact fight match.
   */
  async getRankingParseForFight(input: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
    dungeonSlug: string;
    keyLevel: number | null;
    ctx: ProviderFetchContext;
  }): Promise<{
    evidence: RankingParseEvidenceV2 | null;
    providerCalls: number;
    unavailableReason: string | null;
  }> {
    const identity = requireTargetCharacter(input.ctx);
    const fetched = await this.fetchCharacterZoneRankingsParse({
      character: identity,
      zoneId: this.zoneConfig.zoneId,
      ctx: input.ctx,
    });
    const resolved = resolveRankingParseFromZoneRankings({
      payload: fetched.payload,
      zoneId: this.zoneConfig.zoneId,
      reportCode: input.reportCode,
      fightId: input.fightId,
      reportRevision: input.reportRevision,
      dungeonSlug: input.dungeonSlug,
      keyLevel: input.keyLevel,
    });
    return {
      evidence: resolved.evidence,
      providerCalls: fetched.providerCalls,
      unavailableReason:
        resolved.unavailableReason ?? fetched.unavailableReason,
    };
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

  /**
   * Fetch the account-global WCL rate-limit snapshot.
   * `ProviderFetchContext.region` is a synthetic placeholder (see
   * `WCL_RATE_LIMIT_CONTEXT_REGION`); GraphQL always uses transport region `"global"`.
   * `ctx.now` becomes the admission-facing `fetchedAt`; request/correlation ids are
   * accepted for call-site tracing even though the GraphQL client has no metadata hook.
   */
  async fetchRateLimit(ctx: ProviderFetchContext): Promise<WclRateBudgetDecisionDTO> {
    void ctx.requestId;
    void ctx.correlationId;
    void ctx.forceRefresh;
    void ctx.region;
    const result = await this.client.request({
      operationName: OPERATIONS.RateLimitData.operationName,
      query: OPERATIONS.RateLimitData.query,
      region: "global",
    });
    const parsed = parseWithSchema(rateLimitDataSchema, result.response.data, "RateLimitData");
    const snapshot = parseRateLimitSnapshot(parsed.rateLimitData);
    const decision = evaluateRateBudget(snapshot, {
      warnPercent: this.config.env.WCL_RATE_WARN_PERCENT,
      deferPercent: this.config.env.WCL_RATE_DEFER_PERCENT,
      stopPercent: this.config.env.WCL_RATE_STOP_PERCENT,
    });
    return {
      action: decision.action,
      utilizationPercent: decision.utilizationPercent,
      snapshot: {
        pointsRemaining: snapshot.pointsRemaining,
        pointsLimit: snapshot.limitPerHour,
        resetAt: snapshot.resetAt,
        fetchedAt: ctx.now,
      },
    };
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
    let rankingCandidates: ReturnType<typeof rankingsToCandidates> = [];
    let usedEncounterRankings = false;
    let performance: PointsAndDamagePerformanceRecord = pointsAndDamageErrorRecord(
      "SKIPPED",
      null,
      "points_and_damage not queried",
    );

    const activeDungeonSlugs = (ctx.wclActiveDungeonSlugs ?? [])
      .map((slug) => slug.trim().toLowerCase())
      .filter((slug) => slug.length > 0);
    let encounterTargets: ActiveDungeonEncounterBinding[] = [];
    try {
      encounterTargets = this.resolveEncounterBindingsFromContext(ctx);
    } catch (error) {
      if (error instanceof MissingDungeonEncounterMappingError) {
        warnings.push(error.message);
        throw error;
      }
      throw error;
    }

    if (shouldQueryZoneRankings(this.zoneConfig) && encounterTargets.length > 0) {
      // Preferred discovery: one aliased encounterRankings call for active dungeons.
      const aliased = buildAliasedEncounterRankingsQuery(encounterTargets);
      const erResult = await this.client.request<{
        characterData: { character: Record<string, unknown> | null };
      }>({
        operationName: aliased.operationName,
        query: aliased.query,
        variables: {
          name: identity.name,
          serverSlug: identity.realmSlug,
          serverRegion,
        },
        region: identity.region,
      });
      const erCharacter = erResult.response.data?.characterData?.character ?? null;
      rankings = mapAliasedEncounterRankings({
        characterPayload: erCharacter,
        encounters: encounterTargets,
        zoneId: this.zoneConfig.zoneId,
      });
      const slugByEncounter = new Map(
        encounterTargets.map((e) => [e.encounterId, e.dungeonSlug] as const),
      );
      rankingCandidates = rankingsToEncounterCandidates(rankings, slugByEncounter);
      usedEncounterRankings = true;
      const coverage = timedEligibleCoverageByDungeon(rankingCandidates, activeDungeonSlugs);
      warnings.push(
        `encounterRankings aliased: dungeons=${encounterTargets.length} logBackedRanks=${rankings.length} timedCoverage=${JSON.stringify(coverage.distinctTimedPerDungeon)} full=${coverage.fullCoverage}`,
      );

      const perf = await this.fetchPointsAndDamageForDiscovery({
        character: identity,
        zoneId: this.zoneConfig.zoneId,
        partition: null,
        ctx,
      });
      performance = perf;
      if (performance.state === "SCHEMA_UNSUPPORTED") {
        warnings.push(
          performance.diagnostics.errorMessage ?? "points_and_damage SCHEMA_UNSUPPORTED",
        );
      } else if (performance.state === "ERROR") {
        warnings.push(performance.diagnostics.errorMessage ?? "points_and_damage ERROR");
      }
    } else if (shouldQueryZoneRankings(this.zoneConfig)) {
      // Legacy: zone-wide Parses when active encounter IDs are unavailable.
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
      rankingCandidates = rankingsToCandidates(rankings);

      const perf = await this.fetchPointsAndDamageForDiscovery({
        character: identity,
        zoneId: this.zoneConfig.zoneId,
        partition: null,
        ctx,
      });
      performance = perf;
      if (performance.state === "SCHEMA_UNSUPPORTED") {
        warnings.push(
          performance.diagnostics.errorMessage ?? "points_and_damage SCHEMA_UNSUPPORTED",
        );
      } else if (performance.state === "ERROR") {
        warnings.push(performance.diagnostics.errorMessage ?? "points_and_damage ERROR");
      }
    } else {
      warnings.push(
        `Skipped zoneRankings/encounterRankings — configured zone ${this.zoneConfig.zoneId} is expired`,
      );
      performance = pointsAndDamageErrorRecord(
        "SKIPPED",
        null,
        `Skipped points_and_damage — configured zone ${this.zoneConfig.zoneId} is expired`,
      );
    }

    // recentReports → mass hydration only when encounter lists cannot fill timed slots.
    type RecentCandidate = ReturnType<typeof recentReportsToCandidates>["candidates"][number];
    let recentCandidates: RecentCandidate[] = [];
    let privateSkippedTotal = 0;
    let recentPublicCount = 0;

    const erCoverage =
      usedEncounterRankings && activeDungeonSlugs.length > 0
        ? timedEligibleCoverageByDungeon(rankingCandidates, activeDungeonSlugs)
        : null;

    if (erCoverage?.fullCoverage) {
      warnings.push(
        "recentReports pagination skipped — encounterRankings already provide timed coverage for every active dungeon",
      );
    } else {
      const candidatesByCode = new Map<string, RecentCandidate>();
      const pagination = await collectBoundedRecentReportCodes({
        fetchPage: async (page, limit) => {
          const recentResult = await this.client.request({
            operationName: OPERATIONS.CharacterRecentReports.operationName,
            query: OPERATIONS.CharacterRecentReports.query,
            variables: {
              name: identity.name,
              serverSlug: identity.realmSlug,
              serverRegion,
              limit,
              page,
            },
            region: identity.region,
          });
          const recentParsed = parseWithSchema(
            recentReportsSchema,
            recentResult.response.data,
            "RecentReports",
          );
          const pagePayload = recentParsed.characterData.character?.recentReports;
          const recentMapped = recentReportsToCandidates(pagePayload);
          for (const candidate of recentMapped.candidates) {
            if (!candidatesByCode.has(candidate.reportCode)) {
              candidatesByCode.set(candidate.reportCode, candidate);
            }
          }
          return {
            reportCodes: recentMapped.candidates.map((c) => c.reportCode),
            hasMorePages: pagePayload?.has_more_pages === true,
            privateSkipped: recentMapped.privateSkipped,
            unlistedSkipped: recentMapped.unlistedSkipped,
          };
        },
      });

      recentCandidates = pagination.reportCodes
        .map((code) => candidatesByCode.get(code))
        .filter((c): c is RecentCandidate => c != null);
      privateSkippedTotal = pagination.privateSkipped + pagination.unlistedSkipped;
      recentPublicCount = recentCandidates.length;

      if (pagination.unlistedSkipped > 0) {
        warnings.push(
          `Skipped ${pagination.unlistedSkipped} unlisted report(s) — never probed with allowUnlisted`,
        );
      }
      if (pagination.privateSkipped > 0) {
        warnings.push(`Skipped ${pagination.privateSkipped} private report(s)`);
      }
      warnings.push(
        `recentReports pagination: pagesFetched=${pagination.pagesFetched} stop=${pagination.stopReason} uniqueReports=${recentPublicCount}`,
      );
    }

    const provenance = deriveWclProvenance(character, rankings, recentPublicCount, {
      privateSkipped: privateSkippedTotal,
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
      rankingCandidates,
      recentCandidates,
      privateReportsSkipped: privateSkippedTotal,
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
    // Do NOT throw on revision-cache hits. A process-scoped boolean cache must not
    // soft-skip fight details for later consumers (Survival / shared evidence) in the
    // same or subsequent refreshes — that wiped Survival when combatFactsByRunId was empty.
    // Deduplication belongs in the worker (in-memory facts map + persisted run analysis).

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
    const fightFriendlyPlayerActorIds = extractFriendlyPlayerActorIds(fight.friendlyPlayers);

    // Independent ownership gate before any ReportEvents call.
    const ownership = resolveFightOwnership({
      actors,
      friendlyPlayers: fight.friendlyPlayers,
      characterName,
      realmSlug,
      keystoneLevel: fight.keystoneLevel,
      inProgress: fight.inProgress ?? false,
      requireMythicPlus: true,
    });
    if (!ownership.ok) {
      throw wclError(
        "NOT_FOUND",
        fightOwnershipRejectionDetail(ownership.reason, {
          fightId,
          targetActorId: ownership.targetActorId,
        }),
        {
          ownershipReason: ownership.reason,
          targetActorId: ownership.targetActorId,
          fightFriendlyPlayerActorIds: ownership.fightFriendlyPlayerActorIds,
          targetInFight: false,
          reportCode,
          fightId,
        },
      );
    }

    const combatFacts = await buildRunCombatFactsFromEvents(this.client, {
      reportCode,
      fightId,
      revision: report.revision,
      characterName,
      realmSlug,
      actors,
      friendlyPlayers: fight.friendlyPlayers,
      keystoneLevel: fight.keystoneLevel,
      inProgress: fight.inProgress ?? false,
      requireMythicPlus: false, // already gated above
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
        keystoneBonus: fight.keystoneBonus ?? null,
        keystoneTime: fight.keystoneTime ?? null,
        inProgress: fight.inProgress === true,
        fightFriendlyPlayerActorIds,
        targetActorId: ownership.targetActorId,
        targetInFight: true,
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
