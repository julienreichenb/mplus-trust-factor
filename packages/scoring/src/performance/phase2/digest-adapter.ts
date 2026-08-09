/**
 * Map ParticipantScoringDigestV1 → cooldown run evidence for Phase 2.
 */

import type { ParticipantScoringDigestV1 } from "@mplus/contracts";
import type { PerformanceCooldownRunEvidence } from "./cooldown-discipline.js";

export function cooldownRunEvidenceFromDigest(input: {
  digest: ParticipantScoringDigestV1;
  slotId: string;
}): PerformanceCooldownRunEvidence {
  const { digest, slotId } = input;
  const performanceClock = digest.performance.activeCombatMs;
  const survivalClock = digest.survival.activeCombatMs;
  const activeCombatDurationMs =
    performanceClock != null && performanceClock > 0
      ? performanceClock
      : survivalClock;
  const activeCombatMethod =
    performanceClock != null && performanceClock > 0
      ? (digest.performance.activeCombatMethod ?? "hostile_cast_activity")
      : survivalClock != null
        ? ("survival_damage_taken_legacy" as const)
        : null;

  return {
    slotId,
    reportCode: digest.reportCode,
    fightId: digest.fightId,
    reportRevision: digest.reportRevision,
    participantActorId: digest.participantActorId,
    classSlug: digest.classSlug,
    specSlug: digest.specSlug,
    catalogVersion: digest.catalogVersion,
    activeCombatDurationMs,
    activeCombatMethod,
    offensiveActivations: digest.performance.offensiveActivations,
    loadoutEvidence: {
      evidenceState: digest.loadoutEvidence.evidenceState,
      talentSpellIds: digest.loadoutEvidence.talentSpellIds,
    },
    ownedPetActorIds: digest.ownedPetActorIds,
  };
}
