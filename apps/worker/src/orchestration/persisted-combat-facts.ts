/**
 * Hydrate a minimal combat-facts handle from persisted wcl-combat-facts-v1 summaries.
 * Enough for Survival shared-evidence ingest (actor IDs + revision) without WCL re-fetch.
 */
import type { RunCombatFacts } from "@mplus/provider-warcraftlogs";

export const WCL_COMBAT_FACTS_ANALYSIS_VERSION = "wcl-combat-facts-v1";

export interface PersistedCombatFactsHandle {
  reportCode: string;
  fightId: number;
  revision: number;
  targetSourceId: number;
  attributedSourceIds: number[];
  startTime: number | null;
  endTime: number | null;
  encounterId: number | null;
  encounterName: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Read actor/revision metadata from a persisted run-analysis summary.
 */
export function readPersistedCombatFactsHandle(summary: unknown): PersistedCombatFactsHandle | null {
  const root = asRecord(summary);
  if (!root) return null;
  const combatFacts = asRecord(root.combatFacts) ?? root;
  const reportCode =
    typeof combatFacts.reportCode === "string"
      ? combatFacts.reportCode
      : typeof root.reportCode === "string"
        ? root.reportCode
        : null;
  const fightId = asFiniteNumber(combatFacts.fightId ?? root.fightId);
  const revision = asFiniteNumber(combatFacts.revision ?? root.revision);
  const targetSourceId = asFiniteNumber(combatFacts.targetSourceId ?? root.targetSourceId);
  if (!reportCode || fightId == null || revision == null || targetSourceId == null) {
    return null;
  }

  const attributedRaw = combatFacts.attributedSourceIds ?? root.attributedSourceIds;
  const attributedSourceIds = Array.isArray(attributedRaw)
    ? attributedRaw
        .map((id) => asFiniteNumber(id))
        .filter((id): id is number => id != null)
    : [targetSourceId];
  if (!attributedSourceIds.includes(targetSourceId)) {
    attributedSourceIds.unshift(targetSourceId);
  }

  return {
    reportCode,
    fightId,
    revision,
    targetSourceId,
    attributedSourceIds,
    startTime: asFiniteNumber(root.fightStartTime ?? combatFacts.fightStartTime),
    endTime: asFiniteNumber(root.fightEndTime ?? combatFacts.fightEndTime),
    encounterId: asFiniteNumber(root.encounterId ?? combatFacts.encounterId),
    encounterName:
      typeof (root.encounterName ?? combatFacts.encounterName) === "string"
        ? String(root.encounterName ?? combatFacts.encounterName)
        : null,
  };
}

/** Minimal RunCombatFacts stub for shared-evidence Survival (events come from wcl-run-evidence-v1). */
export function combatFactsStubFromHandle(handle: PersistedCombatFactsHandle): RunCombatFacts {
  return {
    reportCode: handle.reportCode,
    fightId: handle.fightId,
    revision: handle.revision,
    targetSourceId: handle.targetSourceId,
    attributedSourceIds: handle.attributedSourceIds,
    actorMap: { byId: new Map(), byName: new Map() },
    casts: [],
    interrupts: [],
    deaths: [],
    damageTaken: [],
    auras: [],
    dispels: [],
    healing: [],
    combatantInfo: null,
    coverage: {
      casts: false,
      interrupts: false,
      deaths: false,
      damageTaken: false,
      auras: false,
      dispels: false,
      healing: false,
      combatantInfo: false,
    },
    limitations: {
      missingCategories: ["hydrated_from_persisted_combat_facts_v1"],
      truncatedPages: [],
      notes: ["Actor/revision hydrated from persisted analysis; event datasets from shared evidence."],
    },
  };
}
