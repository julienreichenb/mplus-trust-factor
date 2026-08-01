/**
 * Regression tests for temporal / cross-season leakage in Phase 2 backtest.
 */
import { describe, expect, it } from "vitest";
import {
  HIGH_KEY_POLICY_VERSION,
  extractBoostFeatureFactsV1,
  resolveTimeAlignedRating,
} from "../index.js";
import {
  assignLeakageSafeSplits,
  buildBacktestArtifacts,
  buildPhase2FixtureBundle,
  computeTeammateCohortFingerprint,
  createMutationGuard,
  filterMemberEvidenceAsOf,
  mapPersistedCharacterSnapshotsToSeasonBound,
  mergeExperimentParams,
  runBoostShadowBacktest,
  runBoostShadowBacktestFromBundle,
  validateBoostShadowEvidenceBundle,
  type BoostShadowMemberEvidenceV1,
} from "./index.js";

const SEASON = "season-eval-1";
const CUTOFF = "2026-07-10T12:00:00.000Z";
const SEASON_START = "2026-07-01T00:00:00.000Z";
const SEASON_END = "2026-07-31T23:59:59.000Z";

function baseRun(overrides: Partial<BoostShadowMemberEvidenceV1["runs"][number]> & {
  runId: string;
  completedAt: string;
}): BoostShadowMemberEvidenceV1["runs"][number] {
  return {
    seasonId: SEASON,
    keyLevel: 14,
    timed: true,
    scoreValue: 1400,
    source: "fixture",
    participants: [
      {
        characterId: "char-a",
        regionCode: "eu",
        realmSlug: "fixture-realm",
        isTargetCharacter: true,
        mythicRatingAtRun: 2100,
      },
      {
        characterId: "char-tm-1",
        regionCode: "eu",
        realmSlug: "fixture-realm",
        isTargetCharacter: false,
        mythicRatingAtRun: 3200,
      },
      {
        characterId: "char-tm-2",
        regionCode: "eu",
        realmSlug: "fixture-realm",
        isTargetCharacter: false,
        mythicRatingAtRun: 3150,
      },
      {
        characterId: "char-tm-3",
        regionCode: "eu",
        realmSlug: "fixture-realm",
        isTargetCharacter: false,
        mythicRatingAtRun: 3100,
      },
      {
        characterId: "char-tm-4",
        regionCode: "eu",
        realmSlug: "fixture-realm",
        isTargetCharacter: false,
        mythicRatingAtRun: 3050,
      },
    ],
    ...overrides,
  };
}

function memberEvidence(
  memberId: string,
  characterId: string,
  extras: Partial<BoostShadowMemberEvidenceV1> = {},
): BoostShadowMemberEvidenceV1 {
  return {
    memberId,
    characterId,
    seasonId: SEASON,
    regionId: "region-eu",
    runs: [
      baseRun({
        runId: `${characterId}:r1`,
        completedAt: "2026-07-05T10:00:00.000Z",
        participants: baseRun({ runId: "x", completedAt: "2026-07-05T10:00:00.000Z" }).participants.map(
          (p) =>
            p.isTargetCharacter
              ? { ...p, characterId }
              : p,
        ),
      }),
      baseRun({
        runId: `${characterId}:r2`,
        completedAt: "2026-07-08T10:00:00.000Z",
        keyLevel: 15,
        participants: baseRun({ runId: "x", completedAt: "2026-07-08T10:00:00.000Z" }).participants.map(
          (p) =>
            p.isTargetCharacter
              ? { ...p, characterId }
              : p,
        ),
      }),
      baseRun({
        runId: `${characterId}:r3`,
        completedAt: "2026-07-09T10:00:00.000Z",
        keyLevel: 16,
        participants: baseRun({ runId: "x", completedAt: "2026-07-09T10:00:00.000Z" }).participants.map(
          (p) =>
            p.isTargetCharacter
              ? { ...p, characterId }
              : p,
        ),
      }),
    ],
    ...extras,
  };
}

describe("boost-shadow Phase 2 leakage regressions", () => {
  it("1. excludes CharacterSnapshot before season start", () => {
    const mapped = mapPersistedCharacterSnapshotsToSeasonBound({
      snapshots: [
        {
          characterId: "char-a",
          mythicRating: 2500,
          capturedAt: "2026-06-15T00:00:00.000Z",
        },
      ],
      seasonBounds: { seasonId: SEASON, startsAt: SEASON_START, endsAt: SEASON_END },
      evaluationCutoff: CUTOFF,
    });
    expect(mapped).toEqual([]);
  });

  it("2. excludes CharacterSnapshot after season end", () => {
    const mapped = mapPersistedCharacterSnapshotsToSeasonBound({
      snapshots: [
        {
          characterId: "char-a",
          mythicRating: 2500,
          capturedAt: "2026-08-05T00:00:00.000Z",
        },
      ],
      seasonBounds: { seasonId: SEASON, startsAt: SEASON_START, endsAt: SEASON_END },
      evaluationCutoff: "2026-08-15T00:00:00.000Z",
    });
    expect(mapped).toEqual([]);
  });

  it("3. excludes CharacterSnapshot after evaluationCutoff", () => {
    const mapped = mapPersistedCharacterSnapshotsToSeasonBound({
      snapshots: [
        {
          characterId: "char-a",
          mythicRating: 2500,
          capturedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      seasonBounds: { seasonId: SEASON, startsAt: SEASON_START, endsAt: SEASON_END },
      evaluationCutoff: CUTOFF,
    });
    expect(mapped).toEqual([]);
  });

  it("4. omits snapshot fallback when season startsAt is missing", () => {
    const mapped = mapPersistedCharacterSnapshotsToSeasonBound({
      snapshots: [
        {
          characterId: "char-a",
          mythicRating: 2500,
          capturedAt: "2026-07-05T00:00:00.000Z",
        },
      ],
      seasonBounds: { seasonId: SEASON, startsAt: null, endsAt: SEASON_END },
      evaluationCutoff: CUTOFF,
    });
    expect(mapped).toEqual([]);
  });

  it("5. never assigns a snapshot to a season solely because the manifest names that season", () => {
    // Without valid startsAt, even in-window timestamps are omitted — no silent attribution.
    const mapped = mapPersistedCharacterSnapshotsToSeasonBound({
      snapshots: [
        {
          characterId: "char-a",
          mythicRating: 2500,
          capturedAt: "2026-07-05T00:00:00.000Z",
        },
      ],
      seasonBounds: { seasonId: "other-season", startsAt: null, endsAt: null },
      evaluationCutoff: CUTOFF,
    });
    expect(mapped).toEqual([]);

    // With bounds, seasonId is attached only after window check.
    const ok = mapPersistedCharacterSnapshotsToSeasonBound({
      snapshots: [
        {
          characterId: "char-a",
          mythicRating: 2500,
          capturedAt: "2026-07-05T00:00:00.000Z",
        },
      ],
      seasonBounds: { seasonId: SEASON, startsAt: SEASON_START, endsAt: SEASON_END },
      evaluationCutoff: CUTOFF,
    });
    expect(ok).toHaveLength(1);
    expect(ok[0]!.seasonId).toBe(SEASON);
  });

  it("6. prefers RunParticipant.mythicRatingAtRun over snapshot", () => {
    const run = baseRun({
      runId: "r-pref",
      completedAt: "2026-07-05T10:00:00.000Z",
      participants: [
        {
          characterId: "char-a",
          regionCode: "eu",
          realmSlug: "fixture-realm",
          isTargetCharacter: true,
          mythicRatingAtRun: 2111,
        },
      ],
    });
    const aligned = resolveTimeAlignedRating({
      participant: run.participants[0]!,
      run,
      seasonId: SEASON,
      ratingSnapshots: [
        {
          characterId: "char-a",
          mythicRating: 9999,
          capturedAt: "2026-07-04T00:00:00.000Z",
          seasonId: SEASON,
        },
      ],
    });
    expect(aligned?.source).toBe("run_participant");
    expect(aligned?.rating).toBe(2111);
  });

  it("7. future run does not change latestRunAt for split assignment", () => {
    const params = mergeExperimentParams({ temporalHoldoutFraction: 0.5 });
    const evidence = memberEvidence("m1", "char-a", {
      runs: [
        ...memberEvidence("m1", "char-a").runs,
        baseRun({
          runId: "char-a:future",
          completedAt: "2026-07-20T10:00:00.000Z",
          participants: memberEvidence("m1", "char-a").runs[0]!.participants,
        }),
      ],
    });
    const other = memberEvidence("m2", "char-b");
    const { assignments } = assignLeakageSafeSplits({
      members: [
        {
          memberId: "m1",
          characterId: "char-a",
          evaluationCutoff: CUTOFF,
          label: {
            class: "unlabeled",
            source: "none",
            confidence: null,
            labeledAt: null,
            policyVersion: "t",
            reviewerCount: null,
          },
        },
        {
          memberId: "m2",
          characterId: "char-b",
          evaluationCutoff: CUTOFF,
          label: {
            class: "unlabeled",
            source: "none",
            confidence: null,
            labeledAt: null,
            policyVersion: "t",
            reviewerCount: null,
          },
        },
      ],
      evidenceByMemberId: { m1: evidence, m2: other },
      seasonId: SEASON,
      params,
      defaultEvaluationCutoff: CUTOFF,
    });
    const a = assignments.find((x) => x.memberId === "m1")!;
    expect(a.latestRunAt).toBe("2026-07-09T10:00:00.000Z");
    expect(Date.parse(a.latestRunAt!)).toBeLessThanOrEqual(Date.parse(CUTOFF));
  });

  it("8. future run does not change teammate cohort fingerprint", () => {
    const before = memberEvidence("m1", "char-a");
    const withFuture = {
      ...before,
      runs: [
        ...before.runs,
        baseRun({
          runId: "char-a:future-new-team",
          completedAt: "2026-07-25T10:00:00.000Z",
          participants: [
            {
              characterId: "char-a",
              regionCode: "eu",
              realmSlug: "fixture-realm",
              isTargetCharacter: true,
              mythicRatingAtRun: 2100,
            },
            {
              characterId: "char-new-1",
              regionCode: "eu",
              realmSlug: "fixture-realm",
              isTargetCharacter: false,
              mythicRatingAtRun: 4000,
            },
            {
              characterId: "char-new-2",
              regionCode: "eu",
              realmSlug: "fixture-realm",
              isTargetCharacter: false,
              mythicRatingAtRun: 4000,
            },
            {
              characterId: "char-new-3",
              regionCode: "eu",
              realmSlug: "fixture-realm",
              isTargetCharacter: false,
              mythicRatingAtRun: 4000,
            },
            {
              characterId: "char-new-4",
              regionCode: "eu",
              realmSlug: "fixture-realm",
              isTargetCharacter: false,
              mythicRatingAtRun: 4000,
            },
          ],
        }),
      ],
    };
    const filteredBefore = filterMemberEvidenceAsOf(before, CUTOFF);
    const filteredAfter = filterMemberEvidenceAsOf(withFuture, CUTOFF);
    expect(computeTeammateCohortFingerprint(filteredBefore, SEASON)).toBe(
      computeTeammateCohortFingerprint(filteredAfter, SEASON),
    );
  });

  it("9. future-only duplicate run does not force coverage_only", () => {
    const params = mergeExperimentParams({ temporalHoldoutFraction: 0.5 });
    const sharedFutureId = "shared-future-run";
    const m1 = memberEvidence("m1", "char-a", {
      runs: [
        ...memberEvidence("m1", "char-a").runs,
        baseRun({
          runId: sharedFutureId,
          completedAt: "2026-07-28T10:00:00.000Z",
          participants: memberEvidence("m1", "char-a").runs[0]!.participants,
        }),
      ],
    });
    const m2 = memberEvidence("m2", "char-b", {
      runs: [
        ...memberEvidence("m2", "char-b").runs,
        baseRun({
          runId: sharedFutureId,
          completedAt: "2026-07-28T10:00:00.000Z",
          participants: memberEvidence("m2", "char-b").runs[0]!.participants,
        }),
      ],
    });
    const { assignments } = assignLeakageSafeSplits({
      members: [
        { memberId: "m1", characterId: "char-a", evaluationCutoff: CUTOFF },
        { memberId: "m2", characterId: "char-b", evaluationCutoff: CUTOFF },
      ],
      evidenceByMemberId: { m1, m2 },
      seasonId: SEASON,
      params,
      defaultEvaluationCutoff: CUTOFF,
    });
    expect(assignments.every((a) => a.split !== "coverage_only")).toBe(true);
    expect(assignments.every((a) => a.exclusionReason !== "DUPLICATE_RUN_ACROSS_MEMBERS")).toBe(
      true,
    );
  });

  it("10. member with only post-cutoff runs is coverage_only", () => {
    const params = mergeExperimentParams();
    const onlyFuture = memberEvidence("m1", "char-a", {
      runs: [
        baseRun({
          runId: "char-a:future-only",
          completedAt: "2026-07-20T10:00:00.000Z",
          participants: memberEvidence("m1", "char-a").runs[0]!.participants,
        }),
      ],
    });
    const peer = memberEvidence("m2", "char-b");
    const { assignments } = assignLeakageSafeSplits({
      members: [
        { memberId: "m1", characterId: "char-a", evaluationCutoff: CUTOFF },
        { memberId: "m2", characterId: "char-b", evaluationCutoff: CUTOFF },
      ],
      evidenceByMemberId: { m1: onlyFuture, m2: peer },
      seasonId: SEASON,
      params,
      defaultEvaluationCutoff: CUTOFF,
    });
    const a = assignments.find((x) => x.memberId === "m1")!;
    expect(a.split).toBe("coverage_only");
    expect(a.exclusionReason).toBe("NO_RUNS");
  });

  it("11. post-cutoff ScoreSnapshot is not used for authenticity comparison", () => {
    const evidence = memberEvidence("m1", "char-a", {
      productionAuthenticity: {
        authenticityScore: 12,
        boostSuspected: true,
        atypicalProgression: false,
        redFlagKeys: ["boost_suspected"],
        snapshotId: "snap-future",
        calculatedAt: "2026-07-25T00:00:00.000Z",
        source: "bundle",
      },
    });
    const { report } = runBoostShadowBacktest(
      {
        schemaVersion: "boost-shadow-cohort-v1",
        cohortId: "leak-auth",
        description: "auth cutoff",
        createdAt: CUTOFF,
        highKeyPolicyVersion: HIGH_KEY_POLICY_VERSION,
        seasonId: SEASON,
        members: [
          {
            memberId: "m1",
            characterId: "char-a",
            evaluationCutoff: CUTOFF,
          },
        ],
      },
      { m1: evidence },
      { generatedAt: CUTOFF },
    );
    expect(report.rows[0]!.productionAuthenticity.source).toBe("none");
    expect(report.rows[0]!.productionAuthenticity.snapshotId).toBeNull();
  });

  it("12. imported bundle with post-cutoff authenticity is filtered", () => {
    const bundle = buildPhase2FixtureBundle();
    const poisoned = {
      ...bundle,
      evidenceByMemberId: {
        ...bundle.evidenceByMemberId,
        "m-stable": {
          ...bundle.evidenceByMemberId["m-stable"]!,
          productionAuthenticity: {
            authenticityScore: 10,
            boostSuspected: true,
            atypicalProgression: false,
            redFlagKeys: ["boost_suspected"],
            snapshotId: "snap-after",
            calculatedAt: "2099-01-01T00:00:00.000Z",
            source: "bundle" as const,
          },
        },
      },
    };
    const { report } = runBoostShadowBacktestFromBundle(poisoned);
    const row = report.rows.find((r) => r.memberId === "m-stable")!;
    expect(row.productionAuthenticity.source).toBe("none");
  });

  it("13. cross-season runs and rating snapshots are rejected or omitted fail-closed", () => {
    const evidence = memberEvidence("m1", "char-a", {
      runs: [
        baseRun({
          runId: "wrong-season",
          completedAt: "2026-07-05T10:00:00.000Z",
          seasonId: "other-season",
          participants: memberEvidence("m1", "char-a").runs[0]!.participants,
        }),
        ...memberEvidence("m1", "char-a").runs,
      ],
      ratingSnapshots: [
        {
          characterId: "char-a",
          mythicRating: 2800,
          capturedAt: "2026-07-04T00:00:00.000Z",
          seasonId: "other-season",
        },
        {
          characterId: "char-a",
          mythicRating: 2700,
          capturedAt: "2026-07-04T00:00:00.000Z",
          // missing seasonId — must not pass
        } as { characterId: string; mythicRating: number; capturedAt: string },
      ],
    });
    const filtered = filterMemberEvidenceAsOf(evidence, CUTOFF);
    expect(filtered.runs.every((r) => r.seasonId === SEASON)).toBe(true);
    expect(filtered.runs.some((r) => r.runId === "wrong-season")).toBe(false);
    expect(filtered.ratingSnapshots ?? []).toEqual([]);

    const invalid = validateBoostShadowEvidenceBundle({
      schemaVersion: "boost-shadow-evidence-bundle-v1",
      generatedAt: CUTOFF,
      source: "fixture",
      manifest: {
        schemaVersion: "boost-shadow-cohort-v1",
        cohortId: "x",
        description: "x",
        createdAt: CUTOFF,
        highKeyPolicyVersion: HIGH_KEY_POLICY_VERSION,
        seasonId: SEASON,
        members: [{ memberId: "m1", characterId: "char-a" }],
      },
      evidenceByMemberId: {
        m1: {
          ...evidence,
          ratingSnapshots: [
            {
              characterId: "char-a",
              mythicRating: 1,
              capturedAt: "2026-07-04T00:00:00.000Z",
              seasonId: "other-season",
            },
          ],
        },
      },
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.some((e) => e.includes("seasonId"))).toBe(true);
  });

  it("14. deterministic JSON/CSV/Markdown output remains byte-stable", () => {
    const bundle = buildPhase2FixtureBundle();
    const a = buildBacktestArtifacts(runBoostShadowBacktestFromBundle(bundle).report);
    const b = buildBacktestArtifacts(runBoostShadowBacktestFromBundle(bundle).report);
    expect(a.json).toBe(b.json);
    expect(a.csv).toBe(b.csv);
    expect(a.markdown).toBe(b.markdown);
  });

  it("15. Phase 2 remains read-only, provider-free and ownership-free", () => {
    const bundle = buildPhase2FixtureBundle();
    const { report, mutationGuard } = runBoostShadowBacktestFromBundle(bundle);
    expect(mutationGuard.counters.providerCalls).toBe(0);
    expect(mutationGuard.counters.databaseWrites).toBe(0);
    expect(mutationGuard.counters.scoreSnapshotWrites).toBe(0);
    expect(report.providerCallsMade).toBe(false);
    expect(report.isolation.verifiedOwnershipUsage).toBe(false);
    expect(report.isolation.shadowOnly).toBe(true);
    createMutationGuard().assertNoProviderCalls();

    // Ownership still rejected
    expect(() =>
      runBoostShadowBacktest(
        bundle.manifest,
        {
          ...bundle.evidenceByMemberId,
          "m-stronger": {
            ...bundle.evidenceByMemberId["m-stronger"]!,
            ...( {
              ownershipEvidence: [{ ownershipId: "x" }],
            } as object),
          },
        },
        { generatedAt: bundle.generatedAt },
      ),
    ).toThrow(/ownershipEvidence/);
  });

  it("includes season-bound snapshots only inside startsAt..min(endsAt,cutoff)", () => {
    const mapped = mapPersistedCharacterSnapshotsToSeasonBound({
      snapshots: [
        { characterId: "c", mythicRating: 1, capturedAt: "2026-06-30T23:59:59.000Z" },
        { characterId: "c", mythicRating: 2, capturedAt: "2026-07-05T00:00:00.000Z" },
        { characterId: "c", mythicRating: 3, capturedAt: "2026-07-15T00:00:00.000Z" },
        { characterId: "c", mythicRating: 4, capturedAt: "2026-08-01T00:00:00.000Z" },
      ],
      seasonBounds: { seasonId: SEASON, startsAt: SEASON_START, endsAt: SEASON_END },
      evaluationCutoff: CUTOFF,
    });
    expect(mapped.map((s) => s.mythicRating)).toEqual([2]);
  });

  it("does not invent feature zeros from omitted cross-season ratings", () => {
    const input = {
      subjectCharacterId: "char-a",
      seasonId: SEASON,
      regionId: "region-eu",
      calculatedAt: CUTOFF,
      runs: [
        baseRun({
          runId: "r1",
          completedAt: "2026-07-05T10:00:00.000Z",
          participants: [
            {
              characterId: "char-a",
              regionCode: "eu",
              realmSlug: "fixture-realm",
              isTargetCharacter: true,
              mythicRatingAtRun: null,
            },
            {
              characterId: "char-tm-1",
              regionCode: "eu",
              realmSlug: "fixture-realm",
              isTargetCharacter: false,
              mythicRatingAtRun: 3200,
            },
          ],
        }),
      ],
      ratingSnapshots: [],
    };
    const facts = extractBoostFeatureFactsV1(input);
    expect(facts.features.teammateScoreGap).toBeUndefined();
  });
});
