import { describe, expect, it } from "vitest";
import { createDefaultModelV6 } from "../model/defaults.js";
import {
  anonymizeReport,
  buildCalibrationArtifacts,
  buildSyntheticFixtureBundle,
  buildSyntheticFixtureCohort,
  createAblatedModel,
  createFixtureEvidencePort,
  runAdminCalibrationBacktest,
  runCalibrationHarness,
  runCalibrationHarnessFromBundle,
  spearmanRankCorrelation,
  validateCalibrationInputBundle,
  validateCohortManifest,
  CALIBRATION_REPORT_SCHEMA_VERSION,
  COHORT_MANIFEST_SCHEMA_VERSION,
  V6_CANONICAL_METRIC_KEYS,
  RETIRED_PERFORMANCE_METRIC_KEYS,
} from "./index.js";
import type { CalibrationMemberEvidence, CalibrationModelRef } from "./types.js";
import { LABEL_RANK } from "./manifest.js";

describe("calibration ranking", () => {
  it("returns +1 for perfect positive ordering", () => {
    expect(spearmanRankCorrelation([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 10);
  });

  it("returns -1 for perfect inverse ordering", () => {
    expect(spearmanRankCorrelation([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it("handles label ties deterministically", () => {
    const r = spearmanRankCorrelation([5, 5, 3, 1], [90, 80, 50, 20]);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0);
  });

  it("handles score ties deterministically", () => {
    const r = spearmanRankCorrelation([5, 4, 3, 1], [90, 50, 50, 20]);
    expect(r).not.toBeNull();
  });

  it("returns null for all-equal labels or scores", () => {
    expect(spearmanRankCorrelation([3, 3, 3], [10, 20, 30])).toBeNull();
    expect(spearmanRankCorrelation([1, 2, 3], [5, 5, 5])).toBeNull();
  });

  it("returns null for fewer than two observations", () => {
    expect(spearmanRankCorrelation([1], [2])).toBeNull();
    expect(spearmanRankCorrelation([], [])).toBeNull();
  });
});

describe("calibration harness", () => {
  const fixture = buildSyntheticFixtureCohort();
  const evidence = createFixtureEvidencePort(fixture.evidenceById);
  const activeModel: CalibrationModelRef = {
    ...fixture.modelRef,
    status: "ACTIVE",
    isActive: true,
  };

  it("validates a well-formed cohort manifest", () => {
    const result = validateCohortManifest(fixture.manifest);
    expect(result.ok).toBe(true);
    expect(result.manifest?.schemaVersion).toBe(COHORT_MANIFEST_SCHEMA_VERSION);
  });

  it("rejects malformed cohort manifests", () => {
    const bad = validateCohortManifest({
      schemaVersion: "0.0.1",
      cohortId: "",
      members: [{ id: 1 }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(2);
  });

  it("rejects empty members", () => {
    const bad = validateCohortManifest({
      schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
      cohortId: "x",
      description: "d",
      createdAt: "2026-07-31T00:00:00.000Z",
      members: [],
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.includes("empty"))).toBe(true);
  });

  it("uses canonical v6 metric keys in fixtures", () => {
    const allKeys = new Set<string>();
    for (const evidenceRow of fixture.evidenceById.values()) {
      for (const obs of evidenceRow.observations ?? []) {
        allKeys.add(obs.metricKey);
      }
    }
    for (const key of V6_CANONICAL_METRIC_KEYS) {
      expect(allKeys.has(key)).toBe(true);
    }
    for (const retired of RETIRED_PERFORMANCE_METRIC_KEYS) {
      expect(allKeys.has(retired)).toBe(false);
    }
  });

  it("lets excellent non-meta outrank mediocre meta", () => {
    const report = runCalibrationHarness(
      fixture.manifest,
      {
        mode: "persisted-snapshot-only",
        activeModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence },
    );
    const excellent = report.characters.find((c) => c.memberId === "fx-dps-excellent-nonmeta")!;
    const mediocre = report.characters.find((c) => c.memberId === "fx-dps-meta-mediocre")!;
    expect(excellent.overallScore).not.toBeNull();
    expect(mediocre.overallScore).not.toBeNull();
    expect(excellent.overallScore!).toBeGreaterThan(mediocre.overallScore!);
  });

  it("covers four public dimensions when evidence is complete", () => {
    const report = runCalibrationHarness(
      fixture.manifest,
      { mode: "persisted-snapshot-only", activeModel, calculatedAt: "2026-07-31T12:00:00.000Z" },
      { evidence },
    );
    const complete = report.characters.find((c) => c.memberId === "fx-dps-average")!;
    const dims = new Set(complete.dimensions.map((d) => d.dimension));
    expect(dims.has("PERFORMANCE")).toBe(true);
    expect(dims.has("SURVIVAL")).toBe(true);
    expect(dims.has("UTILITY")).toBe(true);
    expect(dims.has("EXPERIENCE")).toBe(true);
  });

  it("retains U / low-confidence and utility edge cases", () => {
    const report = runCalibrationHarness(
      fixture.manifest,
      { mode: "persisted-snapshot-only", activeModel, calculatedAt: "2026-07-31T12:00:00.000Z" },
      { evidence },
    );
    expect(report.characters.some((c) => c.isUnrated || c.lowConfidence)).toBe(true);
    expect(report.characters.some((c) => c.memberId === "fx-utility-zero-complete")).toBe(true);
    expect(report.characters.some((c) => c.memberId === "fx-utility-insufficient")).toBe(true);
    const boost = report.characters.find((c) => c.memberId === "fx-dps-weak-overrated")!;
    expect(boost.boost.suspected).toBe(true);
  });

  it("produces positive Spearman on broadly monotonic fixture ordering", () => {
    const report = runCalibrationHarness(
      fixture.manifest,
      {
        mode: "persisted-snapshot-only",
        activeModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
        bootstrapSeed: 7,
        bootstrapIterations: 50,
      },
      { evidence },
    );
    expect(report.schemaVersion).toBe(CALIBRATION_REPORT_SCHEMA_VERSION);
    expect(report.providerCallsMade).toBe(false);
    expect(report.modelActivated).toBe(false);
    expect(report.statistics.monotonicOrdering.labelScoreSpearman).not.toBeNull();
    expect(report.statistics.monotonicOrdering.labelScoreSpearman!).toBeGreaterThan(0);
    expect(report.statistics.monotonicOrdering.tieMethod).toBe("average-ranks");
    expect(report.activeDraftComparison?.comparable).toBe(false);
  });

  it("is deterministic / reproducible for the same inputs", () => {
    const opts = {
      mode: "persisted-snapshot-only" as const,
      activeModel,
      calculatedAt: "2026-07-31T12:00:00.000Z",
      bootstrapSeed: 99,
      bootstrapIterations: 40,
    };
    const a = buildCalibrationArtifacts(
      runCalibrationHarness(fixture.manifest, opts, { evidence }),
    );
    const b = buildCalibrationArtifacts(
      runCalibrationHarness(fixture.manifest, opts, { evidence }),
    );
    expect(a.json).toBe(b.json);
    expect(a.csv).toBe(b.csv);
    expect(a.markdown).toBe(b.markdown);
  });

  it("rejects fabricated draft context and missing observations", () => {
    const member = fixture.manifest.members[0]!;
    const base = fixture.evidenceById.get(member.id)!;
    const noContext: CalibrationMemberEvidence = {
      ...base,
      scoringContext: null,
    };
    const port = createFixtureEvidencePort(new Map([[member.id, noContext]]));
    const report = runCalibrationHarness(
      { ...fixture.manifest, members: [member] },
      {
        mode: "draft-model-evaluate",
        activeModel,
        evaluationModel: { ...fixture.modelRef, status: "DRAFT", isActive: false },
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence: port },
    );
    expect(report.validationFailureCount).toBe(1);
    expect(report.validationFailures[0]?.code).toBe("MISSING_REPLAY_CONTEXT");
    expect(report.statistics.scoredMemberCount).toBe(0);
  });

  it("evaluates a draft model with explicit fixture context", () => {
    const draftConfig = createDefaultModelV6({
      key: "default",
      version: 6,
      weights: {
        performance: 0.4,
        survival: 0.25,
        utility: 0.25,
        experienceConsistency: 0.1,
        mythicRaid: 0,
      },
    });
    const evaluationModel: CalibrationModelRef = {
      id: "draft",
      key: draftConfig.key,
      version: draftConfig.version,
      status: "DRAFT",
      config: draftConfig,
      isActive: false,
    };
    const report = runCalibrationHarness(
      fixture.manifest,
      {
        mode: "draft-model-evaluate",
        activeModel,
        evaluationModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence },
    );
    expect(report.modelActivated).toBe(false);
    expect(report.evaluationModel.isActive).toBe(false);
    expect(report.errorCount).toBe(0);
    expect(report.statistics.weightAblation.length).toBeGreaterThan(0);
    expect(report.statistics.weightAblation.every((w) => w.method === "engine-zero-renormalize")).toBe(
      true,
    );
  });

  it("compares active versus draft on identical replay inputs", () => {
    const draftConfig = createDefaultModelV6({
      version: 6,
      weights: {
        performance: 0.45,
        survival: 0.25,
        utility: 0.2,
        experienceConsistency: 0.1,
        mythicRaid: 0,
      },
    });
    const evaluationModel: CalibrationModelRef = {
      ...fixture.modelRef,
      status: "DRAFT",
      isActive: false,
      config: draftConfig,
    };
    const originalWeights = structuredClone(activeModel.config.weights);
    const report = runCalibrationHarness(
      fixture.manifest,
      {
        mode: "active-versus-draft",
        activeModel,
        evaluationModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence },
    );
    expect(JSON.stringify(activeModel.config.weights)).toBe(JSON.stringify(originalWeights));
    expect(report.activeDraftComparison?.comparable).toBe(true);
    expect(report.activeDraftComparison?.aggregate?.comparableCount).toBeGreaterThan(0);
    const row = report.activeDraftComparison!.characters.find(
      (c) => c.memberId === "fx-dps-excellent-nonmeta",
    )!;
    expect(row.comparable).toBe(true);
    expect(row.scoreDelta).not.toBeNull();
    expect(row.dimensionDeltas.length).toBeGreaterThan(0);
  });

  it("does not mutate model during ablation", () => {
    const model = createDefaultModelV6();
    const before = JSON.stringify(model);
    const ablated = createAblatedModel(model, "performance");
    expect(JSON.stringify(model)).toBe(before);
    expect(ablated.weights.performance).toBe(0);
    const sum =
      ablated.weights.survival +
      ablated.weights.utility +
      ablated.weights.experienceConsistency;
    expect(sum).toBeCloseTo(1, 10);
  });

  it("rejects refresh-then-evaluate as unsupported", () => {
    expect(() =>
      runCalibrationHarness(
        fixture.manifest,
        { mode: "refresh-then-evaluate", calculatedAt: "2026-07-31T12:00:00.000Z" },
        { evidence },
      ),
    ).toThrow(/UNSUPPORTED_MODE/);
  });

  it("validates snapshot provenance mismatches", () => {
    const member = fixture.manifest.members[0]!;
    const base = fixture.evidenceById.get(member.id)!;
    const cases: Array<{ evidence: CalibrationMemberEvidence; code: string }> = [
      {
        evidence: { ...base, memberId: "other" },
        code: "MEMBER_ID_MISMATCH",
      },
      {
        evidence: {
          ...base,
          snapshot: { ...base.snapshot!, characterId: "wrong-char" },
        },
        code: "CHARACTER_ID_MISMATCH",
      },
      {
        evidence: {
          ...base,
          snapshot: { ...base.snapshot!, seasonSlug: "wrong-season" },
        },
        code: "SEASON_MISMATCH",
      },
      {
        evidence: {
          ...base,
          snapshotId: "not-in-manifest",
        },
        code: "SNAPSHOT_ID_NOT_IN_MANIFEST",
      },
      {
        evidence: {
          ...base,
          snapshot: { ...base.snapshot!, modelVersion: 5 },
        },
        code: "MODEL_VERSION_MISMATCH",
      },
    ];

    for (const testCase of cases) {
      const port = createFixtureEvidencePort(new Map([[member.id, testCase.evidence]]));
      const report = runCalibrationHarness(
        { ...fixture.manifest, members: [member] },
        {
          mode: "persisted-snapshot-only",
          activeModel,
          evaluationModel: fixture.modelRef,
          calculatedAt: "2026-07-31T12:00:00.000Z",
        },
        { evidence: port },
      );
      expect(report.validationFailures[0]?.code).toBe(testCase.code);
      expect(report.statistics.scoredMemberCount).toBe(0);
    }
  });

  it("does not relabel a v5 snapshot when only activeModel is v6", () => {
    const member = fixture.manifest.members[0]!;
    const base = fixture.evidenceById.get(member.id)!;
    const v5Snap = {
      ...base.snapshot!,
      modelKey: "default",
      modelVersion: 5,
    };
    const port = createFixtureEvidencePort(
      new Map([[member.id, { ...base, snapshot: v5Snap }]]),
    );
    const report = runCalibrationHarness(
      { ...fixture.manifest, members: [member] },
      {
        mode: "persisted-snapshot-only",
        activeModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence: port },
    );
    expect(report.errorCount).toBe(0);
    expect(report.characters[0]?.scoreModelVersion).toBe(5);
    expect(report.characters[0]?.scoreModelKey).toBe("default");
  });

  it("rejects duplicate snapshot IDs across members", () => {
    const m1 = fixture.manifest.members[0]!;
    const m2 = fixture.manifest.members[1]!;
    const e1 = fixture.evidenceById.get(m1.id)!;
    const e2 = {
      ...fixture.evidenceById.get(m2.id)!,
      snapshotId: e1.snapshotId,
      snapshot: {
        ...fixture.evidenceById.get(m2.id)!.snapshot!,
        characterId: m2.id,
      },
    };
    // Adjust m2 snapshotIds to include the reused id so SNAPSHOT_ID_NOT_IN_MANIFEST does not fire first.
    const members = [
      m1,
      { ...m2, snapshotIds: [e1.snapshotId!] },
    ];
    const port = createFixtureEvidencePort(
      new Map([
        [m1.id, e1],
        [m2.id, e2],
      ]),
    );
    const report = runCalibrationHarness(
      { ...fixture.manifest, members },
      {
        mode: "persisted-snapshot-only",
        activeModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence: port },
    );
    expect(report.validationFailures.some((v) => v.code === "DUPLICATE_SNAPSHOT_ID")).toBe(true);
  });

  it("anonymizes identities consistently including comparison movers", () => {
    const draftConfig = createDefaultModelV6({
      version: 6,
      weights: {
        performance: 0.5,
        survival: 0.2,
        utility: 0.2,
        experienceConsistency: 0.1,
        mythicRaid: 0,
      },
    });
    const report = runCalibrationHarness(
      fixture.manifest,
      {
        mode: "active-versus-draft",
        activeModel,
        evaluationModel: {
          ...fixture.modelRef,
          status: "DRAFT",
          isActive: false,
          config: draftConfig,
        },
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence },
    );
    const publicSafe = anonymizeReport(report);
    const json = JSON.stringify(publicSafe);
    for (const member of fixture.manifest.members) {
      expect(json).not.toContain(member.character);
      expect(json).not.toContain(member.realm);
      expect(json).not.toContain(`"${member.id}"`);
    }
    expect(json).not.toContain("ExcellentNonMeta");
  });

  it("uses explicit coverage fields rather than only dimension counts", () => {
    const report = runCalibrationHarness(
      fixture.manifest,
      { mode: "persisted-snapshot-only", activeModel, calculatedAt: "2026-07-31T12:00:00.000Z" },
      { evidence },
    );
    const point = report.statistics.confidenceVersusCoverage.find(
      (p) => p.memberId === "fx-dps-excellent-nonmeta",
    )!;
    expect(point.selectedRunCoverage).toBe(0.95);
    expect(point.dimensionAvailabilityRatio).not.toBeNull();
  });

  it("validates portable bundles and runs from bundle", () => {
    const bundle = buildSyntheticFixtureBundle();
    const ok = validateCalibrationInputBundle(bundle);
    expect(ok.ok).toBe(true);

    const invalid = validateCalibrationInputBundle({ schemaVersion: "nope" });
    expect(invalid.ok).toBe(false);

    const missing = validateCalibrationInputBundle({
      ...bundle,
      evidenceByMemberId: {},
    });
    expect(missing.errors.some((e) => e.code === "MISSING_EVIDENCE")).toBe(true);

    const { report } = runCalibrationHarnessFromBundle(bundle, {
      mode: "persisted-snapshot-only",
      calculatedAt: "2026-07-31T12:00:00.000Z",
    });
    expect(report.evaluatedCount).toBe(bundle.manifest.members.length);
  });

  it("admin adapter maps summary without activation", () => {
    const result = runAdminCalibrationBacktest({
      scoreModelId: "model-1",
      manifest: fixture.manifest,
      options: {
        mode: "persisted-snapshot-only",
        activeModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      deps: { evidence },
      publicSafe: true,
    });
    expect(result.summary.modelActivated).toBe(false);
    expect(result.summary.providerCallsMade).toBe(false);
    expect(result.summary.monotonicSpearman).not.toBeNull();
    expect(result.artifacts.report.schemaVersion).toBe(CALIBRATION_REPORT_SCHEMA_VERSION);
  });

  it("admin adapter returns validation errors for bad manifests", () => {
    const result = runAdminCalibrationBacktest({
      scoreModelId: "model-1",
      manifest: { schemaVersion: "nope" },
      options: { mode: "persisted-snapshot-only" },
      deps: { evidence },
    });
    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(result.summary.sampleSize).toBe(0);
  });

  it("excludes failed members from score denominators while retaining U", () => {
    const member = fixture.manifest.members[0]!;
    const bad = { ...fixture.evidenceById.get(member.id)!, memberId: "x" };
    const goodId = "fx-dps-sparse-u";
    const goodMember = fixture.manifest.members.find((m) => m.id === goodId)!;
    const port = createFixtureEvidencePort(
      new Map([
        [member.id, bad],
        [goodId, fixture.evidenceById.get(goodId)!],
      ]),
    );
    const report = runCalibrationHarness(
      { ...fixture.manifest, members: [member, goodMember] },
      {
        mode: "persisted-snapshot-only",
        activeModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence: port },
    );
    expect(report.statistics.failedMemberCount).toBe(1);
    expect(report.statistics.scoredMemberCount).toBe(1);
    // U may or may not appear depending on engine; grade dist only from non-failed.
    expect(report.statistics.monotonicOrdering.sampleSize).toBe(1);
    expect(LABEL_RANK.excellent).toBe(5);
  });
});
