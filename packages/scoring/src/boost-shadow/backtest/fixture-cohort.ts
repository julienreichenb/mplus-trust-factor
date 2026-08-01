/**
 * Synthetic fixture cohort for Phase 2 — synthetic IDs only, no real player identities.
 */

import {
  fixtureEstablishedFarmer,
  fixtureMissingSubjectAlignedRating,
  fixtureRapidProgression,
  fixtureRejectFutureSnapshot,
  fixtureStableTeam,
  fixtureStrongerCohort,
  FIXTURE_IDS,
} from "../fixtures.js";
import { HIGH_KEY_POLICY_VERSION } from "../constants.js";
import type { BoostShadowMemberEvidenceV1, BoostShadowEvidenceBundleV1 } from "./evidence.js";
import {
  BOOST_SHADOW_COHORT_MANIFEST_SCHEMA,
  type BoostShadowCohortManifestV1,
} from "./manifest.js";
import {
  BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA,
  type ResearchLabelV1,
} from "./types.js";

const GENERATED_AT = "2026-07-15T12:00:00.000Z";

function syntheticLabel(
  cls: ResearchLabelV1["class"],
  source: string,
  confidence: number,
): ResearchLabelV1 {
  return {
    class: cls,
    source,
    confidence,
    labeledAt: "2026-07-10T00:00:00.000Z",
    policyVersion: "label-policy-fixture-v1",
    reviewerCount: cls === "synthetic_fixture" ? null : 2,
  };
}

function evidenceFromFixture(
  memberId: string,
  characterId: string,
  input: ReturnType<typeof fixtureStrongerCohort>,
  authenticity?: BoostShadowMemberEvidenceV1["productionAuthenticity"],
): BoostShadowMemberEvidenceV1 {
  return {
    memberId,
    characterId,
    seasonId: input.seasonId,
    regionId: input.regionId,
    runs: input.runs.map((r) => ({
      ...r,
      // Strip display names from fixture participants for private-safe fixtures.
      participants: r.participants.map((p) => ({
        characterId: p.characterId,
        providerCharacterKey: p.providerCharacterKey ?? null,
        regionCode: p.regionCode,
        realmSlug: "fixture-realm",
        isTargetCharacter: p.isTargetCharacter,
        mythicRatingAtRun: p.mythicRatingAtRun,
      })),
    })),
    ratingSnapshots: input.ratingSnapshots,
    productionAuthenticity: authenticity ?? {
      authenticityScore: null,
      boostSuspected: null,
      atypicalProgression: null,
      redFlagKeys: [],
      snapshotId: null,
      calculatedAt: null,
      source: "none",
    },
  };
}

/** Remap fixture subject id so each cohort member has a unique characterId. */
function remapSubject(
  input: ReturnType<typeof fixtureStrongerCohort>,
  characterId: string,
): ReturnType<typeof fixtureStrongerCohort> {
  return {
    ...input,
    subjectCharacterId: characterId,
    runs: input.runs.map((run) => ({
      ...run,
      runId: `${characterId}:${run.runId}`,
      participants: run.participants.map((p) =>
        p.isTargetCharacter || p.characterId === FIXTURE_IDS.SUBJECT
          ? { ...p, characterId }
          : p,
      ),
    })),
    ratingSnapshots: (input.ratingSnapshots ?? []).map((s) =>
      s.characterId === FIXTURE_IDS.SUBJECT ? { ...s, characterId } : s,
    ),
  };
}

export function buildPhase2FixtureBundle(): BoostShadowEvidenceBundleV1 {
  const stronger = remapSubject(fixtureStrongerCohort(), "char-synth-stronger");
  const stable = remapSubject(fixtureStableTeam(), "char-synth-stable");
  const rapid = remapSubject(fixtureRapidProgression(), "char-synth-rapid");
  const farmer = remapSubject(fixtureEstablishedFarmer(), "char-synth-farmer");
  const missing = remapSubject(
    fixtureMissingSubjectAlignedRating(),
    "char-synth-missing-rating",
  );
  const future = fixtureRejectFutureSnapshot();
  const futureRemapped = remapSubject(future.input, "char-synth-future-snap");

  const unlabeled = remapSubject(fixtureStableTeam(), "char-synth-unlabeled");
  // Shift unlabeled later in time for temporal holdout
  unlabeled.runs = unlabeled.runs.map((r, i) => ({
    ...r,
    completedAt: `2026-07-${String(20 + i).padStart(2, "0")}T10:00:00.000Z`,
  }));

  const members = [
    {
      memberId: "m-stronger",
      characterId: "char-synth-stronger",
      role: "DPS" as const,
      keyBand: "high",
      label: syntheticLabel("synthetic_fixture", "synthetic_suspicious_cohort", 1),
      evaluationCutoff: GENERATED_AT,
    },
    {
      memberId: "m-stable",
      characterId: "char-synth-stable",
      role: "TANK" as const,
      keyBand: "high",
      label: syntheticLabel("synthetic_fixture", "synthetic_legitimate_team", 1),
      evaluationCutoff: GENERATED_AT,
    },
    {
      memberId: "m-rapid",
      characterId: "char-synth-rapid",
      role: "HEALER" as const,
      keyBand: "mid",
      label: syntheticLabel("suspicious_consensus", "reviewer_consensus", 0.85),
      evaluationCutoff: GENERATED_AT,
    },
    {
      memberId: "m-farmer",
      characterId: "char-synth-farmer",
      role: "DPS" as const,
      keyBand: "high",
      label: syntheticLabel("legitimate_consensus", "reviewer_consensus", 0.9),
      evaluationCutoff: GENERATED_AT,
    },
    {
      memberId: "m-missing",
      characterId: "char-synth-missing-rating",
      role: "DPS" as const,
      keyBand: "high",
      label: {
        class: "unlabeled" as const,
        source: "none",
        confidence: null,
        labeledAt: null,
        policyVersion: "label-policy-fixture-v1",
        reviewerCount: null,
      },
      evaluationCutoff: GENERATED_AT,
    },
    {
      memberId: "m-future",
      characterId: "char-synth-future-snap",
      role: "DPS" as const,
      keyBand: "high",
      label: {
        class: "uncertain" as const,
        source: "reviewer_disagreement",
        confidence: 0.4,
        labeledAt: "2026-07-10T00:00:00.000Z",
        policyVersion: "label-policy-fixture-v1",
        reviewerCount: 2,
      },
      evaluationCutoff: "2026-07-05T00:00:00.000Z",
    },
    {
      memberId: "m-unlabeled-late",
      characterId: "char-synth-unlabeled",
      role: "HEALER" as const,
      keyBand: "mid",
      label: {
        class: "unlabeled" as const,
        source: "none",
        confidence: null,
        labeledAt: null,
        policyVersion: "label-policy-fixture-v1",
        reviewerCount: null,
      },
      evaluationCutoff: GENERATED_AT,
    },
  ];

  const manifest: BoostShadowCohortManifestV1 = {
    schemaVersion: BOOST_SHADOW_COHORT_MANIFEST_SCHEMA,
    cohortId: "fixture-boost-shadow-phase2-v1",
    description: "Synthetic Phase 2 backtest cohort (no real player identities)",
    createdAt: GENERATED_AT,
    highKeyPolicyVersion: HIGH_KEY_POLICY_VERSION,
    seasonId: FIXTURE_IDS.SEASON,
    members,
    notes: "Fixture-only. Do not treat experimental classifier as product output.",
  };

  const evidenceByMemberId: Record<string, BoostShadowMemberEvidenceV1> = {
    "m-stronger": evidenceFromFixture("m-stronger", "char-synth-stronger", stronger, {
      authenticityScore: 35,
      boostSuspected: true,
      atypicalProgression: false,
      redFlagKeys: ["boost_suspected"],
      snapshotId: "snap-synth-1",
      calculatedAt: GENERATED_AT,
      source: "bundle",
    }),
    "m-stable": evidenceFromFixture("m-stable", "char-synth-stable", stable, {
      authenticityScore: 88,
      boostSuspected: false,
      atypicalProgression: false,
      redFlagKeys: [],
      snapshotId: "snap-synth-2",
      calculatedAt: GENERATED_AT,
      source: "bundle",
    }),
    "m-rapid": evidenceFromFixture("m-rapid", "char-synth-rapid", rapid),
    "m-farmer": evidenceFromFixture("m-farmer", "char-synth-farmer", farmer),
    "m-missing": evidenceFromFixture("m-missing", "char-synth-missing-rating", missing),
    "m-future": evidenceFromFixture("m-future", "char-synth-future-snap", futureRemapped),
    "m-unlabeled-late": evidenceFromFixture(
      "m-unlabeled-late",
      "char-synth-unlabeled",
      unlabeled,
    ),
  };

  return {
    schemaVersion: BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA,
    manifest,
    evidenceByMemberId,
    generatedAt: GENERATED_AT,
    source: "fixture",
  };
}

export const PHASE2_FIXTURE_GENERATED_AT = GENERATED_AT;
