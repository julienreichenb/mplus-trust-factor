import type { RedFlagDTO } from "@mplus/contracts";
import { clamp, clamp01 } from "./math.js";
import type {
  AuthenticityEvidence,
  AuthenticityFeatureInput,
  AuthenticityResult,
  ScoreModelConfigV1,
} from "./types.js";

const SUSPICION_KEYS = [
  "progressionKeyJump",
  "compressedBestRunWindow",
  "lowVolumeForScore",
  "repeatedStrongerTeammates",
  "topRunRosterConcentration",
  "weakTargetPerformance",
  "highDeathsLowContribution",
  "ratingPerformanceDivergence",
  "lackIntermediateProgression",
] as const;

const MITIGATION_KEYS = [
  "confirmedEliteMain",
  "probableReroll",
  "strongPriorSeasonSameRole",
  "strongPersonalTopRunPerformance",
  "independentGroupDiversity",
] as const;

/** Progression features that reroll mitigation can soften — not direct performance evidence. */
const PROGRESSION_ONLY = new Set([
  "progressionKeyJump",
  "compressedBestRunWindow",
  "lowVolumeForScore",
  "lackIntermediateProgression",
]);

const DIRECT_PERFORMANCE = new Set([
  "weakTargetPerformance",
  "highDeathsLowContribution",
  "ratingPerformanceDivergence",
]);

export function calculateAuthenticity(
  features: AuthenticityFeatureInput | undefined,
  model: ScoreModelConfigV1,
): AuthenticityResult {
  const input = features ?? {};
  const evidence: AuthenticityEvidence[] = [];
  let score = 100;

  const rerollSoftening =
    input.isConfirmedReroll || (input.confirmedEliteMain ?? 0) >= 0.7
      ? 0.55
      : input.isProbableReroll || (input.probableReroll ?? 0) >= 0.5
        ? 0.3
        : 0;

  for (const key of SUSPICION_KEYS) {
    const raw = clamp01(input[key] ?? 0);
    if (raw <= 0) continue;
    let severity = raw;
    if (rerollSoftening > 0 && PROGRESSION_ONLY.has(key)) {
      severity *= 1 - rerollSoftening;
    }
    // Reroll never erases direct poor-performance evidence
    if (DIRECT_PERFORMANCE.has(key)) {
      severity = raw;
    }
    const weight = model.authenticityFeatures[key];
    const contribution = -(weight * severity);
    score += contribution;
    evidence.push({
      featureKey: key,
      kind: "suspicion",
      rawValue: raw,
      normalizedSeverity: severity,
      confidence: clamp01(0.5 + 0.5 * raw),
      contribution,
    });
  }

  for (const key of MITIGATION_KEYS) {
    const raw = clamp01(input[key] ?? 0);
    if (raw <= 0) continue;
    // Mitigations cannot fully cancel direct performance evidence magnitude already applied;
    // they only add back up to their weight.
    const weight = model.authenticityMitigations[key];
    // Reroll/main mitigations explain progression; they do not wipe performance deductions.
    const contribution =
      key === "probableReroll" || key === "confirmedEliteMain"
        ? Math.min(weight * raw, 40)
        : weight * raw;
    score += contribution;
    evidence.push({
      featureKey: key,
      kind: "mitigation",
      rawValue: raw,
      normalizedSeverity: raw,
      confidence: clamp01(0.5 + 0.5 * raw),
      contribution,
    });
  }

  const authenticityScore = clamp(score);
  const evidenceStrength = evidence.reduce((s, e) => s + Math.abs(e.contribution), 0);
  const tags: string[] = [];
  const redFlags: RedFlagDTO[] = [];

  const { boostSuspectedBelow, atypicalBelow, minEvidenceStrength } = model.authenticityTags;
  const adequate = evidenceStrength >= minEvidenceStrength;

  if (!adequate && evidence.length < 2) {
    tags.push("INSUFFICIENT_DATA");
    redFlags.push({
      key: "insufficient_data",
      label: "Insufficient data",
      severity: "INFO",
      confidence: 0.4,
      public: true,
      evidence: { evidenceStrength, note: "Not enough authenticity evidence for a boost tag" },
    });
  } else if (authenticityScore < boostSuspectedBelow && adequate) {
    tags.push("BOOST_SUSPECTED");
    redFlags.push({
      key: "boost_suspected",
      label: "Boost suspected",
      severity: "HIGH",
      confidence: clamp01(1 - authenticityScore / 100),
      public: true,
      evidence: { authenticityScore, evidenceStrength, top: evidence.slice(0, 5) },
    });
  } else if (authenticityScore < atypicalBelow && adequate) {
    tags.push("ATYPICAL_PROGRESSION");
    redFlags.push({
      key: "atypical_progression",
      label: "Atypical progression",
      severity: "MEDIUM",
      confidence: clamp01(0.7 - authenticityScore / 200),
      public: true,
      evidence: { authenticityScore, evidenceStrength },
    });
  }

  if (input.isConfirmedReroll || (input.confirmedEliteMain ?? 0) >= 0.8) {
    tags.push("CONFIRMED_REROLL");
    redFlags.push({
      key: "confirmed_reroll",
      label: "Confirmed reroll",
      severity: "INFO",
      confidence: 0.9,
      public: true,
      evidence: { confirmedEliteMain: input.confirmedEliteMain ?? 1 },
    });
  } else if (input.isProbableReroll || (input.probableReroll ?? 0) >= 0.6) {
    tags.push("PROBABLE_REROLL");
    redFlags.push({
      key: "probable_reroll",
      label: "Probable reroll",
      severity: "INFO",
      confidence: 0.65,
      public: true,
      evidence: { probableReroll: input.probableReroll ?? 1 },
    });
  }

  return { authenticityScore, evidence, evidenceStrength, tags, redFlags };
}
