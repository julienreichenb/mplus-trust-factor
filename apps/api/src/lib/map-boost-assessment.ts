import type { BoostAssessmentPublicDTO } from "@mplus/contracts";
import { projectBoostAssessmentPublic } from "@mplus/scoring";

export function mapPersistedBoostAssessment(row: {
  status: string;
  suspicionScore: number | null;
  suspicionBand: string | null;
  confidence: { toNumber?: () => number } | number;
  detectorVersion: string;
  calculatedAt: Date;
  sample: unknown;
  signals: unknown;
}): BoostAssessmentPublicDTO {
  const confidence =
    typeof row.confidence === "number" ? row.confidence : Number(row.confidence.toNumber?.() ?? row.confidence);
  return projectBoostAssessmentPublic({
    status: row.status,
    suspicionScore: row.suspicionScore,
    suspicionBand: row.suspicionBand,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    detectorVersion: row.detectorVersion,
    calculatedAt: row.calculatedAt.toISOString(),
    sample: row.sample,
    signals: row.signals,
  });
}
