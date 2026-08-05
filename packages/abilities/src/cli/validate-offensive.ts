import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OffensiveCandidateCatalog } from "../offensive/build.js";
import {
  buildOffensiveCoverageMatrix,
  formatOffensiveCoverageReport,
} from "../offensive/coverage.js";
import { validateOffensiveCatalog } from "../offensive/validate.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../../generated/offensive");
const candidatesPath = join(outDir, "candidates.json");

let candidates: OffensiveCandidateCatalog | null = null;
if (existsSync(candidatesPath)) {
  candidates = JSON.parse(readFileSync(candidatesPath, "utf8")) as OffensiveCandidateCatalog;
}

const generatedAt = process.env.OFFENSIVE_CATALOG_BUILD_TIME ?? new Date().toISOString();
const report = validateOffensiveCatalog({ candidates, nowIso: generatedAt });
const coverageMatrix = report.coverageMatrix ?? buildOffensiveCoverageMatrix({ nowIso: generatedAt });
const coverageMarkdown = formatOffensiveCoverageReport(coverageMatrix);

mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "validation-report.json");
const matrixPath = join(outDir, "coverage-matrix.json");
const coverageReportPath = join(outDir, "coverage-report.md");

writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(matrixPath, `${JSON.stringify(coverageMatrix, null, 2)}\n`, "utf8");
writeFileSync(coverageReportPath, coverageMarkdown, "utf8");

console.log(`Offensive catalog validation: ${report.valid ? "PASS" : "FAIL"}`);
console.log("");
console.log("Totals");
console.log(`  playable classes:              ${report.totals.playableClasses}`);
console.log(`  playable specializations:      ${report.totals.playableSpecializations}`);
console.log(`  covered specializations:       ${report.totals.coveredSpecializations}`);
console.log(`  exempt specializations:        ${report.totals.exemptSpecializations}`);
console.log(`  uncovered specializations:     ${report.totals.uncoveredSpecializations}`);
console.log(`  reviewed canonical abilities:  ${report.totals.reviewedCanonicalAbilities}`);
console.log("");
console.log("Scope distinction");
console.log(
  `  full Retail coverage:           ${report.scopes.fullRetailSpecializationCoverage ? "yes" : "no"}`,
);
console.log(
  `  same-fight party classes:       ${report.scopes.sameFightObservedValidation.partyClassSlugs.join(", ")}`,
);
console.log(
  `  specs not in five-player party: ${report.scopes.classesSpecsNotInFivePlayerTestParty.length}`,
);
console.log(`Errors: ${report.errors.length}, warnings: ${report.warnings.length}`);
for (const issue of report.errors) {
  console.error(`  [error] ${issue.code}: ${issue.message}`);
}
for (const issue of report.warnings.slice(0, 30)) {
  console.warn(`  [warn] ${issue.code}: ${issue.message}`);
}
if (report.warnings.length > 30) {
  console.warn(`  … ${report.warnings.length - 30} more warnings`);
}
console.log(`Wrote ${outPath}`);
console.log(`Wrote ${matrixPath}`);
console.log(`Wrote ${coverageReportPath}`);

if (!report.valid) {
  process.exitCode = 1;
}
