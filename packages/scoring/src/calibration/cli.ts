#!/usr/bin/env node
/**
 * CLI for the calibration harness (fixture / persisted modes only).
 *
 * Usage:
 *   pnpm --filter @mplus/scoring exec tsx src/calibration/cli.ts
 *   pnpm --filter @mplus/scoring exec tsx src/calibration/cli.ts --mode draft-model-evaluate --out ./tmp/calibration
 *
 * Does not call live providers. Does not activate models.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDefaultModelV6 } from "../model/defaults.js";
import {
  buildCalibrationArtifacts,
  buildSyntheticFixtureCohort,
  createFixtureEvidencePort,
  runCalibrationHarness,
  type CalibrationBacktestMode,
  type CalibrationModelRef,
} from "./index.js";

function parseArgs(argv: string[]) {
  const out: { mode: CalibrationBacktestMode; outDir: string; help: boolean } = {
    mode: "persisted-snapshot-only",
    outDir: resolve(process.cwd(), "tmp/calibration-harness"),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    if (arg === "--mode") {
      const value = argv[++i];
      if (
        value === "persisted-snapshot-only" ||
        value === "draft-model-evaluate" ||
        value === "refresh-then-evaluate"
      ) {
        out.mode = value;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "Usage: tsx src/calibration/cli.ts [--mode persisted-snapshot-only|draft-model-evaluate] [--out dir]\n",
    );
    return;
  }

  if (args.mode === "refresh-then-evaluate") {
    throw new Error(
      "refresh-then-evaluate is disabled in the CLI (no live provider budget). Use persisted or draft modes.",
    );
  }

  const fixture = buildSyntheticFixtureCohort();
  const evidence = createFixtureEvidencePort(fixture.evidenceById);
  const activeModel: CalibrationModelRef = {
    ...fixture.modelRef,
    status: "ACTIVE",
    isActive: true,
  };

  let evaluationModel: CalibrationModelRef | undefined;
  if (args.mode === "draft-model-evaluate") {
    const draftConfig = createDefaultModelV6({ version: 7 });
    evaluationModel = {
      id: "cli-draft",
      key: draftConfig.key,
      version: draftConfig.version,
      status: "DRAFT",
      config: draftConfig,
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

  mkdirSync(args.outDir, { recursive: true });
  writeFileSync(resolve(args.outDir, "report.json"), artifacts.json);
  writeFileSync(resolve(args.outDir, "report.csv"), artifacts.csv);
  writeFileSync(resolve(args.outDir, "report.md"), artifacts.markdown);
  writeFileSync(resolve(args.outDir, "report.public.json"), artifacts.publicSafeJson);
  writeFileSync(resolve(args.outDir, "report.public.md"), artifacts.publicSafeMarkdown);
  writeFileSync(
    resolve(args.outDir, "cohort.manifest.json"),
    `${JSON.stringify(fixture.manifest, null, 2)}\n`,
  );

  process.stdout.write(
    `Wrote calibration artifacts to ${args.outDir}\n` +
      `mode=${report.mode} evaluated=${report.evaluatedCount} activated=${report.modelActivated} providers=${report.providerCallsMade}\n`,
  );
}

main();
