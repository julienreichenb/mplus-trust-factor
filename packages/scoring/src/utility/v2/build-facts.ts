/**
 * Build a Utility V2 run fact set from attempt seeds + context (provider-free).
 */

import {
  UTILITY_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_EXTRACTOR_VERSION,
  UTILITY_V2_SCHEMA_VERSION,
} from "./constants.js";
import { classifyInterruptAttempts } from "./classify-interrupts.js";
import { activeCombatHours, estimateActiveCombatMs } from "./active-combat.js";
import type {
  UtilityV2CcAction,
  UtilityV2ConfirmedInterruptEvent,
  UtilityV2HostileCastWindow,
  UtilityV2InterruptAttemptSeed,
  UtilityV2RunFactSet,
  UtilityV2SupportAction,
  UtilityV2ToolkitApplicability,
} from "./types.js";

export interface BuildUtilityV2FactSetInput {
  slotId: string;
  runId: string;
  dungeonSlug: string;
  keyLevel?: number | null;
  slotIndex?: 0 | 1 | null;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  fightDurationMs: number;
  attemptSeeds: UtilityV2InterruptAttemptSeed[];
  confirmedInterrupts: UtilityV2ConfirmedInterruptEvent[];
  hostileWindows: UtilityV2HostileCastWindow[];
  hostileEventTimestampsMs?: number[];
  ccActions?: UtilityV2CcAction[];
  supportActions?: UtilityV2SupportAction[];
  dispelPurgeSuccessCount?: number;
  bloodlustSuccessCount?: number;
  toolkit: UtilityV2ToolkitApplicability;
  abilityCatalogCoverage?: number;
  mechanicCatalogCoverage?: number;
  limitations?: string[];
}

export function buildUtilityV2RunFactSet(
  input: BuildUtilityV2FactSetInput,
): UtilityV2RunFactSet {
  const hostileObservabilityPresent =
    input.hostileWindows.length > 0 ||
    (input.hostileEventTimestampsMs?.length ?? 0) > 0;

  const interruptAttempts = classifyInterruptAttempts({
    attempts: input.attemptSeeds,
    confirmedInterrupts: input.confirmedInterrupts,
    hostileWindows: input.hostileWindows,
    hostileObservabilityPresent,
  });

  const timestamps =
    input.hostileEventTimestampsMs ??
    input.hostileWindows.flatMap((w) => [w.startMs, w.endMs]);
  const combat = estimateActiveCombatMs({
    fightDurationMs: input.fightDurationMs,
    hostileEventTimestampsMs: timestamps,
  });
  const hours = activeCombatHours(combat);

  return {
    schemaVersion: UTILITY_V2_SCHEMA_VERSION,
    extractorFamily: UTILITY_V2_EXTRACTOR_FAMILY,
    extractorVersion: UTILITY_V2_EXTRACTOR_VERSION,
    slotId: input.slotId,
    runId: input.runId,
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel ?? null,
    slotIndex: input.slotIndex ?? null,
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    fightDurationMs: input.fightDurationMs,
    activeCombatMs: combat.activeCombatMs,
    activeCombatHours: hours,
    hostileBegincastCount: input.hostileWindows.length,
    hostileObservability: hostileObservabilityPresent
      ? input.hostileWindows.length > 0
        ? "PRESENT"
        : "PARTIAL"
      : "ABSENT",
    toolkit: input.toolkit,
    interruptAttempts,
    ccActions: input.ccActions ?? [],
    supportActions: input.supportActions ?? [],
    dispelPurgeSuccessCount: input.dispelPurgeSuccessCount ?? 0,
    bloodlustSuccessCount: input.bloodlustSuccessCount ?? 0,
    catalogCoverage: {
      abilityCatalogCoverage: input.abilityCatalogCoverage ?? 0,
      mechanicCatalogCoverage: input.mechanicCatalogCoverage ?? 0,
    },
    limitations: [
      ...(input.limitations ?? []),
      ...(input.abilityCatalogCoverage == null ||
      input.mechanicCatalogCoverage == null
        ? ["catalog_coverage_unmeasured_fallback"]
        : []),
      ...combat.notes.map((n) => `active_combat:${n}`),
    ],
  };
}
