import {
  CharacterBoostAssessmentRepository,
  type PrismaClient,
} from "@mplus/database";
import {
  assessBoostSuspicionV1,
  toPublicBoostAssessment,
  type BoostAssessmentResult,
} from "@mplus/scoring";
import type { BoostAssessmentPublicDTO } from "@mplus/contracts";
import { loadBoostAssessmentEvidence, type BoostLineageSlot } from "./load-persisted-evidence.js";

export async function runBoostAssessmentFromPersisted(input: {
  prisma: PrismaClient;
  characterId: string;
  seasonId: string;
  persist?: boolean;
  now?: Date;
}): Promise<{
  result: BoostAssessmentResult;
  publicDto: BoostAssessmentPublicDTO;
  persistedId: string | null;
  lineage: {
    manifestId: string | null;
    manifestContentHash: string | null;
    source: "character_score_selected_runs" | "evidence_manifest_replay" | "missing";
    canonicalSlots: BoostLineageSlot[];
    boostSlots: BoostLineageSlot[];
    setsEqual: boolean;
  };
}> {
  const calculatedAt = (input.now ?? new Date()).toISOString();
  const evidence = await loadBoostAssessmentEvidence({
    prisma: input.prisma,
    characterId: input.characterId,
    seasonId: input.seasonId,
  });
  const result = assessBoostSuspicionV1({
    subjectCharacterId: input.characterId,
    seasonId: input.seasonId,
    calculatedAt,
    runs: evidence.runs,
    seasonHighKeyContext: evidence.seasonHighKeyContext,
    dungeonContexts: evidence.dungeonContexts,
  });
  const publicDto = toPublicBoostAssessment(result);

  let persistedId: string | null = null;
  if (input.persist) {
    const repo = new CharacterBoostAssessmentRepository(input.prisma);
    const row = await repo.save({
      characterId: input.characterId,
      seasonId: input.seasonId,
      detectorVersion: result.detectorVersion,
      policyVersion: result.policyVersion,
      contextRevisionKey: result.contextRevisionKey,
      contextRevisionId: result.contextRevisionId,
      suspicionScore: result.suspicionScore,
      suspicionBand: result.suspicionBand,
      confidence: result.confidence,
      status: result.status,
      signals: result.signals as unknown as object,
      sample: result.sample as unknown as object,
      evidenceFingerprint: result.evidenceFingerprint,
      calculatedAt: new Date(result.calculatedAt),
    });
    persistedId = row.id;
  }

  return { result, publicDto, persistedId, lineage: evidence.lineage };
}
