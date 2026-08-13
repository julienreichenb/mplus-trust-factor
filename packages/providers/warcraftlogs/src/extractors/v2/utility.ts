/**
 * Utility V2 fact extractors — shared-evidence → UtilityV2RunFactSet.
 * Preserves bound zero-observation vs missing-evidence distinction.
 */

import {
  getAbilityCatalog,
  spellIdsForCategory,
} from "@mplus/abilities";
import {
  UTILITY_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_EXTRACTOR_VERSION,
  buildUtilityV2RunFactSet,
  resolveUtilityToolkitFromCatalog,
  type UtilityV2CcAction,
  type UtilityV2ConfirmedInterruptEvent,
  type UtilityV2HostileCastWindow,
  type UtilityV2InterruptAttemptSeed,
  type UtilityV2RunFactSet,
  type UtilityV2SupportAction,
  type UtilityV2SupportSemantic,
} from "@mplus/scoring";
import {
  buildUtilityShadowInputsFromBundles,
  utilityEvidencePresentInBundle,
} from "../../evidence/utility-from-shared-evidence.js";
import type { WclRunEvidenceBundle } from "../../evidence/wcl-run-evidence-types.js";
import type { UtilityNormalizedRun } from "../../probe/utility-probe-types.js";
import { FACT_V2_MAX_LIMITATIONS } from "./constants.js";
import type {
  FrozenSlotBindingV2,
  UtilityFactExtractionOutcome,
} from "./types.js";

function clampLimitations(limitations: string[]): string[] {
  return [...new Set(limitations.filter((l) => l.length > 0))].slice(
    0,
    FACT_V2_MAX_LIMITATIONS,
  );
}

function sourceKind(
  kind: "PLAYER" | "OWNED_PET" | string,
): UtilityV2InterruptAttemptSeed["sourceKind"] {
  if (kind === "PLAYER") return "PLAYER";
  if (kind === "OWNED_PET") return "OWNED_PET";
  return "OTHER";
}

function buildHostileWindows(
  events: Array<Record<string, unknown>>,
): UtilityV2HostileCastWindow[] {
  const open = new Map<string, UtilityV2HostileCastWindow>();
  const closed: UtilityV2HostileCastWindow[] = [];

  for (const ev of events) {
    const sourceActorId =
      typeof ev.sourceID === "number"
        ? ev.sourceID
        : typeof ev.sourceId === "number"
          ? ev.sourceId
          : null;
    const abilityGameId =
      typeof ev.abilityGameID === "number"
        ? ev.abilityGameID
        : typeof ev.abilityGameId === "number"
          ? ev.abilityGameId
          : null;
    const ts = typeof ev.timestamp === "number" ? ev.timestamp : null;
    if (sourceActorId == null || abilityGameId == null || ts == null) continue;
    const type = String(ev.type ?? "");
    const key = `${sourceActorId}:${abilityGameId}`;

    if (type === "begincast") {
      open.set(key, {
        startMs: ts,
        endMs: ts,
        sourceActorId,
        abilityGameId,
        completed: false,
        interrupted: false,
        interruptedByActorId: null,
        interruptedByKind: null,
      });
      continue;
    }

    const window = open.get(key);
    if (type === "cast" || type === "castfailed" || type === "interrupted") {
      if (window) {
        window.endMs = ts;
        window.completed = type === "cast";
        window.interrupted = type === "interrupted" || type === "castfailed";
        open.delete(key);
        closed.push(window);
      } else {
        closed.push({
          startMs: ts,
          endMs: ts,
          sourceActorId,
          abilityGameId,
          completed: type === "cast",
          interrupted: type === "interrupted" || type === "castfailed",
          interruptedByActorId: null,
          interruptedByKind: null,
        });
      }
    }
  }
  for (const w of open.values()) closed.push(w);
  return closed;
}

function buildAttemptSeeds(
  casts: Array<Record<string, unknown>>,
  interruptIds: Set<number>,
  playerActorId: number,
  ownedPetActorIds: number[],
): UtilityV2InterruptAttemptSeed[] {
  const petSet = new Set(ownedPetActorIds);
  const seeds: UtilityV2InterruptAttemptSeed[] = [];
  let i = 0;
  for (const ev of casts) {
    const type = String(ev.type ?? "");
    if (type !== "cast" && type !== "castfailed") continue;
    const abilityGameId =
      typeof ev.abilityGameID === "number"
        ? ev.abilityGameID
        : typeof ev.abilityGameId === "number"
          ? ev.abilityGameId
          : null;
    const sourceActorId =
      typeof ev.sourceID === "number"
        ? ev.sourceID
        : typeof ev.sourceId === "number"
          ? ev.sourceId
          : null;
    const ts = typeof ev.timestamp === "number" ? ev.timestamp : null;
    if (abilityGameId == null || sourceActorId == null || ts == null) continue;
    if (!interruptIds.has(abilityGameId)) continue;
    const kind =
      sourceActorId === playerActorId
        ? "PLAYER"
        : petSet.has(sourceActorId)
          ? "OWNED_PET"
          : null;
    if (kind == null) continue;
    i += 1;
    seeds.push({
      id: `kick-${i}-${ts}-${abilityGameId}`,
      timestampMs: ts,
      abilityGameId,
      sourceActorId,
      sourceKind: kind,
      targetActorId:
        typeof ev.targetID === "number"
          ? ev.targetID
          : typeof ev.targetId === "number"
            ? ev.targetId
            : null,
    });
  }
  return seeds;
}

function mapCcActions(run: UtilityNormalizedRun): UtilityV2CcAction[] {
  return run.ccEvents.map((ev, idx) => ({
    id: `cc-${idx}-${ev.timestamp}-${ev.abilityGameID}`,
    timestampMs: ev.timestamp,
    abilityGameId: ev.abilityGameID,
    sourceActorId: ev.sourceID,
    sourceKind: sourceKind(ev.sourceKind),
    targetActorId: ev.targetID,
    inActiveCombat: true,
  }));
}

function mapSupportActions(run: UtilityNormalizedRun): UtilityV2SupportAction[] {
  const out: UtilityV2SupportAction[] = [];
  for (const [idx, ev] of run.dispelPurgeEvents.entries()) {
    out.push({
      id: `support-dp-${idx}-${ev.timestamp}`,
      timestampMs: ev.timestamp,
      abilityGameId: ev.abilityGameID,
      abilityName: null,
      sourceActorId: ev.sourceID,
      sourceKind: sourceKind(ev.sourceKind),
      targetActorId: ev.targetID,
      semantic: "REACTIVE_SUPPORT" satisfies UtilityV2SupportSemantic,
      tier: "CONFIRMED_IMPACT",
    });
  }
  for (const [idx, ev] of run.externalGroupUtilityEvents.entries()) {
    const semantic: UtilityV2SupportSemantic =
      ev.category === "EXTERNAL_DEFENSIVE" || ev.category === "BATTLE_REZ"
        ? "EMERGENCY_SUPPORT"
        : ev.category === "MOVEMENT_UTILITY"
          ? "PERSONAL_MOBILITY"
          : "STRATEGIC_SUPPORT";
    out.push({
      id: `support-ext-${idx}-${ev.timestamp}`,
      timestampMs: ev.timestamp,
      abilityGameId: ev.abilityGameID,
      abilityName: null,
      sourceActorId: ev.sourceID,
      sourceKind: sourceKind(ev.sourceKind),
      targetActorId: ev.targetID,
      semantic,
      tier: ev.successfulApplication === true ? "CONFIRMED_IMPACT" : "INFERRED",
    });
  }
  return out;
}

function resolveToolkit(
  classSlug: string | null,
  specSlug: string | null,
): ReturnType<typeof resolveUtilityToolkitFromCatalog> {
  return resolveUtilityToolkitFromCatalog({
    classSlug,
    specSlug,
    includeRacials: true,
  });
}

/**
 * Pure builder: normalized utility run + hostile casts → UtilityV2RunFactSet.
 * Zero observations with present hostile evidence remain distinguishable from missing evidence.
 */
export function mapUtilityNormalizedRunToFactSet(input: {
  slot: FrozenSlotBindingV2;
  run: UtilityNormalizedRun;
  hostileCastEvents: Array<Record<string, unknown>>;
  castEvents?: Array<Record<string, unknown>>;
  classSlug: string | null;
  specSlug: string | null;
  limitations?: string[];
}): UtilityV2RunFactSet {
  const catalog = getAbilityCatalog({
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    includeRacials: true,
  });
  const interruptIds = spellIdsForCategory(catalog, "INTERRUPT", {
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });

  const castEvents = input.castEvents ?? [];
  const attemptSeeds = buildAttemptSeeds(
    castEvents,
    interruptIds,
    input.run.playerActorId,
    input.run.petActorIds,
  );

  const confirmedInterrupts: UtilityV2ConfirmedInterruptEvent[] =
    input.run.interruptEvents.map((ev) => ({
      timestampMs: ev.timestamp,
      sourceActorId: ev.sourceID,
      sourceKind: sourceKind(ev.sourceKind),
      targetActorId: ev.targetID,
      abilityGameId: ev.abilityGameID,
      interruptedSpellId: ev.interruptedSpellId,
    }));

  const hostileWindows = buildHostileWindows(input.hostileCastEvents);
  const resolvedToolkit = resolveToolkit(input.classSlug, input.specSlug);
  const toolkit = resolvedToolkit.toolkit;
  const incomplete = input.run.incompleteDatasets.length > 0;
  const truncated = input.run.truncatedDatasets.length > 0;
  const identityUnknown = !resolvedToolkit.catalogSupported;

  const limitations = clampLimitations([
    ...(input.limitations ?? []),
    ...(incomplete
      ? input.run.incompleteDatasets.map((d) => `incomplete_dataset:${d}`)
      : []),
    ...(truncated
      ? input.run.truncatedDatasets.map((d) => `truncated_dataset:${d}`)
      : []),
    ...(identityUnknown
      ? [
          "class_spec_identity_unknown",
          `ability_catalog:${resolvedToolkit.unsupportedReason}`,
          "toolkit_coverage_unconfirmed",
        ]
      : []),
    // Bound zero-observation marker when evidence is complete but empty.
    // Skip when identity is unknown — empty toolkit is not confirmed coverage.
    ...(!identityUnknown &&
    !incomplete &&
    attemptSeeds.length === 0 &&
    confirmedInterrupts.length === 0 &&
    mapCcActions(input.run).length === 0 &&
    mapSupportActions(input.run).length === 0
      ? ["zero_observation_bound"]
      : []),
  ]);

  return buildUtilityV2RunFactSet({
    slotId: input.slot.slotId,
    runId: `${input.slot.identity.reportCode}:${input.slot.identity.fightId}`,
    dungeonSlug: input.slot.dungeonSlug || input.run.dungeonSlug,
    keyLevel: input.slot.keyLevel ?? input.run.keyLevel,
    slotIndex: input.slot.slotIndex,
    reportCode: input.slot.identity.reportCode,
    fightId: input.slot.identity.fightId,
    reportRevision: input.slot.identity.reportRevision,
    fightDurationMs: Math.max(1, input.run.durationMs),
    attemptSeeds,
    confirmedInterrupts,
    hostileWindows,
    hostileEventTimestampsMs: input.hostileCastEvents
      .map((e) => (typeof e.timestamp === "number" ? e.timestamp : null))
      .filter((t): t is number => t != null),
    ccActions: mapCcActions(input.run),
    supportActions: mapSupportActions(input.run),
    dispelPurgeSuccessCount: input.run.dispelPurgeEvents.length,
    toolkit,
    abilityCatalogCoverage: identityUnknown ? 0 : incomplete ? 0.5 : 0.85,
    mechanicCatalogCoverage: identityUnknown ? 0 : incomplete ? 0.4 : 0.7,
    limitations,
  });
}

/**
 * Extract UtilityV2RunFactSet from a persisted shared WCL evidence bundle.
 */
export function extractUtilityV2RunFactSetFromSharedEvidence(input: {
  bundle: WclRunEvidenceBundle;
  slot: FrozenSlotBindingV2;
  classSlug: string | null;
  specSlug: string | null;
  roleSlug?: string | null;
}): UtilityFactExtractionOutcome {
  const { bundle, slot } = input;

  if (
    bundle.reportCode !== slot.identity.reportCode ||
    bundle.fightId !== slot.identity.fightId
  ) {
    return {
      status: "FAILED",
      dimension: "UTILITY",
      fact: null,
      limitations: ["frozen_identity_mismatch"],
      category: "incompatible_evidence",
      reason: "bundle_identity_does_not_match_frozen_slot",
    };
  }

  if (
    bundle.reportRevision != null &&
    bundle.reportRevision !== slot.identity.reportRevision
  ) {
    return {
      status: "FAILED",
      dimension: "UTILITY",
      fact: null,
      limitations: ["report_revision_mismatch"],
      category: "incompatible_evidence",
      reason: "bundle_revision_mismatch",
    };
  }

  const presence = utilityEvidencePresentInBundle(bundle);
  if (!presence.complete) {
    return {
      status: "UNAVAILABLE",
      dimension: "UTILITY",
      fact: null,
      limitations: [
        "incomplete_utility_shared_evidence",
        ...presence.missing.map((m) => `missing_dataset:${m}`),
      ].slice(0, FACT_V2_MAX_LIMITATIONS),
      category: "incomplete_shared_evidence",
      reason: "required_utility_datasets_absent",
    };
  }

  try {
    const built = buildUtilityShadowInputsFromBundles({
      bundles: [bundle],
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      roleSlug: input.roleSlug ?? null,
    });

    const run = built.runs[0];
    if (!run) {
      return {
        status: "UNAVAILABLE",
        dimension: "UTILITY",
        fact: null,
        limitations: clampLimitations([
          "utility_normalize_empty",
          ...built.notes,
        ]),
        category: "empty_fact",
        reason: "normalized_run_absent",
      };
    }

    const runId = `${bundle.reportCode}:${bundle.fightId}`;
    const raw = built.rawByRunId.get(runId);
    const hostile = built.hostileCastEventsByRun.get(runId) ?? [];
    const castEvents = raw?.casts ?? [];

    const fact = mapUtilityNormalizedRunToFactSet({
      slot,
      run,
      hostileCastEvents: hostile,
      castEvents,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      limitations: built.notes,
    });

    if (fact.extractorFamily !== UTILITY_V2_EXTRACTOR_FAMILY) {
      return {
        status: "FAILED",
        dimension: "UTILITY",
        fact: null,
        limitations: ["extractor_family_mismatch"],
        category: "analysis_failed",
        reason: "unexpected_extractor_family",
      };
    }

    return {
      status: "WRITTEN",
      dimension: "UTILITY",
      fact: {
        ...fact,
        extractorVersion: UTILITY_V2_EXTRACTOR_VERSION,
      },
      limitations: fact.limitations,
      category: null,
      reason: null,
    };
  } catch {
    return {
      status: "FAILED",
      dimension: "UTILITY",
      fact: null,
      limitations: ["utility_extraction_failed"],
      category: "analysis_failed",
      reason: "utility_analysis_threw",
    };
  }
}
