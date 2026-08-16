import {
  BOOST_ASSESSMENT_PUBLIC_DISCLAIMER,
  type BoostAssessmentApplicabilityDTO,
  type BoostAssessmentCoverageDTO,
  type BoostAssessmentPublicDTO,
  type BoostAssessmentSampleDTO,
  type BoostAssessmentSignalDTO,
  type BoostPeerGapClassificationPublic,
  type BoostRunEvidencePublicDTO,
  type BoostSignalCode,
  type BoostSignalFactsDTO,
} from "@mplus/contracts";

const SIGNAL_CODES: ReadonlySet<string> = new Set([
  "HIGH_KEY_PERFORMANCE_MISMATCH",
  "STRONG_PEER_PERFORMANCE_GAP",
  "RECURRENT_STRONG_PEER_COHORT",
  "HIGH_KEY_SURVIVAL_MISMATCH",
  "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE",
  "HIGHEST_RUN_TEMPORAL_CLUSTER",
  "RECURRENT_HIGH_KEY_COHORT",
  "STRONGER_RECURRENT_COHORT",
]);

function asRec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function publicWclDamageDoneReportUrl(
  reportCode: string | null | undefined,
  fightId: number | null | undefined,
): string | null {
  if (typeof reportCode !== "string" || reportCode.trim().length === 0) return null;
  if (typeof fightId !== "number" || !Number.isInteger(fightId) || fightId <= 0) return null;
  return `https://www.warcraftlogs.com/reports/${reportCode.trim()}?fight=${fightId}&type=damage-done`;
}

function mapClassification(raw: unknown): BoostPeerGapClassificationPublic {
  switch (raw) {
    case "RED_EXTREME":
    case "EXTREME_GAP":
    case "EXTREME_RED":
      return "EXTREME_RED";
    case "RED_MATERIAL":
    case "MATERIAL_GAP":
    case "RED":
      return "RED";
    case "GREEN_EXTREME":
    case "EXTREME_GREEN":
      return "EXTREME_GREEN";
    case "GREEN_MATERIAL":
    case "GREEN":
      return "GREEN";
    case "NEUTRAL":
    case "NORMAL":
      return "NEUTRAL";
    default:
      return "UNAVAILABLE";
  }
}

function projectApplicability(
  sample: Record<string, unknown> | null,
  status: string,
  signals: Array<Record<string, unknown>>,
): BoostAssessmentApplicabilityDTO {
  const exceptional = bool(sample?.exceptionalOperatingLevel);
  const notExceptionalReason = signals.some(
    (s) => s.missingReason === "SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL",
  );
  if (exceptional === false || notExceptionalReason) {
    return { status: "SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL" };
  }
  if (exceptional === true) {
    return { status: "APPLICABLE" };
  }
  if (sample?.seasonContextAvailable !== true || status === "INSUFFICIENT_DATA") {
    return { status: "INSUFFICIENT_CONTEXT" };
  }
  return { status: "APPLICABLE" };
}

function projectCoverage(sample: Record<string, unknown> | null): BoostAssessmentCoverageDTO {
  const raw = sample?.dungeonContexts;
  const list = Array.isArray(raw) ? raw : [];
  const dungeons = list
    .map((row) => asRec(row))
    .filter((row): row is Record<string, unknown> => row != null)
    .map((row) => {
      const analysable = row.topPublicEvidenceAvailable === true;
      return {
        dungeonSlug: typeof row.dungeonSlug === "string" ? row.dungeonSlug : "",
        blizzardBestKeyLevel: num(row.blizzardBestKeyLevel),
        publicAnalysableBestKeyLevel: num(row.publicAnalysableBestKeyLevel),
        keyLevelVerificationGap: num(row.keyLevelVerificationGap),
        analysable,
      };
    })
    .filter((d) => d.dungeonSlug.length > 0)
    .sort((a, b) => a.dungeonSlug.localeCompare(b.dungeonSlug));
  const analyzableTopRuns = dungeons.filter((d) => d.analysable).length;
  return {
    expectedTopRuns: dungeons.length,
    analyzableTopRuns,
    unavailableTopRuns: Math.max(0, dungeons.length - analyzableTopRuns),
    dungeons,
  };
}

function factsFor(code: BoostSignalCode, evidence: Record<string, unknown>): BoostSignalFactsDTO {
  switch (code) {
    case "STRONG_PEER_PERFORMANCE_GAP":
      return {
        code,
        peerComparableRunCount: num(evidence.peerComparableRunCount),
        analyzablePrimaryRunCount: num(evidence.comparablePrimaryRunCount),
        redPrimaryCount: num(evidence.redPrimaryCount),
        extremePrimaryCount: num(evidence.extremePrimaryCount),
        weightedRedSeverity: num(evidence.weightedRedSeverity),
        weightedGreenSeverity: num(evidence.weightedGreenSeverity),
        materiallyNegativePrimaryCount: num(evidence.materiallyNegativePrimaryCount ?? evidence.redPrimaryCount),
        severeNegativePrimaryCount: num(evidence.severeNegativePrimaryCount ?? evidence.veryStrongPrimaryCount),
        medianPrimaryPerformanceDelta: num(evidence.medianPrimaryPerformanceDelta),
        severePrimaryRatio: num(evidence.severePrimaryRatio),
      };
    case "RECURRENT_STRONG_PEER_COHORT": {
      const identitiesRaw = Array.isArray(evidence.identities) ? evidence.identities : [];
      const identities = identitiesRaw
        .map((row) => asRec(row))
        .filter((row): row is Record<string, unknown> => row != null)
        .slice(0, 8)
        .map((row) => ({
          displayName: typeof row.displayName === "string" ? row.displayName : null,
        }));
      return {
        code,
        gapDungeonCount: num(evidence.gapDungeonCount),
        identities,
      };
    }
    case "HIGH_KEY_SURVIVAL_MISMATCH":
      return {
        code,
        verifiedPrimaryRunCount: num(evidence.verifiedPrimaryRunCount),
        totalDeaths: num(evidence.totalDeaths),
        runsWithAtLeastOneDeath: num(evidence.runsWithAtLeastOneDeath),
        runsWithAtLeastTwoDeaths: num(evidence.runsWithAtLeastTwoDeaths),
        runsWithAtLeastThreeDeaths: num(evidence.runsWithAtLeastThreeDeaths),
      };
    case "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE":
      return {
        code,
        unverifiableTopRunCount: num(evidence.unverifiableTopRunCount),
      };
    case "HIGHEST_RUN_TEMPORAL_CLUSTER":
      return {
        code,
        maxDistinctDungeons24h: num(evidence.maxDistinctDungeons24h),
        maxDistinctDungeons48h: num(evidence.maxDistinctDungeons48h),
      };
    default:
      return { code };
  }
}

function projectSignals(raw: unknown): BoostAssessmentSignalDTO[] {
  const list = Array.isArray(raw) ? raw : [];
  const mapped: BoostAssessmentSignalDTO[] = [];
  for (const item of list) {
    const rec = asRec(item);
    if (!rec) continue;
    const codeRaw = String(rec.code ?? "");
    if (!SIGNAL_CODES.has(codeRaw)) continue;
    const code = codeRaw as BoostSignalCode;
    const evidence = asRec(rec.evidence) ?? {};
    mapped.push({
      code,
      contribution: typeof rec.contribution === "number" ? rec.contribution : 0,
      confidence: typeof rec.confidence === "number" ? rec.confidence : 0,
      status: rec.status === "UNAVAILABLE" ? "UNAVAILABLE" : "COMPUTED",
      summary: typeof rec.summary === "string" ? rec.summary : "",
      missingReason: typeof rec.missingReason === "string" ? rec.missingReason : null,
      displayOrder: 0,
      facts: factsFor(code, evidence),
    });
  }
  mapped.sort((a, b) => {
    const aLive = a.status === "COMPUTED" && a.contribution > 0 ? 0 : 1;
    const bLive = b.status === "COMPUTED" && b.contribution > 0 ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    if (b.contribution !== a.contribution) return b.contribution - a.contribution;
    return a.code.localeCompare(b.code);
  });
  return mapped.map((s, i) => ({ ...s, displayOrder: i }));
}

function dungeonPublicUrlForMatchingKey(
  dungeonSlug: string,
  keyLevel: number | null,
  sample: Record<string, unknown> | null,
): string | null {
  const contexts = Array.isArray(sample?.dungeonContexts) ? sample!.dungeonContexts : [];
  for (const row of contexts) {
    const rec = asRec(row);
    if (!rec || rec.dungeonSlug !== dungeonSlug) continue;
    if (keyLevel != null && num(rec.publicAnalysableBestKeyLevel) !== keyLevel) return null;
    return publicWclDamageDoneReportUrl(str(rec.publicAnalysableCode), num(rec.publicAnalysableFightId));
  }
  return null;
}

function isPeerPerformancePublicEligible(
  dungeonSlug: string,
  sample: Record<string, unknown> | null,
): boolean {
  const raw = sample?.dungeonContexts;
  if (!Array.isArray(raw) || raw.length === 0) return true;
  const ctx = raw
    .map((row) => asRec(row))
    .find((row) => row != null && row.dungeonSlug === dungeonSlug);
  return ctx?.topPublicEvidenceAvailable === true;
}

function projectRunEvidence(
  sample: Record<string, unknown> | null,
): BoostRunEvidencePublicDTO[] {
  const raw = sample?.analyzedRuns;
  const list = Array.isArray(raw) ? raw : [];
  const rows: BoostRunEvidencePublicDTO[] = [];
  for (const item of list) {
    const rec = asRec(item);
    if (!rec) continue;
    const dungeonSlug = typeof rec.dungeonSlug === "string" ? rec.dungeonSlug : "";
    if (!dungeonSlug) continue;
    if (!isPeerPerformancePublicEligible(dungeonSlug, sample)) continue;
    const slot: "PRIMARY" | "SECONDARY" =
      rec.dungeonSlotRole === "SECONDARY" || rec.slotIndex === 1 ? "SECONDARY" : "PRIMARY";
    const keyLevel = num(rec.keyLevel);
    const derivedUrl = publicWclDamageDoneReportUrl(str(rec.wclCode), num(rec.wclFightId));
    const legacyUrl = typeof rec.wclUrl === "string" ? rec.wclUrl : null;
    const fallbackUrl =
      slot === "PRIMARY" ? dungeonPublicUrlForMatchingKey(dungeonSlug, keyLevel, sample) : null;
    rows.push({
      dungeonSlug,
      slot,
      keyLevel,
      subjectKeyPercent: num(rec.subjectKeyParse),
      peerMedianKeyPercent: num(rec.peerMedianKeyParse),
      performanceDelta: num(rec.performanceDelta),
      classification: mapClassification(rec.gapClass),
      reportUrl: derivedUrl ?? legacyUrl ?? fallbackUrl,
    });
  }
  rows.sort((a, b) => {
    if (a.slot !== b.slot) return a.slot === "PRIMARY" ? -1 : 1;
    return a.dungeonSlug.localeCompare(b.dungeonSlug);
  });
  return rows;
}

function projectSample(sample: Record<string, unknown> | null): BoostAssessmentSampleDTO {
  return {
    highKeyRunCount: typeof sample?.highKeyRunCount === "number" ? sample.highKeyRunCount : 0,
    boostSampleSize: num(sample?.boostSampleSize) ?? num(sample?.highKeyRunCount) ?? 0,
    timedRunCountUsedForMedian: num(sample?.timedRunCountUsedForMedian),
    parseCoverage: num(sample?.parseCoverage),
    peerComparableRunCount: num(sample?.peerComparableRunCount),
    peerCoverage: num(sample?.peerCoverage),
    completeRosterRunCount: num(sample?.completeRosterRunCount),
    seasonContextAvailable: sample?.seasonContextAvailable === true,
    subjectMedianTimedKey: num(sample?.subjectMedianTimedKey),
    subjectMedianKeyPercentileBps: num(sample?.subjectMedianKeyPercentileBps),
    subjectMedianKeyPercentileLabel: str(sample?.subjectMedianKeyPercentileLabel),
    p99KeyThreshold: num(sample?.p99KeyThreshold),
    p999KeyThreshold: num(sample?.p999KeyThreshold),
    appliedAnchorPercentileLabel: str(sample?.appliedAnchorPercentileLabel),
    exceptionalOperatingLevel: sample?.exceptionalOperatingLevel === true,
  };
}

export function projectBoostAssessmentPublic(row: {
  status: string;
  suspicionScore: number | null;
  suspicionBand: string | null;
  confidence: number;
  detectorVersion: string;
  calculatedAt: string;
  sample: unknown;
  signals: unknown;
  primaryEvidenceAvailable?: boolean;
  assessmentCompleteness?: string;
}): BoostAssessmentPublicDTO {
  const sampleRec = asRec(row.sample);
  const signalRecs = Array.isArray(row.signals)
    ? row.signals.map((s) => asRec(s)).filter((s): s is Record<string, unknown> => s != null)
    : [];
  const coverage = projectCoverage(sampleRec);
  const completeness =
    row.assessmentCompleteness === "FULL" ||
    row.assessmentCompleteness === "PARTIAL_PRIMARY_MISSING" ||
    row.assessmentCompleteness === "INSUFFICIENT"
      ? row.assessmentCompleteness
      : sampleRec?.assessmentCompleteness === "FULL" ||
          sampleRec?.assessmentCompleteness === "PARTIAL_PRIMARY_MISSING" ||
          sampleRec?.assessmentCompleteness === "INSUFFICIENT"
        ? sampleRec.assessmentCompleteness
        : row.status === "INSUFFICIENT_DATA"
          ? "INSUFFICIENT"
          : row.status === "PARTIAL"
            ? "PARTIAL_PRIMARY_MISSING"
            : "FULL";
  const primary =
    typeof row.primaryEvidenceAvailable === "boolean"
      ? row.primaryEvidenceAvailable
      : sampleRec?.primaryEvidenceAvailable === true;
  return {
    status:
      row.status === "PARTIAL" || row.status === "INSUFFICIENT_DATA" ? row.status : "AVAILABLE",
    suspicionScore: row.suspicionScore,
    suspicionBand:
      row.suspicionBand === "LOW" || row.suspicionBand === "ELEVATED" || row.suspicionBand === "HIGH"
        ? row.suspicionBand
        : null,
    confidence: Number.isFinite(row.confidence) ? row.confidence : 0,
    primaryEvidenceAvailable: primary,
    assessmentCompleteness: completeness,
    applicability: projectApplicability(sampleRec, row.status, signalRecs),
    coverage,
    runEvidence: projectRunEvidence(sampleRec),
    detectorVersion: row.detectorVersion,
    calculatedAt: row.calculatedAt,
    sample: projectSample(sampleRec),
    signals: projectSignals(row.signals),
    disclaimer: BOOST_ASSESSMENT_PUBLIC_DISCLAIMER,
  };
}

export function assertPublicBoostDtoHasNoInternalPeers(dto: BoostAssessmentPublicDTO): void {
  const blob = JSON.stringify(dto);
  const forbidden = [
    "peerKeyParses",
    "authenticityScore",
    "overallScore",
    "identityKey",
    "actorId",
    "participantActorId",
    "rankingSnapshotId",
    '"participants"',
    '"evidence":',
    "wclCode",
    "wclFightId",
    "publicAnalysableCode",
  ];
  for (const key of forbidden) {
    if (blob.includes(key)) {
      throw new Error(`public Boost DTO must not include ${key}`);
    }
  }
}
