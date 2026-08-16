import type { BoostAssessmentSignalDTO, BoostSignalFactsDTO } from "@mplus/contracts";

type PeerGapFacts = Extract<BoostSignalFactsDTO, { code: "STRONG_PEER_PERFORMANCE_GAP" }>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Presentation only: never derives suspicion band or score. */
export function peerGapFactSentences(facts: PeerGapFacts, mode: "section" | "alert"): string[] {
  const analyzable = facts.analyzablePrimaryRunCount;
  const severe = isFiniteNumber(facts.severeNegativePrimaryCount)
    ? facts.severeNegativePrimaryCount
    : isFiniteNumber(facts.extremePrimaryCount)
      ? facts.extremePrimaryCount
      : null;
  const material = isFiniteNumber(facts.materiallyNegativePrimaryCount)
    ? facts.materiallyNegativePrimaryCount
    : isFiniteNumber(facts.redPrimaryCount)
      ? facts.redPrimaryCount
      : null;
  const median = isFiniteNumber(facts.medianPrimaryPerformanceDelta)
    ? facts.medianPrimaryPerformanceDelta
    : null;

  const sentences: string[] = [];
  if (isFiniteNumber(severe) && isFiniteNumber(analyzable) && severe > 0) {
    sentences.push(
      `Severe performance gaps were observed across ${severe} of ${analyzable} analysed highest runs.`,
    );
  }
  if (
    isFiniteNumber(material) &&
    isFiniteNumber(analyzable) &&
    material > 0 &&
    material !== severe
  ) {
    sentences.push(
      `${material} of ${analyzable} analysed highest runs show material underperformance versus same-run peers.`,
    );
  }
  if (isFiniteNumber(median) && mode === "section") {
    sentences.push(
      `Typical performance gap across analysed highest runs: ${Math.round(median)} points.`,
    );
  }
  if (isFiniteNumber(median) && mode === "alert" && sentences.length === 0) {
    sentences.push(
      `Typical performance gap across analysed highest runs: ${Math.round(median)} points.`,
    );
  }
  return sentences;
}

export function signalIndicatorSentences(
  signal: BoostAssessmentSignalDTO,
  coverageExpectedTopRuns: number | null,
  mode: "section" | "alert",
): string[] {
  const facts = signal.facts;
  if (facts.code === "STRONG_PEER_PERFORMANCE_GAP") {
    return peerGapFactSentences(facts, mode);
  }
  const single = signalExplanation(signal, coverageExpectedTopRuns, mode);
  return single ? [single] : [];
}

export function signalExplanation(
  signal: BoostAssessmentSignalDTO,
  coverageExpectedTopRuns: number | null,
  mode: "section" | "alert",
): string | null {
  const facts = signal.facts;
  if (facts.code === "STRONG_PEER_PERFORMANCE_GAP") {
    const sentences = peerGapFactSentences(facts, mode);
    return sentences.length > 0 ? sentences.join(" ") : null;
  }
  if (facts.code === "RECURRENT_STRONG_PEER_COHORT") {
    if (facts.gapDungeonCount != null) {
      return `Materially stronger teammates recur across ${facts.gapDungeonCount} dungeons.`;
    }
    return null;
  }
  if (facts.code === "HIGH_KEY_SURVIVAL_MISMATCH") {
    if (facts.totalDeaths != null && facts.verifiedPrimaryRunCount != null) {
      return `${facts.totalDeaths} deaths across ${facts.verifiedPrimaryRunCount} verified highest runs.`;
    }
    return null;
  }
  if (facts.code === "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE") {
    if (facts.unverifiableTopRunCount != null && coverageExpectedTopRuns != null) {
      return `${facts.unverifiableTopRunCount} of ${coverageExpectedTopRuns} highest dungeon runs could not be publicly analysed.`;
    }
    if (facts.unverifiableTopRunCount != null && mode === "alert") {
      return `${facts.unverifiableTopRunCount} highest dungeon runs could not be publicly analysed.`;
    }
    return null;
  }
  if (facts.code === "HIGHEST_RUN_TEMPORAL_CLUSTER") {
    if (facts.maxDistinctDungeons48h != null) {
      return `Up to ${facts.maxDistinctDungeons48h} highest dungeon records were completed within 48 hours.`;
    }
    return null;
  }
  return null;
}

export function boostSignalLabel(code: string): string {
  switch (code) {
    case "STRONG_PEER_PERFORMANCE_GAP":
      return "Performance gap with teammates";
    case "RECURRENT_STRONG_PEER_COHORT":
      return "Recurring stronger teammates";
    case "HIGH_KEY_SURVIVAL_MISMATCH":
      return "Deaths on highest runs";
    case "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE":
      return "Highest runs without public evidence";
    case "HIGHEST_RUN_TEMPORAL_CLUSTER":
      return "Clustered timing";
    default:
      return code.replaceAll("_", " ").toLowerCase();
  }
}
