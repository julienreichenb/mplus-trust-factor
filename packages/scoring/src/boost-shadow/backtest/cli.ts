#!/usr/bin/env node
/**
 * CLI for boost-shadow Phase 2 offline backtest.
 *
 * Usage:
 *   node dist/boost-shadow/backtest/cli.js --fixture --out ./tmp/boost-shadow-phase2
 *   node dist/boost-shadow/backtest/cli.js --bundle ./path/bundle.json --out ./tmp/boost-shadow-phase2
 *   node dist/boost-shadow/backtest/cli.js --fixture --public-safe --out ./tmp/boost-shadow-phase2
 *
 * Shadow-only: no provider calls, no ScoreSnapshot writes, no authenticity write-back.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateBoostShadowEvidenceBundle } from "./evidence.js";
import { runBoostShadowBacktestFromBundle } from "./evaluate.js";
import { buildPhase2FixtureBundle } from "./fixture-cohort.js";
import { validateBoostShadowCohortManifest } from "./manifest.js";
import { buildBacktestArtifacts } from "./reports.js";

interface CliArgs {
  outDir: string;
  help: boolean;
  fixture: boolean;
  bundlePath: string | null;
  publicSafe: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    outDir: resolve(process.cwd(), "tmp/boost-shadow-phase2"),
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
    if (arg === "--out") {
      out.outDir = resolve(process.cwd(), argv[++i] ?? out.outDir);
    }
  }
  return out;
}

function writeArtifacts(
  outDir: string,
  artifacts: ReturnType<typeof buildBacktestArtifacts>,
  publicSafe: boolean,
): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "report.json"), artifacts.json);
  writeFileSync(resolve(outDir, "report.csv"), artifacts.csv);
  writeFileSync(resolve(outDir, "report.md"), artifacts.markdown);
  writeFileSync(resolve(outDir, "report.public.json"), artifacts.publicSafeJson);
  writeFileSync(resolve(outDir, "report.public.csv"), artifacts.publicSafeCsv);
  writeFileSync(resolve(outDir, "report.public.md"), artifacts.publicSafeMarkdown);
  if (publicSafe) {
    writeFileSync(resolve(outDir, "report.primary.json"), artifacts.publicSafeJson);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "Usage: boost-shadow:backtest (--fixture | --bundle <path>) [--out dir] [--public-safe]\n" +
        "Shadow-only Phase 2 harness. No provider calls. No production score effect.\n",
    );
    return;
  }

  if (args.bundlePath && args.fixture) {
    process.stderr.write("Provide either --fixture or --bundle, not both.\n");
    process.exitCode = 1;
    return;
  }
  if (!args.bundlePath && !args.fixture) {
    args.fixture = true;
    process.stderr.write(
      "warning: neither --fixture nor --bundle supplied; defaulting to --fixture\n",
    );
  }

  try {
    if (args.bundlePath) {
      const raw = JSON.parse(readFileSync(args.bundlePath, "utf8")) as unknown;
      const validated = validateBoostShadowEvidenceBundle(raw);
      if (!validated.ok || !validated.bundle) {
        process.stderr.write(
          `Invalid bundle:\n${validated.errors.map((e) => `- ${e}`).join("\n")}\n`,
        );
        process.exitCode = 1;
        return;
      }
      const manifestCheck = validateBoostShadowCohortManifest(validated.bundle.manifest);
      if (!manifestCheck.ok || !manifestCheck.manifest) {
        process.stderr.write(
          `Invalid manifest:\n${manifestCheck.errors.map((e) => `- ${e}`).join("\n")}\n`,
        );
        process.exitCode = 1;
        return;
      }

      const { report, mutationGuard } = runBoostShadowBacktestFromBundle({
        manifest: manifestCheck.manifest,
        evidenceByMemberId: validated.bundle.evidenceByMemberId,
        generatedAt: validated.bundle.generatedAt,
      });
      mutationGuard.assertNoProviderCalls();
      mutationGuard.assertNoWrites();

      const artifacts = buildBacktestArtifacts(report);
      writeArtifacts(args.outDir, artifacts, args.publicSafe);
      writeFileSync(
        resolve(args.outDir, "input.bundle.json"),
        `${JSON.stringify(validated.bundle, null, 2)}\n`,
      );
      process.stdout.write(
        `Wrote boost-shadow Phase 2 artifacts to ${args.outDir}\n` +
          `source=bundle rows=${report.rows.length} providers=${report.providerCallsMade} ` +
          `snapshotsWritten=${report.scoreSnapshotsWritten}\n`,
      );
      return;
    }

    const bundle = buildPhase2FixtureBundle();
    const { report, mutationGuard } = runBoostShadowBacktestFromBundle(bundle);
    mutationGuard.assertNoProviderCalls();
    mutationGuard.assertNoWrites();
    const artifacts = buildBacktestArtifacts(report);
    writeArtifacts(args.outDir, artifacts, args.publicSafe);
    writeFileSync(
      resolve(args.outDir, "input.bundle.json"),
      `${JSON.stringify(bundle, null, 2)}\n`,
    );
    writeFileSync(
      resolve(args.outDir, "cohort.manifest.json"),
      `${JSON.stringify(bundle.manifest, null, 2)}\n`,
    );
    process.stdout.write(
      `Wrote boost-shadow Phase 2 artifacts to ${args.outDir}\n` +
        `source=fixture rows=${report.rows.length} providers=${report.providerCallsMade}\n`,
    );
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

main();
