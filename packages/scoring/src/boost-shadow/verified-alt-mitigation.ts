import { clamp01 } from "../math.js";
import {
  VERIFIED_ALT_FRESHNESS_DAYS,
  VERIFIED_ALT_MARGIN_ONSET,
  VERIFIED_ALT_MARGIN_SATURATION,
} from "./constants.js";
import type {
  FeatureComputeResult,
  VerifiedOwnershipEvidenceInput,
} from "./types.js";

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Subject eligibility at calculation time T (Locked filters).
 * Uses verified Battle.net ownership only — never names/guilds/IPs/roster similarity.
 */
export function isEligibleVerifiedSubjectAtT(
  ownership: VerifiedOwnershipEvidenceInput,
  calculatedAtMs: number,
): boolean {
  if (ownership.status !== "CURRENT") return false;
  if (ownership.confidence !== "CONFIRMED") return false;
  if (!ownership.characterId) return false;
  if (!ownership.accountClaimed) return false;

  const verifiedAt = parseTime(ownership.verifiedAt);
  if (verifiedAt === null || verifiedAt > calculatedAtMs) return false;

  const revokedAt = parseTime(ownership.revokedAt);
  if (revokedAt !== null && revokedAt <= calculatedAtMs) return false;

  const unlinkedAt = parseTime(ownership.accountUnlinkedAt);
  if (unlinkedAt !== null && unlinkedAt <= calculatedAtMs) return false;

  return true;
}

/**
 * Candidate alt filters at T (Locked) — same BattleNet account, same region (V1).
 */
export function isEligibleVerifiedAltAtT(args: {
  alt: VerifiedOwnershipEvidenceInput;
  subject: VerifiedOwnershipEvidenceInput;
  calculatedAtMs: number;
  subjectSeasonId: string;
  allowCrossRegion?: boolean;
}): boolean {
  const { alt, subject, calculatedAtMs, subjectSeasonId } = args;
  if (!isEligibleVerifiedSubjectAtT(alt, calculatedAtMs)) return false;
  if (alt.characterId === subject.characterId) return false;
  if (alt.battleNetAccountId !== subject.battleNetAccountId) return false;
  if (!args.allowCrossRegion && alt.regionId !== subject.regionId) return false;

  if (alt.currentSeasonMythicSeasonId !== subjectSeasonId) return false;
  if (
    alt.currentSeasonMythicRating == null ||
    !(alt.currentSeasonMythicRating > 0)
  ) {
    return false;
  }

  const fetchedAt = parseTime(alt.currentSeasonMythicFetchedAt);
  if (fetchedAt === null || fetchedAt > calculatedAtMs) return false;

  const ageDays = (calculatedAtMs - fetchedAt) / (24 * 60 * 60 * 1000);
  if (ageDays > VERIFIED_ALT_FRESHNESS_DAYS) return false;

  return true;
}

function normalizeMargin(margin: number): number {
  if (margin <= VERIFIED_ALT_MARGIN_ONSET) return 0;
  return clamp01(
    (margin - VERIFIED_ALT_MARGIN_ONSET) /
      (VERIFIED_ALT_MARGIN_SATURATION - VERIFIED_ALT_MARGIN_ONSET),
  );
}

/**
 * Private verified-alt experience mitigation.
 * No verified subject → omit (never a penalty).
 * Never emits public reroll/account flags.
 */
export function computeVerifiedAltExperienceMitigation(args: {
  subjectCharacterId: string;
  regionId: string;
  seasonId: string;
  calculatedAt: string;
  ownershipEvidence: VerifiedOwnershipEvidenceInput[];
  /** Subject season Mythic+ at T for margin — not Trust Score. */
  subjectSeasonMythicRating?: number | null;
}): FeatureComputeResult {
  const calculatedAtMs = parseTime(args.calculatedAt);
  if (calculatedAtMs === null) {
    return { status: "omitted", reasonCode: "OWNERSHIP_NOT_VALID_AT_T" };
  }

  const subjectOwnership = args.ownershipEvidence.find(
    (o) =>
      o.characterId === args.subjectCharacterId &&
      isEligibleVerifiedSubjectAtT(o, calculatedAtMs),
  );

  if (!subjectOwnership) {
    // Distinguish never-linked vs linked-but-invalid-at-T.
    const anySubjectRecord = args.ownershipEvidence.some(
      (o) => o.characterId === args.subjectCharacterId,
    );
    return {
      status: "omitted",
      reasonCode: anySubjectRecord ? "OWNERSHIP_NOT_VALID_AT_T" : "NO_VERIFIED_SUBJECT",
      diagnostics: {
        verifiedAltMitigationPresent: false,
        verifiedAltScoreMargin: null,
      },
    };
  }

  // Reject userId-only linkage: alts must share battleNetAccountId with subject.
  const eligibleAlts = args.ownershipEvidence.filter((alt) =>
    isEligibleVerifiedAltAtT({
      alt,
      subject: subjectOwnership,
      calculatedAtMs,
      subjectSeasonId: args.seasonId,
      allowCrossRegion: false,
    }),
  );

  const subjectRating =
    args.subjectSeasonMythicRating ??
    subjectOwnership.currentSeasonMythicRating ??
    null;

  if (subjectRating == null || !(subjectRating > 0)) {
    return {
      status: "omitted",
      reasonCode: "NO_ELIGIBLE_ALT_EVIDENCE",
      diagnostics: {
        verifiedAltMitigationPresent: false,
        verifiedAltScoreMargin: null,
      },
    };
  }

  let bestMargin: number | null = null;
  let bestFreshness = 0;
  for (const alt of eligibleAlts) {
    const altRating = alt.currentSeasonMythicRating!;
    if (altRating < subjectRating) continue;
    const margin = altRating - subjectRating;
    const fetchedAt = parseTime(alt.currentSeasonMythicFetchedAt)!;
    const ageDays = (calculatedAtMs - fetchedAt) / (24 * 60 * 60 * 1000);
    const freshness = clamp01(1 - ageDays / VERIFIED_ALT_FRESHNESS_DAYS);
    if (bestMargin === null || margin > bestMargin) {
      bestMargin = margin;
      bestFreshness = freshness;
    }
  }

  if (bestMargin === null) {
    // Linked subject, ownership evidence present, no equal/higher eligible alt → value 0.
    return {
      status: "computed",
      evidence: {
        value: 0,
        confidence: 0.7,
        sampleSize: 1,
        coverage: 1,
      },
      diagnostics: {
        verifiedAltMitigationPresent: true,
        verifiedAltScoreMargin: 0,
      },
    };
  }

  const value = clamp01(normalizeMargin(bestMargin) * (0.7 + 0.3 * bestFreshness));
  return {
    status: "computed",
    evidence: {
      value,
      confidence: clamp01(0.65 + 0.35 * bestFreshness),
      sampleSize: eligibleAlts.length,
      coverage: 1,
    },
    diagnostics: {
      verifiedAltMitigationPresent: true,
      verifiedAltScoreMargin: bestMargin,
    },
  };
}
