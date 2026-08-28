import { readFileSync } from "node:fs";
import { resolveWorkspacePath } from "../refresh/extract/workspace-path.js";
import { runShadowCatalogRefresh, formatShadowRefreshSummary } from "../refresh/pipeline.js";
import { importBlizzardRefreshSnapshot } from "../refresh/sources/blizzard.js";
import { importSimcSpellQuerySnapshot } from "../refresh/sources/simc.js";
import { writeJsonAtomic } from "../refresh/extract/atomic-write.js";
import {
  GOLDEN_BLIZZARD_SNAPSHOT,
  GOLDEN_SIMC_SNAPSHOT,
} from "../refresh/fixtures/golden-retail.js";
import type { SimcSpellQueryExport } from "../refresh/sources/simc.js";
import type { BlizzardRefreshSnapshotFile } from "../refresh/sources/blizzard.js";

function arg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function printUsage(): never {
  console.error(`Usage:
  pnpm ability-catalog:refresh:shadow -- --blizzard <file.json> --simc <file.json> [--previous-simc <file.json>] [--out report.json] [--json]
  pnpm ability-catalog:refresh:shadow -- --fixtures [--out report.json]

Golden/demo fixtures require explicit --fixtures or --demo.
Without snapshot files the command fails; it will not silently audit Retail.`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const useFixtures = argv.includes("--fixtures") || argv.includes("--demo");
const previousSimcPath = arg(argv, "--previous-simc");
const blizzardPath = arg(argv, "--blizzard");
const simcPath = arg(argv, "--simc");
const out = arg(argv, "--out");
const json = argv.includes("--json");

if (!useFixtures && (!blizzardPath || !simcPath)) {
  printUsage();
}

let snapshots;
let currentSimcFile: SimcSpellQueryExport | undefined;
if (useFixtures) {
  console.error("WARNING: --fixtures selected. GOLDEN DEMO DATA — not a pinned current-Retail audit.");
  snapshots = [
    importBlizzardRefreshSnapshot(GOLDEN_BLIZZARD_SNAPSHOT),
    importSimcSpellQuerySnapshot(GOLDEN_SIMC_SNAPSHOT),
  ];
  currentSimcFile = GOLDEN_SIMC_SNAPSHOT;
} else {
  const blizzard = JSON.parse(readFileSync(resolveWorkspacePath(blizzardPath!), "utf8")) as BlizzardRefreshSnapshotFile;
  const simc = JSON.parse(readFileSync(resolveWorkspacePath(simcPath!), "utf8")) as SimcSpellQueryExport;
  currentSimcFile = simc;
  snapshots = [importBlizzardRefreshSnapshot(blizzard), importSimcSpellQuerySnapshot(simc)];
}

const started = Date.now();
const { report, topologyClassification, racialAudit, currentRuleEvidence } = runShadowCatalogRefresh({
  snapshots,
  previousSimc: previousSimcPath
    ? (JSON.parse(readFileSync(resolveWorkspacePath(previousSimcPath), "utf8")) as SimcSpellQueryExport)
    : undefined,
  currentSimc: currentSimcFile,
});
const durationMs = Date.now() - started;

const summary = [
  formatShadowRefreshSummary(report),
  `normalize+diff durationMs=${durationMs}`,
  `topology classes MATCHED=${topologyClassification.classes.filter((r) => r.kind === "MATCHED").length} EXTERNAL_ONLY=${topologyClassification.classes.filter((r) => r.kind === "EXTERNAL_ONLY").length} CURRENT_MATRIX_ONLY=${topologyClassification.classes.filter((r) => r.kind === "CURRENT_MATRIX_ONLY").length}`,
  `topology specs MATCHED=${topologyClassification.specs.filter((r) => r.kind === "MATCHED").length} EXTERNAL_ONLY=${topologyClassification.specs.filter((r) => r.kind === "EXTERNAL_ONLY").length} CURRENT_MATRIX_ONLY=${topologyClassification.specs.filter((r) => r.kind === "CURRENT_MATRIX_ONLY").length}`,
  `racial races=${racialAudit.length}`,
].join("\n");
console.log(summary);

const payload = {
  ...report,
  topologyClassification,
  racialAudit,
  currentRuleEvidence,
};

if (json && !out) {
  console.log(JSON.stringify(payload, null, 2));
}
if (out) {
  writeJsonAtomic(resolveWorkspacePath(out), payload);
  console.log(`Wrote ${out}`);
}

if (!useFixtures && report.datasetKind !== "PINNED") {
  console.error(`ERROR ACCEPTANCE: datasetKind must be PINNED (got ${report.datasetKind})`);
  process.exit(1);
}

if (!report.validation.valid) {
  process.exitCode = 1;
}
