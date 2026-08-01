/**
 * Phase 2 backtest harness tests — isolation, leakage, determinism, semantics.
 */
import { describe, expect, it } from "vitest";
import {
  BOOST_EXTRACTOR_VERSION,
  HIGH_KEY_POLICY_VERSION,
  extractBoostFeatureFactsV1,
  fixtureStrongerCohort,
  fixtureStableTeam,
  isOmittedNotZero,
} from "../index.js";
import {
  assignLeakageSafeSplits,
  assertNoCharacterLeakage,
  assertNoCohortLeakage,
  assertNoIdentityLeakage,
  buildBacktestArtifacts,
  buildPhase2FixtureBundle,
  createMutationGuard,
  createReadOnlyPrismaProxy,
  filterEvidenceAtCutoff,
  isLabeledForSupervised,
  mergeExperimentParams,
  runBoostShadowBacktest,
  runBoostShadowBacktestFromBundle,
  validateBoostShadowCohortManifest,
} from "./index.js";

describe("boost-shadow Phase 2 backtest harness", () => {
  it("reads evidence read-only and records no writes", () => {
    const bundle = buildPhase2FixtureBundle();
    const { report, mutationGuard } = runBoostShadowBacktestFromBundle(bundle);
    expect(mutationGuard.counters.evidenceReads).toBe(bundle.manifest.members.length);
    expect(mutationGuard.counters.scoreSnapshotWrites).toBe(0);
    expect(mutationGuard.counters.characterRedFlagWrites).toBe(0);
    expect(mutationGuard.counters.authenticityInputWrites).toBe(0);
    expect(mutationGuard.counters.authenticityOutputWrites).toBe(0);
    expect(mutationGuard.counters.databaseWrites).toBe(0);
    expect(mutationGuard.counters.providerCalls).toBe(0);
    expect(report.providerCallsMade).toBe(false);
    expect(report.scoreSnapshotsWritten).toBe(false);
    expect(report.characterRedFlagsWritten).toBe(false);
    expect(report.authenticityInputsMutated).toBe(false);
    expect(report.isolation.shadowOnly).toBe(true);
    expect(report.isolation.productionScoreEffect).toBe(false);
    expect(report.isolation.verifiedOwnershipUsage).toBe(false);
    expect(report.isolation.modelActivation).toBe(false);
    expect(report.isolation.persistsBoostFeatureSnapshot).toBe(false);
  });

  it("blocks mutating prisma calls via read-only proxy", async () => {
    const guard = createMutationGuard();
    const fake = {
      scoreSnapshot: {
        create: async () => ({ id: "x" }),
        findMany: async () => [],
      },
    };
    const proxy = createReadOnlyPrismaProxy(fake, guard);
    expect(() => proxy.scoreSnapshot.create({})).toThrow(/Read-only/);
    expect(guard.counters.databaseWrites).toBe(1);
    expect(await proxy.scoreSnapshot.findMany()).toEqual([]);
  });

  it("keeps missing participant ratings unknown (not zero)", () => {
    const bundle = buildPhase2FixtureBundle();
    const { report } = runBoostShadowBacktestFromBundle(bundle);
    const missing = report.rows.find((r) => r.memberId === "m-missing");
    expect(missing).toBeDefined();
    expect(missing!.features.teammateScoreGap).toBeNull();
    expect(
      missing!.omittedFeatures.some(
        (o) =>
          o.featureKey === "teammateScoreGap" &&
          (o.reasonCode === "NO_TIME_ALIGNED_SUBJECT_RATING" ||
            o.reasonCode === "NO_TIME_ALIGNED_GAPS" ||
            o.reasonCode === "INSUFFICIENT_HIGH_KEYS"),
      ),
    ).toBe(true);
    // Direct Phase 1 check still holds
    const facts = extractBoostFeatureFactsV1(fixtureStrongerCohort());
    expect(facts.features.teammateScoreGap).toBeDefined();
  });

  it("prefers time-aligned ratings and rejects future snapshots at cutoff", () => {
    const bundle = buildPhase2FixtureBundle();
    const futureEv = bundle.evidenceByMemberId["m-future"]!;
    const filtered = filterEvidenceAtCutoff(futureEv, "2026-07-05T00:00:00.000Z");
    for (const snap of filtered.ratingSnapshots ?? []) {
      expect(Date.parse(snap.capturedAt)).toBeLessThanOrEqual(
        Date.parse("2026-07-05T00:00:00.000Z"),
      );
    }
    const { report } = runBoostShadowBacktestFromBundle(bundle);
    const futureRow = report.rows.find((r) => r.memberId === "m-future")!;
    // Future snapshot after cutoff must not invent a gap value from post-cutoff evidence
    expect(
      futureRow.features.teammateScoreGap == null ||
        futureRow.omittedFeatures.some((o) =>
          o.reasonCode.includes("TIME_ALIGNED") || o.reasonCode.includes("INSUFFICIENT"),
        ),
    ).toBe(true);
  });

  it("prevents future runs from leaking into earlier evaluation cutoffs", () => {
    const bundle = buildPhase2FixtureBundle();
    const member = bundle.manifest.members.find((m) => m.memberId === "m-stronger")!;
    const evidence = bundle.evidenceByMemberId["m-stronger"]!;
    const earlyCutoff = "2026-07-02T00:00:00.000Z";
    const filtered = filterEvidenceAtCutoff(evidence, earlyCutoff);
    expect(filtered.runs.every((r) => Date.parse(r.completedAt!) <= Date.parse(earlyCutoff))).toBe(
      true,
    );
    expect(filtered.runs.length).toBeLessThan(evidence.runs.length);

    const earlyManifest = {
      ...bundle.manifest,
      members: [{ ...member, evaluationCutoff: earlyCutoff }],
    };
    const { report } = runBoostShadowBacktest(earlyManifest, {
      "m-stronger": evidence,
    }, { generatedAt: bundle.generatedAt });
    const row = report.rows[0]!;
    expect(row.facts.calculatedAt).toBe(earlyCutoff);
  });

  it("keeps characters and teammate cohorts out of incompatible splits", () => {
    const bundle = buildPhase2FixtureBundle();
    const params = mergeExperimentParams();
    const { assignments } = assignLeakageSafeSplits({
      members: bundle.manifest.members,
      evidenceByMemberId: bundle.evidenceByMemberId,
      seasonId: bundle.manifest.seasonId,
      params,
    });
    expect(() => assertNoCharacterLeakage(assignments)).not.toThrow();
    expect(() => assertNoCohortLeakage(assignments)).not.toThrow();

    const trainChars = new Set(
      assignments.filter((a) => a.split === "train").map((a) => a.characterId),
    );
    const evalChars = new Set(
      assignments.filter((a) => a.split === "evaluation").map((a) => a.characterId),
    );
    for (const id of trainChars) {
      expect(evalChars.has(id)).toBe(false);
    }
  });

  it("produces deterministic byte-stable artifacts for fixed timestamps", () => {
    const bundle = buildPhase2FixtureBundle();
    const a = buildBacktestArtifacts(runBoostShadowBacktestFromBundle(bundle).report);
    const b = buildBacktestArtifacts(runBoostShadowBacktestFromBundle(bundle).report);
    expect(a.json).toBe(b.json);
    expect(a.csv).toBe(b.csv);
    expect(a.markdown).toBe(b.markdown);
    expect(a.publicSafeJson).toBe(b.publicSafeJson);
  });

  it("public-safe output contains no identity fields", () => {
    const bundle = buildPhase2FixtureBundle();
    const artifacts = buildBacktestArtifacts(
      runBoostShadowBacktestFromBundle(bundle).report,
    );
    expect(() => assertNoIdentityLeakage(artifacts.publicSafeReport)).not.toThrow();
    expect(artifacts.publicSafeJson).not.toMatch(/"displayName"/);
    expect(artifacts.publicSafeJson).not.toMatch(/"realmSlug"/);
    expect(artifacts.publicSafeJson).not.toMatch(/"providerCharacterKey"/);
    expect(artifacts.publicSafeJson).not.toMatch(/"battleNetAccountId"/);
    expect(artifacts.publicSafeJson).not.toMatch(/"ownershipEvidence"/);
  });

  it("preserves Phase 1 feature semantics for stronger cohort vs stable team", () => {
    const stronger = extractBoostFeatureFactsV1(fixtureStrongerCohort());
    const stable = extractBoostFeatureFactsV1(fixtureStableTeam());
    expect(stronger.extractorVersion).toBe(BOOST_EXTRACTOR_VERSION);
    expect(stronger.highKeyPolicyVersion).toBe(HIGH_KEY_POLICY_VERSION);
    expect(stronger.features.teammateScoreGap!.value).toBeGreaterThan(
      stable.features.teammateScoreGap!.value,
    );
    expect(stronger.features.repeatedStrongerTeammateCohort!.value).toBeGreaterThan(
      stable.features.repeatedStrongerTeammateCohort!.value,
    );

    const bundle = buildPhase2FixtureBundle();
    const { report } = runBoostShadowBacktestFromBundle(bundle);
    const sRow = report.rows.find((r) => r.memberId === "m-stronger")!;
    const tRow = report.rows.find((r) => r.memberId === "m-stable")!;
    expect(sRow.features.teammateScoreGap!).toBeGreaterThan(tRow.features.teammateScoreGap!);
    expect(report.highKeyPolicyVersion).toBe(HIGH_KEY_POLICY_VERSION);
    expect(sRow.facts.highKeyPolicyVersion).toBe(HIGH_KEY_POLICY_VERSION);
  });

  it("distinguishes fixed teams from repeated stronger-teammate patterns", () => {
    const bundle = buildPhase2FixtureBundle();
    const { report } = runBoostShadowBacktestFromBundle(bundle);
    const stronger = report.rows.find((r) => r.memberId === "m-stronger")!;
    const stable = report.rows.find((r) => r.memberId === "m-stable")!;
    expect(stronger.patternClass).toBe("repeated_stronger_teammate");
    expect(stable.patternClass).toBe("fixed_team_low_gap");
    expect(report.analysis.fixedTeamVersusStronger.distinguishable).toBe(true);
    expect(report.analysis.fixedTeamVersusStronger.fixedTeamLowGapCount).toBeGreaterThan(0);
    expect(
      report.analysis.fixedTeamVersusStronger.repeatedStrongerTeammateCount,
    ).toBeGreaterThan(0);
  });

  it("excludes unlabeled rows from supervised denominators but retains for coverage", () => {
    const bundle = buildPhase2FixtureBundle();
    const { report } = runBoostShadowBacktestFromBundle(bundle);
    const params = mergeExperimentParams();
    const unlabeled = report.rows.filter((r) => !isLabeledForSupervised(r, params));
    expect(unlabeled.length).toBeGreaterThan(0);
    expect(report.analysis.evidenceCoverage.unlabeledRetainedForCoverage).toBe(
      unlabeled.length,
    );
    const cm = report.analysis.confusionMatrix!;
    expect(cm.unlabeledExcluded).toBe(unlabeled.length);
    expect(cm.labeledSampleSize).toBe(
      report.analysis.evidenceCoverage.labeledSupervisedCount,
    );
    expect(cm.labeledSampleSize + cm.unlabeledExcluded).toBe(report.rows.length);
  });

  it("rejects ownership evidence in Phase 2 bundles", () => {
    const bundle = buildPhase2FixtureBundle();
    const poisoned = {
      ...bundle.evidenceByMemberId["m-stronger"]!,
      ownershipEvidence: [{ ownershipId: "x" }],
    } as unknown as (typeof bundle.evidenceByMemberId)["m-stronger"];
    expect(() =>
      runBoostShadowBacktest(
        bundle.manifest,
        { ...bundle.evidenceByMemberId, "m-stronger": poisoned },
        { generatedAt: bundle.generatedAt },
      ),
    ).toThrow(/Phase 2 rejects ownershipEvidence/);
  });

  it("validates versioned manifest with character IDs", () => {
    const bundle = buildPhase2FixtureBundle();
    const ok = validateBoostShadowCohortManifest(bundle.manifest);
    expect(ok.ok).toBe(true);
    const bad = validateBoostShadowCohortManifest({
      ...bundle.manifest,
      highKeyPolicyVersion: "wrong",
    });
    expect(bad.ok).toBe(false);
  });

  it("labels experimental classifier as offline non-product", () => {
    const { report } = runBoostShadowBacktestFromBundle(buildPhase2FixtureBundle());
    expect(report.experimentalClassifier.label).toBe("OFFLINE_NON_PRODUCT");
    expect(report.disclaimer).toMatch(/No production score effect/i);
  });

  it("does not coerce omitted Phase 1 features to zero in harness rows", () => {
    const bundle = buildPhase2FixtureBundle();
    const { report } = runBoostShadowBacktestFromBundle(bundle);
    const missing = report.rows.find((r) => r.memberId === "m-missing")!;
    expect(missing.features.teammateScoreGap).toBeNull();
    expect(missing.features.teammateScoreGap).not.toBe(0);
    // Mirror Phase 1 helper
    const facts = missing.facts;
    expect(isOmittedNotZero(facts, "teammateScoreGap")).toBe(true);
  });
});
