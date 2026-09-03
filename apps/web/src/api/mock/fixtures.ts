import type {
  AdminScoreModelDTO,
  CharacterIdentityInput,
  CharacterProfileView,
  JobStatusDTO,
  RedFlagDTO,
  ScoreSnapshotDTO,
  AdminFaqEntryDTO,
} from "../types";
import { deepClone } from "../../lib/clone";
import { PERSISTED_V6_SCORE_MODEL_CONFIG } from "../model-config/persisted-v6-fixture";

const now = "2026-07-20T12:00:00.000Z";
const staleAt = "2026-07-19T08:00:00.000Z";

export const EU_REALMS = [
  { slug: "tarren-mill", name: "Tarren Mill", region: "EU", locale: "en_GB", displayLabel: "Tarren Mill — EU" },
  { slug: "silvermoon", name: "Silvermoon", region: "EU", locale: "en_GB", displayLabel: "Silvermoon — EU" },
  { slug: "draenor", name: "Draenor", region: "EU", locale: "en_GB", displayLabel: "Draenor — EU" },
  { slug: "kazzak", name: "Kazzak", region: "EU", locale: "en_GB", displayLabel: "Kazzak — EU" },
  { slug: "ravencrest", name: "Ravencrest", region: "EU", locale: "en_GB", displayLabel: "Ravencrest — EU" },
  { slug: "twisting-nether", name: "Twisting Nether", region: "EU", locale: "en_GB", displayLabel: "Twisting Nether — EU" },
  { slug: "outland", name: "Outland", region: "EU", locale: "en_GB", displayLabel: "Outland — EU" },
  { slug: "stormscale", name: "Stormscale", region: "EU", locale: "en_GB", displayLabel: "Stormscale — EU" },
  { slug: "sylvanas", name: "Sylvanas", region: "EU", locale: "en_GB", displayLabel: "Sylvanas — EU" },
  { slug: "ghostlands", name: "Ghostlands", region: "EU", locale: "en_GB", displayLabel: "Ghostlands — EU" },
  { slug: "archimonde", name: "Archimonde", region: "EU", locale: "fr_FR", displayLabel: "Archimonde — EU" },
  { slug: "cherith", name: "Chérith", region: "EU", locale: "fr_FR", displayLabel: "Chérith — EU" },
] as const;

/** Seed-matched persisted v6 config used by the mock admin catalog. */
export const DEFAULT_MODEL_CONFIG: Record<string, unknown> = deepClone(
  PERSISTED_V6_SCORE_MODEL_CONFIG,
);

function contributors(positive: string, negative: string): unknown {
  return {
    positive: [{ label: positive, impact: 8 }],
    negative: [{ label: negative, impact: -5 }],
  };
}

type FixtureDim = {
  dimension: ScoreSnapshotDTO["dimensions"][number]["dimension"];
  score: number;
  weight: number;
  confidence: number;
  pos: string;
  neg: string;
  /** Optional Score Explainability V1 public projection. */
  explainability?: ScoreSnapshotDTO["dimensions"][number]["explainability"];
  /** When true, omit explainability (legacy row simulation). */
  legacyNoExplainability?: boolean;
};

function baseScore(
  characterId: string,
  overall: number,
  grade: ScoreSnapshotDTO["grade"],
  authenticity: number,
  confidence: number,
  dims: FixtureDim[],
  redFlags: RedFlagDTO[],
  calculatedAt: string,
  modelVersion = 1,
): ScoreSnapshotDTO {
  return {
    characterId,
    seasonSlug: "season-tww-3",
    modelKey: "default",
    modelVersion,
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
      score: d.confidence <= 0 ? null : d.score,
      confidence: d.confidence,
      weight: d.weight,
      state:
        d.confidence <= 0
          ? ("UNAVAILABLE" as const)
          : d.confidence < 0.35
            ? ("PARTIAL" as const)
            : ("AVAILABLE" as const),
      reason: d.confidence <= 0 ? "FIXTURE_UNAVAILABLE" : null,
      contributors: contributors(d.pos, d.neg),
      ...(d.legacyNoExplainability
        ? {}
        : {
            explainability: d.explainability ?? {
              scoreDrivers: [
                {
                  code: `${d.dimension.toLowerCase()}.fixture_strength`,
                  labelKey: `score.${d.dimension.toLowerCase()}.fixture_strength`,
                  label: d.pos,
                  direction: "POSITIVE" as const,
                  value: d.score,
                },
                {
                  code: `${d.dimension.toLowerCase()}.fixture_weakness`,
                  labelKey: `score.${d.dimension.toLowerCase()}.fixture_weakness`,
                  label: d.neg,
                  direction: "NEGATIVE" as const,
                  value: Math.max(0, 100 - d.score),
                },
              ],
              confidenceReasons:
                d.confidence < 0.999
                  ? [
                      {
                        code: `${d.dimension.toLowerCase()}.fixture_confidence`,
                        labelKey: `confidence.${d.dimension.toLowerCase()}.fixture`,
                        label: "Sample coverage is incomplete for this fixture",
                      },
                    ]
                  : [],
            },
          }),
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
      weight: 0.35,
      confidence: 0.85,
      pos: "Strong DPS percentile on +12s",
      neg: "Slight dip on Tyrannical weeks",
      explainability: {
        scoreDrivers: [
          {
            code: "performance.phase1_performance",
            labelKey: "score.performance.phase1_performance",
            label: "Strong Phase 1 performance",
            direction: "POSITIVE",
            value: 92,
          },
          {
            code: "performance.offensive_cooldown_discipline",
            labelKey: "score.performance.offensive_cooldown_discipline",
            label: "Offensive uptime below neutral",
            direction: "NEGATIVE",
            value: 42,
          },
        ],
        confidenceReasons: [
          {
            code: "incomplete_cooldown_run_coverage",
            labelKey: "confidence.performance.incomplete_cooldown_run_coverage",
            label: "Incomplete cooldown evidence coverage",
          },
        ],
      },
    },
    {
      dimension: "SURVIVAL",
      score: 84,
      weight: 0.3,
      confidence: 0.8,
      pos: "Low avoidable damage",
      neg: "Two deaths on first boss pull",
      explainability: {
        scoreDrivers: [
          {
            code: "survival.outcome",
            labelKey: "score.survival.outcome",
            label: "Strong survival outcomes",
            direction: "POSITIVE",
            value: 90,
          },
          {
            code: "survival.defensive_response",
            labelKey: "score.survival.defensive_response",
            label: "Defensive response below neutral",
            direction: "NEGATIVE",
            value: 38,
          },
        ],
        confidenceReasons: [
          {
            code: "partial_health_evidence",
            labelKey: "confidence.survival.partial_health_evidence",
            label: "Some health evidence is incomplete",
          },
        ],
      },
    },
    {
      dimension: "UTILITY",
      score: 86,
      weight: 0.25,
      confidence: 0.75,
      pos: "Consistent interrupts",
      neg: "Missed one purge window",
      explainability: {
        scoreDrivers: [
          {
            code: "utility.cast_stops",
            labelKey: "score.utility.cast_stops",
            label: "Observed cast stops contributed to Utility",
            direction: "POSITIVE",
            value: 22,
          },
          {
            code: "utility.strategic_cc",
            labelKey: "score.utility.strategic_cc",
            label: "No strategic CC observed in scoring runs",
            direction: "NEUTRAL",
            value: 0,
          },
        ],
        confidenceReasons: [
          {
            code: "tiny_run_sample",
            labelKey: "confidence.utility.tiny_run_sample",
            label: "Utility sample size is small",
          },
        ],
      },
    },
    {
      dimension: "EXPERIENCE",
      score: 0,
      weight: 0.1,
      confidence: 1,
      pos: "Confirmed absence",
      neg: "unused",
      explainability: {
        scoreDrivers: [
          {
            code: "experience.confirmed_no_activity",
            labelKey: "score.experience.confirmed_no_activity",
            label: "Previous-season activity: none confirmed",
            direction: "NEUTRAL",
            value: 0,
          },
        ],
        confidenceReasons: [],
      },
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
  3,
);

const lowConfScore = baseScore(
  "22222222-2222-4222-8222-222222222222",
  54,
  "C",
  48,
  0.28,
  [
    { dimension: "PERFORMANCE", score: 58, weight: 0.32, confidence: 0.25, pos: "Average parses when logged", neg: "Sparse sample" },
    { dimension: "SURVIVAL", score: 50, weight: 0.27, confidence: 0.2, pos: "Neutral", neg: "Insufficient logs" },
    { dimension: "UTILITY", score: 52, weight: 0.23, confidence: 0.2, pos: "Neutral", neg: "Insufficient logs" },
    {
      dimension: "EXPERIENCE",
      score: 0,
      weight: 0.13,
      confidence: 0,
      pos: "unused",
      neg: "unused",
      explainability: {
        scoreDrivers: [],
        confidenceReasons: [
          {
            code: "previous_evidence_unavailable",
            labelKey: "confidence.experience.previous_evidence_unavailable",
            label: "Previous-season evidence is unavailable",
          },
        ],
      },
    },
    { dimension: "RAID", score: 40, weight: 0.05, confidence: 0.15, pos: "None", neg: "No Mythic signal" },
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
    { dimension: "PERFORMANCE", score: 55, weight: 0.32, confidence: 0.7, pos: "Timed keys", neg: "Weak personal contribution in top runs" },
    { dimension: "SURVIVAL", score: 48, weight: 0.27, confidence: 0.65, pos: "Survived most pulls", neg: "High death rate in scoring runs" },
    { dimension: "UTILITY", score: 60, weight: 0.23, confidence: 0.6, pos: "Some interrupts", neg: "Low utility timing" },
    { dimension: "EXPERIENCE", score: 88, weight: 0.13, confidence: 0.8, pos: "Rapid key climb", neg: "Thin intermediate history" },
    { dimension: "RAID", score: 50, weight: 0.05, confidence: 0.4, pos: "Heroic clears", neg: "No Mythic" },
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

const SEASON_DUNGEON_FIXTURES = [
  { slug: "priory-of-the-sacred-flame", name: "Priory of the Sacred Flame", keyLevel: 12 },
  { slug: "operation-floodgate", name: "Operation: Floodgate", keyLevel: 11 },
  { slug: "darkflame-cleft", name: "Darkflame Cleft", keyLevel: 12 },
  { slug: "the-rookery", name: "The Rookery", keyLevel: 10 },
  { slug: "cinderbrew-meadery", name: "Cinderbrew Meadery", keyLevel: 11 },
  { slug: "the-stonevault", name: "The Stonevault", keyLevel: 12 },
  { slug: "city-of-threads", name: "City of Threads", keyLevel: 11 },
  { slug: "arakara-city-of-echoes", name: "Ara-Kara, City of Echoes", keyLevel: 10 },
] as const;

export const aleriaScoringRunSelection = {
  seasonSlug: "season-tww-3",
  expectedDungeonCount: 8,
  selectedRuns: SEASON_DUNGEON_FIXTURES.map((dungeon, index) => ({
    dungeonSlug: dungeon.slug,
    dungeonName: dungeon.name,
    canonicalRunId: index < 6 ? `run-${dungeon.slug}` : null,
    keyLevel: index < 6 ? dungeon.keyLevel : null,
    timed: index === 1 ? false : index < 6 ? true : null,
    completedAt: index < 6 ? "2026-07-18T21:14:00.000Z" : null,
    wclReportMatched: index < 6,
    selectionReason: index < 6 ? ("HIGHEST_KEY" as const) : null,
    coverageRatio: index < 6 ? 0.82 + index * 0.01 : null,
  })),
};

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
        { provider: "WARCRAFT_LOGS", fetchedAt: now, url: "https://www.warcraftlogs.com/character/eu/tarren-mill/aleria" },
        { provider: "RAIDER_IO", fetchedAt: now, url: "https://raider.io/characters/eu/tarren-mill/Aleria" },
      ],
      refreshStatus: "FRESH",
      wclVisibility: "PUBLIC",
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
      itemLevel: 668,
      lastAnalyzedRun: { ...sharedRun, kind: "BOTH" },
      highestAnalyzedRun: { ...sharedRun, kind: "BOTH" },
      scoringRunSelection: aleriaScoringRunSelection,
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
        avatarUrl: "https://render.worldofwarcraft.com/eu/characters/avatar.jpg",
        insetUrl: "https://render.worldofwarcraft.com/eu/characters/inset.jpg",
        mainRawUrl: "https://render.worldofwarcraft.com/eu/characters/main-raw.jpg",
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
      sources: [
        { provider: "BLIZZARD", fetchedAt: staleAt, url: null },
      ],
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
      entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
      warnings: [
        { code: "INSUFFICIENT_DATA", message: "Data incomplete — confidence is reduced toward neutral.", severity: "WARN" },
        { code: "LOGS_HIDDEN", message: "Detailed logs are hidden or incomplete.", severity: "WARN" },
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
        { provider: "RAIDER_IO", fetchedAt: now, url: "https://raider.io/characters/eu/kazzak/Carryme" },
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
        { code: "AUTHENTICITY", message: "Authenticity signals are probabilistic, not proof of boosting.", severity: "INFO" },
      ],
      raiderIoUsed: true,
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
    id: "model-active-6",
    key: "default",
    version: 6,
    name: "Default Trust Factor v6",
    status: "ACTIVE",
    config: deepClone(DEFAULT_MODEL_CONFIG),
    createdAt: "2026-07-01T00:00:00.000Z",
    activatedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "model-archived-5",
    key: "default",
    version: 5,
    name: "Default Trust Factor v5",
    status: "ARCHIVED",
    config: deepClone(DEFAULT_MODEL_CONFIG),
    createdAt: "2026-06-01T00:00:00.000Z",
    activatedAt: "2026-06-01T00:00:00.000Z",
  },
];

let nextModelVersion = 7;

/** Mutable mock session state (queued refresh polls + dynamic ingestions). */
export const mockSession = {
  refreshPolls: new Map<string, number>(),
  dynamicProfiles: new Map<string, CharacterProfileView>(),
};

export let mockFaqEntries: AdminFaqEntryDTO[] = [];

export function createDynamicQueuedProfile(identity: CharacterIdentityInput): CharacterProfileView {
  const characterId = `dyn-${identityKey(identity)}`.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 36);
  return {
    characterId,
    region: identity.region,
    realmSlug: identity.realmSlug,
    displayName: identity.name,
    score: null,
    redFlags: [],
    dataConfidence: null,
    lastAnalyzedRunId: null,
    highestAnalyzedRunId: null,
    sources: [{ provider: "BLIZZARD", fetchedAt: now, url: null }],
    refreshStatus: "QUEUED",
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS",
    entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
    warnings: [
      {
        code: "INGESTING",
        message: "Character is being ingested from live providers.",
        severity: "INFO",
      },
    ],
    scoringRunSelection: null,
    media: {
      avatarUrl: "https://render.worldofwarcraft.com/eu/characters/avatar-fail.jpg",
      insetUrl: "https://render.worldofwarcraft.com/eu/characters/inset-fail.jpg",
      mainRawUrl: "https://render.worldofwarcraft.com/eu/characters/main-raw-fail.jpg",
    },
  };
}

export function finalizeDynamicProfile(profile: CharacterProfileView): CharacterProfileView {
  return {
    ...profile,
    refreshStatus: "FRESH",
    dataConfidence: 45,
    score: {
      characterId: profile.characterId,
      seasonSlug: "season-tww-3",
      modelKey: "default",
      modelVersion: 3,
      scopeType: "CHARACTER",
      scopeKey: null,
      overallScore: 62,
      grade: "C",
      skillScore: 65,
      authenticityScore: 70,
      confidence: 0.45,
      calculatedAt: now,
      inputFingerprint: `fp-${profile.characterId}`,
      dimensions: [
        { dimension: "PERFORMANCE", score: 60, confidence: 0.4, weight: 0.35, state: "AVAILABLE", reason: null, contributors: null },
        { dimension: "SURVIVAL", score: 58, confidence: 0.4, weight: 0.3, state: "AVAILABLE", reason: null, contributors: null },
        { dimension: "UTILITY", score: 64, confidence: 0.4, weight: 0.25, state: "AVAILABLE", reason: null, contributors: null },
        { dimension: "EXPERIENCE", score: 55, confidence: 0.5, weight: 0.1, state: "AVAILABLE", reason: null, contributors: null },
      ],
      redFlags: [],
      explanation: { summary: "Dynamically ingested fixture character" },
    },
    warnings: [],
  };
}

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
  mockSession.dynamicProfiles.clear();
  mockFaqEntries = [];
  nextModelVersion = 7;
  modelStore = [
    {
      id: "model-active-6",
      key: "default",
      version: 6,
      name: "Default Trust Factor v6",
      status: "ACTIVE",
      config: deepClone(DEFAULT_MODEL_CONFIG),
      createdAt: "2026-07-01T00:00:00.000Z",
      activatedAt: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "model-archived-5",
      key: "default",
      version: 5,
      name: "Default Trust Factor v5",
      status: "ARCHIVED",
      config: deepClone(DEFAULT_MODEL_CONFIG),
      createdAt: "2026-06-01T00:00:00.000Z",
      activatedAt: "2026-06-01T00:00:00.000Z",
    },
  ];
}
