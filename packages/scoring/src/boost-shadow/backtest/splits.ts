/**
 * Leakage-safe train / evaluation splits for boost-shadow Phase 2.
 * Prefer temporal + grouped evaluation over random row splitting.
 *
 * Split metadata is computed only from as-of filtered evidence so future runs
 * cannot influence latestRunAt, cohort fingerprints, duplicates, or coverage.
 */

import { createHash } from "node:crypto";
import type { BoostShadowCohortMemberV1 } from "./manifest.js";
import {
  filterMemberEvidenceAsOf,
  type BoostShadowMemberEvidenceV1,
} from "./evidence.js";
import type { BoostShadowExperimentParamsV1 } from "./experiment-params.js";
import type { BoostShadowSplitAssignmentV1, BoostShadowSplitName } from "./types.js";
import { resolveCanonicalTeammateIdentity } from "../identity.js";
import { selectHighKeySet } from "../high-key-policy.js";

function latestRunAt(evidence: BoostShadowMemberEvidenceV1 | null): string | null {
  if (!evidence) return null;
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const run of evidence.runs) {
    if (!run.completedAt) continue;
    const ms = Date.parse(run.completedAt);
    if (Number.isFinite(ms) && ms >= bestMs) {
      bestMs = ms;
      best = run.completedAt;
    }
  }
  return best;
}

/**
 * Stable fingerprint of recurring high-key teammates for leakage grouping.
 * Uses canonical teammate keys only (private).
 */
export function computeTeammateCohortFingerprint(
  evidence: BoostShadowMemberEvidenceV1 | null,
  seasonId: string,
): string | null {
  if (!evidence || evidence.runs.length === 0) return null;
  const highKey = selectHighKeySet(evidence.runs, seasonId);
  const counts = new Map<string, number>();
  for (const run of highKey.eligible) {
    for (const p of run.participants) {
      if (p.isTargetCharacter || p.characterId === evidence.characterId) continue;
      const identity = resolveCanonicalTeammateIdentity(p);
      if (identity.confidence === "ambiguous") continue;
      counts.set(identity.canonicalKey, (counts.get(identity.canonicalKey) ?? 0) + 1);
    }
  }
  const recurrent = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([key]) => key);
  if (recurrent.length === 0) return null;
  return createHash("sha256").update(recurrent.join("|")).digest("hex").slice(0, 16);
}

interface SplitCandidate {
  member: BoostShadowCohortMemberV1;
  /** Evidence filtered to the member's evaluationCutoff. */
  evidence: BoostShadowMemberEvidenceV1 | null;
  latestRunAt: string | null;
  cohortFp: string | null;
  evaluationCutoff: string;
}

/**
 * Assign leakage-safe splits using only as-of filtered evidence per member.
 */
export function assignLeakageSafeSplits(args: {
  members: BoostShadowCohortMemberV1[];
  evidenceByMemberId: Record<string, BoostShadowMemberEvidenceV1>;
  seasonId: string;
  params: BoostShadowExperimentParamsV1;
  /** Fallback cutoff when member.evaluationCutoff is omitted. */
  defaultEvaluationCutoff: string;
}): {
  assignments: BoostShadowSplitAssignmentV1[];
  duplicateRunIds: string[];
} {
  const candidates: SplitCandidate[] = args.members.map((member) => {
    const cutoff = member.evaluationCutoff ?? args.defaultEvaluationCutoff;
    const raw = args.evidenceByMemberId[member.memberId] ?? null;
    const filtered = raw ? filterMemberEvidenceAsOf(raw, cutoff) : null;
    return {
      member,
      evidence: filtered,
      latestRunAt: latestRunAt(filtered),
      cohortFp: computeTeammateCohortFingerprint(filtered, args.seasonId),
      evaluationCutoff: cutoff,
    };
  });

  // Duplicate run IDs — only among as-of-visible runs.
  const runOwner = new Map<string, string>();
  const duplicateRunIds: string[] = [];
  for (const c of candidates) {
    if (!c.evidence) continue;
    for (const run of c.evidence.runs) {
      const prior = runOwner.get(run.runId);
      if (prior && prior !== c.member.memberId) {
        duplicateRunIds.push(run.runId);
      } else {
        runOwner.set(run.runId, c.member.memberId);
      }
    }
  }
  const dupSet = new Set(duplicateRunIds);

  // Temporal sort on filtered latestRunAt.
  const ordered = [...candidates].sort((a, b) => {
    const aMs = a.latestRunAt ? Date.parse(a.latestRunAt) : 0;
    const bMs = b.latestRunAt ? Date.parse(b.latestRunAt) : 0;
    if (aMs !== bMs) return aMs - bMs;
    return a.member.memberId.localeCompare(b.member.memberId);
  });

  const holdout = Math.max(
    1,
    Math.min(
      ordered.length - 1,
      Math.round(ordered.length * args.params.temporalHoldoutFraction),
    ),
  );
  const evalStart = Math.max(0, ordered.length - holdout);

  const provisional = new Map<string, BoostShadowSplitName>();
  for (let i = 0; i < ordered.length; i++) {
    provisional.set(ordered[i]!.member.memberId, i >= evalStart ? "evaluation" : "train");
  }

  const byCohort = new Map<string, string[]>();
  for (const c of candidates) {
    if (!c.cohortFp) continue;
    const list = byCohort.get(c.cohortFp) ?? [];
    list.push(c.member.memberId);
    byCohort.set(c.cohortFp, list);
  }
  for (const memberIds of byCohort.values()) {
    if (memberIds.length < 2) continue;
    const splits = new Set(memberIds.map((id) => provisional.get(id)));
    if (splits.has("train") && splits.has("evaluation")) {
      for (const id of memberIds) {
        provisional.set(id, "evaluation");
      }
    }
  }

  const assignments: BoostShadowSplitAssignmentV1[] = candidates.map((c) => {
    let split = provisional.get(c.member.memberId) ?? "coverage_only";
    let exclusionReason: string | null = null;

    if (!c.evidence || c.evidence.runs.length === 0) {
      split = "coverage_only";
      exclusionReason = "NO_RUNS";
    } else if (c.evidence.runs.some((r) => dupSet.has(r.runId))) {
      split = "coverage_only";
      exclusionReason = "DUPLICATE_RUN_ACROSS_MEMBERS";
    }

    return {
      memberId: c.member.memberId,
      characterId: c.member.characterId,
      split,
      teammateCohortFingerprint: c.cohortFp,
      latestRunAt: c.latestRunAt,
      evaluationCutoff: c.evaluationCutoff,
      exclusionReason,
    };
  });

  assignments.sort((a, b) => a.memberId.localeCompare(b.memberId));

  return { assignments, duplicateRunIds: [...dupSet].sort() };
}

/** Assert no characterId appears in both train and evaluation. */
export function assertNoCharacterLeakage(assignments: BoostShadowSplitAssignmentV1[]): void {
  const train = new Set(
    assignments.filter((a) => a.split === "train").map((a) => a.characterId),
  );
  const evaluation = new Set(
    assignments.filter((a) => a.split === "evaluation").map((a) => a.characterId),
  );
  for (const id of train) {
    if (evaluation.has(id)) {
      throw new Error(`Character leakage across train/evaluation: ${id}`);
    }
  }
}

/** Assert no teammate cohort fingerprint crosses train and evaluation. */
export function assertNoCohortLeakage(assignments: BoostShadowSplitAssignmentV1[]): void {
  const train = new Set(
    assignments
      .filter((a) => a.split === "train" && a.teammateCohortFingerprint)
      .map((a) => a.teammateCohortFingerprint!),
  );
  const evaluation = new Set(
    assignments
      .filter((a) => a.split === "evaluation" && a.teammateCohortFingerprint)
      .map((a) => a.teammateCohortFingerprint!),
  );
  for (const fp of train) {
    if (evaluation.has(fp)) {
      throw new Error(`Teammate cohort leakage across train/evaluation: ${fp}`);
    }
  }
}
