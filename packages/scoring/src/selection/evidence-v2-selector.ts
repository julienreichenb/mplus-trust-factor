import { createHash } from "node:crypto";
import type {
  CandidateRejectionReason,
  CandidateRejectionSummary,
  CharacterSeasonEvidenceManifestV2,
  DimensionValidity,
  EvidenceAccessState,
  EvidenceAcquisitionCandidateRef,
  EvidenceAcquisitionPlanContentHashInput,
  EvidenceAcquisitionPlanV2,
  EvidenceAcquisitionSlotPlanV2,
  EvidenceCandidateAcquisitionResult,
  EvidenceCandidateMetadataV2,
  EvidenceCoverageState,
  EvidenceCoverageV2,
  EvidenceManifestContentHashInput,
  EvidenceSelectionScope,
  EvidenceSelectorDiagnosticsV2,
  EvidenceSlotState,
  EvidenceSlotV2,
} from "@mplus/contracts";
import {
  EVIDENCE_ACQUISITION_PLAN_SCHEMA_VERSION,
  EVIDENCE_MANIFEST_SCHEMA_VERSION,
  EVIDENCE_PLAN_MAX_CANDIDATES_PER_DUNGEON,
  EVIDENCE_SELECTOR_VERSION,
  EVIDENCE_SLOTS_PER_DUNGEON,
  discoveryIdentityKey,
  expectedEvidenceSlotCount,
} from "@mplus/contracts";

/** Max rejected summaries retained on plan/manifest (bounded). */
export const EVIDENCE_V2_MAX_REJECTED_SUMMARIES = 80;

export interface BuildEvidenceAcquisitionPlanV2Input {
  scope: EvidenceSelectionScope;
  candidates: readonly EvidenceCandidateMetadataV2[];
  /** Wall-clock plan timestamp (excluded from plan content hash). */
  plannedAt: string;
  selectorVersion?: string;
  maxRejectedSummaries?: number;
  maxCandidatesPerDungeon?: number;
}

export interface BuildEvidenceAcquisitionPlanV2Result {
  plan: EvidenceAcquisitionPlanV2;
}

export interface FinalizeEvidenceManifestV2Input {
  plan: EvidenceAcquisitionPlanV2;
  acquisitionResults: readonly EvidenceCandidateAcquisitionResult[];
  /** Wall-clock finalization timestamp (excluded from manifest content hash). */
  selectedAt: string;
  maxRejectedSummaries?: number;
}

export interface FinalizeEvidenceManifestV2Result {
  manifest: CharacterSeasonEvidenceManifestV2;
}

function normalizeDungeonSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function timerQualityRank(timed: boolean | null): number {
  if (timed === true) return 2;
  if (timed === false) return 1;
  return 0;
}

/**
 * Deterministic per-dungeon ordering.
 * MUST NOT read diagnosticsOnly (parse / deaths / utility / labels).
 */
export function compareEvidenceCandidatesV2(
  a: EvidenceCandidateMetadataV2,
  b: EvidenceCandidateMetadataV2,
): number {
  if (a.keyLevel !== b.keyLevel) return b.keyLevel - a.keyLevel;

  const timerDiff = timerQualityRank(b.timed) - timerQualityRank(a.timed);
  if (timerDiff !== 0) return timerDiff;

  const scoreA = a.runScore ?? Number.NEGATIVE_INFINITY;
  const scoreB = b.runScore ?? Number.NEGATIVE_INFINITY;
  if (scoreA !== scoreB) return scoreB - scoreA;

  if (a.evidenceCompleteness !== b.evidenceCompleteness) {
    return b.evidenceCompleteness - a.evidenceCompleteness;
  }

  const timeA = a.completedAt ? Date.parse(a.completedAt) : Number.NEGATIVE_INFINITY;
  const timeB = b.completedAt ? Date.parse(b.completedAt) : Number.NEGATIVE_INFINITY;
  if (timeA !== timeB) return timeB - timeA;

  const codeCmp = a.discoveryIdentity.reportCode.localeCompare(
    b.discoveryIdentity.reportCode,
  );
  if (codeCmp !== 0) return codeCmp;

  return a.discoveryIdentity.fightId - b.discoveryIdentity.fightId;
}

export function orderEvidenceCandidatesV2(
  candidates: readonly EvidenceCandidateMetadataV2[],
): EvidenceCandidateMetadataV2[] {
  return [...candidates].sort(compareEvidenceCandidatesV2);
}

function planEligibilityRejection(
  candidate: EvidenceCandidateMetadataV2,
  scope: EvidenceSelectionScope,
  activePool: ReadonlySet<string>,
): CandidateRejectionReason | null {
  const dungeonSlug = normalizeDungeonSlug(candidate.dungeonSlug);
  if (!dungeonSlug) return "DUNGEON_UNRESOLVED";
  if (!activePool.has(dungeonSlug)) return "OFF_POOL_DUNGEON";

  if (candidate.hardError) return "HARD_PROVIDER_ERROR";
  if (candidate.accessState === "PRIVATE_OR_HIDDEN") return "PRIVATE_OR_HIDDEN";
  if (candidate.accessState === "ARCHIVED_OR_GATED") return "ARCHIVED_OR_GATED";
  if (candidate.accessState === "SCHEMA_UNSUPPORTED") return "SCHEMA_UNSUPPORTED";
  if (candidate.accessState === "RATE_DEFERRED") return "RATE_DEFERRED";

  switch (candidate.identityResolution) {
    case "UNRESOLVED":
      return "IDENTITY_UNRESOLVED";
    case "WRONG_SPEC":
      return "WRONG_SPEC";
    case "WRONG_SEASON":
      return "WRONG_SEASON";
    case "WRONG_DUNGEON":
      return "WRONG_DUNGEON";
    case "RESOLVED":
      break;
  }

  if (!candidate.fightAccessible) return "PUBLIC_ACCESS_FAILED";
  if (!Number.isFinite(candidate.keyLevel) || candidate.keyLevel <= 0) {
    return "KEY_LEVEL_UNRESOLVED";
  }
  // Timed must be explicitly true — false and null never consume a slot.
  if (candidate.timed === false) return "UNTIMED_RUN";
  if (candidate.timed == null) return "TIMED_STATE_UNKNOWN";
  if (candidate.fightDurationMs != null && candidate.fightDurationMs <= 0) {
    return "INVALID_DURATION";
  }
  // reportRevision is NOT required at plan time — freeze happens after acquisition.

  if (candidate.completedAt) {
    const completedMs = Date.parse(candidate.completedAt);
    const cutoffMs = Date.parse(scope.evidenceCutoffAt);
    if (Number.isFinite(completedMs) && Number.isFinite(cutoffMs) && completedMs > cutoffMs) {
      return "AFTER_CUTOFF";
    }
  }

  return null;
}

function rejectionSummary(
  identity: { reportCode: string; fightId: number },
  reason: CandidateRejectionReason,
  parts?: {
    reportRevision?: number | null;
    dungeonSlug?: string | null;
    detail?: string | null;
  },
): CandidateRejectionSummary {
  return {
    reportCode: identity.reportCode,
    fightId: identity.fightId,
    reportRevision: parts?.reportRevision ?? null,
    dungeonSlug: parts?.dungeonSlug ?? null,
    reason,
    detail: parts?.detail ?? null,
  };
}

function rejectionFromCandidate(
  candidate: EvidenceCandidateMetadataV2,
  reason: CandidateRejectionReason,
  detail: string | null = null,
): CandidateRejectionSummary {
  return rejectionSummary(candidate.discoveryIdentity, reason, {
    reportRevision: candidate.reportRevision,
    dungeonSlug: normalizeDungeonSlug(candidate.dungeonSlug),
    detail,
  });
}

function missingStateFromRejections(
  rejections: readonly CandidateRejectionSummary[],
): EvidenceSlotState {
  const reasons = new Set(rejections.map((r) => r.reason));
  if (reasons.has("HIDDEN_OR_PRIVATE") || reasons.has("PRIVATE_OR_HIDDEN")) {
    return "MISSING_PRIVATE_OR_HIDDEN";
  }
  if (reasons.has("ARCHIVED_OR_GATED") || reasons.has("PUBLIC_ACCESS_FAILED")) {
    return "MISSING_ARCHIVED_OR_GATED";
  }
  if (
    reasons.has("IDENTITY_UNRESOLVED") ||
    reasons.has("WRONG_SPEC") ||
    reasons.has("WRONG_SEASON") ||
    reasons.has("WRONG_DUNGEON")
  ) {
    return "MISSING_IDENTITY_UNRESOLVED";
  }
  if (
    reasons.has("SCHEMA_UNSUPPORTED") ||
    reasons.has("HARD_PROVIDER_ERROR") ||
    reasons.has("DATASET_INVALID") ||
    reasons.has("FACT_SET_INVALID")
  ) {
    return "MISSING_SCHEMA_UNSUPPORTED";
  }
  if (reasons.has("RATE_DEFERRED")) return "MISSING_RATE_DEFERRED";
  return "MISSING_NO_CANDIDATE";
}

function toAcquisitionRef(
  candidate: EvidenceCandidateMetadataV2,
  rank: number,
): EvidenceAcquisitionCandidateRef {
  return {
    discoveryIdentity: {
      reportCode: candidate.discoveryIdentity.reportCode,
      fightId: candidate.discoveryIdentity.fightId,
    },
    rank,
    keyLevel: candidate.keyLevel,
    timed: candidate.timed,
    runScore: candidate.runScore,
    evidenceCompleteness: candidate.evidenceCompleteness,
    completedAt: candidate.completedAt,
    actorId: candidate.actorId,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const child of Object.values(value as object)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

export function computeEvidenceCoverageV2(parts: {
  activeDungeonSlugs: readonly string[];
  slots: readonly EvidenceSlotV2[];
}): EvidenceCoverageV2 {
  const dungeonCount = parts.activeDungeonSlugs.length;
  const expectedSlotCount = expectedEvidenceSlotCount(dungeonCount);
  const selectedSlotCount = parts.slots.filter((s) => s.state === "SELECTED").length;
  const represented = new Set(
    parts.slots.filter((s) => s.state === "SELECTED").map((s) => s.dungeonSlug),
  );
  const dungeonsRepresented = represented.size;
  const slotFillRatio = expectedSlotCount === 0 ? 0 : selectedSlotCount / expectedSlotCount;
  const dungeonFillRatio = dungeonCount === 0 ? 0 : dungeonsRepresented / dungeonCount;

  let state: EvidenceCoverageState = "INSUFFICIENT";
  if (slotFillRatio >= 1 && dungeonFillRatio >= 1) state = "FULL";
  else if (slotFillRatio >= 0.75 && dungeonFillRatio >= 0.875) state = "STRONG";
  else if (slotFillRatio >= 0.5 && dungeonFillRatio >= 0.75) state = "PARTIAL";

  return {
    state,
    expectedSlotCount,
    selectedSlotCount,
    dungeonCount,
    dungeonsRepresented,
    slotFillRatio,
    dungeonFillRatio,
  };
}

export function buildEvidenceAcquisitionPlanContentHashInput(
  parts: Omit<EvidenceAcquisitionPlanContentHashInput, "schemaVersion"> & {
    schemaVersion?: typeof EVIDENCE_ACQUISITION_PLAN_SCHEMA_VERSION;
  },
): EvidenceAcquisitionPlanContentHashInput {
  return {
    schemaVersion: parts.schemaVersion ?? EVIDENCE_ACQUISITION_PLAN_SCHEMA_VERSION,
    selectorVersion: parts.selectorVersion,
    characterId: parts.characterId,
    seasonId: parts.seasonId,
    seasonSlug: parts.seasonSlug,
    classSlug: parts.classSlug ?? null,
    specSlug: parts.specSlug,
    role: parts.role,
    refreshContractHash: parts.refreshContractHash,
    evidenceCutoffAt: parts.evidenceCutoffAt,
    highKeyPolicyId: parts.highKeyPolicyId,
    activeDungeonSlugs: [...parts.activeDungeonSlugs],
    expectedSlotCount: parts.expectedSlotCount,
    slots: parts.slots.map((slot) => ({
      ...slot,
      orderedCandidates: slot.orderedCandidates.map((c) => ({
        ...c,
        discoveryIdentity: { ...c.discoveryIdentity },
      })),
    })),
    rejectedCandidates: parts.rejectedCandidates.map((r) => ({ ...r })),
  };
}

export function computeEvidenceAcquisitionPlanContentHash(
  input: EvidenceAcquisitionPlanContentHashInput,
): string {
  return createHash("sha256").update(stableStringify(input), "utf8").digest("hex");
}

export function buildEvidenceManifestContentHashInput(
  parts: Omit<EvidenceManifestContentHashInput, "schemaVersion"> & {
    schemaVersion?: typeof EVIDENCE_MANIFEST_SCHEMA_VERSION;
  },
): EvidenceManifestContentHashInput {
  return {
    schemaVersion: parts.schemaVersion ?? EVIDENCE_MANIFEST_SCHEMA_VERSION,
    selectorVersion: parts.selectorVersion,
    characterId: parts.characterId,
    seasonId: parts.seasonId,
    seasonSlug: parts.seasonSlug,
    classSlug: parts.classSlug ?? null,
    specSlug: parts.specSlug,
    role: parts.role,
    refreshContractHash: parts.refreshContractHash,
    evidenceCutoffAt: parts.evidenceCutoffAt,
    highKeyPolicyId: parts.highKeyPolicyId,
    activeDungeonSlugs: [...parts.activeDungeonSlugs],
    expectedSlotCount: parts.expectedSlotCount,
    selectedSlotCount: parts.selectedSlotCount,
    acquisitionPlanContentHash: parts.acquisitionPlanContentHash,
    slots: parts.slots.map((slot) => ({
      ...slot,
      dimensionValidity: slot.dimensionValidity
        ? { ...slot.dimensionValidity, reasons: [...slot.dimensionValidity.reasons] }
        : null,
      datasetHashes: slot.datasetHashes?.map((h) => ({ ...h })) ?? null,
    })),
    rejectedCandidates: parts.rejectedCandidates.map((r) => ({ ...r })),
    coverage: { ...parts.coverage },
  };
}

export function computeEvidenceManifestContentHash(
  input: EvidenceManifestContentHashInput,
): string {
  return createHash("sha256").update(stableStringify(input), "utf8").digest("hex");
}

export function deepFreezeEvidenceAcquisitionPlan(
  plan: EvidenceAcquisitionPlanV2,
): EvidenceAcquisitionPlanV2 {
  return deepFreeze(plan);
}

export function deepFreezeEvidenceManifest(
  manifest: CharacterSeasonEvidenceManifestV2,
): CharacterSeasonEvidenceManifestV2 {
  return deepFreeze(manifest);
}

/**
 * Pure WS02 acquisition policy: ordered candidates/fallbacks per desired slot.
 * Discovery identity only. Provider-free. Does NOT freeze a manifest.
 */
export function buildEvidenceAcquisitionPlanV2(
  input: BuildEvidenceAcquisitionPlanV2Input,
): BuildEvidenceAcquisitionPlanV2Result {
  const selectorVersion =
    input.selectorVersion ?? input.scope.selectorVersion ?? EVIDENCE_SELECTOR_VERSION;
  const maxRejected = input.maxRejectedSummaries ?? EVIDENCE_V2_MAX_REJECTED_SUMMARIES;
  const maxPerDungeon =
    input.maxCandidatesPerDungeon ?? EVIDENCE_PLAN_MAX_CANDIDATES_PER_DUNGEON;

  const activeDungeonSlugs = [
    ...new Set(
      input.scope.activeDungeonSlugs
        .map(normalizeDungeonSlug)
        .filter((slug): slug is string => slug.length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const activePool: ReadonlySet<string> = new Set(activeDungeonSlugs);
  const expectedSlotCount = expectedEvidenceSlotCount(activeDungeonSlugs.length);

  const rejected: CandidateRejectionSummary[] = [];
  const pushRejection = (summary: CandidateRejectionSummary) => {
    if (rejected.length < maxRejected) rejected.push(summary);
  };

  let candidatesEligible = 0;
  const slots: EvidenceAcquisitionSlotPlanV2[] = [];
  const usedReportFight = new Set<string>();
  const perDungeonDiagnostics: EvidenceSelectorDiagnosticsV2["perDungeon"] = [];

  for (const dungeonSlug of activeDungeonSlugs) {
    const dungeonCandidates = input.candidates.filter(
      (c) => normalizeDungeonSlug(c.dungeonSlug) === dungeonSlug,
    );

    const eligible: EvidenceCandidateMetadataV2[] = [];
    const dungeonRejections: CandidateRejectionSummary[] = [];

    for (const candidate of dungeonCandidates) {
      const reason = planEligibilityRejection(candidate, input.scope, activePool);
      if (reason) {
        const summary = rejectionFromCandidate(candidate, reason);
        pushRejection(summary);
        dungeonRejections.push(summary);
        continue;
      }
      const key = discoveryIdentityKey(candidate.discoveryIdentity);
      if (usedReportFight.has(key)) {
        const summary = rejectionFromCandidate(candidate, "DUPLICATE_REPORT_FIGHT");
        pushRejection(summary);
        dungeonRejections.push(summary);
        continue;
      }
      // Reserve identity across dungeons once accepted into any dungeon eligible set.
      usedReportFight.add(key);
      eligible.push(candidate);
    }

    candidatesEligible += eligible.length;
    const ordered = orderEvidenceCandidatesV2(eligible).slice(0, maxPerDungeon);

    for (const leftover of orderEvidenceCandidatesV2(eligible).slice(maxPerDungeon)) {
      pushRejection(rejectionFromCandidate(leftover, "NOT_SELECTED_CAPACITY"));
    }

    const provisionalMissing =
      ordered.length === 0
        ? dungeonCandidates.length === 0
          ? ("MISSING_NO_CANDIDATE" as const)
          : missingStateFromRejections(dungeonRejections)
        : null;

    const provisionalMissingStates: EvidenceSlotState[] = [];
    let plannedAttemptCount = 0;

    for (let i = 0; i < EVIDENCE_SLOTS_PER_DUNGEON; i++) {
      const slotIndex = i as 0 | 1;
      const slice = ordered.slice(slotIndex);
      const orderedCandidates = slice.map((candidate, rank) =>
        toAcquisitionRef(candidate, rank),
      );
      plannedAttemptCount += orderedCandidates.length;

      const slotMissing =
        orderedCandidates.length === 0 ? (provisionalMissing ?? "MISSING_NO_CANDIDATE") : null;
      if (slotMissing) provisionalMissingStates.push(slotMissing);

      slots.push({
        slotId: `${dungeonSlug}:${slotIndex}`,
        dungeonSlug,
        slotIndex,
        orderedCandidates,
        provisionalMissingState: slotMissing,
      });
    }

    perDungeonDiagnostics.push({
      dungeonSlug,
      eligibleCount: eligible.length,
      plannedAttemptCount,
      provisionalMissingStates,
    });
  }

  for (const candidate of input.candidates) {
    const slug = normalizeDungeonSlug(candidate.dungeonSlug);
    if (activePool.has(slug)) continue;
    pushRejection(rejectionFromCandidate(candidate, "OFF_POOL_DUNGEON"));
  }

  const rejectionReasonCounts: Record<string, number> = {};
  for (const summary of rejected) {
    rejectionReasonCounts[summary.reason] = (rejectionReasonCounts[summary.reason] ?? 0) + 1;
  }

  const diagnostics: EvidenceSelectorDiagnosticsV2 = {
    candidatesConsidered: input.candidates.length,
    candidatesEligible,
    candidatesRejected: rejected.length,
    rejectionReasonCounts,
    perDungeon: perDungeonDiagnostics,
  };

  const hashInput = buildEvidenceAcquisitionPlanContentHashInput({
    selectorVersion,
    characterId: input.scope.characterId,
    seasonId: input.scope.seasonId,
    seasonSlug: input.scope.seasonSlug,
    classSlug: input.scope.classSlug ?? null,
    specSlug: input.scope.specSlug,
    role: input.scope.role,
    refreshContractHash: input.scope.refreshContractHash,
    evidenceCutoffAt: input.scope.evidenceCutoffAt,
    highKeyPolicyId: input.scope.highKeyPolicyId,
    activeDungeonSlugs,
    expectedSlotCount,
    slots,
    rejectedCandidates: rejected,
  });

  const plan: EvidenceAcquisitionPlanV2 = {
    schemaVersion: EVIDENCE_ACQUISITION_PLAN_SCHEMA_VERSION,
    selectorVersion,
    characterId: input.scope.characterId,
    seasonId: input.scope.seasonId,
    seasonSlug: input.scope.seasonSlug,
    classSlug: input.scope.classSlug ?? null,
    specSlug: input.scope.specSlug,
    role: input.scope.role,
    refreshContractHash: input.scope.refreshContractHash,
    evidenceCutoffAt: input.scope.evidenceCutoffAt,
    highKeyPolicyId: input.scope.highKeyPolicyId,
    activeDungeonSlugs,
    expectedSlotCount,
    plannedAt: input.plannedAt,
    slots,
    rejectedCandidates: rejected,
    diagnostics,
    contentHash: computeEvidenceAcquisitionPlanContentHash(hashInput),
  };

  return { plan: deepFreezeEvidenceAcquisitionPlan(plan) };
}

function defaultDimensionValidity(
  completeness: number,
): DimensionValidity {
  const state =
    completeness >= 1 ? "VALID" : completeness > 0 ? "PARTIAL" : "INVALID";
  const reasons: string[] = [];
  if (state === "PARTIAL") reasons.push("EVIDENCE_INCOMPLETE");
  if (state === "INVALID") reasons.push("EVIDENCE_EMPTY");
  return {
    performance: state,
    survival: state,
    utility: state,
    reasons,
  };
}

function emptyMissingSlot(
  slotPlan: EvidenceAcquisitionSlotPlanV2,
  state: EvidenceSlotState,
): EvidenceSlotV2 {
  return {
    slotId: slotPlan.slotId,
    dungeonSlug: slotPlan.dungeonSlug,
    slotIndex: slotPlan.slotIndex,
    state,
    identity: null,
    keyLevel: null,
    timed: null,
    runScore: null,
    completedAt: null,
    actorId: null,
    dimensionValidity: null,
    selectedRank: null,
    fallbackReason: null,
    datasetHashes: null,
    factSetHash: null,
  };
}

function isUsableAcquisition(
  result: EvidenceCandidateAcquisitionResult | undefined,
): result is EvidenceCandidateAcquisitionResult & { reportRevision: number } {
  return (
    result != null &&
    result.acquisitionStatus === "ACQUIRED" &&
    result.reportRevision != null &&
    result.factSetHash != null &&
    !result.rejectionReason
  );
}

/**
 * Pure WS02 finalization after WS03 acquisition + dataset/fact-set validation.
 * Freezes EvidenceManifestV2 with reportRevision identities. Provider-free.
 */
export function finalizeEvidenceManifestV2(
  input: FinalizeEvidenceManifestV2Input,
): FinalizeEvidenceManifestV2Result {
  const maxRejected = input.maxRejectedSummaries ?? EVIDENCE_V2_MAX_REJECTED_SUMMARIES;
  const plan = input.plan;

  const resultsByKey = new Map<string, EvidenceCandidateAcquisitionResult>();
  for (const result of input.acquisitionResults) {
    resultsByKey.set(discoveryIdentityKey(result.discoveryIdentity), result);
  }

  const rejected: CandidateRejectionSummary[] = plan.rejectedCandidates.map((r) => ({ ...r }));
  const pushRejection = (summary: CandidateRejectionSummary) => {
    if (rejected.length < maxRejected) rejected.push(summary);
  };

  const usedReportFight = new Set<string>();
  const slots: EvidenceSlotV2[] = [];
  const perDungeonDiagnostics: EvidenceSelectorDiagnosticsV2["perDungeon"] = [];
  const dungeonStats = new Map<
    string,
    { eligibleCount: number; selectedCount: number; missingStates: EvidenceSlotState[] }
  >();

  for (const slotPlan of plan.slots) {
    const stats = dungeonStats.get(slotPlan.dungeonSlug) ?? {
      eligibleCount: slotPlan.orderedCandidates.length,
      selectedCount: 0,
      missingStates: [] as EvidenceSlotState[],
    };
    // eligibleCount on finalize ≈ planned attempts for slot0 (full list).
    if (slotPlan.slotIndex === 0) {
      stats.eligibleCount = slotPlan.orderedCandidates.length;
    }

    let selected: EvidenceSlotV2 | null = null;
    let fallbackReason: string | null = null;
    const attemptRejections: CandidateRejectionSummary[] = [];

    for (const attempt of slotPlan.orderedCandidates) {
      const key = discoveryIdentityKey(attempt.discoveryIdentity);
      if (usedReportFight.has(key)) {
        const summary = rejectionSummary(attempt.discoveryIdentity, "DUPLICATE_REPORT_FIGHT", {
          dungeonSlug: slotPlan.dungeonSlug,
          detail: `already selected for another slot`,
        });
        pushRejection(summary);
        attemptRejections.push(summary);
        if (attempt.rank === 0) fallbackReason = "DUPLICATE_REPORT_FIGHT";
        continue;
      }

      const result = resultsByKey.get(key);
      if (!result) {
        const summary = rejectionSummary(attempt.discoveryIdentity, "ACQUISITION_FAILED", {
          dungeonSlug: slotPlan.dungeonSlug,
          detail: "no acquisition result",
        });
        pushRejection(summary);
        attemptRejections.push(summary);
        if (attempt.rank === 0) fallbackReason = "ACQUISITION_FAILED";
        continue;
      }

      if (result.acquisitionStatus === "REJECTED" || result.rejectionReason) {
        const reason = result.rejectionReason ?? "ACQUISITION_FAILED";
        const summary = rejectionSummary(attempt.discoveryIdentity, reason, {
          reportRevision: result.reportRevision,
          dungeonSlug: slotPlan.dungeonSlug,
          detail: result.rejectionDetail,
        });
        pushRejection(summary);
        attemptRejections.push(summary);
        if (attempt.rank === 0) fallbackReason = reason;
        continue;
      }

      if (result.reportRevision == null) {
        const summary = rejectionSummary(
          attempt.discoveryIdentity,
          "MISSING_REPORT_REVISION",
          { dungeonSlug: slotPlan.dungeonSlug },
        );
        pushRejection(summary);
        attemptRejections.push(summary);
        if (attempt.rank === 0) fallbackReason = "MISSING_REPORT_REVISION";
        continue;
      }

      if (result.factSetHash == null) {
        const summary = rejectionSummary(attempt.discoveryIdentity, "FACT_SET_INVALID", {
          reportRevision: result.reportRevision,
          dungeonSlug: slotPlan.dungeonSlug,
          detail: "missing factSetHash",
        });
        pushRejection(summary);
        attemptRejections.push(summary);
        if (attempt.rank === 0) fallbackReason = "FACT_SET_INVALID";
        continue;
      }

      if (!isUsableAcquisition(result)) {
        const summary = rejectionSummary(attempt.discoveryIdentity, "ACQUISITION_FAILED", {
          reportRevision: result.reportRevision,
          dungeonSlug: slotPlan.dungeonSlug,
        });
        pushRejection(summary);
        attemptRejections.push(summary);
        if (attempt.rank === 0) fallbackReason = "ACQUISITION_FAILED";
        continue;
      }

      usedReportFight.add(key);
      const completeness =
        result.evidenceCompleteness ?? attempt.evidenceCompleteness ?? 1;
      selected = {
        slotId: slotPlan.slotId,
        dungeonSlug: slotPlan.dungeonSlug,
        slotIndex: slotPlan.slotIndex,
        state: "SELECTED",
        identity: {
          reportCode: attempt.discoveryIdentity.reportCode,
          fightId: attempt.discoveryIdentity.fightId,
          reportRevision: result.reportRevision,
        },
        keyLevel: result.keyLevel ?? attempt.keyLevel,
        timed: result.timed !== undefined ? result.timed : attempt.timed,
        runScore: result.runScore !== undefined ? result.runScore : attempt.runScore,
        completedAt:
          result.completedAt !== undefined ? result.completedAt : attempt.completedAt,
        actorId: result.actorId !== undefined ? result.actorId : attempt.actorId,
        dimensionValidity:
          result.dimensionValidity ?? defaultDimensionValidity(completeness),
        selectedRank: attempt.rank,
        fallbackReason: attempt.rank > 0 ? fallbackReason : null,
        datasetHashes: result.datasetHashes.map((h) => ({ ...h })),
        factSetHash: result.factSetHash,
      };
      break;
    }

    if (selected) {
      slots.push(selected);
      stats.selectedCount += 1;
    } else {
      const state =
        slotPlan.provisionalMissingState ??
        (slotPlan.orderedCandidates.length === 0
          ? "MISSING_NO_CANDIDATE"
          : missingStateFromRejections(attemptRejections));
      if (slotPlan.orderedCandidates.length > 0) {
        const head = slotPlan.orderedCandidates[0]!;
        pushRejection(
          rejectionSummary(head.discoveryIdentity, "FALLBACK_EXHAUSTED", {
            dungeonSlug: slotPlan.dungeonSlug,
            detail: `slot ${slotPlan.slotId}`,
          }),
        );
      }
      slots.push(emptyMissingSlot(slotPlan, state));
      stats.missingStates.push(state);
    }

    dungeonStats.set(slotPlan.dungeonSlug, stats);
  }

  for (const [dungeonSlug, stats] of [...dungeonStats.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    perDungeonDiagnostics.push({
      dungeonSlug,
      eligibleCount: stats.eligibleCount,
      plannedAttemptCount: stats.eligibleCount,
      provisionalMissingStates: stats.missingStates,
    });
  }

  const coverage = computeEvidenceCoverageV2({
    activeDungeonSlugs: plan.activeDungeonSlugs,
    slots,
  });

  const rejectionReasonCounts: Record<string, number> = {};
  for (const summary of rejected) {
    rejectionReasonCounts[summary.reason] = (rejectionReasonCounts[summary.reason] ?? 0) + 1;
  }

  const diagnostics: EvidenceSelectorDiagnosticsV2 = {
    candidatesConsidered: plan.diagnostics.candidatesConsidered,
    candidatesEligible: plan.diagnostics.candidatesEligible,
    candidatesRejected: rejected.length,
    rejectionReasonCounts,
    perDungeon: perDungeonDiagnostics,
  };

  const hashInput = buildEvidenceManifestContentHashInput({
    selectorVersion: plan.selectorVersion,
    characterId: plan.characterId,
    seasonId: plan.seasonId,
    seasonSlug: plan.seasonSlug,
    classSlug: plan.classSlug ?? null,
    specSlug: plan.specSlug,
    role: plan.role,
    refreshContractHash: plan.refreshContractHash,
    evidenceCutoffAt: plan.evidenceCutoffAt,
    highKeyPolicyId: plan.highKeyPolicyId,
    activeDungeonSlugs: plan.activeDungeonSlugs,
    expectedSlotCount: plan.expectedSlotCount,
    selectedSlotCount: coverage.selectedSlotCount,
    acquisitionPlanContentHash: plan.contentHash,
    slots,
    rejectedCandidates: rejected,
    coverage,
  });

  const manifest: CharacterSeasonEvidenceManifestV2 = {
    schemaVersion: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    selectorVersion: plan.selectorVersion,
    characterId: plan.characterId,
    seasonId: plan.seasonId,
    seasonSlug: plan.seasonSlug,
    classSlug: plan.classSlug ?? null,
    specSlug: plan.specSlug,
    role: plan.role,
    refreshContractHash: plan.refreshContractHash,
    evidenceCutoffAt: plan.evidenceCutoffAt,
    highKeyPolicyId: plan.highKeyPolicyId,
    activeDungeonSlugs: [...plan.activeDungeonSlugs],
    expectedSlotCount: plan.expectedSlotCount,
    selectedSlotCount: coverage.selectedSlotCount,
    selectedAt: input.selectedAt,
    acquisitionPlanContentHash: plan.contentHash,
    slots,
    rejectedCandidates: rejected,
    coverage,
    contentHash: computeEvidenceManifestContentHash(hashInput),
    diagnostics,
  };

  return { manifest: deepFreezeEvidenceManifest(manifest) };
}

/** Access-state → missing slot mapping helper for diagnostics consumers. */
export function evidenceAccessStateToMissingSlot(
  access: EvidenceAccessState,
): EvidenceSlotState | null {
  switch (access) {
    case "PRIVATE_OR_HIDDEN":
      return "MISSING_PRIVATE_OR_HIDDEN";
    case "ARCHIVED_OR_GATED":
      return "MISSING_ARCHIVED_OR_GATED";
    case "SCHEMA_UNSUPPORTED":
      return "MISSING_SCHEMA_UNSUPPORTED";
    case "RATE_DEFERRED":
      return "MISSING_RATE_DEFERRED";
    default:
      return null;
  }
}
