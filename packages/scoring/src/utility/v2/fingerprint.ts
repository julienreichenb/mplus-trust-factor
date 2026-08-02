/**
 * Deterministic Utility V2 input fingerprint (lowercase SHA-256 hex).
 */

import { createHash } from "node:crypto";
import { UTILITY_V2_ALGORITHM_VERSION, UTILITY_V2_MODEL_CONFIG } from "./constants.js";
import type {
  UtilityV2ComputeInput,
  UtilityV2ComputeOptions,
  UtilityV2RunFactSet,
} from "./types.js";
import { selectedManifestSlots } from "./bind.js";
import {
  fingerprintUtilityV2ModelConfig,
  resolveUtilityV2ModelConfig,
} from "./model-config.js";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function canonicalFactContent(fact: UtilityV2RunFactSet): unknown {
  return {
    slotId: fact.slotId,
    runId: fact.runId,
    dungeonSlug: fact.dungeonSlug,
    slotIndex: fact.slotIndex,
    reportCode: fact.reportCode,
    fightId: fact.fightId,
    reportRevision: fact.reportRevision,
    keyLevel: fact.keyLevel,
    fightDurationMs: fact.fightDurationMs,
    activeCombatMs: fact.activeCombatMs,
    activeCombatHours: fact.activeCombatHours,
    hostileBegincastCount: fact.hostileBegincastCount,
    hostileObservability: fact.hostileObservability,
    toolkit: fact.toolkit,
    interruptAttempts: [...fact.interruptAttempts]
      .map((a) => ({
        id: a.id,
        timestampMs: a.timestampMs,
        abilityGameId: a.abilityGameId,
        sourceActorId: a.sourceActorId,
        sourceKind: a.sourceKind,
        targetActorId: a.targetActorId,
        classification: a.classification,
        credit: a.credit,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    ccActions: [...fact.ccActions]
      .map((a) => ({
        id: a.id,
        timestampMs: a.timestampMs,
        abilityGameId: a.abilityGameId,
        sourceActorId: a.sourceActorId,
        sourceKind: a.sourceKind,
        targetActorId: a.targetActorId,
        inActiveCombat: a.inActiveCombat,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    supportActions: [...fact.supportActions]
      .map((a) => ({
        id: a.id,
        timestampMs: a.timestampMs,
        abilityGameId: a.abilityGameId,
        abilityName: a.abilityName,
        sourceActorId: a.sourceActorId,
        sourceKind: a.sourceKind,
        targetActorId: a.targetActorId,
        semantic: a.semantic,
        tier: a.tier,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    dispelPurgeSuccessCount: fact.dispelPurgeSuccessCount,
    catalogCoverage: fact.catalogCoverage,
    limitations: [...fact.limitations].sort(),
    extractorFamily: fact.extractorFamily,
    extractorVersion: fact.extractorVersion,
    schemaVersion: fact.schemaVersion,
  };
}

/**
 * Lowercase SHA-256 of canonical stable JSON over algorithm, manifest hash,
 * selected slot identities, and deterministic fact content.
 * Default config preserves the pre-injection fingerprint payload.
 */
export function computeUtilityV2InputFingerprint(
  input: UtilityV2ComputeInput,
  options?: UtilityV2ComputeOptions,
): string {
  const config = resolveUtilityV2ModelConfig(options?.modelConfig);
  const configFingerprint = fingerprintUtilityV2ModelConfig(config);
  const usingDefault =
    configFingerprint === fingerprintUtilityV2ModelConfig(UTILITY_V2_MODEL_CONFIG);

  const selectedSlots = selectedManifestSlots(input.manifest)
    .map((s) => ({
      slotId: s.slotId,
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex,
      state: s.state,
      identity: s.identity,
    }))
    .sort((a, b) => a.slotId.localeCompare(b.slotId));

  const facts = [...input.factSets]
    .map(canonicalFactContent)
    .sort((a, b) => {
      const aa = a as { slotId: string };
      const bb = b as { slotId: string };
      return aa.slotId.localeCompare(bb.slotId);
    });

  const payload = usingDefault
    ? {
        algorithmVersion: UTILITY_V2_ALGORITHM_VERSION,
        manifestContentHash: input.manifest.contentHash,
        expectedSlotCount: input.manifest.expectedSlotCount,
        selectedSlotCount: input.manifest.selectedSlotCount,
        extractionFailed: input.extractionFailed === true,
        selectedSlots,
        factSets: facts,
      }
    : {
        algorithmVersion: config.algorithmVersion,
        modelConfigFingerprint: configFingerprint,
        manifestContentHash: input.manifest.contentHash,
        expectedSlotCount: input.manifest.expectedSlotCount,
        selectedSlotCount: input.manifest.selectedSlotCount,
        extractionFailed: input.extractionFailed === true,
        selectedSlots,
        factSets: facts,
      };

  return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}
