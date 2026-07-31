#!/usr/bin/env node
/**
 * CLI for the calibration harness.
 *
 * Usage:
 *   node dist/calibration/cli.js --fixture --mode persisted-snapshot-only --out ./tmp/cal
 *   node dist/calibration/cli.js --bundle ./path/bundle.json --mode draft-model-evaluate --out ./tmp/cal
 *   node dist/calibration/cli.js --bundle ./path/bundle.json --public-safe --out ./tmp/cal
 *
 * Does not call live providers. Does not activate models.
 * Never silently falls back to fixtures when --bundle is supplied.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDefaultModelV6 } from "../model/defaults.js";
import { runCalibrationHarnessFromBundle } from "./async-boundary.js";
import {
  buildCalibrationArtifacts,
  buildSyntheticFixtureBundle,
  buildSyntheticFixtureCohort,
  createFixtureEvidencePort,
  runCalibrationHarness,
  validateCalibrationInputBundle,
  type CalibrationBacktestMode,
  type CalibrationModelRef,
} from "./index.js";

interface CliArgs {
  mode: CalibrationBacktestMode;
  outDir: string;
  help: boolean;
  fixture: boolean;
  bundlePath: string | null;
  publicSafe: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    mode: "persisted-snapshot-only",
    outDir: resolve(process.cwd(), "tmp/calibration-harness"),
    help: false,
    fixture: false,
    bundlePath: null,
    publicSafe: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    if (arg === "--fixture") out.fixture = true;
    if (arg === "--public-safe") out.publicSafe = true;
    if (arg === "--bundle") {
      out.bundlePath = resolve(process.cwd(), argv[++i] ?? "");
    }
    if (arg === "--mode") {
      const value = argv[++i];
      if (
        value === "persisted-snapshot-only" ||
        value === "draft-model-evaluate" ||
        value === "active-versus-draft"
      ) {
        out.mode = value;
      } else if (value === "refresh-then-evaluate") {
        throw new Error(
          "UNSUPPORTED_MODE: refresh-then-evaluate is not executable (no provider refresh port)",
        );
      } else {
        throw new Error(`Unknown mode: ${value}`);
      }
    }
    if (arg === "--out") {
      out.outDir = resolve(process.cwd(), argv[++i] ?? out.outDir);
    }
  }
  return out;
}

function writeArtifacts(
  outDir: string,
  artifacts: ReturnType<typeof buildCalibrationArtifacts>,
  publicSafe: boolean,
): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "report.json"), artifacts.json);
  writeFileSync(resolve(outDir, "report.csv"), artifacts.csv);
  writeFileSync(resolve(outDir, "report.md"), artifacts.markdown);
  writeFileSync(resolve(outDir, "report.public.json"), artifacts.publicSafeJson);
  writeFileSync(resolve(outDir, "report.public.md"), artifacts.publicSafeMarkdown);
  if (publicSafe) {
    writeFileSync(resolve(outDir, "report.primary.json"), artifacts.publicSafeJson);
  }
}

function main(): void {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    process.stdout.write(
      "Usage: calibration:harness (--fixture | --bundle <path>) [--mode persisted-snapshot-only|draft-model-evaluate|active-versus-draft] [--out dir] [--public-safe]\n",
    );
    return;
  }

  if (args.bundlePath && args.fixture) {
    process.stderr.write("Provide either --fixture or --bundle, not both.\n");
    process.exitCode = 1;
    return;
  }

  if (!args.bundlePath && !args.fixture) {
    // Backward-compatible default: explicit fixture mode when neither flag given.
    args.fixture = true;
    process.stderr.write(
      "warning: neither --fixture nor --bundle supplied; defaulting to --fixture (explicit in future releases)\n",
    );
  }

  try {
    if (args.bundlePath) {
      const raw = JSON.parse(readFileSync(args.bundlePath, "utf8")) as unknown;
      const validated = validateCalibrationInputBundle(raw);
      if (!validated.ok || !validated.bundle) {
        process.stderr.write(
          `Invalid bundle:\n${validated.errors.map((e) => `- [${e.code}] ${e.message}`).join("\n")}\n`,
        );
        process.exitCode = 1;
        return;
      }

      let evaluationModel = validated.bundle.evaluationModel;
      let activeModel = validated.bundle.activeModel;
      if (args.mode === "draft-model-evaluate" || args.mode === "active-versus-draft") {
        if (!evaluationModel) {
          const draftConfig = createDefaultModelV6({ version: 6 });
          evaluationModel = {
            id: "cli-draft",
            key: draftConfig.key,
            version: draftConfig.version,
            status: "DRAFT",
            config: draftConfig,
            isActive: false,
          };
        }
        if (args.mode === "active-versus-draft" && !activeModel) {
          process.stderr.write(
            "active-versus-draft requires activeModel in the bundle (or use --fixture).\n",
          );
          process.exitCode = 1;
          return;
        }
      }

      const { report } = runCalibrationHarnessFromBundle(validated.bundle, {
        mode: args.mode,
        activeModel,
        evaluationModel,
        calculatedAt: validated.bundle.generatedAt,
        bootstrapSeed: 42,
      });

      if (report.errorCount > 0 && report.evaluatedCount === 0) {
        process.stderr.write(
          `Fatal evaluation failure: evaluated=0 errors=${report.errorCount} validationFailures=${report.validationFailureCount}\n`,
        );
        process.exitCode = 1;
      }

      const artifacts = buildCalibrationArtifacts(report);
      writeArtifacts(args.outDir, artifacts, args.publicSafe);
      writeFileSync(
        resolve(args.outDir, "input.bundle.json"),
        `${JSON.stringify(validated.bundle, null, 2)}\n`,
      );
      process.stdout.write(
        `Wrote calibration artifacts to ${args.outDir}\n` +
          `source=bundle mode=${report.mode} evaluated=${report.evaluatedCount} ` +
          `errors=${report.errorCount} validationFailures=${report.validationFailureCount} ` +
          `activated=${report.modelActivated} providers=${report.providerCallsMade}\n`,
      );
      return;
    }

    // Explicit fixture path
    const fixture = buildSyntheticFixtureCohort();
    const evidence = createFixtureEvidencePort(fixture.evidenceById);
    const activeModel: CalibrationModelRef = {
      ...fixture.modelRef,
      status: "ACTIVE",
      isActive: true,
    };

    let evaluationModel: CalibrationModelRef | undefined = fixture.modelRef;
    if (args.mode === "draft-model-evaluate" || args.mode === "active-versus-draft") {
      evaluationModel = {
        ...fixture.modelRef,
        id: "cli-draft-fixture",
        status: "DRAFT",
        isActive: false,
      };
    }

    const report = runCalibrationHarness(
      fixture.manifest,
      {
        mode: args.mode,
        activeModel,
        evaluationModel,
        calculatedAt: "2026-07-31T12:00:00.000Z",
        bootstrapSeed: 42,
      },
      { evidence },
    );
    const artifacts = buildCalibrationArtifacts(report);
    writeArtifacts(args.outDir, artifacts, args.publicSafe);
    const bundle = buildSyntheticFixtureBundle();
    writeFileSync(
      resolve(args.outDir, "cohort.manifest.json"),
      `${JSON.stringify(fixture.manifest, null, 2)}\n`,
    );
    writeFileSync(
      resolve(args.outDir, "input.bundle.json"),
      `${JSON.stringify(bundle, null, 2)}\n`,
    );
    process.stdout.write(
      `Wrote calibration artifacts to ${args.outDir}\n` +
        `source=fixture mode=${report.mode} evaluated=${report.evaluatedCount} ` +
        `activated=${report.modelActivated} providers=${report.providerCallsMade}\n`,
    );
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

main();
