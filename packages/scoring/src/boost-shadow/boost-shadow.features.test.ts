import { describe, expect, it } from "vitest";
import {
  BOOST_EXTRACTOR_VERSION,
  BOOST_FEATURE_SCHEMA_VERSION,
  BOOST_SHADOW_ISOLATION,
  HIGH_KEY_POLICY_VERSION,
  buildOfflineEvaluation,
  extractBoostFeatureFactsV1,
  fixtureEstablishedFarmer,
  fixtureMissingSubjectAlignedRating,
  fixtureRapidProgression,
  fixtureRejectFutureSnapshot,
  fixtureStableTeam,
  fixtureStrongerCohort,
  isOmittedNotZero,
  resolveTimeAlignedRating,
  selectHighKeySet,
} from "./index.js";

describe("boost-shadow feature extractors", () => {
  it("uses shared high-key policy version across facts", () => {
    const facts = extractBoostFeatureFactsV1(fixtureStrongerCohort());
    expect(facts.schemaVersion).toBe(BOOST_FEATURE_SCHEMA_VERSION);
    expect(facts.extractorVersion).toBe(BOOST_EXTRACTOR_VERSION);
    expect(facts.highKeyPolicyVersion).toBe(HIGH_KEY_POLICY_VERSION);
    expect(facts.highKeySet.runsEligible).toBeGreaterThanOrEqual(3);
  });

  it("progressionVelocity rises for rapid difficulty climb, not farm volume", () => {
    const rapid = extractBoostFeatureFactsV1(fixtureRapidProgression());
    const farmer = extractBoostFeatureFactsV1(fixtureEstablishedFarmer());

    expect(rapid.features.progressionVelocity).toBeDefined();
    expect(farmer.features.progressionVelocity).toBeDefined();
    expect(rapid.features.progressionVelocity!.value).toBeGreaterThan(
      farmer.features.progressionVelocity!.value,
    );
    expect(farmer.diagnostics?.topKeyRunCount).toBeGreaterThan(
      rapid.diagnostics?.topKeyRunCount ?? 0,
    );
  });

  it("teammateScoreGap uses time-aligned evidence and rejects current-score substitution", () => {
    const strong = extractBoostFeatureFactsV1(fixtureStrongerCohort());
    const stable = extractBoostFeatureFactsV1(fixtureStableTeam());
    expect(strong.features.teammateScoreGap).toBeDefined();
    expect(stable.features.teammateScoreGap).toBeDefined();
    expect(strong.features.teammateScoreGap!.value).toBeGreaterThan(
      stable.features.teammateScoreGap!.value,
    );
    expect(strong.diagnostics?.meanAlignedTeammateGap).toBeGreaterThan(500);
  });

  it("omits teammateScoreGap when subject aligned rating is missing (never zero)", () => {
    const facts = extractBoostFeatureFactsV1(fixtureMissingSubjectAlignedRating());
    expect(isOmittedNotZero(facts, "teammateScoreGap")).toBe(true);
    expect(facts.features.teammateScoreGap).toBeUndefined();
    expect(facts.missing.some((m) => m.featureKey === "teammateScoreGap")).toBe(true);
  });

  it("rejects rating snapshots captured after the run", () => {
    const { input } = fixtureRejectFutureSnapshot();
    const run = input.runs[0]!;
    const subject = run.participants.find((p) => p.isTargetCharacter)!;
    const aligned = resolveTimeAlignedRating({
      participant: subject,
      run,
      ratingSnapshots: input.ratingSnapshots,
      seasonId: input.seasonId,
    });
    expect(aligned).toBeNull();

    const facts = extractBoostFeatureFactsV1(input);
    expect(facts.features.teammateScoreGap).toBeUndefined();
  });

  it("repeatedStrongerTeammateCohort is high for stronger fixed helpers", () => {
    const strong = extractBoostFeatureFactsV1(fixtureStrongerCohort());
    const stable = extractBoostFeatureFactsV1(fixtureStableTeam());
    expect(strong.features.repeatedStrongerTeammateCohort).toBeDefined();
    expect(strong.features.repeatedStrongerTeammateCohort!.value).toBeGreaterThan(0.5);
    expect(stable.features.repeatedStrongerTeammateCohort!.value).toBe(0);
  });

  it("highKeyGroupConcentration is high for both stable and stronger fixed groups", () => {
    const strong = extractBoostFeatureFactsV1(fixtureStrongerCohort());
    const stable = extractBoostFeatureFactsV1(fixtureStableTeam());
    expect(strong.features.highKeyGroupConcentration!.value).toBeGreaterThan(0.5);
    expect(stable.features.highKeyGroupConcentration!.value).toBeGreaterThan(0.5);
  });

  it("selectHighKeySet excludes season mismatches and undated runs", () => {
    const input = fixtureStrongerCohort();
    input.runs.push({
      runId: "other-season",
      seasonId: "other",
      keyLevel: 20,
      timed: true,
      completedAt: "2026-07-01T00:00:00.000Z",
      participants: input.runs[0]!.participants,
    });
    input.runs.push({
      runId: "undated",
      seasonId: input.seasonId,
      keyLevel: 20,
      timed: true,
      completedAt: null,
      participants: input.runs[0]!.participants,
    });
    const set = selectHighKeySet(input.runs, input.seasonId);
    expect(set.exclusionReasonCounts.SEASON_MISMATCH).toBe(1);
    expect(set.exclusionReasonCounts.MISSING_COMPLETED_AT).toBe(1);
  });

  it("builds offline evaluation without production authenticity write-back", () => {
    const facts = extractBoostFeatureFactsV1(fixtureStrongerCohort());
    const evalOut = buildOfflineEvaluation(facts);
    expect(evalOut.evaluationKind).toBe("boost_shadow_offline_v1");
    expect(evalOut.productionAuthenticityCompare).toBeNull();
    expect(evalOut.isolation).toEqual(BOOST_SHADOW_ISOLATION);
    expect(evalOut.summary.computedFeatureCount).toBeGreaterThan(0);
  });
});
