import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAbilityCatalog } from "../validation.js";

const report = validateAbilityCatalog();
const outPath = join(dirname(fileURLToPath(import.meta.url)), "../../generated/validation-report.json");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Ability catalog validation: ${report.valid ? "PASS" : "FAIL"}`);
console.log(`Errors: ${report.errors.length}, warnings: ${report.warnings.length}`);
for (const issue of report.errors) {
  console.error(`  [error] ${issue.code}: ${issue.message}`);
}
for (const issue of report.warnings.slice(0, 40)) {
  console.warn(`  [warn] ${issue.code}: ${issue.message}`);
}
if (report.warnings.length > 40) {
  console.warn(`  … ${report.warnings.length - 40} more warnings`);
}
console.log(`Wrote ${outPath}`);

if (!report.valid) {
  process.exitCode = 1;
}
