import type { Grade, ScoreModelConfig, ScoreSnapshotDTO } from "@mplus/contracts";

export interface DataQualityViolation {
  code: string;
  message: string;
  path?: string;
  /** Structural violations block persistence; statistical ones are warnings only. */
  severity?: "structural" | "statistical";
}

export interface DataQualityReport {
  ok: boolean;
  violations: DataQualityViolation[];
  structuralOk: boolean;
  statisticalWarnings: DataQualityViolation[];
}

function violation(
  code: string,
  message: string,
  path?: string,
  severity: "structural" | "statistical" = "structural",
): DataQualityViolation {
  return { code, message, path, severity };
}

export function assertRegionPresent(region: string | null | undefined): DataQualityViolation | null {
  if (!region || region.trim().length === 0) {
    return violation("REGION_MISSING", "Region must be present on every character/run identity");
  }
  return null;
}

export function assertScoreRange(score: number, path = "score"): DataQualityViolation | null {
  if (score < 0 || score > 100 || Number.isNaN(score)) {
    return violation("SCORE_OUT_OF_RANGE", `Score must be in 0–100, got ${score}`, path);
  }
  return null;
}

export function assertConfidenceRange(
  confidence: number,
  path = "confidence",
): DataQualityViolation | null {
  if (confidence < 0 || confidence > 1 || Number.isNaN(confidence)) {
    return violation(
      "CONFIDENCE_OUT_OF_RANGE",
      `Confidence must be in 0–1, got ${confidence}`,
      path,
    );
  }
  return null;
}

export function assertGradeMatchesThresholds(
  score: number,
  grade: Grade,
  thresholds: ScoreModelConfig["gradeThresholds"],
): DataQualityViolation | null {
  const expected: Grade =
    score >= thresholds.S
      ? "S"
      : score >= thresholds.A
        ? "A"
        : score >= thresholds.B
          ? "B"
          : score >= thresholds.C
            ? "C"
            : "D";
  if (grade !== expected) {
    return violation(
      "GRADE_MISMATCH",
      `Grade ${grade} does not match score ${score} (expected ${expected})`,
      "grade",
    );
  }
  return null;
}

export function assertDimensionWeightsSumToOne(
  weights: ScoreModelConfig["weights"],
): DataQualityViolation | null {
  const sum =
    weights.performance +
    weights.survival +
    weights.utility +
    weights.experienceConsistency +
    weights.mythicRaid;
  if (Math.abs(sum - 1) > 0.0001) {
    return violation(
      "WEIGHTS_NOT_NORMALIZED",
      `Dimension weights must sum to 1, got ${sum}`,
      "weights",
    );
  }
  return null;
}

export function assertSnapshotReferencesModel(
  snapshot: ScoreSnapshotDTO,
): DataQualityViolation | null {
  if (!snapshot.modelKey || snapshot.modelVersion < 1) {
    return violation(
      "MODEL_REFERENCE_MISSING",
      "Score snapshot must reference immutable model key and version",
      "modelKey",
    );
  }
  return null;
}

export function assertNoDuplicateFingerprints(
  fingerprints: string[],
): DataQualityViolation | null {
  const seen = new Set<string>();
  for (const fp of fingerprints) {
    if (seen.has(fp)) {
      return violation(
        "DUPLICATE_RUN_FINGERPRINT",
        `Duplicate canonical run fingerprint: ${fp}`,
        "canonicalFingerprint",
      );
    }
    seen.add(fp);
  }
  return null;
}

export function assertNoDuplicateAnalysis(
  keys: string[],
): DataQualityViolation | null {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      return violation(
        "DUPLICATE_ANALYSIS",
        `Same report revision analyzed twice: ${key}`,
        "analysisKey",
      );
    }
    seen.add(key);
  }
  return null;
}

export function assertMissingNotFabricatedZero(
  rawValue: number | null,
  normalizedValue: number | null,
  path: string,
): DataQualityViolation | null {
  if (rawValue === null && normalizedValue === 0) {
    return violation(
      "FABRICATED_ZERO",
      "Missing metric must not be stored as fake zero",
      path,
    );
  }
  return null;
}

const addonForbiddenFields = [
  "email",
  "admin",
  "premium",
  "rawPayload",
  "clientSecret",
  "battletag",
  "oauth",
];

export function assertAddonExportSafe(record: Record<string, unknown>): DataQualityViolation | null {
  for (const key of Object.keys(record)) {
    const lower = key.toLowerCase();
    if (addonForbiddenFields.some((f) => lower.includes(f.toLowerCase()))) {
      return violation(
        "ADDON_FIELD_LEAK",
        `Addon export must not include field: ${key}`,
        key,
      );
    }
  }
  return null;
}

export function validateScoreSnapshot(
  snapshot: ScoreSnapshotDTO,
  model: ScoreModelConfig,
): DataQualityReport {
  const violations: DataQualityViolation[] = [];

  const checks = [
    assertScoreRange(snapshot.overallScore, "overallScore"),
    assertScoreRange(snapshot.skillScore, "skillScore"),
    assertScoreRange(snapshot.authenticityScore, "authenticityScore"),
    assertConfidenceRange(snapshot.confidence, "confidence"),
    assertGradeMatchesThresholds(snapshot.overallScore, snapshot.grade, model.gradeThresholds),
    assertSnapshotReferencesModel(snapshot),
  ];

  for (const dim of snapshot.dimensions) {
    const scoreCheck = assertScoreRange(dim.score, `dimensions.${dim.dimension}.score`);
    const confCheck = assertConfidenceRange(
      dim.confidence,
      `dimensions.${dim.dimension}.confidence`,
    );
    if (scoreCheck) violations.push(scoreCheck);
    if (confCheck) violations.push(confCheck);
  }

  for (const check of checks) {
    if (check) violations.push(check);
  }

  const weightCheck = assertDimensionWeightsSumToOne(model.weights);
  if (weightCheck) violations.push(weightCheck);

  const structural = violations.filter((v) => (v.severity ?? "structural") === "structural");
  const statisticalWarnings = violations.filter((v) => v.severity === "statistical");

  return {
    ok: structural.length === 0,
    violations,
    structuralOk: structural.length === 0,
    statisticalWarnings,
  };
}

export function collectViolations(
  ...checks: Array<DataQualityViolation | null>
): DataQualityReport {
  const violations = checks.filter((c): c is DataQualityViolation => c !== null);
  const structural = violations.filter((v) => (v.severity ?? "structural") === "structural");
  return {
    ok: structural.length === 0,
    violations,
    structuralOk: structural.length === 0,
    statisticalWarnings: violations.filter((v) => v.severity === "statistical"),
  };
}
