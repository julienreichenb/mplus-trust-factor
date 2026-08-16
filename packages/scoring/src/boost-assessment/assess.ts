import { hashCanonicalJson, type BoostAssessmentPublicDTO } from "@mplus/contracts";
import { clamp } from "../math.js";
import { BOOST_ASSESSMENT_ISOLATION, assertBoostAssessmentIsolation } from "./isolation.js";
import { projectBoostAssessmentPublic } from "./project-public.js";
import {
  BOOST_ASSESSMENT_POLICY,
  BOOST_ASSESSMENT_SCHEMA_VERSION,
  BOOST_DETECTOR_VERSION,
  BOOST_POLICY_VERSION,
  classifyPeerGap,
  dungeonRunSlotRole,
  dungeonRunSlotWeight,
  isGreenPeerClass,
  isRedPeerClass,
  peerMismatchSuspicionFloor,
  performanceDelta,
  signedDeltaSeverity,
} from "./policy.js";
import { isExceptionalOperatingLevel } from "./character-context.js";
import { isDungeonBehaviourAnalysable } from "./dungeon-filter.js";
import { peerMaxKeyParse, peerMedianKeyParse, subjectKeyParse } from "./sample.js";
import { computeStrongPeerPerformanceGap, peerGapWeightedContribution } from "./features/peer-gap.js";
import { computeRecurrentStrongPeerCohort } from "./features/recurrent-strong-peers.js";
import { computeSurvivalMismatch } from "./features/survival-mismatch.js";
import { computeTopRunPublicEvidenceUnavailable } from "./features/unverifiable-top-runs.js";
import { computeHighestRunTemporalCluster } from "./features/temporal-cluster.js";
import { isUsableTeammateIdentity, resolveCanonicalTeammateIdentity } from "./identity.js";
import type {
  BoostAnalyzedRunRow,
  BoostAssessmentExtractorInput,
  BoostAssessmentInternalSignal,
  BoostAssessmentResult,
  BoostFeatureComputeResult,
  BoostSignalCode,
} from "./types.js";

function bandFor(score: number): BoostAssessmentResult["suspicionBand"] {
  if (score >= BOOST_ASSESSMENT_POLICY.bands.highMin) return "HIGH";
  if (score >= BOOST_ASSESSMENT_POLICY.bands.elevatedMin) return "ELEVATED";
  return "LOW";
}

function toSignal(
  code: BoostSignalCode,
  result: BoostFeatureComputeResult,
  weight: number,
): BoostAssessmentInternalSignal {
  if (result.status === "unavailable") {
    return {
      code,
      contribution: 0,
      confidence: result.confidence ?? 0,
      status: "UNAVAILABLE",
      summary: result.summary,
      missingReason: result.reasonCode,
      evidence: result.publicEvidence,
    };
  }
  return {
    code,
    contribution: Number((result.evidence.value * weight).toFixed(2)),
    confidence: result.evidence.confidence,
    status: "COMPUTED",
    summary: result.summary,
    missingReason: null,
    evidence: {
      ...result.publicEvidence,
      normalizedValue: Number(result.evidence.value.toFixed(4)),
      sampleSize: result.evidence.sampleSize,
      coverage: Number(result.evidence.coverage.toFixed(4)),
    },
  };
}

function rosterComplete(run: BoostAssessmentExtractorInput["runs"][number], subjectId: string): boolean {
  const mates = run.participants.filter((p) => !p.isTargetCharacter && p.characterId !== subjectId);
  const usable = mates.filter((p) => isUsableTeammateIdentity(resolveCanonicalTeammateIdentity(p)));
  return usable.length >= 2;
}

function combineSuspicion(args: {
  signals: BoostAssessmentInternalSignal[];
  extremePrimaryDungeonCount: number;
  analyzablePrimaryRunCount: number;
  redPrimaryCount: number;
  veryStrongPrimaryCount: number;
  medianPrimaryPerformanceDelta: number | null;
}): number {
  const contrib = (code: BoostSignalCode) =>
    args.signals.find((s) => s.code === code && s.status === "COMPUTED")?.contribution ?? 0;
  const peer = contrib("STRONG_PEER_PERFORMANCE_GAP");
  const cohort = contrib("RECURRENT_STRONG_PEER_COHORT");
  const deaths = contrib("HIGH_KEY_SURVIVAL_MISMATCH");
  const missing = contrib("TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE");
  const temporal = contrib("HIGHEST_RUN_TEMPORAL_CLUSTER");
  const direct = peer + cohort;
  const behavioral = deaths;
  let context = missing + temporal;
  if (direct + behavioral < 25) {
    context = Math.min(context, BOOST_ASSESSMENT_POLICY.contextOnlySuspicionCap);
  }
  let raw = direct + behavioral + context;
  const positive = args.signals.filter((s) => s.status === "COMPUTED" && s.contribution > 0.5);
  if (positive.length === 1 && positive[0]?.code === "RECURRENT_STRONG_PEER_COHORT") {
    raw = Math.min(raw, BOOST_ASSESSMENT_POLICY.cohortAloneSuspicionCap);
  }
  if (positive.length === 1 && positive[0]?.code === "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE") {
    raw = Math.min(raw, BOOST_ASSESSMENT_POLICY.unavailableAloneSuspicionCap);
  }
  if (positive.length === 1 && positive[0]?.code === "HIGHEST_RUN_TEMPORAL_CLUSTER") {
    raw = Math.min(raw, BOOST_ASSESSMENT_POLICY.temporalAloneSuspicionCap);
  }
  raw = Math.max(
    raw,
    peerMismatchSuspicionFloor({
      analyzablePrimaryRunCount: args.analyzablePrimaryRunCount,
      redPrimaryCount: args.redPrimaryCount,
      veryStrongPrimaryCount: args.veryStrongPrimaryCount,
      extremePrimaryDungeonCount: args.extremePrimaryDungeonCount,
      medianPrimaryPerformanceDelta: args.medianPrimaryPerformanceDelta,
    }),
  );
  return clamp(Math.round(raw), 0, 100);
}

export function assessBoostSuspicionV1(input: BoostAssessmentExtractorInput): BoostAssessmentResult {
  const sample = input.runs;
  const exceptional = isExceptionalOperatingLevel(input.seasonHighKeyContext);
  const dungeonContexts = input.dungeonContexts;

  const peerGap = computeStrongPeerPerformanceGap({
    sampleRuns: sample,
    context: input.seasonHighKeyContext,
    dungeonContexts,
  });
  const materialPeerGapRunCount =
    peerGap.status === "computed" && typeof peerGap.publicEvidence.materialPeerGapRunCount === "number"
      ? peerGap.publicEvidence.materialPeerGapRunCount
      : 0;
  const weightedMaterialGapWeight =
    peerGap.status === "computed" && typeof peerGap.publicEvidence.weightedMaterialGapWeight === "number"
      ? peerGap.publicEvidence.weightedMaterialGapWeight
      : 0;
  const comparableWeight =
    peerGap.status === "computed" && typeof peerGap.publicEvidence.comparableWeight === "number"
      ? peerGap.publicEvidence.comparableWeight
      : 0;
  const extremePrimaryDungeonCount =
    peerGap.status === "computed" && typeof peerGap.publicEvidence.extremePrimaryDungeonCount === "number"
      ? peerGap.publicEvidence.extremePrimaryDungeonCount
      : 0;
  const analyzablePrimaryRunCount =
    peerGap.status === "computed" && typeof peerGap.publicEvidence.comparablePrimaryRunCount === "number"
      ? peerGap.publicEvidence.comparablePrimaryRunCount
      : 0;
  const redPrimaryCount =
    peerGap.status === "computed" && typeof peerGap.publicEvidence.redPrimaryCount === "number"
      ? peerGap.publicEvidence.redPrimaryCount
      : 0;
  const veryStrongPrimaryCount =
    peerGap.status === "computed" && typeof peerGap.publicEvidence.veryStrongPrimaryCount === "number"
      ? peerGap.publicEvidence.veryStrongPrimaryCount
      : 0;
  const medianPrimaryPerformanceDelta =
    peerGap.status === "computed" && typeof peerGap.publicEvidence.medianPrimaryPerformanceDelta === "number"
      ? peerGap.publicEvidence.medianPrimaryPerformanceDelta
      : null;
  const cohort = computeRecurrentStrongPeerCohort({
    sampleRuns: sample,
    subjectCharacterId: input.subjectCharacterId,
    peerGapComputed: peerGap.status === "computed",
    materialPeerGapRunCount,
    weightedMaterialGapWeight,
    dungeonContexts,
  });
  const survival = computeSurvivalMismatch({
    sampleRuns: sample,
    dungeonContexts,
    context: input.seasonHighKeyContext,
  });
  const unverifiable = computeTopRunPublicEvidenceUnavailable({
    dungeonContexts,
    context: input.seasonHighKeyContext,
  });
  const temporal = computeHighestRunTemporalCluster({
    dungeonContexts,
    context: input.seasonHighKeyContext,
  });

  const signals: BoostAssessmentInternalSignal[] = [
    toSignal("STRONG_PEER_PERFORMANCE_GAP", peerGap, BOOST_ASSESSMENT_POLICY.weights.strongPeerPerformanceGap),
    toSignal("RECURRENT_STRONG_PEER_COHORT", cohort, BOOST_ASSESSMENT_POLICY.weights.recurrentStrongPeerCohort),
    toSignal("HIGH_KEY_SURVIVAL_MISMATCH", survival, BOOST_ASSESSMENT_POLICY.weights.survivalMismatch),
    toSignal(
      "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE",
      unverifiable,
      BOOST_ASSESSMENT_POLICY.weights.topRunPublicEvidenceUnavailable,
    ),
    toSignal(
      "HIGHEST_RUN_TEMPORAL_CLUSTER",
      temporal,
      BOOST_ASSESSMENT_POLICY.weights.highestRunTemporalCluster,
    ),
  ];

  const parseCovered = sample.filter((r) => subjectKeyParse(r) != null).length;
  const peerComparable = sample.filter(
    (r) =>
      isDungeonBehaviourAnalysable(r.dungeonSlug, dungeonContexts) &&
      subjectKeyParse(r) != null &&
      peerMedianKeyParse(r) != null,
  ).length;
  const completeRoster = sample.filter((r) => rosterComplete(r, input.subjectCharacterId)).length;

  const primaryEvidenceAvailable =
    exceptional &&
    parseCovered / Math.max(1, sample.length) >= BOOST_ASSESSMENT_POLICY.minParseCoverageForComputed &&
    parseCovered >= BOOST_ASSESSMENT_POLICY.minParseCoveredRuns;

  const missingContext = !input.seasonHighKeyContext.available;
  const insufficientSample = sample.length < BOOST_ASSESSMENT_POLICY.minUsableSampleRuns;

  const scored = signals.filter((s) => s.status === "COMPUTED");
  const rawSuspicion = combineSuspicion({
    signals,
    extremePrimaryDungeonCount,
    analyzablePrimaryRunCount,
    redPrimaryCount,
    veryStrongPrimaryCount,
    medianPrimaryPerformanceDelta,
  });

  let status: BoostAssessmentResult["status"] = "AVAILABLE";
  let assessmentCompleteness: BoostAssessmentResult["assessmentCompleteness"] = "FULL";
  if (missingContext || insufficientSample) {
    status = "INSUFFICIENT_DATA";
    assessmentCompleteness = "INSUFFICIENT";
  } else if (!primaryEvidenceAvailable) {
    status = "PARTIAL";
    assessmentCompleteness = "PARTIAL_PRIMARY_MISSING";
  } else if (signals.some((s) => s.status === "UNAVAILABLE")) {
    status = "PARTIAL";
    assessmentCompleteness = "FULL";
  }

  const publishScore = status !== "INSUFFICIENT_DATA" && primaryEvidenceAvailable;
  const suspicionScore = !publishScore ? null : scored.length === 0 ? null : rawSuspicion;

  const coverageBits = [
    input.seasonHighKeyContext.available ? 1 : 0,
    sample.length >= BOOST_ASSESSMENT_POLICY.minUsableSampleRuns ? 1 : 0,
    parseCovered / Math.max(1, sample.length),
    peerComparable / Math.max(1, sample.length),
    survival.status === "computed" ? survival.evidence.coverage : 0.4,
  ];
  const confidence = clamp(coverageBits.reduce((a, b) => a + b, 0) / coverageBits.length, 0, 1);

  const cohortIdentityRows =
    cohort.status === "computed" && Array.isArray(cohort.publicEvidence.identities)
      ? (cohort.publicEvidence.identities as Array<{ identityKey?: string }>)
      : [];
  const cohortIdentities = new Set(cohortIdentityRows.map((i) => i.identityKey ?? "").filter(Boolean));

  const analyzedRuns: BoostAnalyzedRunRow[] = sample.map((run) => {
    const subject = subjectKeyParse(run);
    const peerMed = peerMedianKeyParse(run);
    const gapClass = classifyPeerGap({ subjectKeyParse: subject, peerMedianKeyParse: peerMed });
    const slotIndex = typeof run.slotIndex === "number" ? run.slotIndex : null;
    const dungeonSlotRole = dungeonRunSlotRole(slotIndex);
    const dungeonSlotWeight = dungeonRunSlotWeight(slotIndex);
    const delta = subject != null && peerMed != null ? performanceDelta(subject, peerMed) : null;
    const behavioural = isDungeonBehaviourAnalysable(run.dungeonSlug, dungeonContexts);
    const peerGapSeverity = delta == null || !behavioural ? null : signedDeltaSeverity(Math.abs(delta));
    const polarity: BoostAnalyzedRunRow["gapPolarity"] =
      gapClass === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : isRedPeerClass(gapClass)
          ? "RED"
          : isGreenPeerClass(gapClass)
            ? "GREEN"
            : "NEUTRAL";
    const peerGapWeightedContributionValue =
      !behavioural || delta == null || comparableWeight <= 0
        ? null
        : peerGapWeightedContribution(
            {
              run,
              slotIndex,
              role: dungeonSlotRole,
              weight: dungeonSlotWeight,
              subjectKeyParse: subject!,
              peerMedianKeyParse: peerMed!,
              performanceDelta: delta,
              classification: gapClass,
              redSeverity: delta < 0 ? (peerGapSeverity ?? 0) : 0,
              greenSeverity: delta > 0 ? (peerGapSeverity ?? 0) : 0,
            },
            comparableWeight,
          );
    const recurring: string[] = [];
    for (const p of run.participants) {
      if (p.isTargetCharacter || p.characterId === input.subjectCharacterId) continue;
      const id = resolveCanonicalTeammateIdentity(p);
      if (cohortIdentities.has(id.canonicalKey)) recurring.push(p.displayName ?? id.canonicalKey);
    }
    for (const peer of run.peerKeyParses ?? []) {
      if (cohortIdentities.has(peer.identityKey) && !recurring.includes(peer.displayName ?? peer.identityKey)) {
        recurring.push(peer.displayName ?? peer.identityKey);
      }
    }
    return {
      runId: run.runId,
      dungeonSlug: run.dungeonSlug ?? null,
      dungeonName: run.dungeonName ?? null,
      completedAt: run.completedAt,
      keyLevel: run.keyLevel,
      timed: run.timed,
      usedForMedian: run.usedForMedian === true,
      usedInBoostSample: behavioural,
      subjectKeyParse: subject,
      peerMedianKeyParse: peerMed,
      peerMaxKeyParse: peerMaxKeyParse(run),
      performanceDelta: delta == null ? null : Number(delta.toFixed(2)),
      peerPerformanceGap: delta == null ? null : Number(delta.toFixed(2)),
      gapClass,
      gapPolarity: polarity,
      slotIndex,
      dungeonSlotRole,
      dungeonSlotWeight,
      peerGapSeverity: peerGapSeverity == null ? null : Number(peerGapSeverity.toFixed(4)),
      peerGapWeightedContribution:
        peerGapWeightedContributionValue == null ? null : Number(peerGapWeightedContributionValue.toFixed(4)),
      peerCount: (run.peerKeyParses ?? []).filter((p) => Number.isFinite(p.keyParse)).length,
      peerKeyParses: run.peerKeyParses ?? [],
      deathCount: run.deathCount ?? null,
      rosterComplete: rosterComplete(run, input.subjectCharacterId),
      recurringStrongPeers: recurring,
      evidenceSource: run.evidenceSource ?? null,
      missingReason:
        !behavioural
          ? "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE"
          : (run.missingReason ?? (run.alignmentStatus === "AMBIGUOUS" ? "AMBIGUOUS_WCL_ALIGNMENT" : null)),
      wclCode: run.wclCode ?? null,
      wclFightId: run.wclFightId ?? null,
    };
  });

  const sampleDto = {
    highKeyRunCount: sample.length,
    boostSampleSize: sample.length,
    timedRunCountUsedForMedian: input.seasonHighKeyContext.timedRunCountUsedForMedian ?? 0,
    parseCoveredRunCount: parseCovered,
    parseCoverage: sample.length > 0 ? parseCovered / sample.length : null,
    peerComparableRunCount: peerComparable,
    peerCoverage: sample.length > 0 ? peerComparable / sample.length : null,
    completeRosterRunCount: completeRoster,
    seasonContextAvailable: input.seasonHighKeyContext.available,
    subjectMedianTimedKey: input.seasonHighKeyContext.subjectMedianTimedKey ?? null,
    subjectMedianKeyPercentileBps: input.seasonHighKeyContext.subjectMedianKeyPercentileBps ?? null,
    subjectMedianKeyPercentileLabel: input.seasonHighKeyContext.subjectMedianKeyPercentileLabel ?? null,
    p99KeyThreshold: input.seasonHighKeyContext.p99KeyThreshold,
    p999KeyThreshold: input.seasonHighKeyContext.p999KeyThreshold,
    appliedAnchorPercentileLabel: input.seasonHighKeyContext.appliedAnchorPercentileLabel,
    exceptionalOperatingLevel: exceptional,
    dungeonContexts: dungeonContexts ?? [],
    rankingSnapshotIds: [
      ...new Set(sample.map((r) => r.rankingSnapshotId).filter((id): id is string => Boolean(id))),
    ].sort(),
    primaryEvidenceAvailable,
    assessmentCompleteness,
    analyzedRuns,
  };

  const evidenceFingerprint = hashCanonicalJson({
    detectorVersion: BOOST_DETECTOR_VERSION,
    policyVersion: BOOST_POLICY_VERSION,
    subjectCharacterId: input.subjectCharacterId,
    seasonId: input.seasonId,
    contextRevisionKey: input.seasonHighKeyContext.contextRevisionKey,
    runIds: sample.map((r) => r.slotId ?? r.runId).sort(),
    rankingSnapshotIds: sampleDto.rankingSnapshotIds,
    rankingSnapshotContentHashes: [
      ...new Set(sample.map((r) => r.rankingSnapshotContentHash).filter((id): id is string => Boolean(id))),
    ].sort(),
    dungeonContexts: (dungeonContexts ?? []).map((c) => ({
      dungeonSlug: c.dungeonSlug,
      blizzardBestKeyLevel: c.blizzardBestKeyLevel,
      blizzardBestCompletedAt: c.blizzardBestCompletedAt,
      publicAnalysableBestKeyLevel: c.publicAnalysableBestKeyLevel,
      topPublicEvidenceAvailable: c.topPublicEvidenceAvailable,
    })),
    signals: signals.map((s) => ({
      code: s.code,
      contribution: s.contribution,
      status: s.status,
      missingReason: s.missingReason,
      evidence: s.evidence,
    })),
  });

  const result: BoostAssessmentResult = {
    schemaVersion: BOOST_ASSESSMENT_SCHEMA_VERSION,
    detectorVersion: BOOST_DETECTOR_VERSION,
    policyVersion: BOOST_POLICY_VERSION,
    subjectCharacterId: input.subjectCharacterId,
    seasonId: input.seasonId,
    contextRevisionKey: input.seasonHighKeyContext.contextRevisionKey,
    contextRevisionId: input.seasonHighKeyContext.contextRevisionId,
    status,
    suspicionScore,
    suspicionBand: suspicionScore == null ? null : bandFor(suspicionScore),
    confidence: Number(confidence.toFixed(4)),
    primaryEvidenceAvailable,
    assessmentCompleteness,
    calculatedAt: input.calculatedAt,
    signals,
    sample: sampleDto,
    evidenceFingerprint,
    isolation: BOOST_ASSESSMENT_ISOLATION,
  };

  assertBoostAssessmentIsolation(result);
  return result;
}

export function toPublicBoostAssessment(result: BoostAssessmentResult): BoostAssessmentPublicDTO {
  return projectBoostAssessmentPublic({
    status: result.status,
    suspicionScore: result.suspicionScore,
    suspicionBand: result.suspicionBand,
    confidence: result.confidence,
    detectorVersion: result.detectorVersion,
    calculatedAt: result.calculatedAt,
    sample: result.sample,
    signals: result.signals,
    primaryEvidenceAvailable: result.primaryEvidenceAvailable,
    assessmentCompleteness: result.assessmentCompleteness,
  });
}
