import type { Grade } from "@mplus/contracts";
import { LOOKUP_TEST_VECTORS } from "./constants.js";
import type { AddonExportInput } from "./types.js";

const FIRST_NAMES = [
  "Aelindra",
  "Boostling",
  "Cinder",
  "Dawnbreak",
  "Elara",
  "Frostweave",
  "Glimmer",
  "Halcyon",
  "Ithildin",
  "Jorvik",
];

const REALM_SLUGS = [
  "argent-dawn",
  "kazzak",
  "ravencrest",
  "silvermoon",
  "tarren-mill",
  "twisting-nether",
  "draenor",
  "stormrage",
];

const RED_FLAG_POOL = [
  [],
  ["boost_suspected"],
  ["atypical_progression"],
  ["logs_hidden"],
  ["insufficient_data"],
  ["probable_reroll"],
  ["boost_suspected", "atypical_progression"],
  ["logs_hidden", "insufficient_data"],
];

const GRADES: Grade[] = ["S", "A", "B", "C", "D"];

export function generateSyntheticRecords(count: number, generatedAt: string): AddonExportInput[] {
  const records: AddonExportInput[] = [];

  for (let i = 0; i < count; i += 1) {
    const realmSlug = REALM_SLUGS[i % REALM_SLUGS.length]!;
    const baseName = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const name = count <= FIRST_NAMES.length ? baseName : `${baseName}${i}`;
    const score = 45 + (i * 17) % 56;
    const grade = GRADES[Math.min(GRADES.length - 1, Math.floor(score / 20))]!;
    const runCount = 20 + (i % 80);
    const top25 = score >= 85;
    const baseline = i % 3 !== 0;
    const stale = i % 97 === 0;
    const searchedOnly = i % 53 === 0;

    records.push({
      region: "EU",
      realmSlug,
      name,
      overallScore: score,
      grade,
      confidence: 0.25 + (i % 75) / 100,
      calculatedAt: new Date(Date.parse(generatedAt) - (i % 30) * 86_400_000).toISOString(),
      runCount,
      baselineDungeonComplete: baseline,
      top25Percent: top25,
      stale,
      searchedOnly,
      redFlagKeys: RED_FLAG_POOL[i % RED_FLAG_POOL.length]!,
      profileKey: `p${i.toString(36)}`,
    });
  }

  return records;
}

export function buildFixtureRecords(generatedAt: string): AddonExportInput[] {
  const core: AddonExportInput[] = LOOKUP_TEST_VECTORS.map((vector, index) => ({
    region: vector.region,
    realmSlug: vector.realmSlug,
    name: vector.name,
    overallScore: vector.score,
    grade: vector.grade,
    confidence: vector.confidence,
    calculatedAt: generatedAt,
    runCount: 25 + index,
    baselineDungeonComplete: true,
    top25Percent: vector.grade === "S",
    stale: false,
    redFlagKeys: [...vector.redFlagKeys],
    profileKey: `vec${index}`,
  }));

  const extras: AddonExportInput[] = [
    {
      region: "EU",
      realmSlug: "ravencrest",
      name: "Sparseprofile",
      overallScore: 52,
      grade: "C",
      confidence: 0.18,
      calculatedAt: generatedAt,
      runCount: 8,
      baselineDungeonComplete: false,
      top25Percent: false,
      stale: false,
      redFlagKeys: ["insufficient_data"],
      searchedOnly: false,
    },
    {
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Staleplayer",
      overallScore: 76,
      grade: "A",
      confidence: 0.7,
      calculatedAt: new Date(Date.parse(generatedAt) - 120 * 86_400_000).toISOString(),
      runCount: 40,
      baselineDungeonComplete: true,
      top25Percent: false,
      stale: true,
      redFlagKeys: [],
    },
    {
      region: "EU",
      realmSlug: "draenor",
      name: "Searchonly",
      overallScore: 63,
      grade: "B",
      confidence: 0.5,
      calculatedAt: generatedAt,
      runCount: 5,
      baselineDungeonComplete: false,
      top25Percent: false,
      stale: false,
      searchedOnly: true,
      redFlagKeys: ["insufficient_data"],
    },
    {
      region: "EU",
      realmSlug: "stormrage",
      name: "Tankmain",
      overallScore: 84,
      grade: "A",
      confidence: 0.82,
      calculatedAt: generatedAt,
      runCount: 55,
      baselineDungeonComplete: true,
      top25Percent: true,
      stale: false,
      redFlagKeys: [],
      profileKey: "tank01",
    },
    {
      region: "EU",
      realmSlug: "silvermoon",
      name: "Healbot",
      overallScore: 79,
      grade: "B",
      confidence: 0.77,
      calculatedAt: generatedAt,
      runCount: 48,
      baselineDungeonComplete: true,
      top25Percent: false,
      stale: false,
      redFlagKeys: ["probable_reroll"],
      profileKey: "heal01",
    },
    {
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Rerollpro",
      overallScore: 88,
      grade: "A",
      confidence: 0.74,
      calculatedAt: generatedAt,
      runCount: 32,
      baselineDungeonComplete: true,
      top25Percent: true,
      stale: false,
      redFlagKeys: ["confirmed_reroll"],
      profileKey: "reroll01",
    },
  ];

  return [...core, ...extras];
}
