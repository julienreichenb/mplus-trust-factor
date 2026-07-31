import type { CalibrationInputBundleV1, CalibrationRunOptions } from "./types.js";
import { validateCalibrationInputBundle } from "./bundle.js";
import { createFixtureEvidencePort } from "./fixture-cohort.js";
import { runCalibrationHarness } from "./evaluate.js";
import type { CalibrationReport } from "./types.js";
import { buildCalibrationArtifacts } from "./reports.js";
import type { CalibrationArtifacts } from "./types.js";

/**
 * Async integration boundary for Agent 08.
 *
 * Preferred flow:
 *   async DB/export adapter
 *     → builds validated CalibrationInputBundle
 *     → pure synchronous calibration core
 *
 * This helper awaits an async evidence/export port, materializes an immutable
 * bundle, validates it, then delegates to the pure harness. The scoring package
 * must not import Prisma, API, or worker containers.
 */
export interface CalibrationBundleExportPort {
  /**
   * Preload all cohort evidence + model refs into a portable bundle.
   * Implementations live outside packages/scoring (Agent 08 / API).
   * Must not enqueue provider refresh from the backtest path.
   */
  exportBundle(): Promise<unknown>;
}

export interface RunCalibrationFromExportInput {
  port: CalibrationBundleExportPort;
  options: CalibrationRunOptions;
  publicSafe?: boolean;
}

export interface RunCalibrationFromExportResult {
  report: CalibrationReport;
  artifacts: CalibrationArtifacts;
  bundle: CalibrationInputBundleV1;
  validationErrors: string[];
}

/**
 * Await async export → validate bundle → run pure sync core.
 * Never performs DB reads itself.
 */
export async function runCalibrationHarnessFromExport(
  input: RunCalibrationFromExportInput,
): Promise<RunCalibrationFromExportResult> {
  const raw = await input.port.exportBundle();
  const validated = validateCalibrationInputBundle(raw);
  if (!validated.ok || !validated.bundle) {
    throw new Error(
      `Invalid calibration export bundle: ${validated.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const bundle = validated.bundle;
  const evidence = createFixtureEvidencePort(
    new Map(Object.entries(bundle.evidenceByMemberId)),
  );

  const report = runCalibrationHarness(
    bundle.manifest,
    {
      ...input.options,
      mode: input.options.mode ?? bundle.mode ?? "persisted-snapshot-only",
      activeModel: input.options.activeModel ?? bundle.activeModel,
      evaluationModel: input.options.evaluationModel ?? bundle.evaluationModel,
    },
    { evidence },
  );

  const artifacts = buildCalibrationArtifacts(report);
  return {
    report: input.publicSafe ? artifacts.publicSafeReport : report,
    artifacts,
    bundle,
    validationErrors: [],
  };
}

/**
 * Synchronous entry when Agent 08 (or tests) already materialised a bundle.
 */
export function runCalibrationHarnessFromBundle(
  bundleInput: unknown,
  options: CalibrationRunOptions,
): { report: CalibrationReport; bundle: CalibrationInputBundleV1 } {
  const validated = validateCalibrationInputBundle(bundleInput);
  if (!validated.ok || !validated.bundle) {
    throw new Error(
      `Invalid calibration input bundle: ${validated.errors.map((e) => e.message).join("; ")}`,
    );
  }
  const bundle = validated.bundle;
  const evidence = createFixtureEvidencePort(
    new Map(Object.entries(bundle.evidenceByMemberId)),
  );
  const report = runCalibrationHarness(
    bundle.manifest,
    {
      ...options,
      mode: options.mode ?? bundle.mode ?? "persisted-snapshot-only",
      activeModel: options.activeModel ?? bundle.activeModel,
      evaluationModel: options.evaluationModel ?? bundle.evaluationModel,
    },
    { evidence },
  );
  return { report, bundle };
}
