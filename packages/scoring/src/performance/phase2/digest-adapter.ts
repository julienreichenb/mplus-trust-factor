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
  return {
    slotId,
    reportCode: digest.reportCode,
    fightId: digest.fightId,
    reportRevision: digest.reportRevision,
    participantActorId: digest.participantActorId,
    classSlug: digest.classSlug,
    specSlug: digest.specSlug,
    catalogVersion: digest.catalogVersion,
    activeCombatDurationMs: digest.survival.activeCombatMs,
    offensiveActivations: digest.performance.offensiveActivations,
  };
}
