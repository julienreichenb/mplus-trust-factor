import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOffensiveCandidateCatalog } from "../offensive/build.js";

const generatedAt = process.env.OFFENSIVE_CATALOG_BUILD_TIME ?? new Date().toISOString();
const { catalog, review } = await buildOffensiveCandidateCatalog({ nowIso: generatedAt });

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../../generated/offensive");
mkdirSync(outDir, { recursive: true });

const candidatesPath = join(outDir, "candidates.json");
const reviewPath = join(outDir, "review-report.json");
const snapshotPath = join(outDir, "source-snapshots.json");

writeFileSync(candidatesPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
writeFileSync(reviewPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
writeFileSync(
  snapshotPath,
  `${JSON.stringify(
    {
      generatedAt: catalog.generatedAt,
      gameVersion: catalog.gameVersion,
      catalogVersion: catalog.catalogVersion,
      snapshots: catalog.sourceSnapshots.map((s) => ({
        adapterId: s.meta.adapterId,
        kind: s.meta.kind,
        licenseNote: s.meta.licenseNote,
        mayProposeClassification: s.meta.mayProposeClassification,
        candidateCount: s.candidates.length,
      })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log("Offensive catalog build complete");
console.log(`  candidates: ${catalog.stats.candidateCount}`);
console.log(`  matched reviewed: ${catalog.stats.matchedReviewedCount}`);
console.log(`  new unmatched: ${catalog.stats.unmatchedCandidateCount}`);
console.log(`  coverage seeds: ${catalog.stats.coverageSeedCount}`);
console.log(`Wrote ${candidatesPath}`);
console.log(`Wrote ${reviewPath}`);
console.log(`Wrote ${snapshotPath}`);
console.log("Note: reviewed canonical entries were not modified.");
