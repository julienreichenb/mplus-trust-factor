import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCoverageReport, formatCoverageReport } from "../coverage.js";

const report = buildCoverageReport();
const text = formatCoverageReport(report);
const outDir = join(dirname(fileURLToPath(import.meta.url)), "../../generated");
const jsonPath = join(outDir, "coverage-report.json");
const textPath = join(outDir, "coverage-report.txt");

mkdirSync(outDir, { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(textPath, `${text}\n`, "utf8");

console.log(text);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${textPath}`);
