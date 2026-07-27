import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtureRecords } from "./synthetic.js";

const TOOL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedAt = "2026-07-27T09:00:00.000Z";

const fixture = {
  context: {
    formatVersion: 1,
    generatedAt,
    region: "EU",
    seasonSlug: "season-mvp",
    scoreModelKey: "default",
    scoreModelVersion: 1,
  },
  records: buildFixtureRecords(generatedAt),
};

writeFileSync(
  join(TOOL_ROOT, "fixtures/score-snapshots.json"),
  `${JSON.stringify(fixture, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${fixture.records.length} fixture records`);
