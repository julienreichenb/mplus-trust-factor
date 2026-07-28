/**
 * Gate A.1 — analyze all ScoringRunSelection entries (up to season dungeon count).
 * Selection is highest key → score → timed → latest; never demotes unlogged highest.
 */
import { createHash } from "node:crypto";
import type {
  MetricObservationDTO,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderResult,
  ScoringRunSelection,
  ScoringSelectedRun,
} from "@mplus/contracts";
import {
  MIDNIGHT_S1_SEASON,
  extractSurvivalCounts,
  extractUtilityCounts,
  loadSeedAbilityCatalog,
  loadSeedScoringMechanicCatalog,
  resolveSeasonDungeonSet,
  type SeasonDungeonSet,
} from "@mplus/mechanics";
import {
  resolveMaxAnalysisFights,
  resolveAttributedSourceIds,
  type RunCombatFacts,
  type WclReportFightDetails,
} from "@mplus/provider-warcraftlogs";
import {
  buildProvenance,
  computeKeyDifficultyPercentile,
  rawFactsToMetricObservations,
  resolveSelectedRunParsePercentile,
  selectScoringRuns,
  toPerformanceRawInputs,
  toSurvivalRawFacts,
  toUtilityRawFacts,
  type RankingParseCandidate,
  type SelectableScoringRun,
} from "@mplus/scoring";

export interface ScoringRunWclSource {
  reportCode: string;
  fightId: number;
}

export interface ScoringRunAnalysisCandidate {
  /** DB MythicRun id used for persistence. */
  runId: string;
  dungeonSlug: string;
  seasonSlug: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  durationMs: number | null;
  raiderIoScore: number | null;
  wclSource: ScoringRunWclSource | null;
  canonicalFingerprint?: string;
  /** Parse percentile tied to this report/fight when known from rankings. */
  parsePercentile?: number | null;
  bracket?: number | null;
  rankPercent?: number | null;
}

export interface ScoringRunAnalysisRow {
  selected: ScoringSelectedRun;
  runId: string;
  dungeonSlug: string;
  combatFacts: RunCombatFacts | null;
  detailAvailable: boolean;
  rejectionReason: string | null;
  analysisError: string | null;
  reusedCachedFight: boolean;
  wclApiCalls: number;
  parsePercentile: number | null;
  parseBindingSource: string | null;
}

export interface ScoringRunAnalysisDiagnostics {
  selectedRunCount: number;
  analyzedFightCount: number;
  missingCombatFactCount: number;
  wclApiCallCount: number;
  deduplicatedFightFetches: number;
  budget: number;
  expectedDungeonCount: number;
  missingDungeonSlugs: string[];
  rows: Array<{
    dungeonSlug: string;
    runId: string;
    keyLevel: number;
    detailAvailable: boolean;
    rejectionReason: string | null;
    analysisError: string | null;
    reusedCachedFight: boolean;
  }>;
}

export interface AnalyzeScoringRunsResult {
  selection: ScoringRunSelection;
  rows: ScoringRunAnalysisRow[];
  combatFactsList: RunCombatFacts[];
  v3Observations: MetricObservationDTO[];
  diagnostics: ScoringRunAnalysisDiagnostics;
}

export type FetchReportFightDetails = (
  reportCode: string,
  fightId: number,
  ctx: ProviderFetchContext,
) => Promise<ProviderResult<unknown> & { wclApiCallCount?: number }>;

function wclSourceFromDto(run: MythicRunDTO): ScoringRunWclSource | null {
  const source = run.sources.find(
    (s) =>
      s.provider === "WARCRAFT_LOGS" &&
      typeof s.reportCode === "string" &&
      s.reportCode.length > 0 &&
      typeof s.fightId === "number" &&
      s.fightId > 0,
  );
  if (!source?.reportCode || source.fightId == null) return null;
  return { reportCode: source.reportCode, fightId: source.fightId };
}

function parseFromDto(run: MythicRunDTO): {
  parsePercentile: number | null;
  bracket: number | null;
} {
  const source = run.sources.find((s) => s.provider === "WARCRAFT_LOGS");
  return {
    parsePercentile:
      source?.parsePercentile != null && Number.isFinite(source.parsePercentile)
        ? source.parsePercentile
        : null,
    bracket: source?.bracket ?? null,
  };
}

/** Map fused DTOs into analysis candidates (WCL source from DTO, not discovery order). */
export function candidatesFromMythicRunDtos(runs: MythicRunDTO[]): ScoringRunAnalysisCandidate[] {
  return runs.map((run) => {
    const parse = parseFromDto(run);
    return {
      runId: run.id,
      dungeonSlug: run.dungeonSlug,
      seasonSlug: run.seasonSlug,
      keyLevel: run.keyLevel,
      timed: run.timed,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      raiderIoScore: run.scoreValue,
      wclSource: wclSourceFromDto(run),
      canonicalFingerprint: run.canonicalFingerprint,
      parsePercentile: parse.parsePercentile,
      bracket: parse.bracket,
    };
  });
}

export function resolveScoringSeasonDungeonSet(input: {
  seasonSlug?: string | null;
  dungeonCount?: number | null;
  allowPlaceholder?: boolean;
}): SeasonDungeonSet {
  const configured = input.seasonSlug?.trim();
  if (configured) {
    try {
      return resolveSeasonDungeonSet({
        seasonSlug: configured,
        dungeonSlugs:
          configured === MIDNIGHT_S1_SEASON.seasonSlug ||
          configured.startsWith("blizzard-season-")
            ? MIDNIGHT_S1_SEASON.dungeonSlugs
            : undefined,
        expectedDungeonCount: input.dungeonCount ?? MIDNIGHT_S1_SEASON.expectedDungeonCount,
        allowPlaceholder: input.allowPlaceholder,
      });
    } catch {
      /* fall through to midnight default */
    }
  }
  return {
    ...MIDNIGHT_S1_SEASON,
    expectedDungeonCount: input.dungeonCount && input.dungeonCount > 0
      ? input.dungeonCount
      : MIDNIGHT_S1_SEASON.expectedDungeonCount,
  };
}

function toSelectable(candidate: ScoringRunAnalysisCandidate): SelectableScoringRun {
  const fingerprint = candidate.wclSource
    ? createHash("sha256").update(candidate.wclSource.reportCode, "utf8").digest("hex").slice(0, 12)
    : null;
  return {
    id: candidate.runId,
    dungeonSlug: candidate.dungeonSlug,
    seasonSlug: candidate.seasonSlug,
    keyLevel: candidate.keyLevel,
    timed: candidate.timed,
    completedAt: candidate.completedAt,
    durationMs: candidate.durationMs,
    raiderIoScore: candidate.raiderIoScore,
    wclReportMatched: candidate.wclSource != null,
    wclCoverageRatio: null,
    wclReportCode: candidate.wclSource?.reportCode ?? null,
    wclReportFingerprint: fingerprint,
    wclFightId: candidate.wclSource?.fightId ?? null,
    matchConfidence: candidate.wclSource ? "MEDIUM" : null,
    matchEvidence: candidate.wclSource
      ? {
          dungeonMatch: true,
          keyLevelMatch: true,
          timeDeltaMs: null,
          durationDeltaMs: null,
          rosterOverlapRatio: null,
        }
      : null,
  };
}

function fightCacheKey(reportCode: string, fightId: number): string {
  return `${reportCode}:${fightId}`;
}

function coverageRatio(facts: RunCombatFacts): number {
  const flags = Object.values(facts.coverage);
  if (flags.length === 0) return 0;
  return flags.filter(Boolean).length / flags.length;
}

function buildUnavailableObservations(input: {
  selected: ScoringSelectedRun;
  observedAt: string;
  reason: string;
  seasonSlug: string;
  classSlug?: string | null;
  specSlug?: string | null;
  region?: string | null;
  parsePercentile?: number | null;
  top25CutoffScore?: number | null;
}): MetricObservationDTO[] {
  const abilityCatalog = loadSeedAbilityCatalog();
  const mechanicCatalog = loadSeedScoringMechanicCatalog();
  const provenance = buildProvenance({
    sourceProvider: "derived",
    canonicalRunId: input.selected.canonicalRunId,
    dungeonSlug: input.selected.dungeonSlug,
    abilityCatalog,
    mechanicCatalog,
    observedAt: input.observedAt,
  });
  const survival = toSurvivalRawFacts({
    provenance,
    counts: null,
    detailAvailable: false,
    missingReasons: [input.reason],
  });
  const utility = toUtilityRawFacts({
    provenance,
    counts: null,
    detailAvailable: false,
    missingReasons: [input.reason],
  });
  const keyDiff = computeKeyDifficultyPercentile({
    keyLevel: input.selected.keyLevel,
    timed: input.selected.timed,
    context: {
      seasonSlug: input.seasonSlug,
      region: input.region ?? null,
      top25CutoffScore: input.top25CutoffScore ?? null,
      observedKeyLevels: [input.selected.keyLevel],
    },
  });
  const performance = toPerformanceRawInputs({
    provenance,
    parsePercentile: input.parsePercentile ?? null,
    keyLevel: input.selected.keyLevel,
    timed: input.selected.timed,
    seasonSlug: input.seasonSlug,
    region: input.region ?? null,
    detailAvailable: false,
    keyDifficultyPercentile: keyDiff.percentile,
    keyDifficultySource: keyDiff.source,
    keyDifficultyReason: keyDiff.reason,
  });
  return rawFactsToMetricObservations({ survival, utility, performance }).map((obs) => ({
    ...obs,
    confidence: Math.min(obs.confidence, 0.15),
    context: {
      ...(typeof obs.context === "object" && obs.context ? obs.context : {}),
      detailAvailable: false,
      rejectionReason: input.reason,
      classSlug: input.classSlug ?? null,
      specSlug: input.specSlug ?? null,
      keyDifficultyPercentile: keyDiff.percentile,
    },
  }));
}

function buildAvailableObservations(input: {
  selected: ScoringSelectedRun;
  facts: RunCombatFacts;
  observedAt: string;
  seasonSlug: string;
  classSlug?: string | null;
  specSlug?: string | null;
  region?: string | null;
  parsePercentile?: number | null;
  top25CutoffScore?: number | null;
}): MetricObservationDTO[] {
  const abilityCatalog = loadSeedAbilityCatalog();
  const mechanicCatalog = loadSeedScoringMechanicCatalog();
  const attributed = resolveAttributedSourceIds(input.facts.actorMap, input.facts.targetSourceId);
  const hostileTargetIds = new Set<number>();
  for (const actor of input.facts.actorMap.byId.values()) {
    if (actor.type === "NPC" || actor.type === "Boss" || actor.type === "Enemy") {
      hostileTargetIds.add(actor.id);
    }
  }
  const extractInput = {
    seasonSlug: input.seasonSlug,
    dungeonSlug: input.selected.dungeonSlug,
    targetSourceId: input.facts.targetSourceId,
    attributedSourceIds: attributed,
    hostileTargetIds,
    maxHealth: null as number | null,
    abilityCatalog,
    mechanicCatalog,
    casts: input.facts.casts,
    interrupts: input.facts.interrupts,
    deaths: input.facts.deaths,
    damageTaken: input.facts.damageTaken,
    healing: input.facts.healing,
    dispels: input.facts.dispels,
    auras: input.facts.auras,
    classSlug: input.classSlug ?? null,
    specSlug: input.specSlug ?? null,
  };
  const survivalCounts = extractSurvivalCounts(extractInput);
  const utilityCounts = extractUtilityCounts(extractInput);
  const provenance = buildProvenance({
    sourceProvider: "warcraftlogs",
    canonicalRunId: input.selected.canonicalRunId,
    dungeonSlug: input.selected.dungeonSlug,
    abilityCatalog,
    mechanicCatalog,
    observedAt: input.observedAt,
  });
  const survival = toSurvivalRawFacts({
    provenance,
    counts: survivalCounts,
    detailAvailable: true,
  });
  const utility = toUtilityRawFacts({
    provenance,
    counts: utilityCounts,
    detailAvailable: true,
  });
  const keyDiff = computeKeyDifficultyPercentile({
    keyLevel: input.selected.keyLevel,
    timed: input.selected.timed,
    context: {
      seasonSlug: input.seasonSlug,
      region: input.region ?? null,
      top25CutoffScore: input.top25CutoffScore ?? null,
      observedKeyLevels: [input.selected.keyLevel],
    },
  });
  const performance = toPerformanceRawInputs({
    provenance,
    parsePercentile: input.parsePercentile ?? null,
    keyLevel: input.selected.keyLevel,
    timed: input.selected.timed,
    seasonSlug: input.seasonSlug,
    region: input.region ?? null,
    detailAvailable: true,
    keyDifficultyPercentile: keyDiff.percentile,
    keyDifficultySource: keyDiff.source,
    keyDifficultyReason: keyDiff.reason,
  });
  return rawFactsToMetricObservations({ survival, utility, performance }).map((obs) => ({
    ...obs,
    context: {
      ...(typeof obs.context === "object" && obs.context ? obs.context : {}),
      detailAvailable: true,
      coverageRatio: coverageRatio(input.facts),
      classSlug: input.classSlug ?? null,
      specSlug: input.specSlug ?? null,
      keyDifficultyPercentile: keyDiff.percentile,
    },
  }));
}

function resolveParseForCandidate(
  candidate: ScoringRunAnalysisCandidate,
  rankings: readonly RankingParseCandidate[],
): { parsePercentile: number | null; source: string | null } {
  if (rankings.length > 0 && candidate.wclSource) {
    const binding = resolveSelectedRunParsePercentile({
      rankings,
      reportCode: candidate.wclSource.reportCode,
      fightId: candidate.wclSource.fightId,
      selectedKeyLevel: candidate.keyLevel,
    });
    if (binding.executionPercentile != null) {
      return { parsePercentile: binding.executionPercentile, source: binding.source };
    }
  }
  if (candidate.parsePercentile != null && Number.isFinite(candidate.parsePercentile)) {
    const bracketOk =
      candidate.bracket == null || candidate.bracket === candidate.keyLevel;
    return {
      parsePercentile: candidate.parsePercentile,
      source: bracketOk ? "selected_fight_bracket_matched" : "selected_fight",
    };
  }
  return { parsePercentile: null, source: "unavailable" };
}

/**
 * Analyze every selected canonical scoring run (bounded), with report/fight dedupe.
 * Partial provider failures mark that dungeon unavailable and continue.
 */
export async function analyzeScoringRuns(input: {
  candidates: ScoringRunAnalysisCandidate[];
  season: SeasonDungeonSet;
  ctx: ProviderFetchContext;
  fetchReportFightDetails: FetchReportFightDetails;
  configuredMaxAnalysisFights?: number | null;
  observedAt?: string;
  classSlug?: string | null;
  specSlug?: string | null;
  isSoftSkipError?: (error: unknown) => boolean;
  /** Optional GraphQL request accounting around the analysis session. */
  beginWclApiCallAccounting?: () => void;
  endWclApiCallAccounting?: () => number;
  /** Bracket-aware ranking rows used to tie parses to selected fights. */
  parseRankings?: readonly RankingParseCandidate[];
  top25CutoffScore?: number | null;
}): Promise<AnalyzeScoringRunsResult> {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const budget = resolveMaxAnalysisFights({
    expectedDungeonCount: input.season.expectedDungeonCount || input.season.dungeonSlugs.length,
    configuredMax: input.configuredMaxAnalysisFights,
  });
  const rankings = input.parseRankings ?? [];
  const top25CutoffScore = input.top25CutoffScore ?? null;

  // Align candidate season slugs with the scoring season so out-of-season rows drop.
  const selectables = input.candidates.map((c) => {
    const selectable = toSelectable(c);
    return selectable;
  });

  const selection = selectScoringRuns({
    season: input.season,
    runs: selectables,
    observedAt,
  });

  const byId = new Map(input.candidates.map((c) => [c.runId, c]));
  const targets = selection.selectedRuns.slice(0, budget);

  const fightCache = new Map<
    string,
    { result: ProviderResult<unknown> & { wclApiCallCount?: number }; apiCalls: number }
  >();
  let wclApiCallCount = 0;
  let deduplicatedFightFetches = 0;
  input.beginWclApiCallAccounting?.();

  const rows: ScoringRunAnalysisRow[] = [];
  const combatFactsList: RunCombatFacts[] = [];
  const v3Observations: MetricObservationDTO[] = [];

  for (const selected of targets) {
    const candidate = byId.get(selected.canonicalRunId);
    if (!candidate) {
      rows.push({
        selected,
        runId: selected.canonicalRunId,
        dungeonSlug: selected.dungeonSlug,
        combatFacts: null,
        detailAvailable: false,
        rejectionReason: "selected_run_missing_from_candidates",
        analysisError: null,
        reusedCachedFight: false,
        wclApiCalls: 0,
        parsePercentile: null,
        parseBindingSource: null,
      });
      v3Observations.push(
        ...buildUnavailableObservations({
          selected,
          observedAt,
          reason: "selected_run_missing_from_candidates",
          seasonSlug: input.season.seasonSlug,
          classSlug: input.classSlug,
          specSlug: input.specSlug,
          region: input.ctx.region,
          top25CutoffScore,
        }),
      );
      continue;
    }

    const parseBinding = resolveParseForCandidate(candidate, rankings);

    if (!candidate.wclSource || !selected.wclReportMatched) {
      const reason =
        selected.rejectionReasons[0] ?? "wcl_detail_unavailable_on_highest_run";
      rows.push({
        selected,
        runId: candidate.runId,
        dungeonSlug: selected.dungeonSlug,
        combatFacts: null,
        detailAvailable: false,
        rejectionReason: reason,
        analysisError: null,
        reusedCachedFight: false,
        wclApiCalls: 0,
        parsePercentile: parseBinding.parsePercentile,
        parseBindingSource: parseBinding.source,
      });
      v3Observations.push(
        ...buildUnavailableObservations({
          selected,
          observedAt,
          reason,
          seasonSlug: input.season.seasonSlug,
          classSlug: input.classSlug,
          specSlug: input.specSlug,
          region: input.ctx.region,
          parsePercentile: parseBinding.parsePercentile,
          top25CutoffScore,
        }),
      );
      continue;
    }

    const key = fightCacheKey(candidate.wclSource.reportCode, candidate.wclSource.fightId);
    let reusedCachedFight = false;
    let rowApiCalls = 0;
    let details: WclReportFightDetails | null = null;
    let analysisError: string | null = null;

    try {
      const cached = fightCache.get(key);
      if (cached) {
        reusedCachedFight = true;
        deduplicatedFightFetches += 1;
        details = cached.result.data as WclReportFightDetails;
      } else {
        const result = await input.fetchReportFightDetails(
          candidate.wclSource.reportCode,
          candidate.wclSource.fightId,
          input.ctx,
        );
        rowApiCalls = result.wclApiCallCount ?? 1;
        wclApiCallCount += rowApiCalls;
        fightCache.set(key, { result, apiCalls: rowApiCalls });
        details = result.data as WclReportFightDetails;
      }
    } catch (error) {
      const soft = input.isSoftSkipError?.(error) ?? false;
      analysisError = error instanceof Error ? error.message : String(error);
      if (!soft) {
        // Still continue other dungeons — partial failure must not fail all eight.
        analysisError = `partial_failure:${analysisError}`;
      }
    }

    if (!details?.combatFacts) {
      const reason = analysisError ?? "wcl_fight_details_unavailable";
      rows.push({
        selected,
        runId: candidate.runId,
        dungeonSlug: selected.dungeonSlug,
        combatFacts: null,
        detailAvailable: false,
        rejectionReason: reason,
        analysisError,
        reusedCachedFight,
        wclApiCalls: rowApiCalls,
        parsePercentile: parseBinding.parsePercentile,
        parseBindingSource: parseBinding.source,
      });
      v3Observations.push(
        ...buildUnavailableObservations({
          selected,
          observedAt,
          reason,
          seasonSlug: input.season.seasonSlug,
          classSlug: input.classSlug,
          specSlug: input.specSlug,
          region: input.ctx.region,
          parsePercentile: parseBinding.parsePercentile,
          top25CutoffScore,
        }),
      );
      continue;
    }

    const coverage = coverageRatio(details.combatFacts);
    combatFactsList.push(details.combatFacts);
    rows.push({
      selected: {
        ...selected,
        wclReportMatched: true,
        wclCoverageRatio: coverage,
        detailAvailable: true,
        rejectionReasons: [],
        wclReportFingerprint: selected.wclReportFingerprint,
        wclFightId: candidate.wclSource.fightId,
        combatCoverageState: coverage >= 0.75 ? "AVAILABLE" : "PARTIAL",
      },
      runId: candidate.runId,
      dungeonSlug: selected.dungeonSlug,
      combatFacts: details.combatFacts,
      detailAvailable: true,
      rejectionReason: null,
      analysisError: null,
      reusedCachedFight,
      wclApiCalls: rowApiCalls,
      parsePercentile: parseBinding.parsePercentile,
      parseBindingSource: parseBinding.source,
    });
    v3Observations.push(
      ...buildAvailableObservations({
        selected,
        facts: details.combatFacts,
        observedAt,
        seasonSlug: input.season.seasonSlug,
        classSlug: input.classSlug,
        specSlug: input.specSlug,
        region: input.ctx.region,
        parsePercentile: parseBinding.parsePercentile,
        top25CutoffScore,
      }),
    );
  }

  const accounted = input.endWclApiCallAccounting?.();
  if (typeof accounted === "number" && accounted > wclApiCallCount) {
    wclApiCallCount = accounted;
  }

  const diagnostics: ScoringRunAnalysisDiagnostics = {
    selectedRunCount: targets.length,
    analyzedFightCount: rows.filter((r) => r.detailAvailable).length,
    missingCombatFactCount: rows.filter((r) => !r.detailAvailable).length,
    wclApiCallCount,
    deduplicatedFightFetches,
    budget,
    expectedDungeonCount: input.season.expectedDungeonCount,
    missingDungeonSlugs: selection.missingDungeonSlugs,
    rows: rows.map((r) => ({
      dungeonSlug: r.dungeonSlug,
      runId: r.runId,
      keyLevel: r.selected.keyLevel,
      detailAvailable: r.detailAvailable,
      rejectionReason: r.rejectionReason,
      analysisError: r.analysisError,
      reusedCachedFight: r.reusedCachedFight,
    })),
  };

  return {
    selection: {
      ...selection,
      selectedRuns: selection.selectedRuns.map((selected) => {
        const row = rows.find((r) => r.selected.canonicalRunId === selected.canonicalRunId);
        return row?.selected ?? selected;
      }),
    },
    rows,
    combatFactsList,
    v3Observations,
    diagnostics,
  };
}

export { coverageRatio as scoringRunCoverageRatio };
