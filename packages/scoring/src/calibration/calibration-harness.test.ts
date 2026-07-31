import { describe, expect, it } from "vitest";
import { createDefaultModelV6 } from "../model/defaults.js";
import {
  anonymizeReport,
  buildCalibrationArtifacts,
  buildSyntheticFixtureCohort,
  createFixtureEvidencePort,
  runAdminCalibrationBacktest,
  runCalibrationHarness,
  validateCohortManifest,
  CALIBRATION_REPORT_SCHEMA_VERSION,
  COHORT_MANIFEST_SCHEMA_VERSION,
} from "./index.js";
import type { CalibrationModelRef } from "./types.js";

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

  it("runs persisted-snapshot-only without provider calls", () => {
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
    expect(report.evaluatedCount).toBe(fixture.manifest.members.length);
    expect(report.errorCount).toBe(0);
    expect(report.characters.some((c) => c.isUnrated || c.lowConfidence)).toBe(true);
    expect(report.statistics.gradeDistributionNote).toMatch(/no forced quotas/i);
    expect(report.statistics.weightAblation.length).toBeGreaterThan(0);
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

  it("evaluates a draft model without marking it active", () => {
    const draftConfig = createDefaultModelV6({
      key: "default",
      version: 7,
      weights: {
        performance: 0.4,
        survival: 0.25,
        utility: 0.25,
        experienceConsistency: 0.1,
        mythicRaid: 0,
      },
    });
    const draft: CalibrationModelRef = {
      id: "draft-7",
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
        evaluationModel: draft,
        activeModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence },
    );

    expect(report.modelActivated).toBe(false);
    expect(report.evaluationModel.status).toBe("DRAFT");
    expect(report.evaluationModel.isActive).toBe(false);
    expect(report.activeModel.isActive).toBe(true);
    expect(report.providerCallsMade).toBe(false);
    expect(report.characters.every((c) => c.evaluationModelVersion === 7)).toBe(true);
  });

  it("refuses draft evaluation when evaluationModel claims ACTIVE/isActive", () => {
    expect(() =>
      runCalibrationHarness(
        fixture.manifest,
        {
          mode: "draft-model-evaluate",
          evaluationModel: { ...activeModel, status: "ACTIVE", isActive: true },
          calculatedAt: "2026-07-31T12:00:00.000Z",
        },
        { evidence },
      ),
    ).toThrow(/isActive|ACTIVE/i);
  });

  it("keeps refresh-then-evaluate disabled by default", () => {
    expect(() =>
      runCalibrationHarness(
        fixture.manifest,
        { mode: "refresh-then-evaluate", calculatedAt: "2026-07-31T12:00:00.000Z" },
        { evidence },
      ),
    ).toThrow(/allowRefreshThenEvaluate/i);
  });

  it("still refuses refresh even when explicitly allowed (no provider port)", () => {
    expect(() =>
      runCalibrationHarness(
        fixture.manifest,
        {
          mode: "refresh-then-evaluate",
          allowRefreshThenEvaluate: true,
          calculatedAt: "2026-07-31T12:00:00.000Z",
        },
        { evidence },
      ),
    ).toThrow(/no live provider/i);
  });

  it("produces anonymized public-safe reports", () => {
    const report = runCalibrationHarness(
      fixture.manifest,
      {
        mode: "persisted-snapshot-only",
        activeModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence },
    );
    const publicSafe = anonymizeReport(report);
    expect(publicSafe.characters.every((c) => c.region === "REDACTED")).toBe(true);
    expect(publicSafe.characters.every((c) => c.character.startsWith("member-"))).toBe(
      true,
    );
    expect(publicSafe.characters.some((c) => /Excellent|Tank|Healer/.test(c.character))).toBe(
      false,
    );
    const artifacts = buildCalibrationArtifacts(report);
    expect(artifacts.publicSafeJson).toContain("REDACTED");
    expect(artifacts.csv.split("\n")[0]).toContain("memberId");
    expect(artifacts.markdown).toContain("Calibration harness report");
  });

  it("retains U and low-confidence cases in output", () => {
    const report = runCalibrationHarness(
      fixture.manifest,
      {
        mode: "persisted-snapshot-only",
        activeModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      { evidence },
    );
    const sparse = report.characters.find((c) => c.memberId === "fx-dps-sparse-u");
    const hidden = report.characters.find((c) => c.memberId === "fx-healer-low-conf");
    expect(sparse).toBeTruthy();
    expect(hidden).toBeTruthy();
    expect(sparse!.isUnrated || sparse!.lowConfidence || sparse!.grade === "U").toBe(true);
    expect(hidden!.lowConfidence || hidden!.isUnrated || (hidden!.confidence ?? 1) < 0.5).toBe(
      true,
    );
    expect(report.statistics.missingDataSlices.some((s) => s.count > 0)).toBe(true);
  });

  it("exposes Agent 08 admin adapter with versioned schema", () => {
    const result = runAdminCalibrationBacktest({
      scoreModelId: "model-uuid-fixture",
      manifest: fixture.manifest,
      options: {
        mode: "persisted-snapshot-only",
        activeModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
      },
      deps: { evidence },
      publicSafe: true,
    });
    expect(result.validationErrors).toEqual([]);
    expect(result.summary.scoreModelId).toBe("model-uuid-fixture");
    expect(result.summary.calibrationSchemaVersion).toBe(CALIBRATION_REPORT_SCHEMA_VERSION);
    expect(result.summary.modelActivated).toBe(false);
    expect(result.summary.providerCallsMade).toBe(false);
    expect(result.summary.sampleSize).toBeGreaterThan(0);
    expect(result.artifacts.report.schemaVersion).toBe(CALIBRATION_REPORT_SCHEMA_VERSION);
  });

  it("surfaces validation errors through the admin adapter", () => {
    const result = runAdminCalibrationBacktest({
      scoreModelId: "x",
      manifest: { schemaVersion: "nope" },
      options: { mode: "persisted-snapshot-only" },
      deps: { evidence },
    });
    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(result.summary.sampleSize).toBe(0);
  });
});
