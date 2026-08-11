import type {
  CharacterIdentityInput,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderResult,
  WarcraftLogsProvider,
  WclDataState,
  WclRateBudgetDecisionDTO,
  WclVisibilityState,
} from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";
import { computeRunFingerprint } from "@mplus/domain";
import {
  buildCharacterDiscovery,
  deriveWclProvenance,
  mapCharacterSummary,
  mapRegionToWcl,
  mapZoneRankings,
  mythicRunPlaceholders,
  rankingsToCandidates,  type ZoneRankingsPayload,
} from "../discovery/run-discovery.js";
import {
  adaptPointsAndDamagePerformance,
  buildWclSummaryRequestFingerprint,
  buildPerformanceAggregateRequestFingerprint,
  pointsAndDamageErrorRecord,
  POINTS_AND_DAMAGE_ADAPTER_VERSION,
} from "../discovery/points-and-damage-performance.js";
import {
  ROLE_AWARE_THROUGHPUT_ADAPTER_VERSION,
  buildRoleAwareAggregateFromRaw,
  buildRoleAwarePerformanceAggregateRequestFingerprint,
} from "../discovery/role-aware-performance-aggregate.js";
import { CHARACTER_PERFORMANCE_AGGREGATE_METRIC } from "@mplus/contracts";
import { parseJsonScalar } from "../probe/performance-probe-logic.js";
import { FIXTURE_MPLUS_ZONE_ID, resolveMplusZoneConfig } from "../discovery/mplus-zone.js";
import {
  characterResolveSchema,
  parseWithSchema,
  rateLimitDataSchema,  reportFightSchema,
  zoneRankingsSchema,
} from "../client/graphql-client.js";
import { wclError } from "../client/errors.js";
import { buildRunCombatFacts } from "../analysis/combat-facts.js";
import { ReportRevisionCache } from "../analysis/revision-cache.js";
import { evaluateRateBudget, parseRateLimitSnapshot } from "../rate/rate-budget.js";
import {
  fightOwnershipRejectionDetail,
  resolveFightOwnership,
} from "../discovery/fight-ownership.js";
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
  /** Explicit opt-in: fixture returns a deterministic rate-limit snapshot. */
  readonly rateLimitSupported = true as const;
  private readonly revisionCache = new ReportRevisionCache();
  private readonly fetchedReports = new Set<string>();

  async discoverCharacterRuns(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<MythicRunDTO[]>> {
    const discovery = this.discoverCharacter(identity, ctx);
    const runs = discovery.candidates
      .filter((c) => c.fightId > 0)
      .map((c) => this.candidateToMythicRun(c, identity, ctx));
    const envelope = emptyProviderResult(
      runs,
      "discoverCharacterRuns",
      `fixture-discover-${identity.name}`,
      ctx,
    );
    return { ...envelope, wclRankings: discovery.rankings } as ProviderResult<MythicRunDTO[]> & {
      wclRankings: typeof discovery.rankings;
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
      dungeonAggregates: WclCharacterDiscoveryResult["dungeonAggregates"];
      performance: WclCharacterDiscoveryResult["performance"];
      rawZoneRankingsPointsAndDamage: unknown;
    }>
  > {
    const discovery = this.discoverCharacter(identity, ctx);
    const zoneId = resolveMplusZoneConfig({
      env: process.env,
      allowFixtureDefault: true,
    }).zoneId;
    const fingerprint = buildWclSummaryRequestFingerprint({
      region: identity.region,
      realmSlug: identity.realmSlug,
      name: identity.name,
      zoneId,
      partition: null,
    });
    const envelope = emptyProviderResult(
      {
        visibility: discovery.summary.visibility,
        dataState: discovery.summary.dataState,
        warnings: discovery.summary.warnings,
        dungeonAggregates: discovery.dungeonAggregates,
        performance: discovery.performance,
        rawZoneRankingsPointsAndDamage: discovery.performance?.raw ?? null,
      },
      "discoverCharacterSummary",
      fingerprint,
      ctx,
    );
    return {
      ...envelope,
      provenance: {
        ...envelope.provenance,
        schemaVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
      },
      metadata: {
        ...envelope.metadata,
        requestFingerprint: fingerprint,
      },
    };
  }

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
    const fixture = loadFixtureByIdentity(
      input.character.name,
      input.character.realmSlug,
    );
    const padEnvelope = fixture.zoneRankingsPointsAndDamage as
      | { data?: { characterData?: { character?: { zoneRankings?: unknown } } } }
      | undefined;
    if (!padEnvelope) {
      return {
        record: {
          state: "SKIPPED",
          adapterVersion: ROLE_AWARE_THROUGHPUT_ADAPTER_VERSION,
          metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
          compact: null,
          raw: null,
          errorMessage:
            "Fixture has no zoneRankingsPointsAndDamage — Performance unavailable",
        },
        rawPayload: null,
        sourceRequestFingerprint: fingerprint,
        providerCalls: 1,
      };
    }
    const damageRaw = parseJsonScalar(
      padEnvelope.data?.characterData?.character?.zoneRankings ?? null,
    );
    const healingRaw =
      input.role === "HEALER" && damageRaw != null && typeof damageRaw === "object"
        ? { ...(damageRaw as Record<string, unknown>), metric: "points_and_healing" }
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

  async fetchSurvivalHealthSnapshots(
    input: { reportCode: string; fightId: number; sourceId: number },
    ctx: ProviderFetchContext,
  ) {
    return emptyProviderResult(
      {
        snapshots: [],
        truncated: false,
        eventCount: 0,
        events: [],
      },
      "fetchSurvivalHealthSnapshots",
      `fixture-survival-health-${input.reportCode}-${input.fightId}-${input.sourceId}`,
      ctx,
    );
  }

  async analyzeSurvivalCanonicalRun(
    input: {
      characterId: string;
      reportCode: string;
      fightId: number;
      dungeonSlug: string;
      keyLevel: number | null;
      playerActorId: number;
    },
    ctx: ProviderFetchContext,
  ) {
    // Fixture: outcome-only placeholder (no live event pages).
    const summary = {
      compatibilityKey: `fixture:${input.reportCode}:${input.fightId}`,
      configVersion: "survival-standalone-v1.1.1",
      analysisVersion: "wcl-survival-v1.1.1-parity",
      adapterVersion: "survival-adapter-v1.1.1-parity",
      runId: `${input.reportCode}:${input.fightId}`,
      dungeonSlug: input.dungeonSlug,
      reportCode: input.reportCode,
      fightId: input.fightId,
      keyLevel: input.keyLevel,
      deathCount: 0,
      behavioralSurvivalScore: 100,
      outcomeOnlyScore: 100,
      pressureClusterCount: 0,
      maxHpResolution: {
        baselineMaxHp: null,
        baselineConfidence: "NONE" as const,
        baselineSourcePath: null,
        invalidOutlierCount: 0,
        temporaryIntervalCount: 0,
        rejectionReasons: { fixture_no_events: 1 },
        resolutionFailureReason: "fixture_no_events",
      },
      componentScores: {
        outcome: {
          state: "SCORED" as const,
          score: 100,
          weightUsed: 1,
          reason: null,
          evidence: { deathCount: 0 },
        },
        defensiveResponse: {
          state: "NOT_APPLICABLE" as const,
          score: null,
          weightUsed: 0,
          reason: "fixture_no_events",
          evidence: {},
        },
        emergencyRecovery: {
          state: "NOT_APPLICABLE" as const,
          score: null,
          weightUsed: 0,
          reason: "fixture_no_events",
          evidence: {},
        },
        weightsApplied: {
          survivalOutcome: 1,
          defensiveResponse: 0,
          emergencyRecovery: 0,
        },
      },
      defensiveCounts: {
        proactive: 0,
        reactive: 0,
        death_only: 0,
        unavailable: 0,
        eligible_miss: 0,
        not_applicable: 0,
        insufficient_reaction_time: 0,
      },
      recoveryCounts: {
        covered: 0,
        eligible_miss: 0,
        not_applicable: 0,
        insufficient_reaction_time: 0,
        death_only_health_context_unavailable: 0,
      },
      diagnostics: {
        scoreMode: "OUTCOME_ONLY" as const,
        invalidOutlierCount: 0,
        healthTimelineComplete: false,
        preClusterDangerWindowCount: 0,
        nonFatalWindowCount: 0,
        fatalWindowCount: 0,
        deathOnlyWindowCount: 0,
        eventPagesComplete: false,
      },
    };
    return emptyProviderResult(
      {
        summary,
        requestCount: 0,
        maxHpFailureReason: "fixture_no_events",
        truncated: false,
        snapshotCount: 0,
        playerActorId: input.playerActorId,
        deathCount: 0,
        pressureClusterCount: 0,
        behavioralSurvivalScore: 100,
      },
      "analyzeSurvivalCanonicalRun",
      `fixture-survival-canonical-${input.reportCode}-${input.fightId}`,
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

    const padEnvelope = fixture.zoneRankingsPointsAndDamage as
      | { data?: { characterData?: { character?: { zoneRankings?: unknown } } } }
      | undefined;
    const performance = padEnvelope
      ? adaptPointsAndDamagePerformance({
          raw: parseJsonScalar(padEnvelope.data?.characterData?.character?.zoneRankings ?? null),
        })
      : pointsAndDamageErrorRecord(
          "SKIPPED",
          null,
          "Fixture has no zoneRankingsPointsAndDamage — Performance unavailable",
        );

    const provenance = deriveWclProvenance(character, rankings, rankings.length);
    const summary = mapCharacterSummary(
      character,
      identity.region,
      ctx.now,
      provenance.visibility,
      [],
      provenance.dataState,
    );

    return buildCharacterDiscovery({
      summary,
      rankings,
      dungeonAggregates: performance.state === "OK" ? performance.dungeonAggregates : [],
      performance,
      rankingCandidates: rankingsToCandidates(rankings),
      privateReportsSkipped: 0,
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

  /**
   * Deterministic fixture rate-limit capability for admission snapshot refreshers.
   * Uses canonical ProviderFetchContext; rateLimitData itself is account-global.
   * `ctx.now` is the admission-facing fetchedAt (fixture body timestamps are ignored).
   */
  async fetchRateLimit(ctx: ProviderFetchContext): Promise<WclRateBudgetDecisionDTO> {
    const decision = this.getRateBudgetDecision(ctx);
    return {
      action: decision.action,
      utilizationPercent: decision.utilizationPercent,
      snapshot: {
        pointsRemaining: decision.snapshot.pointsRemaining,
        pointsLimit: decision.snapshot.limitPerHour,
        resetAt: decision.snapshot.resetAt,
        fetchedAt: ctx.now,
      },
    };
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

    const actors = report.masterData?.actors ?? [];
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

    const eventsFixture = fixture.events ?? {};
    const combatFacts = buildRunCombatFacts({
      reportCode,
      fightId,
      revision: report.revision,
      characterName,
      realmSlug,
      actors,
      eventsByType: eventsFixture,
      alreadyFetched: this.fetchedReports.has(cacheKey),
    });
    this.fetchedReports.add(cacheKey);

    const friendlyPlayers = (fight.friendlyPlayers ?? []).map((p) =>
      typeof p === "number"
        ? { id: p, name: "", server: "", type: "Player", icon: null }
        : {
            id: p.id,
            name: p.name,
            server: p.server,
            type: p.type,
            icon: p.icon ?? null,
          },
    );

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
        fightFriendlyPlayerActorIds: ownership.fightFriendlyPlayerActorIds,
        targetActorId: ownership.targetActorId,
        targetInFight: true,
        friendlyPlayers,
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
