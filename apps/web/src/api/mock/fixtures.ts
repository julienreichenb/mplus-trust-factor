import type {
  AdminScoreModelDTO,
  CharacterIdentityInput,
  CharacterProfileView,
  EditableModelConfig,
  JobStatusDTO,
  RedFlagDTO,
  ScoreSnapshotDTO,
  ScoringRunSelectionProfileDTO,
  ScoringSelectedRunProfileDTO,
  SelectedRunView,
} from "../types";
import { deepClone } from "../../lib/clone";

const now = "2026-07-20T12:00:00.000Z";
const staleAt = "2026-07-19T08:00:00.000Z";

export const EU_REALMS = [
  { slug: "tarren-mill", name: "Tarren Mill" },
  { slug: "silvermoon", name: "Silvermoon" },
  { slug: "draenor", name: "Draenor" },
  { slug: "kazzak", name: "Kazzak" },
  { slug: "ravencrest", name: "Ravencrest" },
  { slug: "twisting-nether", name: "Twisting Nether" },
  { slug: "outland", name: "Outland" },
  { slug: "stormscale", name: "Stormscale" },
  { slug: "sylvanas", name: "Sylvanas" },
  { slug: "ghostlands", name: "Ghostlands" },
] as const;

export const DEFAULT_MODEL_CONFIG: EditableModelConfig = {
  key: "default",
  version: 1,
  weights: {
    performance: 0.32,
    survival: 0.27,
    utility: 0.23,
    experienceConsistency: 0.13,
    mythicRaid: 0.05,
  },
  authenticityBlend: {
    skillWeight: 0.6,
    authenticityWeight: 0.4,
  },
  confidenceNeutralScore: 50,
  gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
  nestedMetricWeights: {
    performance: { spec_percentile: 0.5, consistency: 0.3, contribution: 0.2 },
    survival: { deaths: 0.4, avoidable: 0.35, defensives: 0.25 },
    utility: { interrupts: 0.4, cc: 0.3, dispels: 0.3 },
    experienceConsistency: { volume: 0.4, breadth: 0.3, progression: 0.3 },
    mythicRaid: { progression: 0.6, parses: 0.4 },
  },
  confidenceParameters: {
    minRunsForFullConfidence: 20,
    shrinkageFloor: 0.35,
  },
  boostThresholds: {
    suspicionSoft: 0.45,
    suspicionHard: 0.7,
  },
};

function contributors(
  positive: string,
  negative: string,
  extras?: {
    internalWeights?: Array<{ key: string; weight: number; available?: boolean }>;
    perRunEvidence?: Array<{ dungeon: string; summary: string }>;
    missingMetrics?: string[];
  },
): unknown {
  return {
    positive: [{ label: positive, impact: 8 }],
    negative: [{ label: negative, impact: -5 }],
    internalWeights: extras?.internalWeights ?? [],
    perRunEvidence: extras?.perRunEvidence ?? [],
    missingMetrics: extras?.missingMetrics ?? [],
  };
}

function baseScore(
  characterId: string,
  overall: number,
  grade: ScoreSnapshotDTO["grade"],
  authenticity: number,
  confidence: number,
  dims: Array<{
    dimension: ScoreSnapshotDTO["dimensions"][number]["dimension"];
    score: number;
    weight: number;
    confidence: number;
    pos: string;
    neg: string;
    extras?: {
      internalWeights?: Array<{ key: string; weight: number; available?: boolean }>;
      perRunEvidence?: Array<{ dungeon: string; summary: string }>;
      missingMetrics?: string[];
    };
  }>,
  redFlags: RedFlagDTO[],
  calculatedAt: string,
): ScoreSnapshotDTO {
  return {
    characterId,
    seasonSlug: "season-tww-3",
    modelKey: "default",
    modelVersion: 1,
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore: overall,
    grade,
    skillScore: Math.min(100, overall + 3),
    authenticityScore: authenticity,
    confidence,
    calculatedAt,
    inputFingerprint: `fp-${characterId}`,
    dimensions: dims.map((d) => ({
      dimension: d.dimension,
      score: d.score,
      confidence: d.confidence,
      weight: d.weight,
      contributors: contributors(d.pos, d.neg, d.extras),
    })),
    redFlags,
    explanation: {
      summary: "Fixture explanation for UI development",
    },
  };
}

const aleriaScore = baseScore(
  "11111111-1111-4111-8111-111111111111",
  88,
  "A",
  82,
  0.78,
  [
    {
      dimension: "PERFORMANCE",
      score: 91,
      weight: 0.32,
      confidence: 0.85,
      pos: "Strong DPS percentile on +12s",
      neg: "Slight dip on Tyrannical weeks",
      extras: {
        internalWeights: [
          { key: "execution_percentile", weight: 0.65 },
          { key: "key_difficulty", weight: 0.35 },
        ],
        perRunEvidence: [
          { dungeon: "Priory of the Sacred Flame", summary: "Parse 88 · key difficulty 74" },
          { dungeon: "The Rookery", summary: "Parse 91 · key difficulty 80" },
        ],
        missingMetrics: [],
      },
    },
    {
      dimension: "SURVIVAL",
      score: 84,
      weight: 0.27,
      confidence: 0.8,
      pos: "Low avoidable damage",
      neg: "Two deaths on first boss pull",
      extras: {
        internalWeights: [
          { key: "deaths", weight: 0.35 },
          { key: "avoidable_damage", weight: 0.3 },
          { key: "personal_defensives", weight: 0.2 },
          { key: "self_heal_potion", weight: 0.15 },
        ],
        perRunEvidence: [
          { dungeon: "Priory of the Sacred Flame", summary: "0 deaths · avoidable damage low" },
        ],
        missingMetrics: [],
      },
    },
    {
      dimension: "UTILITY",
      score: 86,
      weight: 0.23,
      confidence: 0.75,
      pos: "Consistent interrupts",
      neg: "Missed one purge window",
      extras: {
        internalWeights: [
          { key: "interrupts", weight: 0.4 },
          { key: "crowd_control", weight: 0.3 },
          { key: "dispels", weight: 0.3 },
        ],
        perRunEvidence: [
          { dungeon: "Operation: Floodgate", summary: "Kick uptime strong · 1 missed purge" },
        ],
        missingMetrics: [],
      },
    },
    {
      dimension: "EXPERIENCE",
      score: 80,
      weight: 0.13,
      confidence: 0.9,
      pos: "42 season runs",
      neg: "Narrow dungeon spread",
      extras: {
        internalWeights: [
          { key: "volume", weight: 0.4 },
          { key: "breadth", weight: 0.3 },
          { key: "progression", weight: 0.3 },
        ],
        perRunEvidence: [],
        missingMetrics: ["account_linked_alts"],
      },
    },
    {
      dimension: "RAID",
      score: 70,
      weight: 0.05,
      confidence: 0.55,
      pos: "4/8M",
      neg: "Limited parse sample",
      extras: { missingMetrics: ["mythic_parse_sample"] },
    },
  ],
  [
    {
      key: "atypical_progression",
      label: "Atypical progression",
      severity: "LOW",
      confidence: 0.4,
      public: true,
      evidence: { note: "Short burst of high keys after a quiet week — probabilistic only" },
    },
  ],
  now,
);

const lowConfScore = baseScore(
  "22222222-2222-4222-8222-222222222222",
  54,
  "C",
  48,
  0.28,
  [
    {
      dimension: "PERFORMANCE",
      score: 58,
      weight: 0.32,
      confidence: 0.25,
      pos: "Average parses when logged",
      neg: "Sparse sample",
    },
    {
      dimension: "SURVIVAL",
      score: 50,
      weight: 0.27,
      confidence: 0.2,
      pos: "Neutral",
      neg: "Insufficient logs",
    },
    {
      dimension: "UTILITY",
      score: 52,
      weight: 0.23,
      confidence: 0.2,
      pos: "Neutral",
      neg: "Insufficient logs",
    },
    {
      dimension: "EXPERIENCE",
      score: 45,
      weight: 0.13,
      confidence: 0.4,
      pos: "Some prior-season play",
      neg: "Low current volume",
    },
    {
      dimension: "RAID",
      score: 40,
      weight: 0.05,
      confidence: 0.15,
      pos: "None",
      neg: "No Mythic signal",
    },
  ],
  [
    {
      key: "logs_hidden",
      label: "Logs hidden",
      severity: "MEDIUM",
      confidence: 0.9,
      public: true,
      evidence: { note: "Public logs incomplete for detailed analysis" },
    },
    {
      key: "insufficient_data",
      label: "Insufficient data",
      severity: "HIGH",
      confidence: 0.85,
      public: true,
      evidence: { note: "Fewer than recommended season runs" },
    },
  ],
  staleAt,
);

const boostSuspectScore = baseScore(
  "33333333-3333-4333-8333-333333333333",
  76,
  "B",
  38,
  0.62,
  [
    {
      dimension: "PERFORMANCE",
      score: 55,
      weight: 0.32,
      confidence: 0.7,
      pos: "Timed keys",
      neg: "Weak personal contribution in top runs",
    },
    {
      dimension: "SURVIVAL",
      score: 48,
      weight: 0.27,
      confidence: 0.65,
      pos: "Survived most pulls",
      neg: "High death rate in scoring runs",
    },
    {
      dimension: "UTILITY",
      score: 60,
      weight: 0.23,
      confidence: 0.6,
      pos: "Some interrupts",
      neg: "Low utility timing",
    },
    {
      dimension: "EXPERIENCE",
      score: 88,
      weight: 0.13,
      confidence: 0.8,
      pos: "Rapid key climb",
      neg: "Thin intermediate history",
    },
    {
      dimension: "RAID",
      score: 50,
      weight: 0.05,
      confidence: 0.4,
      pos: "Heroic clears",
      neg: "No Mythic",
    },
  ],
  [
    {
      key: "boost_suspected",
      label: "Boost suspected",
      severity: "HIGH",
      confidence: 0.72,
      public: true,
      evidence: {
        note: "Pattern suggests possible carry — not a factual accusation",
        signals: ["roster_overlap", "rating_jump", "weak_personal_perf"],
      },
    },
    {
      key: "low_run_volume",
      label: "Low run volume",
      severity: "MEDIUM",
      confidence: 0.6,
      public: true,
      evidence: { note: "High score relative to run count" },
    },
  ],
  now,
);

const unratedScore = baseScore(
  "44444444-4444-4444-8444-444444444444",
  50,
  "U",
  50,
  0.12,
  [
    {
      dimension: "PERFORMANCE",
      score: 50,
      weight: 0.32,
      confidence: 0.1,
      pos: "Neutral prior",
      neg: "No usable parses",
      extras: {
        internalWeights: [
          { key: "execution_percentile", weight: 0.65, available: false },
          { key: "key_difficulty", weight: 0.35, available: false },
        ],
        missingMetrics: ["parse_percentile", "selected_runs"],
      },
    },
    {
      dimension: "SURVIVAL",
      score: 50,
      weight: 0.27,
      confidence: 0.1,
      pos: "Neutral prior",
      neg: "No combat facts",
      extras: { missingMetrics: ["deaths", "avoidable_damage"] },
    },
    {
      dimension: "UTILITY",
      score: 50,
      weight: 0.23,
      confidence: 0.1,
      pos: "Neutral prior",
      neg: "No combat facts",
      extras: { missingMetrics: ["interrupts"] },
    },
    {
      dimension: "EXPERIENCE",
      score: 40,
      weight: 0.13,
      confidence: 0.2,
      pos: "Character exists",
      neg: "No season sample",
      extras: { missingMetrics: ["season_run_volume"] },
    },
  ],
  [
    {
      key: "insufficient_data",
      label: "Insufficient data",
      severity: "HIGH",
      confidence: 0.95,
      public: true,
      evidence: { note: "Below minimum confidence for a letter grade — shown as Unrated" },
    },
  ],
  staleAt,
);

export interface FixtureCharacter {
  identity: CharacterIdentityInput;
  profile: CharacterProfileView;
  /** When true, first profile fetch returns QUEUED then flips after polls. */
  simulateQueuedRefresh?: boolean;
}

const sharedRun = {
  runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  dungeonName: "Priory of the Sacred Flame",
  dungeonSlug: "priory-of-the-sacred-flame",
  keyLevel: 12,
  completedAt: "2026-07-18T21:14:00.000Z",
  timed: true,
  performanceSummary: "Top 20% DPS for key bracket; clean interrupt uptime.",
  coverageRatio: 0.88,
};

const ALERIA_SCORING_SELECTED_RUNS: ScoringSelectedRunProfileDTO[] = [
  {
    canonicalRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    dungeonName: "Priory of the Sacred Flame",
    dungeonSlug: "priory-of-the-sacred-flame",
    keyLevel: 12,
    completedAt: "2026-07-18T21:14:00.000Z",
    timed: true,
    durationMs: 1_820_000,
    raiderIoScore: 148,
    selectionReason: "HIGHEST_KEY",
    combatCoverageState: "AVAILABLE",
    unavailableReason: null,
    wclReportMatched: true,
    wclCoverageRatio: 0.88,
    parsePercentile: 88,
    keyDifficultyPercentile: 74,
    evidenceSummary: "Timed +12 with strong personal contribution.",
    missingMetrics: [],
  },
  {
    canonicalRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    dungeonName: "The Rookery",
    dungeonSlug: "the-rookery",
    keyLevel: 13,
    completedAt: "2026-07-17T20:05:00.000Z",
    timed: true,
    durationMs: 1_760_000,
    raiderIoScore: 162,
    selectionReason: "HIGHEST_KEY",
    combatCoverageState: "AVAILABLE",
    unavailableReason: null,
    wclReportMatched: true,
    wclCoverageRatio: 0.91,
    parsePercentile: 91,
    keyDifficultyPercentile: 80,
    evidenceSummary: "Highest key this season; clean survival.",
    missingMetrics: [],
  },
  {
    canonicalRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac",
    dungeonName: "Operation: Floodgate",
    dungeonSlug: "operation-floodgate",
    keyLevel: 12,
    completedAt: "2026-07-16T19:40:00.000Z",
    timed: true,
    durationMs: 1_905_000,
    raiderIoScore: 146,
    selectionReason: "HIGHEST_KEY",
    combatCoverageState: "AVAILABLE",
    unavailableReason: null,
    wclReportMatched: true,
    wclCoverageRatio: 0.84,
    parsePercentile: 79,
    keyDifficultyPercentile: 72,
    evidenceSummary: "Solid utility; one missed purge window.",
    missingMetrics: [],
  },
  {
    canonicalRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad",
    dungeonName: "Darkflame Cleft",
    dungeonSlug: "darkflame-cleft",
    keyLevel: 11,
    completedAt: "2026-07-15T22:10:00.000Z",
    timed: true,
    durationMs: 1_710_000,
    raiderIoScore: 132,
    selectionReason: "HIGHEST_SCORE_TIEBREAK",
    combatCoverageState: "AVAILABLE",
    unavailableReason: null,
    wclReportMatched: true,
    wclCoverageRatio: 0.8,
    parsePercentile: 84,
    keyDifficultyPercentile: 66,
    evidenceSummary: "Tiebreak on score vs equal key level.",
    missingMetrics: [],
  },
  {
    canonicalRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae",
    dungeonName: "Cinderbrew Meadery",
    dungeonSlug: "cinderbrew-meadery",
    keyLevel: 12,
    completedAt: "2026-07-14T18:22:00.000Z",
    timed: false,
    durationMs: 2_140_000,
    raiderIoScore: 120,
    selectionReason: "HIGHEST_KEY",
    combatCoverageState: "PARTIAL",
    unavailableReason: "combat_coverage_incomplete",
    wclReportMatched: true,
    wclCoverageRatio: 0.77,
    parsePercentile: 71,
    keyDifficultyPercentile: 74,
    evidenceSummary: "Deplete; still highest available key for dungeon.",
    missingMetrics: ["combat_coverage"],
  },
  {
    canonicalRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf",
    dungeonName: "The Motherlode!!",
    dungeonSlug: "the-motherlode",
    keyLevel: 11,
    completedAt: "2026-07-13T21:00:00.000Z",
    timed: true,
    durationMs: 1_880_000,
    raiderIoScore: 130,
    selectionReason: "HIGHEST_KEY",
    combatCoverageState: "UNAVAILABLE",
    unavailableReason: "wcl_detail_unavailable_on_highest_run",
    wclReportMatched: false,
    wclCoverageRatio: null,
    parsePercentile: null,
    keyDifficultyPercentile: 64,
    evidenceSummary: "RIO selected; WCL match unavailable for this run.",
    missingMetrics: ["wcl_match", "combat_facts", "parse_percentile"],
  },
  {
    canonicalRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0",
    dungeonName: "Theater of Pain",
    dungeonSlug: "theater-of-pain",
    keyLevel: 12,
    completedAt: "2026-07-12T17:45:00.000Z",
    timed: true,
    durationMs: 1_990_000,
    raiderIoScore: 145,
    selectionReason: "HIGHEST_KEY",
    combatCoverageState: "AVAILABLE",
    unavailableReason: null,
    wclReportMatched: true,
    wclCoverageRatio: 0.86,
    parsePercentile: 82,
    keyDifficultyPercentile: 73,
    evidenceSummary: "Balanced execution across bosses.",
    missingMetrics: [],
  },
  {
    canonicalRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1",
    dungeonName: "Operation: Mechagon — Workshop",
    dungeonSlug: "operation-mechagon-workshop",
    keyLevel: 10,
    completedAt: "2026-07-11T16:30:00.000Z",
    timed: true,
    durationMs: 1_650_000,
    raiderIoScore: 118,
    selectionReason: "LATEST_TIEBREAK",
    combatCoverageState: "PARTIAL",
    unavailableReason: "combat_coverage_incomplete",
    wclReportMatched: true,
    wclCoverageRatio: 0.7,
    parsePercentile: 76,
    keyDifficultyPercentile: 58,
    evidenceSummary: "Lowest key in set; still fills dungeon coverage.",
    missingMetrics: ["combat_coverage"],
  },
];

const ALERIA_SCORING_RUN_SELECTION: ScoringRunSelectionProfileDTO = {
  seasonSlug: "season-tww-3",
  expectedDungeonCount: 8,
  expectedDungeonSlugs: ALERIA_SCORING_SELECTED_RUNS.map((r) => r.dungeonSlug),
  selectedRuns: ALERIA_SCORING_SELECTED_RUNS,
  missingDungeonSlugs: [],
  selectionConfidence: 0.92,
  observedAt: now,
};

const ALERIA_SELECTED_RUNS: SelectedRunView[] = [
  {
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    dungeonName: "Priory of the Sacred Flame",
    dungeonSlug: "priory-of-the-sacred-flame",
    keyLevel: 12,
    completedAt: "2026-07-18T21:14:00.000Z",
    timed: true,
    durationMs: 1_820_000,
    raiderIoScore: 148,
    wclReportMatched: true,
    wclCoverageRatio: 0.88,
    selectionReason: "HIGHEST_KEY" as const,
    parsePercentile: 88,
    keyDifficultyPercentile: 74,
    evidenceSummary: "Timed +12 with strong personal contribution.",
    missingMetrics: [],
  },
  {
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    dungeonName: "The Rookery",
    dungeonSlug: "the-rookery",
    keyLevel: 13,
    completedAt: "2026-07-17T20:05:00.000Z",
    timed: true,
    durationMs: 1_760_000,
    raiderIoScore: 162,
    wclReportMatched: true,
    wclCoverageRatio: 0.91,
    selectionReason: "HIGHEST_KEY" as const,
    parsePercentile: 91,
    keyDifficultyPercentile: 80,
    evidenceSummary: "Highest key this season; clean survival.",
    missingMetrics: [],
  },
  {
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac",
    dungeonName: "Operation: Floodgate",
    dungeonSlug: "operation-floodgate",
    keyLevel: 12,
    completedAt: "2026-07-16T19:40:00.000Z",
    timed: true,
    durationMs: 1_905_000,
    raiderIoScore: 146,
    wclReportMatched: true,
    wclCoverageRatio: 0.84,
    selectionReason: "HIGHEST_KEY" as const,
    parsePercentile: 79,
    keyDifficultyPercentile: 72,
    evidenceSummary: "Solid utility; one missed purge window.",
    missingMetrics: [],
  },
  {
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad",
    dungeonName: "Darkflame Cleft",
    dungeonSlug: "darkflame-cleft",
    keyLevel: 11,
    completedAt: "2026-07-15T22:10:00.000Z",
    timed: true,
    durationMs: 1_710_000,
    raiderIoScore: 132,
    wclReportMatched: true,
    wclCoverageRatio: 0.8,
    selectionReason: "HIGHEST_SCORE_TIEBREAK" as const,
    parsePercentile: 84,
    keyDifficultyPercentile: 66,
    evidenceSummary: "Tiebreak on score vs equal key level.",
    missingMetrics: [],
  },
  {
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae",
    dungeonName: "Cinderbrew Meadery",
    dungeonSlug: "cinderbrew-meadery",
    keyLevel: 12,
    completedAt: "2026-07-14T18:22:00.000Z",
    timed: false,
    durationMs: 2_140_000,
    raiderIoScore: 120,
    wclReportMatched: true,
    wclCoverageRatio: 0.77,
    selectionReason: "HIGHEST_KEY" as const,
    parsePercentile: 71,
    keyDifficultyPercentile: 74,
    evidenceSummary: "Deplete; still highest available key for dungeon.",
    missingMetrics: [],
  },
  {
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf",
    dungeonName: "The Motherlode!!",
    dungeonSlug: "the-motherlode",
    keyLevel: 11,
    completedAt: "2026-07-13T21:00:00.000Z",
    timed: true,
    durationMs: 1_880_000,
    raiderIoScore: 130,
    wclReportMatched: false,
    wclCoverageRatio: null,
    selectionReason: "HIGHEST_KEY" as const,
    parsePercentile: null,
    keyDifficultyPercentile: 64,
    evidenceSummary: "RIO selected; WCL match unavailable for this run.",
    missingMetrics: ["wcl_match", "parse_percentile"],
  },
  {
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0",
    dungeonName: "Theater of Pain",
    dungeonSlug: "theater-of-pain",
    keyLevel: 12,
    completedAt: "2026-07-12T17:45:00.000Z",
    timed: true,
    durationMs: 1_990_000,
    raiderIoScore: 145,
    wclReportMatched: true,
    wclCoverageRatio: 0.86,
    selectionReason: "HIGHEST_KEY" as const,
    parsePercentile: 82,
    keyDifficultyPercentile: 73,
    evidenceSummary: "Balanced execution across bosses.",
    missingMetrics: [],
  },
  {
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1",
    dungeonName: "Operation: Mechagon — Workshop",
    dungeonSlug: "operation-mechagon-workshop",
    keyLevel: 10,
    completedAt: "2026-07-11T16:30:00.000Z",
    timed: true,
    durationMs: 1_650_000,
    raiderIoScore: 118,
    wclReportMatched: true,
    wclCoverageRatio: 0.7,
    selectionReason: "LATEST_TIEBREAK" as const,
    parsePercentile: 76,
    keyDifficultyPercentile: 58,
    evidenceSummary: "Lowest key in set; still fills dungeon coverage.",
    missingMetrics: ["defensive_dispel_casts"],
  },
];

export const FIXTURE_CHARACTERS: FixtureCharacter[] = [
  {
    identity: { region: "EU", realmSlug: "tarren-mill", name: "Aleria" },
    profile: {
      characterId: "11111111-1111-4111-8111-111111111111",
      region: "EU",
      realmSlug: "tarren-mill",
      displayName: "Aleria",
      score: aleriaScore,
      redFlags: aleriaScore.redFlags,
      dataConfidence: 78,
      lastAnalyzedRunId: sharedRun.runId,
      highestAnalyzedRunId: sharedRun.runId,
      sources: [
        { provider: "BLIZZARD", fetchedAt: now, url: null },
        {
          provider: "WARCRAFT_LOGS",
          fetchedAt: now,
          url: "https://www.warcraftlogs.com/character/eu/tarren-mill/aleria",
        },
        {
          provider: "RAIDER_IO",
          fetchedAt: now,
          url: "https://raider.io/characters/eu/tarren-mill/Aleria",
        },
      ],
      refreshStatus: "FRESH",
      wclVisibility: "PUBLIC",
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
      itemLevel: 668,
      lastAnalyzedRun: { ...sharedRun, kind: "BOTH" },
      highestAnalyzedRun: { ...sharedRun, kind: "BOTH" },
      equipment: {
        averageItemLevel: 666,
        equippedItemLevel: 668,
        items: [
          {
            slot: "Trinket",
            itemId: 228411,
            name: "House of Cards",
            itemLevel: 678,
            quality: "Epic",
            iconUrl: null,
            enchantments: [],
            gems: [],
          },
          {
            slot: "Trinket",
            itemId: 219309,
            name: "Signet of the Priory",
            itemLevel: 671,
            quality: "Epic",
            iconUrl: null,
            enchantments: [],
            gems: [],
          },
        ],
        keyItems: [
          {
            slot: "Trinket",
            itemId: 228411,
            name: "House of Cards",
            itemLevel: 678,
            quality: "Epic",
            iconUrl: null,
            enchantments: [],
            gems: [],
          },
          {
            slot: "Trinket",
            itemId: 219309,
            name: "Signet of the Priory",
            itemLevel: 671,
            quality: "Epic",
            iconUrl: null,
            enchantments: [],
            gems: [],
          },
        ],
      },
      media: {
        avatarUrl: null,
        insetUrl: null,
        mainRawUrl: null,
      },
      talents: {
        specializationSlug: "fire",
        loadoutCode: "FIRE-FIXTURE-LOADOUT",
        summary: "Standard Fire single-target / M+ hybrid.",
        sourceProvider: "blizzard",
        fetchedAt: now,
      },
      seasonSummary: {
        seasonSlug: "season-tww-3",
        runCount: 42,
        mythicRating: 2840,
        priorSeasonRating: 2650,
      },
      selectedRuns: ALERIA_SELECTED_RUNS,
      selectedRunExpectedCount: 8,
      scoringRunSelection: ALERIA_SCORING_RUN_SELECTION,
      entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
      warnings: [],
      raiderIoUsed: true,
    },
  },
  {
    identity: { region: "EU", realmSlug: "silvermoon", name: "Lowdata" },
    profile: {
      characterId: "22222222-2222-4222-8222-222222222222",
      region: "EU",
      realmSlug: "silvermoon",
      displayName: "Lowdata",
      score: lowConfScore,
      redFlags: lowConfScore.redFlags,
      dataConfidence: 28,
      lastAnalyzedRunId: null,
      highestAnalyzedRunId: null,
      sources: [{ provider: "BLIZZARD", fetchedAt: staleAt, url: null }],
      refreshStatus: "STALE",
      classSlug: "warrior",
      specSlug: "arms",
      role: "DPS",
      itemLevel: 640,
      lastAnalyzedRun: null,
      highestAnalyzedRun: null,
      equipment: {
        averageItemLevel: 638,
        equippedItemLevel: 640,
        items: [],
        keyItems: [],
      },
      talents: {
        specializationSlug: "arms",
        loadoutCode: null,
        summary: "Limited talent snapshot.",
      },
      seasonSummary: {
        seasonSlug: "season-tww-3",
        runCount: 6,
        mythicRating: 1810,
        priorSeasonRating: null,
      },
      scoringRunSelection: {
        seasonSlug: "season-tww-3",
        expectedDungeonCount: 8,
        expectedDungeonSlugs: [],
        selectedRuns: [],
        missingDungeonSlugs: [],
        selectionConfidence: 0,
        observedAt: staleAt,
      },
      entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
      warnings: [
        {
          code: "INSUFFICIENT_DATA",
          message: "Data incomplete — confidence is reduced toward neutral.",
          severity: "WARN",
        },
        {
          code: "LOGS_HIDDEN",
          message: "Detailed logs are hidden or incomplete.",
          severity: "WARN",
        },
      ],
      raiderIoUsed: false,
    },
  },
  {
    identity: { region: "EU", realmSlug: "kazzak", name: "Carryme" },
    simulateQueuedRefresh: true,
    profile: {
      characterId: "33333333-3333-4333-8333-333333333333",
      region: "EU",
      realmSlug: "kazzak",
      displayName: "Carryme",
      score: boostSuspectScore,
      redFlags: boostSuspectScore.redFlags,
      dataConfidence: 62,
      lastAnalyzedRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      highestAnalyzedRunId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sources: [
        { provider: "BLIZZARD", fetchedAt: now, url: null },
        {
          provider: "RAIDER_IO",
          fetchedAt: now,
          url: "https://raider.io/characters/eu/kazzak/Carryme",
        },
      ],
      refreshStatus: "QUEUED",
      classSlug: "evoker",
      specSlug: "augmentation",
      role: "DPS",
      itemLevel: 655,
      lastAnalyzedRun: {
        runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        kind: "LATEST",
        dungeonName: "Operation: Floodgate",
        dungeonSlug: "operation-floodgate",
        keyLevel: 10,
        completedAt: "2026-07-19T19:00:00.000Z",
        timed: true,
        performanceSummary: "Below-bracket contribution in a high-rated group.",
        coverageRatio: 0.7,
      },
      highestAnalyzedRun: {
        runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        kind: "HIGHEST",
        dungeonName: "The Rookery",
        dungeonSlug: "the-rookery",
        keyLevel: 13,
        completedAt: "2026-07-15T22:30:00.000Z",
        timed: false,
        performanceSummary: "Deplete; weak personal metrics vs teammates.",
        coverageRatio: 0.65,
      },
      equipment: {
        averageItemLevel: 652,
        equippedItemLevel: 655,
        items: [
          {
            slot: "Trinket",
            itemId: null,
            name: "Fixture Trinket",
            itemLevel: 662,
            quality: null,
            iconUrl: null,
            enchantments: [],
            gems: [],
          },
        ],
        keyItems: [
          {
            slot: "Trinket",
            itemId: null,
            name: "Fixture Trinket",
            itemLevel: 662,
            quality: null,
            iconUrl: null,
            enchantments: [],
            gems: [],
          },
        ],
      },
      talents: {
        specializationSlug: "augmentation",
        loadoutCode: "AUG-FIXTURE",
        summary: "Support-oriented Augmentation.",
      },
      seasonSummary: {
        seasonSlug: "season-tww-3",
        runCount: 14,
        mythicRating: 2610,
        priorSeasonRating: 1200,
      },
      entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
      warnings: [
        {
          code: "AUTHENTICITY",
          message: "Authenticity signals are probabilistic, not proof of boosting.",
          severity: "INFO",
        },
      ],
      raiderIoUsed: true,
    },
  },
  {
    identity: { region: "EU", realmSlug: "outland", name: "Unrated" },
    profile: {
      characterId: "44444444-4444-4444-8444-444444444444",
      region: "EU",
      realmSlug: "outland",
      displayName: "Unrated",
      score: unratedScore,
      redFlags: unratedScore.redFlags,
      dataConfidence: 12,
      lastAnalyzedRunId: null,
      highestAnalyzedRunId: null,
      sources: [{ provider: "BLIZZARD", fetchedAt: staleAt, url: null }],
      refreshStatus: "STALE",
      classSlug: "priest",
      specSlug: "shadow",
      role: "DPS",
      itemLevel: null,
      lastAnalyzedRun: null,
      highestAnalyzedRun: null,
      selectedRuns: [],
      selectedRunExpectedCount: 8,
      equipment: null,
      talents: null,
      seasonSummary: {
        seasonSlug: "season-tww-3",
        runCount: 0,
        mythicRating: null,
        priorSeasonRating: null,
      },
      entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
      warnings: [
        {
          code: "UNRATED",
          message: "Grade U — insufficient evidence for a reliable letter grade.",
          severity: "WARN",
        },
      ],
      raiderIoUsed: false,
    },
  },
];

export function identityKey(id: CharacterIdentityInput): string {
  return `${id.region.toLowerCase()}|${id.realmSlug.toLowerCase()}|${id.name.toLowerCase()}`;
}

export function findFixture(identity: CharacterIdentityInput): FixtureCharacter | undefined {
  const key = identityKey(identity);
  return FIXTURE_CHARACTERS.find((c) => identityKey(c.identity) === key);
}

export function createJob(status: JobStatusDTO["status"], characterId: string): JobStatusDTO {
  return {
    jobId: `job-${characterId.slice(0, 8)}`,
    queue: "refresh-character",
    status,
    dedupeKey: `refresh:${characterId}`,
    createdAt: now,
    startedAt: status === "queued" ? null : now,
    finishedAt: status === "completed" ? now : null,
    errorMessage: status === "failed" ? "Fixture refresh failed" : null,
  };
}

let modelStore: AdminScoreModelDTO[] = [
  {
    id: "model-active-1",
    key: "default",
    version: 1,
    name: "Default Trust Model",
    status: "ACTIVE",
    config: DEFAULT_MODEL_CONFIG,
    createdAt: "2026-07-01T00:00:00.000Z",
    activatedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "model-archived-0",
    key: "default",
    version: 0,
    name: "Default Trust Model (archived)",
    status: "ARCHIVED",
    config: { ...DEFAULT_MODEL_CONFIG, version: 0 },
    createdAt: "2026-06-01T00:00:00.000Z",
    activatedAt: "2026-06-01T00:00:00.000Z",
  },
];

let nextModelVersion = 2;

/** Mutable mock session state (queued refresh polls). */
export const mockSession = {
  refreshPolls: new Map<string, number>(),
};

export function getModelStore(): AdminScoreModelDTO[] {
  return modelStore;
}

export function setModelStore(next: AdminScoreModelDTO[]): void {
  modelStore = next;
}

export function allocateModelVersion(): number {
  const v = nextModelVersion;
  nextModelVersion += 1;
  return v;
}

export function resetMockState(): void {
  mockSession.refreshPolls.clear();
  nextModelVersion = 2;
  modelStore = [
    {
      id: "model-active-1",
      key: "default",
      version: 1,
      name: "Default Trust Model",
      status: "ACTIVE",
      config: deepClone(DEFAULT_MODEL_CONFIG),
      createdAt: "2026-07-01T00:00:00.000Z",
      activatedAt: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "model-archived-0",
      key: "default",
      version: 0,
      name: "Default Trust Model (archived)",
      status: "ARCHIVED",
      config: { ...deepClone(DEFAULT_MODEL_CONFIG), version: 0 },
      createdAt: "2026-06-01T00:00:00.000Z",
      activatedAt: "2026-06-01T00:00:00.000Z",
    },
  ];
}
