import type { Grade } from "@mplus/contracts";

export const FORMAT_VERSION = 1;
export const SHARD_SCHEME = "realm_first_char_v1";

export const GRADE_TO_CODE: Record<Grade, number> = {
  S: 5,
  A: 4,
  B: 3,
  C: 2,
  D: 1,
};

export const CODE_TO_GRADE: Record<number, Grade> = {
  5: "S",
  4: "A",
  3: "B",
  2: "C",
  1: "D",
};

/** Public red-flag keys mapped to addon bitset positions. */
export const RED_FLAG_BIT: Record<string, number> = {
  boost_suspected: 1 << 0,
  atypical_progression: 1 << 1,
  logs_hidden: 1 << 2,
  insufficient_data: 1 << 3,
  probable_reroll: 1 << 4,
  confirmed_reroll: 1 << 5,
};

export const RED_FLAG_LABELS: Record<string, string> = {
  boost_suspected: "Boost suspected",
  atypical_progression: "Atypical progression",
  logs_hidden: "Logs hidden",
  insufficient_data: "Insufficient data",
  probable_reroll: "Probable reroll",
  confirmed_reroll: "Confirmed reroll",
};

/** Shared normalization / lookup test vectors (TypeScript + Lua). */
export const LOOKUP_TEST_VECTORS = [
  {
    region: "EU",
    realmSlug: "argent-dawn",
    name: "Aelindra",
    expectedKey: "EU:argent-dawn:aelindra",
    score: 92,
    grade: "S" as Grade,
    confidence: 0.88,
    redFlagKeys: [] as string[],
  },
  {
    region: "EU",
    realmSlug: "Kazzak",
    name: "Boostling",
    expectedKey: "EU:kazzak:boostling",
    score: 71,
    grade: "B" as Grade,
    confidence: 0.45,
    redFlagKeys: ["boost_suspected", "atypical_progression"],
  },
  {
    region: "EU",
    realmSlug: "twisting-nether",
    name: "Logshidden",
    expectedKey: "EU:twisting-nether:logshidden",
    score: 58,
    grade: "C" as Grade,
    confidence: 0.35,
    redFlagKeys: ["logs_hidden", "insufficient_data"],
  },
] as const;
