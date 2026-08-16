import type { Prisma, PrismaClient } from "@prisma/client";

export interface SaveCharacterBoostAssessmentInput {
  characterId: string;
  seasonId: string;
  detectorVersion: string;
  policyVersion: string;
  contextRevisionKey: string;
  contextRevisionId?: string | null;
  suspicionScore: number | null;
  suspicionBand: string | null;
  confidence: number;
  status: string;
  signals: Prisma.InputJsonValue;
  sample: Prisma.InputJsonValue;
  evidenceFingerprint: string;
  calculatedAt?: Date;
}

export class CharacterBoostAssessmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findLatestForCharacterSeason(characterId: string, seasonId: string) {
    const delegate = this.prisma.characterBoostAssessment;
    if (!delegate || typeof delegate.findFirst !== "function") return null;
    return delegate.findFirst({
      where: { characterId, seasonId },
      orderBy: { calculatedAt: "desc" },
    });
  }

  async save(input: SaveCharacterBoostAssessmentInput) {
    const delegate = this.prisma.characterBoostAssessment;
    if (!delegate || typeof delegate.upsert !== "function") {
      return { id: null as string | null };
    }
    const calculatedAt = input.calculatedAt ?? new Date();
    return this.prisma.characterBoostAssessment.upsert({
      where: {
        characterId_seasonId_detectorVersion_evidenceFingerprint: {
          characterId: input.characterId,
          seasonId: input.seasonId,
          detectorVersion: input.detectorVersion,
          evidenceFingerprint: input.evidenceFingerprint,
        },
      },
      create: {
        characterId: input.characterId,
        seasonId: input.seasonId,
        detectorVersion: input.detectorVersion,
        policyVersion: input.policyVersion,
        contextRevisionKey: input.contextRevisionKey,
        contextRevisionId: input.contextRevisionId ?? null,
        suspicionScore: input.suspicionScore,
        suspicionBand: input.suspicionBand,
        confidence: input.confidence,
        status: input.status,
        signals: input.signals,
        sample: input.sample,
        evidenceFingerprint: input.evidenceFingerprint,
        calculatedAt,
      },
      update: {
        policyVersion: input.policyVersion,
        contextRevisionKey: input.contextRevisionKey,
        contextRevisionId: input.contextRevisionId ?? null,
        suspicionScore: input.suspicionScore,
        suspicionBand: input.suspicionBand,
        confidence: input.confidence,
        status: input.status,
        signals: input.signals,
        sample: input.sample,
        calculatedAt,
      },
    });
  }
}

export function createCharacterBoostAssessmentRepository(
  prisma: PrismaClient,
): CharacterBoostAssessmentRepository {
  return new CharacterBoostAssessmentRepository(prisma);
}
