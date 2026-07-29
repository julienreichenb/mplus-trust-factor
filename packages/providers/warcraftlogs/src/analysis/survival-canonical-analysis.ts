import type { AbilityCatalog } from "@mplus/abilities";
import type { WclGraphQlClient } from "../client/graphql-client.js";
import type { GraphQlErrorRecord, ProbeRateLimitRecord } from "../probe/types.js";
import { enrichSurvivalCalibrationRun } from "../probe/survival-calibration-logic.js";
import type { SurvivalCalibrationRun } from "../probe/survival-calibration-types.js";
import { fetchSurvivalEventDataset } from "../probe/survival-probe.js";
import {
  normalizeSurvivalDataset,
  normalizeSpecSlug,
} from "../probe/survival-probe-logic.js";
import type {
  SurvivalEventDataType,
  SurvivalProbeIdentity,
  SurvivalRawEventDataset,
  SurvivalRunCandidate,
} from "../probe/survival-probe-types.js";
import { SURVIVAL_EVENT_TYPES } from "../probe/survival-probe-types.js";
import {
  collectExplicitHealthSnapshots,
  collectHealthFromPlayerDetails,
} from "../probe/survival-v1_1-health.js";
import { fetchPlayerDetails } from "../probe/survival-v1_1-discovery.js";
import type { ExplicitHealthSnapshot } from "../probe/survival-v1_1-types.js";
import type { SurvivalV1_1_1RunScore } from "../probe/survival-v1_1_1-logic.js";
import type { HardenedMaxHpResolution } from "../probe/survival-v1_1_1-maxhp.js";
import {
  analyzeSurvivalRunDetailed,
  type SurvivalRunAnalysisSummary,
} from "./survival-run-analysis.js";

/** Probe-parity pagination — never use the thinner combat-facts page caps. */
export const SURVIVAL_CANONICAL_MAX_EVENT_PAGES = 200;
export const SURVIVAL_CANONICAL_EVENT_PAGE_LIMIT = 1000;

export type SurvivalCanonicalDatasets = Record<SurvivalEventDataType, SurvivalRawEventDataset>;

export interface FetchSurvivalCanonicalDatasetsInput {
  identity: SurvivalProbeIdentity;
  reportCode: string;
  fightId: number;
  playerActorId: number;
  /** Fight-local start/end when known (report-relative). */
  fightStartTime?: number;
  fightEndTime?: number;
  maxEventPages?: number;
  eventPageLimit?: number;
}

export interface FetchSurvivalCanonicalDatasetsResult {
  datasets: SurvivalCanonicalDatasets;
  snapshots: ExplicitHealthSnapshot[];
  truncated: boolean;
  requestCount: number;
  maxHpFailureReason: string | null;
  snapshotSourceCounts: Record<string, number>;
}

function emptyDataset(
  dataType: SurvivalEventDataType,
  state: SurvivalRawEventDataset["state"] = "MISSING",
): SurvivalRawEventDataset {
  return {
    dataType,
    state,
    pageCount: 0,
    truncated: false,
    filterSourceId: null,
    events: [],
    pages: [],
    graphqlErrors: [],
    note: null,
  };
}

/**
 * Merge explicit HP evidence from every probe-parity health source.
 * Used by live canonical fetch and offline artifact / parity tests.
 */
export function collectCanonicalHealthSnapshots(input: {
  playerActorId: number;
  playerName?: string | null;
  damageTakenEvents?: Array<Record<string, unknown>>;
  healingEvents?: Array<Record<string, unknown>>;
  deathsEvents?: Array<Record<string, unknown>>;
  combatantInfoEvents?: Array<Record<string, unknown>>;
  playerDetailsRaw?: unknown;
}): {
  snapshots: ExplicitHealthSnapshot[];
  snapshotSourceCounts: Record<string, number>;
} {
  const snapshots: ExplicitHealthSnapshot[] = [];
  const snapshotSourceCounts: Record<string, number> = {};

  const push = (source: string, more: ExplicitHealthSnapshot[]): void => {
    snapshotSourceCounts[source] = more.length;
    snapshots.push(...more);
  };

  push(
    "DamageTaken",
    collectExplicitHealthSnapshots(
      input.damageTakenEvents ?? [],
      "DamageTaken",
      input.playerActorId,
    ),
  );
  push(
    "Healing",
    collectExplicitHealthSnapshots(
      input.healingEvents ?? [],
      "Healing",
      input.playerActorId,
    ),
  );
  push(
    "Deaths",
    collectExplicitHealthSnapshots(
      input.deathsEvents ?? [],
      "Deaths",
      input.playerActorId,
    ),
  );
  push(
    "CombatantInfo",
    collectExplicitHealthSnapshots(
      input.combatantInfoEvents ?? [],
      "CombatantInfo",
      input.playerActorId,
    ),
  );
  push(
    "playerDetails",
    collectHealthFromPlayerDetails(
      input.playerDetailsRaw,
      input.playerActorId,
      input.playerName,
    ),
  );

  return { snapshots, snapshotSourceCounts };
}

function diagnoseMaxHpFailure(input: {
  snapshots: ExplicitHealthSnapshot[];
  damage: SurvivalRawEventDataset;
  snapshotSourceCounts: Record<string, number>;
}): string | null {
  if (input.snapshots.some((s) => s.maxHp != null && s.maxHp > 0)) return null;
  if (input.damage.state !== "OK") {
    return `damage_taken_dataset_${input.damage.state.toLowerCase()}`;
  }
  if (input.damage.events.length === 0) return "damage_taken_events_empty";
  if (input.snapshots.length === 0) {
    const sources = Object.entries(input.snapshotSourceCounts)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `no_hitpoints_on_damage_healing_deaths_combatantinfo_or_player_details_for_player_actor:${sources}`;
  }
  return "hitpoints_present_but_maxhp_missing_or_nonpositive";
}

/**
 * Fetch the same core Survival datasets the standalone probe uses, with
 * DamageTaken/Healing/Deaths includeResources + playerDetails for max-HP parity
 * with the V1.1 health discovery path.
 */
export async function fetchSurvivalCanonicalDatasets(
  client: WclGraphQlClient,
  input: FetchSurvivalCanonicalDatasetsInput,
): Promise<FetchSurvivalCanonicalDatasetsResult> {
  const graphqlErrors: GraphQlErrorRecord[] = [];
  const perOperation: ProbeRateLimitRecord[] = [];
  const maxEventPages = input.maxEventPages ?? SURVIVAL_CANONICAL_MAX_EVENT_PAGES;
  const eventPageLimit = input.eventPageLimit ?? SURVIVAL_CANONICAL_EVENT_PAGE_LIMIT;
  const datasets = {} as SurvivalCanonicalDatasets;

  for (const dataType of SURVIVAL_EVENT_TYPES) {
    const sourceId = dataType === "Casts" ? null : input.playerActorId;
    const includeResources =
      dataType === "DamageTaken" || dataType === "Healing" || dataType === "Deaths";
    datasets[dataType] = await fetchSurvivalEventDataset(
      client,
      {
        identity: input.identity,
        reportCode: input.reportCode,
        fightId: input.fightId,
        dataType,
        sourceId,
        maxEventPages,
        eventPageLimit,
        includeResources,
        // Fight scoping via fightIDs only — matches probe discovery (no start/end).
      },
      graphqlErrors,
      perOperation,
    );
  }

  const playerDetails = await fetchPlayerDetails(client, {
    identity: input.identity,
    reportCode: input.reportCode,
    fightId: input.fightId,
  });

  const { snapshots, snapshotSourceCounts } = collectCanonicalHealthSnapshots({
    playerActorId: input.playerActorId,
    playerName: input.identity.name,
    damageTakenEvents:
      datasets.DamageTaken.state === "OK" ? datasets.DamageTaken.events : [],
    healingEvents: datasets.Healing.state === "OK" ? datasets.Healing.events : [],
    deathsEvents: datasets.Deaths.state === "OK" ? datasets.Deaths.events : [],
    combatantInfoEvents:
      datasets.CombatantInfo.state === "OK" ? datasets.CombatantInfo.events : [],
    playerDetailsRaw:
      playerDetails.dataset.state === "OK"
        ? playerDetails.dataset.rawPages[0]?.rawResponseData
        : null,
  });

  const damage = datasets.DamageTaken;
  const maxHpFailureReason = diagnoseMaxHpFailure({
    snapshots,
    damage,
    snapshotSourceCounts,
  });
  const truncated = SURVIVAL_EVENT_TYPES.some((t) => datasets[t].truncated);

  return {
    datasets,
    snapshots,
    truncated,
    requestCount: perOperation.length + playerDetails.requestCount,
    maxHpFailureReason,
    snapshotSourceCounts,
  };
}

export interface BuildCanonicalSurvivalAnalysisInput {
  characterId: string | number;
  identity: SurvivalProbeIdentity;
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
  timed?: boolean | null;
  depleted?: boolean | null;
  completed?: boolean | null;
  score?: number | null;
  datasets: SurvivalCanonicalDatasets;
  snapshots: ExplicitHealthSnapshot[];
  catalog: AbilityCatalog;
  classSlug: string | null;
  specSlug: string | null;
  eventPagesComplete: boolean;
  maxHpFailureReason?: string | null;
  snapshotSourceCounts?: Record<string, number>;
}

export interface CanonicalSurvivalAnalysisResult {
  run: SurvivalCalibrationRun;
  snapshots: ExplicitHealthSnapshot[];
  runScore: SurvivalV1_1_1RunScore;
  maxHpResolution: HardenedMaxHpResolution;
  summary: SurvivalRunAnalysisSummary;
  compatibilityKey: string;
}

/**
 * Shared Survival V1.1.1 analyzer — identical for probe and production.
 * Both paths must call this after assembling the same raw datasets + snapshots.
 */
export function buildCanonicalSurvivalAnalysis(
  input: BuildCanonicalSurvivalAnalysisInput,
): CanonicalSurvivalAnalysisResult {
  // Report-relative event timestamps must fall inside [fightStart, fightEnd].
  // If callers pass duration-only bounds (start=0), widen from raw event evidence.
  let fightStartTime = input.fightStartTime;
  let fightEndTime = input.fightEndTime;
  const boundTimes: number[] = input.snapshots.map((s) => s.timestamp);
  for (const dataType of SURVIVAL_EVENT_TYPES) {
    const ds = input.datasets[dataType];
    if (ds.state !== "OK") continue;
    for (const row of ds.events) {
      if (typeof row.timestamp === "number" && Number.isFinite(row.timestamp)) {
        boundTimes.push(row.timestamp);
      }
    }
  }
  if (boundTimes.length > 0) {
    const minTs = Math.min(...boundTimes);
    const maxTs = Math.max(...boundTimes);
    if (minTs < fightStartTime || maxTs > fightEndTime) {
      fightStartTime = Math.min(fightStartTime, minTs);
      fightEndTime = Math.max(fightEndTime, maxTs);
    }
  }

  const candidate: SurvivalRunCandidate = {
    reportCode: input.reportCode,
    fightId: input.fightId,
    encounterId: input.encounterId ?? 0,
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel,
    score: input.score ?? null,
    durationMs: Math.max(0, fightEndTime - fightStartTime),
    startTimeMs: fightStartTime,
    completedAt: null,
    specSlug: input.specSlug,
    roleSlug: null,
    rank: 0,
  };

  const missingDatasets = SURVIVAL_EVENT_TYPES.filter(
    (t) => input.datasets[t].state !== "OK",
  );

  const normalized = normalizeSurvivalDataset({
    identity: input.identity,
    probedAt: new Date().toISOString(),
    candidate,
    wclCharacterId: 0,
    wclCanonicalId: 0,
    playerActorId: input.playerActorId,
    ownedPetActorIds: input.ownedPetActorIds,
    fightStartTime,
    fightEndTime,
    keyLevel: input.keyLevel,
    encounterId: input.encounterId ?? null,
    encounterName: input.encounterName ?? null,
    eventDatasets: input.datasets,
    catalog: input.catalog,
    classSlug: input.classSlug,
    specSlug: normalizeSpecSlug(input.specSlug),
  });

  if (!normalized.combatantInfo.specialization && input.specSlug) {
    normalized.combatantInfo.specialization = input.specSlug;
  }

  const run = enrichSurvivalCalibrationRun({
    normalized,
    timed: input.timed ?? null,
    depleted: input.depleted ?? null,
    completed: input.completed ?? null,
    score: input.score ?? null,
    missingDatasets,
  });

  const detailed = analyzeSurvivalRunDetailed({
    characterId: input.characterId,
    reportRevision: input.reportRevision,
    run,
    snapshots: input.snapshots,
    catalog: input.catalog,
    classSlug: input.classSlug,
    eventPagesComplete: input.eventPagesComplete,
  });

  const summary = { ...detailed.summary };
  if (summary.maxHpResolution.baselineMaxHp == null) {
    const detailedReason =
      input.maxHpFailureReason ??
      summary.maxHpResolution.resolutionFailureReason ??
      "no_explicit_max_hp_for_player_actor";
    summary.maxHpResolution = {
      ...summary.maxHpResolution,
      resolutionFailureReason: detailedReason,
      rejectionReasons: {
        ...summary.maxHpResolution.rejectionReasons,
        ...(input.snapshotSourceCounts
          ? Object.fromEntries(
              Object.entries(input.snapshotSourceCounts).map(([k, v]) => [
                `snapshot_source_${k}`,
                v,
              ]),
            )
          : {}),
      },
    };
  }

  return {
    run,
    snapshots: input.snapshots,
    runScore: detailed.runScore,
    maxHpResolution: detailed.maxHpResolution,
    summary,
    compatibilityKey: summary.compatibilityKey,
  };
}

/** Empty datasets helper for tests. */
export function emptySurvivalCanonicalDatasets(): SurvivalCanonicalDatasets {
  return Object.fromEntries(
    SURVIVAL_EVENT_TYPES.map((t) => [t, emptyDataset(t)]),
  ) as SurvivalCanonicalDatasets;
}
