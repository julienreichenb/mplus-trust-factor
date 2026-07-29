import type { MetricObservationDTO } from "@mplus/contracts";
import type { AbilityCatalog } from "@mplus/abilities";
import type { RunCombatFacts } from "@mplus/provider-warcraftlogs";
import {
  SURVIVAL_STANDALONE_V1_1_1_CONFIG,
  analyzeSurvivalRun,
  buildSurvivalCompatibilityKey,
  combatFactsToSurvivalCalibrationRun,
  type ExplicitHealthSnapshot,
  type SurvivalRequestCostBreakdown,
  type SurvivalRunAnalysisSummary,
} from "@mplus/provider-warcraftlogs";
import {
  computeSurvivalDimension,
  medianSurvivalRunScores,
  resolveSurvivalMetricWeights,
  type SurvivalDungeonAggregate,
  type SurvivalSummaryDTO,
} from "@mplus/scoring";

export interface SurvivalRunAnalysisRow {
  runId: string;
  dungeonSlug: string;
  dungeonName?: string;
  keyLevel: number | null;
  summary: SurvivalRunAnalysisSummary;
  fromCache: boolean;
}

function median(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return medianSurvivalRunScores(valid);
}

function coverageFromCounts(
  counts: Record<string, number> | undefined,
  coveredKeys: string[],
  missedKeys: string[],
  naKeys: string[],
): { covered: number; missed: number; na: number } {
  const sum = (keys: string[]) =>
    keys.reduce((s, k) => s + (counts?.[k] ?? 0), 0);
  return {
    covered: sum(coveredKeys),
    missed: sum(missedKeys),
    na: sum(naKeys),
  };
}

export function isCompatibleSurvivalSummary(
  summary: unknown,
  expectedCompatibilityKey: string,
): summary is SurvivalRunAnalysisSummary {
  if (!summary || typeof summary !== "object") return false;
  const row = summary as Partial<SurvivalRunAnalysisSummary>;
  return (
    row.compatibilityKey === expectedCompatibilityKey &&
    row.analysisVersion === SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion &&
    typeof row.behavioralSurvivalScore === "number"
  );
}

export function expectedSurvivalCompatibilityKey(input: {
  characterId: string;
  reportCode: string;
  fightId: number;
  reportRevision: number | string;
  abilityCatalogVersion: string;
}): string {
  return buildSurvivalCompatibilityKey({
    characterId: input.characterId,
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    adapterVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.adapterVersion,
    scoringConfigVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.version,
    abilityCatalogVersion: input.abilityCatalogVersion,
  });
}

/** Map provider health snapshots into ExplicitHealthSnapshot for scoring. */
export function mapProviderSnapshotsToExplicit(
  snapshots: Array<{
    timestamp: number;
    currentHp: number | null;
    maxHp: number | null;
    absorb: number | null;
    path: string;
    dataType: string;
    abilityGameID: number | null;
    sourceID: number | null;
    targetID: number | null;
    eventType: string | null;
  }>,
): ExplicitHealthSnapshot[] {
  return snapshots.map((s) => ({
    timestamp: s.timestamp,
    currentHp: s.currentHp,
    maxHp: s.maxHp,
    absorb: s.absorb,
    path: s.path,
    dataType: s.dataType,
    abilityGameID: s.abilityGameID,
    sourceID: s.sourceID,
    targetID: s.targetID,
    eventType: s.eventType,
    rawFragment: {},
  }));
}

/**
 * Prefer DamageTaken(+resources) events for normalized damageTaken when available,
 * so amount + HP share the same timeline.
 */
export function mergeResourceDamageEventsIntoRun(
  run: ReturnType<typeof combatFactsToSurvivalCalibrationRun>,
  resourceEvents: Array<Record<string, unknown>>,
): void {
  if (resourceEvents.length === 0) return;
  const preserved = resourceEvents.map((raw) => {
    const ability = raw.ability as { guid?: number } | undefined;
    const source =
      typeof raw.sourceID === "number"
        ? raw.sourceID
        : typeof (raw.source as { id?: number } | undefined)?.id === "number"
          ? (raw.source as { id: number }).id
          : null;
    const target =
      typeof raw.targetID === "number"
        ? raw.targetID
        : typeof (raw.target as { id?: number } | undefined)?.id === "number"
          ? (raw.target as { id: number }).id
          : null;
    return {
      timestamp: typeof raw.timestamp === "number" ? raw.timestamp : null,
      sourceID: source,
      targetID: target,
      abilityGameID:
        typeof raw.abilityGameID === "number"
          ? raw.abilityGameID
          : typeof ability?.guid === "number"
            ? ability.guid
            : null,
      amount: typeof raw.amount === "number" ? raw.amount : 0,
      absorbed: typeof raw.absorbed === "number" ? raw.absorbed : 0,
      overkill: typeof raw.overkill === "number" ? raw.overkill : null,
      hitType: typeof raw.hitType === "number" ? raw.hitType : null,
      additionalFields: {},
      raw,
    };
  });
  run.normalized.damageTaken.events = preserved;
  run.normalized.damageTaken.totalDamageTaken = preserved.reduce(
    (s, e) => s + (e.amount ?? 0),
    0,
  );
  run.normalized.damageTaken.totalAbsorbed = preserved.reduce(
    (s, e) => s + (e.absorbed ?? 0),
    0,
  );
  run.damageTaken.totalDamageTaken = run.normalized.damageTaken.totalDamageTaken;
  run.damageTaken.absorbedAmount = run.normalized.damageTaken.totalAbsorbed;
}

export function analyzeSurvivalFromCombatFacts(input: {
  characterId: string;
  facts: RunCombatFacts;
  snapshots: ExplicitHealthSnapshot[];
  dungeonSlug: string;
  keyLevel: number | null;
  durationMs: number;
  catalog: AbilityCatalog;
  classSlug: string | null;
  specialization?: string | null;
  eventPagesComplete?: boolean;
  resourceDamageEvents?: Array<Record<string, unknown>>;
  startTime?: number;
  endTime?: number;
}): SurvivalRunAnalysisSummary {
  const run = combatFactsToSurvivalCalibrationRun({
    facts: input.facts,
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel,
    durationMs: input.durationMs,
    catalog: input.catalog,
    classSlug: input.classSlug,
    specialization: input.specialization ?? null,
    startTime: input.startTime,
    endTime: input.endTime,
  });
  if (input.resourceDamageEvents) {
    mergeResourceDamageEventsIntoRun(run, input.resourceDamageEvents);
  }
  return analyzeSurvivalRun({
    characterId: input.characterId,
    reportRevision: input.facts.revision,
    run,
    snapshots: input.snapshots,
    catalog: input.catalog,
    classSlug: input.classSlug,
    eventPagesComplete: input.eventPagesComplete ?? true,
  });
}

function resolveGlobalScoreMode(
  rows: SurvivalRunAnalysisRow[],
): SurvivalSummaryDTO["scoreMode"] {
  if (rows.length === 0) return null;
  const modes = rows.map((r) => r.summary.diagnostics.scoreMode);
  const full = modes.filter((m) => m === "FULL_BEHAVIORAL").length / modes.length;
  const partial =
    modes.filter((m) => m === "FULL_BEHAVIORAL" || m === "PARTIAL_BEHAVIORAL").length /
    modes.length;
  const cfg = SURVIVAL_STANDALONE_V1_1_1_CONFIG.scoreMode;
  if (full >= cfg.fullBehavioralMinRunShare) return "FULL_BEHAVIORAL";
  if (partial >= cfg.partialBehavioralMinRunShare) return "PARTIAL_BEHAVIORAL";
  return "OUTCOME_ONLY";
}

export interface BuildWclSurvivalInput {
  rows: SurvivalRunAnalysisRow[];
  expectedDungeonCount: number;
  observedAt: string;
  selectedRunWclCoverage: number;
  logFreshness?: number;
  requestCost?: SurvivalRequestCostBreakdown;
  lateBoundRunCount?: number;
  bindPoolSize?: number;
}

export interface BuildWclSurvivalResult {
  observations: MetricObservationDTO[];
  summary: SurvivalSummaryDTO;
  confidence: number;
  survivalScore: number | null;
  survivalMetricWeights: Array<{ metricKey: string; weight: number }>;
  survivalOk: boolean;
}

/**
 * Aggregate persisted/new Survival V1.1.1 run analyses into dimension observations.
 */
export function buildWclSurvivalObservations(
  input: BuildWclSurvivalInput,
): BuildWclSurvivalResult {
  const byDungeon = new Map<string, SurvivalRunAnalysisRow[]>();
  for (const row of input.rows) {
    const slug = row.dungeonSlug.trim().toLowerCase();
    const bucket = byDungeon.get(slug) ?? [];
    bucket.push(row);
    byDungeon.set(slug, bucket);
  }

  const dungeons: SurvivalDungeonAggregate[] = [];
  for (const [dungeonSlug, runs] of byDungeon) {
    dungeons.push({
      dungeonSlug,
      dungeonName: runs[0]?.dungeonName,
      medianBehavioralScore: median(runs.map((r) => r.summary.behavioralSurvivalScore)),
      medianOutcomeOnlyScore: median(runs.map((r) => r.summary.outcomeOnlyScore)),
      medianOutcomeScore: median(runs.map((r) => r.summary.componentScores.outcome.score)),
      medianDefensiveResponseScore: median(
        runs.map((r) => r.summary.componentScores.defensiveResponse.score),
      ),
      medianEmergencyRecoveryScore: median(
        runs.map((r) => r.summary.componentScores.emergencyRecovery.score),
      ),
      runCount: runs.length,
    });
  }

  const scoreMode = resolveGlobalScoreMode(input.rows);
  const cachedRunCount = input.rows.filter((r) => r.fromCache).length;
  const newlyFetchedRunCount = input.rows.filter((r) => !r.fromCache).length;

  let pressureClusterCount = 0;
  let deathCount = 0;
  let invalidOutlierCount = 0;
  let baselineResolvedRunCount = 0;
  const defensiveAgg = { covered: 0, missed: 0, na: 0 };
  const recoveryAgg = { covered: 0, missed: 0, na: 0 };

  for (const row of input.rows) {
    pressureClusterCount += row.summary.pressureClusterCount;
    deathCount += row.summary.deathCount;
    invalidOutlierCount += row.summary.maxHpResolution.invalidOutlierCount;
    if (row.summary.maxHpResolution.baselineMaxHp != null) baselineResolvedRunCount += 1;
    const def = coverageFromCounts(
      row.summary.defensiveCounts,
      ["proactive", "reactive", "death_only"],
      ["eligible_miss"],
      ["unavailable", "not_applicable", "insufficient_reaction_time"],
    );
    defensiveAgg.covered += def.covered;
    defensiveAgg.missed += def.missed;
    defensiveAgg.na += def.na;
    const rec = coverageFromCounts(
      row.summary.recoveryCounts,
      ["covered"],
      ["eligible_miss"],
      [
        "not_applicable",
        "insufficient_reaction_time",
        "death_only_health_context_unavailable",
      ],
    );
    recoveryAgg.covered += rec.covered;
    recoveryAgg.missed += rec.missed;
    recoveryAgg.na += rec.na;
  }

  const computed = computeSurvivalDimension({
    dungeons,
    expectedDungeonCount: input.expectedDungeonCount,
    scoreMode,
    explanatoryRuns: input.rows.map((r) => ({
      runId: r.runId,
      dungeonSlug: r.dungeonSlug,
      dungeonName: r.dungeonName,
      keyLevel: r.keyLevel,
      behavioralSurvivalScore: r.summary.behavioralSurvivalScore,
      deathCount: r.summary.deathCount,
      pressureClusterCount: r.summary.pressureClusterCount,
      hasWclSource: true,
    })),
    analyzedRunCount: input.rows.length,
    cachedRunCount,
    newlyFetchedRunCount,
    pressureClusterCount,
    deathCount,
    defensiveCounts: defensiveAgg,
    recoveryCounts: recoveryAgg,
    maxHpDiagnostics: { invalidOutlierCount, baselineResolvedRunCount },
    selectedRunWclCoverage: input.selectedRunWclCoverage,
    logFreshness: input.logFreshness,
    requestCost: input.requestCost
      ? {
          wclRequestCount: input.requestCost.wclHttpRequestCount,
          notes: [
            `graphqlOps=${input.requestCost.graphqlOperationCount}`,
            `reused=${input.requestCost.reusedRunAnalyses}`,
            `new=${input.requestCost.newRunAnalyses}`,
            `rejected=${input.requestCost.rejectedCandidates.length}`,
            ...input.requestCost.rejectedCandidates.map(
              (r) =>
                `reject:${r.reason}${r.dungeonSlug ? `@${r.dungeonSlug}` : ""}${r.runId ? `/${r.runId}` : ""}`,
            ),
          ],
        }
      : undefined,
    diagnostics: {
      rejectedCandidates: input.requestCost?.rejectedCandidates ?? [],
      lateBoundRunCount: input.lateBoundRunCount,
      bindPoolSize: input.bindPoolSize,
    },
  });

  const survivalMetricWeights = resolveSurvivalMetricWeights();
  const observations: MetricObservationDTO[] = [];
  const coverage = {
    present: computed.summary.availableDungeonCount,
    expected: input.expectedDungeonCount,
    ratio:
      input.expectedDungeonCount > 0
        ? computed.summary.availableDungeonCount / input.expectedDungeonCount
        : 0,
  };

  const pushObs = (metricKey: string, value: number | null) => {
    if (value == null || !Number.isFinite(value)) return;
    observations.push({
      metricKey,
      dimension: "SURVIVAL",
      rawValue: value,
      normalizedValue: value,
      confidence: computed.confidence,
      observedAt: input.observedAt,
      sourceProvider: "warcraftlogs",
      coverage,
      context: {
        derivedFrom: "survival_standalone_v1_1_1_combat_events",
        adapterVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.adapterVersion,
        configVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.version,
        analysisVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
        scoreMode,
      },
    });
  };

  pushObs("survival.outcome", computed.observations["survival.outcome"]);
  pushObs("survival.defensive_response", computed.observations["survival.defensive_response"]);
  pushObs("survival.emergency_recovery", computed.observations["survival.emergency_recovery"]);

  const survivalOk =
    observations.length > 0 && computed.summary.availableDungeonCount > 0;

  return {
    observations,
    summary: computed.summary,
    confidence: computed.confidence,
    survivalScore: computed.survivalScore,
    survivalMetricWeights,
    survivalOk,
  };
}
