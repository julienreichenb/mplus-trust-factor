import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";

const rawPath =
  "raw-artifacts/wcl-probe-performance/eu-archimonde-wallidrixe/02-zone-rankings-points-and-damage.json";
const czPath =
  "raw-artifacts/wcl-probe-performance/eu-archimonde-wallidrixe/01-character-zone.json";

const rankingsFile = JSON.parse(readFileSync(rawPath, "utf8"));
const cz = JSON.parse(readFileSync(czPath, "utf8"));
const raw = rankingsFile.rawZoneRankings;

const fixtureDir = "tools/fixtures/warcraftlogs";
mkdirSync(fixtureDir, { recursive: true });

const fixture = {
  scenario: "wallidrixe-points-and-damage",
  identity: rankingsFile.identity,
  character: cz.character,
  zone: cz.zone,
  rawZoneRankingsPointsAndDamage: raw,
  expected: {
    totalMythicPlusScore: 4133.25,
    totalLoggedRuns: 143,
    bestDpsPercentileAverage: 80.875,
    medianDpsPercentileAverage: 77,
    wclBestPerformanceAverage: 80.875,
    wclMedianPerformanceAverage: 77,
    dungeons: [
      { name: "Algeth'ar Academy", encounterId: 112526, best: 72, median: 72 },
      { name: "Magisters' Terrace", encounterId: 12811, best: 91, median: 80 },
      { name: "Maisara Caverns", encounterId: 12874, best: 77, median: 77 },
      { name: "Nexus-Point Xenas", encounterId: 12915, best: 86, median: 86 },
      { name: "Pit of Saron", encounterId: 10658, best: 95, median: 75 },
      { name: "Seat of the Triumvirate", encounterId: 361753, best: 59, median: 59 },
      { name: "Skyreach", encounterId: 61209, best: 98, median: 98 },
      { name: "Windrunner Spire", encounterId: 12805, best: 69, median: 69 },
    ],
  },
};

const out = `${fixtureDir}/wallidrixe-points-and-damage.json`;
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
console.log("wrote", out);

for (const f of [
  "wallidrixe-zone-rankings-score.json",
  "wallidrixe-zone-rankings-execution.json",
  "wallidrixe-performance-merged.json",
]) {
  try {
    unlinkSync(`${fixtureDir}/${f}`);
    console.log("removed", f);
  } catch {
    /* missing ok */
  }
}
