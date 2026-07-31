import type {
  BoostShadowRatingSnapshotInput,
  BoostShadowRunInput,
  BoostShadowRunParticipantInput,
  TimeAlignedRating,
} from "./types.js";
import { resolveCanonicalTeammateIdentity } from "./identity.js";

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Time-aligned Mythic+ rating for a participant on a run.
 * Forbidden: current-season rating substituted as historical at-run evidence.
 * Snapshots after the run are rejected.
 */
export function resolveTimeAlignedRating(args: {
  participant: BoostShadowRunParticipantInput;
  run: BoostShadowRunInput;
  ratingSnapshots?: BoostShadowRatingSnapshotInput[];
  seasonId: string;
}): TimeAlignedRating | null {
  const { participant, run, ratingSnapshots, seasonId } = args;
  const runAt = parseTime(run.completedAt);
  if (runAt === null) return null;

  if (
    participant.mythicRatingAtRun != null &&
    Number.isFinite(participant.mythicRatingAtRun) &&
    participant.mythicRatingAtRun > 0
  ) {
    return {
      rating: participant.mythicRatingAtRun,
      source: "run_participant",
      capturedAt: run.completedAt!,
    };
  }

  const identity = resolveCanonicalTeammateIdentity(participant);
  const explicit = run.explicitAlignedRatings?.[identity.canonicalKey];
  if (explicit && Number.isFinite(explicit.rating) && explicit.rating > 0) {
    const explicitAt = parseTime(explicit.capturedAt);
    if (explicitAt !== null && explicitAt <= runAt) {
      return {
        rating: explicit.rating,
        source: "explicit_time_aligned",
        capturedAt: explicit.capturedAt,
      };
    }
  }

  if (!participant.characterId || !ratingSnapshots?.length) return null;

  let best: BoostShadowRatingSnapshotInput | null = null;
  let bestAt = -Infinity;
  for (const snap of ratingSnapshots) {
    if (snap.characterId !== participant.characterId) continue;
    if (snap.seasonId != null && snap.seasonId !== seasonId) continue;
    if (!(snap.mythicRating > 0)) continue;
    const capturedAt = parseTime(snap.capturedAt);
    if (capturedAt === null || capturedAt > runAt) continue;
    if (capturedAt >= bestAt) {
      best = snap;
      bestAt = capturedAt;
    }
  }

  if (!best) return null;
  return {
    rating: best.mythicRating,
    source: "snapshot_at_or_before",
    capturedAt: best.capturedAt,
  };
}

export interface AlignedRunGap {
  runId: string;
  subjectRating: number;
  teammateGaps: Array<{
    canonicalKey: string;
    identityConfidence: string;
    teammateRating: number;
    gap: number;
  }>;
  /** Mean of positive teammate gaps on this run (stronger teammates). */
  meanPositiveGap: number | null;
}

/**
 * Build per-run time-aligned gaps. Runs without subject aligned rating are omitted.
 */
export function buildAlignedRunGaps(args: {
  runs: BoostShadowRunInput[];
  subjectCharacterId: string;
  seasonId: string;
  ratingSnapshots?: BoostShadowRatingSnapshotInput[];
}): { gaps: AlignedRunGap[]; runsMissingSubjectRating: number } {
  const gaps: AlignedRunGap[] = [];
  let runsMissingSubjectRating = 0;

  for (const run of args.runs) {
    const subject = run.participants.find(
      (p) => p.isTargetCharacter || p.characterId === args.subjectCharacterId,
    );
    if (!subject) {
      runsMissingSubjectRating += 1;
      continue;
    }

    const subjectAligned = resolveTimeAlignedRating({
      participant: subject,
      run,
      ratingSnapshots: args.ratingSnapshots,
      seasonId: args.seasonId,
    });
    if (!subjectAligned) {
      runsMissingSubjectRating += 1;
      continue;
    }

    const teammateGaps: AlignedRunGap["teammateGaps"] = [];
    for (const participant of run.participants) {
      if (participant.isTargetCharacter || participant.characterId === args.subjectCharacterId) {
        continue;
      }
      const identity = resolveCanonicalTeammateIdentity(participant);
      if (identity.confidence === "ambiguous") continue;

      const teammateAligned = resolveTimeAlignedRating({
        participant,
        run,
        ratingSnapshots: args.ratingSnapshots,
        seasonId: args.seasonId,
      });
      if (!teammateAligned) continue;

      teammateGaps.push({
        canonicalKey: identity.canonicalKey,
        identityConfidence: identity.confidence,
        teammateRating: teammateAligned.rating,
        gap: teammateAligned.rating - subjectAligned.rating,
      });
    }

    const positive = teammateGaps.map((g) => g.gap).filter((g) => g > 0);
    const meanPositiveGap =
      positive.length > 0 ? positive.reduce((a, b) => a + b, 0) / positive.length : null;

    gaps.push({
      runId: run.runId,
      subjectRating: subjectAligned.rating,
      teammateGaps,
      meanPositiveGap,
    });
  }

  return { gaps, runsMissingSubjectRating };
}
