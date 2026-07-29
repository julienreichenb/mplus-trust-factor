/**
 * Build OBSERVED_CONTRIBUTION scoring inputs from a shared WCL evidence bundle.
 * Zero WCL calls — events must already be persisted / in-memory on the bundle.
 */
import { getAbilityCatalog } from "@mplus/abilities";
import type { WclRunEvidenceBundle, SharedEvidenceDatasetKey } from "./wcl-run-evidence-types.js";
import { UTILITY_EVIDENCE_CONSUMERS } from "./wcl-run-evidence-types.js";
import {
  UTILITY_EVENT_TYPES,
  type UtilityActorContext,
  type UtilityEventDataType,
  type UtilityNormalizedRun,
  type UtilityRawEventDataset,
} from "../probe/utility-probe-types.js";
import { normalizeUtilityRun } from "../probe/utility-probe-logic.js";
import { extractRunOpportunities } from "../probe/utility-opportunity-engine.js";
import type { UtilityOpportunity } from "../probe/utility-opportunity-types.js";
import type { UtilityV2RawRunBundle } from "../probe/utility-v2-types.js";

function toUtilityRawDataset(
  dataType: UtilityEventDataType,
  bundle: WclRunEvidenceBundle,
): UtilityRawEventDataset {
  const ds = bundle.eventDatasets[dataType as SharedEvidenceDatasetKey];
  if (!ds) {
    return {
      dataType,
      state: "MISSING",
      pageCount: 0,
      truncated: false,
      filterSourceId: null,
      events: [],
      pages: [],
      graphqlErrors: [],
      note: "missing_from_shared_evidence_bundle",
    };
  }
  const state: UtilityRawEventDataset["state"] =
    ds.state === "OK" || ds.state === "CACHED" || ds.state === "PERSISTED"
      ? "OK"
      : ds.state === "ERROR"
        ? "ERROR"
        : "MISSING";
  return {
    dataType,
    state,
    pageCount: ds.pageCount,
    truncated: ds.truncated,
    filterSourceId: ds.filterSourceId,
    events: ds.events,
    pages: ds.pages.map((p) => ({
      pageIndex: p.pageIndex,
      startTime: p.startTime,
      nextPageTimestamp: p.nextPageTimestamp,
      eventCount: p.eventCount,
      rawResponseData: null,
      graphqlErrors: [],
    })),
    graphqlErrors: [],
    note: ds.source === "persisted" ? "from_shared_evidence_persisted" : "from_shared_evidence",
  };
}

export function utilityEvidencePresentInBundle(bundle: WclRunEvidenceBundle): {
  complete: boolean;
  present: SharedEvidenceDatasetKey[];
  missing: SharedEvidenceDatasetKey[];
} {
  const required = UTILITY_EVIDENCE_CONSUMERS.filter((k) => k !== "masterData");
  const present = required.filter((k) => {
    const ds = bundle.eventDatasets[k];
    return ds != null && (ds.state === "OK" || ds.state === "CACHED" || ds.state === "PERSISTED");
  });
  const missing = required.filter((k) => !present.includes(k));
  const masterOk = bundle.masterData != null;
  return {
    complete: missing.length === 0 && masterOk,
    present: masterOk
      ? ([...present, "masterData"] as SharedEvidenceDatasetKey[])
      : present,
    missing: masterOk ? missing : ([...missing, "masterData"] as SharedEvidenceDatasetKey[]),
  };
}

function buildActorContext(bundle: WclRunEvidenceBundle): UtilityActorContext | null {
  if (bundle.playerActorId == null) return null;
  const master = bundle.masterData as
    | {
        actors?: Array<{
          id: number;
          name?: string;
          type: string;
          subType?: string | null;
          petOwner?: number | null;
        }>;
      }
    | null
    | undefined;
  const actors = master?.actors ?? [];
  const actorsById = new Map(actors.map((a) => [a.id, { ...a, name: a.name ?? `actor-${a.id}` }]));
  const friendlyPlayerIds = actors
    .filter((a) => a.type === "Player")
    .map((a) => a.id);
  return {
    playerActorId: bundle.playerActorId,
    ownedPetActorIds: bundle.ownedPetActorIds ?? [],
    friendlyPlayerIds,
    actorsById,
    hostileValidatedByDamage: new Set(),
  };
}

export interface UtilityShadowInputsFromBundles {
  hasPersistedSharedEvidence: boolean;
  runs: UtilityNormalizedRun[];
  rawByRunId: Map<string, UtilityV2RawRunBundle>;
  masterByReport: Map<
    string,
    {
      actors: Array<{
        id: number;
        name?: string;
        type: string;
        subType?: string | null;
        petOwner?: number | null;
      }>;
    }
  >;
  opportunities: UtilityOpportunity[];
  hostileCastEventsByRun: Map<string, Array<Record<string, unknown>>>;
  detailedWclEventCallsMade: number;
  notes: string[];
}

/**
 * Convert collected shared evidence bundles into OBSERVED_CONTRIBUTION inputs.
 */
export function buildUtilityShadowInputsFromBundles(input: {
  bundles: WclRunEvidenceBundle[];
  classSlug: string | null;
  specSlug: string | null;
  roleSlug: string | null;
  detailedWclEventCallsMade?: number;
}): UtilityShadowInputsFromBundles {
  const notes: string[] = [];
  const usable = input.bundles.filter((b) => utilityEvidencePresentInBundle(b).complete);
  if (usable.length === 0) {
    notes.push("no_complete_utility_shared_evidence_bundles");
    return {
      hasPersistedSharedEvidence: false,
      runs: [],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [],
      hostileCastEventsByRun: new Map(),
      detailedWclEventCallsMade: input.detailedWclEventCallsMade ?? 0,
      notes,
    };
  }

  const catalog = getAbilityCatalog({
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    includeRacials: true,
  });

  const runs: UtilityNormalizedRun[] = [];
  const rawByRunId = new Map<string, UtilityV2RawRunBundle>();
  const masterByReport = new Map<
    string,
    {
      actors: Array<{
        id: number;
        name?: string;
        type: string;
        subType?: string | null;
        petOwner?: number | null;
      }>;
    }
  >();
  const opportunities: UtilityOpportunity[] = [];
  const hostileCastEventsByRun = new Map<string, Array<Record<string, unknown>>>();

  for (const bundle of usable) {
    const actorCtx = buildActorContext(bundle);
    if (!actorCtx) {
      notes.push(`skip_${bundle.reportCode}:${bundle.fightId}_missing_player_actor`);
      continue;
    }

    const eventDatasets = Object.fromEntries(
      UTILITY_EVENT_TYPES.map((t) => [t, toUtilityRawDataset(t, bundle)]),
    ) as Record<UtilityEventDataType, UtilityRawEventDataset>;

    const durationMs = Math.max(0, (bundle.endTime ?? 0) - (bundle.startTime ?? 0)) || 1_800_000;
    const normalized = normalizeUtilityRun({
      reportCode: bundle.reportCode,
      fightId: bundle.fightId,
      dungeonSlug: bundle.dungeonSlug,
      keyLevel: null,
      durationMs,
      specialization: input.specSlug,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      roleSlug: input.roleSlug,
      catalog,
      actorCtx,
      eventDatasets,
      fightEndTime: bundle.endTime ?? durationMs,
    });
    runs.push(normalized);

    const runId = `${bundle.reportCode}:${bundle.fightId}`;
    const casts = eventDatasets.Casts.events;
    const interrupts = eventDatasets.Interrupts.events;
    const dispels = eventDatasets.Dispels.events;
    const buffs = eventDatasets.Buffs.events;
    const debuffs = eventDatasets.Debuffs.events;
    const deaths = eventDatasets.Deaths.events;
    const hostile = bundle.eventDatasets.HostileCasts?.events ?? [];
    hostileCastEventsByRun.set(runId, hostile);

    rawByRunId.set(runId, {
      runId,
      reportCode: bundle.reportCode,
      fightId: bundle.fightId,
      casts: [...hostile, ...casts],
      interrupts,
      buffs,
      debuffs,
    });

    const master = bundle.masterData as
      | {
          actors?: Array<{
            id: number;
            name?: string;
            type: string;
            subType?: string | null;
            petOwner?: number | null;
          }>;
        }
      | null;
    if (master?.actors) {
      masterByReport.set(bundle.reportCode, { actors: master.actors });
    }

    const castEvents = hostile.length > 0 ? [...hostile, ...casts] : casts;
    opportunities.push(
      ...extractRunOpportunities({
        normalized,
        raw: rawByRunId.get(runId),
        castEvents,
        interruptEvents: interrupts,
        deathEvents: deaths,
        catalog,
      }),
    );
  }

  notes.push(`built_from_${runs.length}_shared_evidence_bundles`);
  return {
    hasPersistedSharedEvidence: runs.length > 0,
    runs,
    rawByRunId,
    masterByReport,
    opportunities,
    hostileCastEventsByRun,
    detailedWclEventCallsMade: input.detailedWclEventCallsMade ?? 0,
    notes,
  };
}
