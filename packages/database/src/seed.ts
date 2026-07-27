import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Prisma, ScoreModelStatus, RedFlagSeverity, ScoreDimension, MetricDirection } from "@prisma/client";

function loadRootEnv(): void {
  const rootEnv = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../.env");
  if (!existsSync(rootEnv) || process.env.DATABASE_URL) {
    return;
  }
  for (const line of readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadRootEnv();

const prisma = new PrismaClient();

const defaultModelConfigV1 = {
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
  gradeThresholds: {
    S: 90,
    A: 80,
    B: 65,
    C: 50,
  },
  minConfidenceForGrade: 0.35,
  metricWeights: {
    PERFORMANCE: [
      { metricKey: "performance.mythic_rating", weight: 0.55 },
      { metricKey: "performance.consistency", weight: 0.25 },
      { metricKey: "performance.contextual_contribution", weight: 0.2 },
    ],
    SURVIVAL: [
      { metricKey: "survival.death_rate", weight: 0.35 },
      { metricKey: "survival.avoidable_damage", weight: 0.3 },
      { metricKey: "survival.defensive_usage", weight: 0.25 },
      { metricKey: "survival.consumable_usage", weight: 0.1 },
    ],
    UTILITY: [
      { metricKey: "utility.interrupts", weight: 0.3 },
      { metricKey: "utility.crowd_control", weight: 0.25 },
      { metricKey: "utility.dispels", weight: 0.15 },
      { metricKey: "utility.externals", weight: 0.15 },
      { metricKey: "utility.class_specific", weight: 0.15 },
    ],
    EXPERIENCE: [
      { metricKey: "experience.dungeon_breadth", weight: 0.35 },
      { metricKey: "experience.top_level_repeat", weight: 0.25 },
      { metricKey: "experience.volume_recency", weight: 0.15 },
      { metricKey: "experience.historical_seasons", weight: 0.15 },
      { metricKey: "experience.role_continuity", weight: 0.1 },
    ],
    RAID: [
      { metricKey: "raid.mythic_progression", weight: 0.6 },
      { metricKey: "raid.mythic_parses", weight: 0.4 },
    ],
  },
  eligibility: {
    minKnownRuns: 20,
    baselineKeyLevel: 10,
    topPopulationPercent: 25,
  },
} satisfies Prisma.InputJsonValue;

/** v2: PERFORMANCE from WCL parse percentiles; Mythic+ rating → EXPERIENCE only. */
const defaultModelConfigV2 = {
  ...defaultModelConfigV1,
  metricWeights: {
    PERFORMANCE: [
      { metricKey: "performance.current_season_peak", weight: 0.5525 },
      { metricKey: "performance.current_season_consistency", weight: 0.2975 },
      { metricKey: "performance.historical_best_average", weight: 0.15 },
    ],
    SURVIVAL: defaultModelConfigV1.metricWeights.SURVIVAL,
    UTILITY: defaultModelConfigV1.metricWeights.UTILITY,
    EXPERIENCE: [
      { metricKey: "experience.dungeon_breadth", weight: 0.28 },
      { metricKey: "experience.top_level_repeat", weight: 0.22 },
      { metricKey: "experience.volume_recency", weight: 0.15 },
      { metricKey: "experience.mythic_rating", weight: 0.15 },
      { metricKey: "experience.historical_seasons", weight: 0.12 },
      { metricKey: "experience.role_continuity", weight: 0.08 },
    ],
    RAID: defaultModelConfigV1.metricWeights.RAID,
  },
} satisfies Prisma.InputJsonValue;

const metricDefinitions: Array<{
  key: string;
  dimension: ScoreDimension;
  valueType: string;
  direction: MetricDirection;
  description: string;
}> = [
  {
    key: "performance.mythic_rating",
    dimension: ScoreDimension.PERFORMANCE,
    valueType: "number",
    direction: MetricDirection.HIGHER_BETTER,
    description:
      "Legacy v1 Blizzard Mythic rating PERFORMANCE contributor (retired in model v2; prefer experience.mythic_rating)",
  },
  {
    key: "performance.current_season_peak",
    dimension: ScoreDimension.PERFORMANCE,
    valueType: "number",
    direction: MetricDirection.HIGHER_BETTER,
    description: "Equal-weight mean of current-season WCL best parse percentiles per dungeon",
  },
  {
    key: "performance.current_season_consistency",
    dimension: ScoreDimension.PERFORMANCE,
    valueType: "number",
    direction: MetricDirection.HIGHER_BETTER,
    description: "Equal-weight mean of current-season WCL median parse percentiles per dungeon",
  },
  {
    key: "performance.historical_best_average",
    dimension: ScoreDimension.PERFORMANCE,
    valueType: "number",
    direction: MetricDirection.HIGHER_BETTER,
    description: "Recency-weighted mean of prior-season best parse percentile averages (same spec/role)",
  },
  {
    key: "experience.mythic_rating",
    dimension: ScoreDimension.EXPERIENCE,
    valueType: "number",
    direction: MetricDirection.HIGHER_BETTER,
    description: "Blizzard Mythic+ rating as progression/experience context (not a parse percentile)",
  },
  {
    key: "performance.spec_percentile",
    dimension: ScoreDimension.PERFORMANCE,
    valueType: "number",
    direction: MetricDirection.HIGHER_BETTER,
    description: "Specialization performance percentile when a real ranking source provides one",
  },
  {
    key: "survival.death_rate",
    dimension: ScoreDimension.SURVIVAL,
    valueType: "number",
    direction: MetricDirection.LOWER_BETTER,
    description: "Death frequency in analyzed runs",
  },
  {
    key: "utility.interrupt_success",
    dimension: ScoreDimension.UTILITY,
    valueType: "number",
    direction: MetricDirection.HIGHER_BETTER,
    description: "Successful relevant interrupts",
  },
  {
    key: "experience.run_volume",
    dimension: ScoreDimension.EXPERIENCE,
    valueType: "number",
    direction: MetricDirection.HIGHER_BETTER,
    description: "Current-season run volume and breadth",
  },
  {
    key: "raid.mythic_progression",
    dimension: ScoreDimension.RAID,
    valueType: "number",
    direction: MetricDirection.HIGHER_BETTER,
    description: "Mythic raid progression signal",
  },
  {
    key: "authenticity.suspicion_index",
    dimension: ScoreDimension.AUTHENTICITY,
    valueType: "number",
    direction: MetricDirection.LOWER_BETTER,
    description: "Composite suspicion index (probabilistic)",
  },
];

const redFlags: Array<{
  key: string;
  label: string;
  description: string;
  severity: RedFlagSeverity;
  public: boolean;
}> = [
  {
    key: "boost_suspected",
    label: "Boost suspected",
    description: "Suspicious progression or roster patterns (probabilistic)",
    severity: RedFlagSeverity.HIGH,
    public: true,
  },
  {
    key: "atypical_progression",
    label: "Atypical progression",
    description: "Key-level jumps without intermediate progression",
    severity: RedFlagSeverity.MEDIUM,
    public: true,
  },
  {
    key: "logs_hidden",
    label: "Logs hidden",
    description: "Character explicitly hides Warcraft Logs (HIDDEN visibility only)",
    severity: RedFlagSeverity.MEDIUM,
    public: true,
  },
  {
    key: "no_public_logs",
    label: "No public logs",
    description: "No public Warcraft Logs reports were found for this character",
    severity: RedFlagSeverity.LOW,
    public: true,
  },
  {
    key: "no_matched_run",
    label: "No matched run",
    description: "Public logs exist but none matched selected Blizzard/Raider.IO runs",
    severity: RedFlagSeverity.LOW,
    public: true,
  },
  {
    key: "wcl_unavailable",
    label: "Warcraft Logs unavailable",
    description: "Warcraft Logs provider was unavailable during enrichment",
    severity: RedFlagSeverity.INFO,
    public: true,
  },
  {
    key: "wcl_rate_limited",
    label: "Warcraft Logs rate limited",
    description: "Warcraft Logs enrichment was rate-limited",
    severity: RedFlagSeverity.INFO,
    public: true,
  },
  {
    key: "insufficient_data",
    label: "Insufficient data",
    description: "Not enough observations for a confident score (presented as UNRATED)",
    severity: RedFlagSeverity.INFO,
    public: true,
  },
  {
    key: "low_run_volume",
    label: "Low run volume",
    description: "Score achieved with unusually low run volume",
    severity: RedFlagSeverity.LOW,
    public: true,
  },
  {
    key: "data_stale",
    label: "Data stale",
    description: "Underlying provider data exceeds freshness TTL",
    severity: RedFlagSeverity.INFO,
    public: true,
  },
];

async function seed(): Promise<void> {
  const region = await prisma.region.upsert({
    where: { code: "EU" },
    update: {
      apiHost: "https://eu.api.blizzard.com",
      localeDefault: "en_GB",
      enabled: true,
    },
    create: {
      code: "EU",
      apiHost: "https://eu.api.blizzard.com",
      localeDefault: "en_GB",
      enabled: true,
    },
  });

  const existingCurrent = await prisma.season.findFirst({
    where: { regionId: region.id, slug: "placeholder-current" },
  });

  if (existingCurrent) {
    await prisma.season.update({
      where: { id: existingCurrent.id },
      data: {
        name: "PLACEHOLDER Current Season (replace with live season)",
        isCurrent: true,
        dungeonCount: 8,
        metadata: {
          placeholder: true,
          note: "Replace with verified current season IDs before production scoring",
        },
      },
    });
  } else {
    await prisma.season.create({
      data: {
        regionId: region.id,
        slug: "placeholder-current",
        name: "PLACEHOLDER Current Season (replace with live season)",
        isCurrent: true,
        dungeonCount: 8,
        metadata: {
          placeholder: true,
          note: "Replace with verified current season IDs before production scoring",
        },
      },
    });
  }

  await prisma.scoreModel.upsert({
    where: {
      key_version: { key: "default", version: 1 },
    },
    update: {
      name: "Default Trust Factor v1",
      description: "Legacy model — Mythic+ rating as PERFORMANCE (archived; snapshots retained)",
      status: ScoreModelStatus.ARCHIVED,
      config: defaultModelConfigV1,
    },
    create: {
      key: "default",
      version: 1,
      name: "Default Trust Factor v1",
      description: "Legacy model — Mythic+ rating as PERFORMANCE (archived; snapshots retained)",
      status: ScoreModelStatus.ARCHIVED,
      config: defaultModelConfigV1,
    },
  });

  await prisma.scoreModel.upsert({
    where: {
      key_version: { key: "default", version: 2 },
    },
    update: {
      name: "Default Trust Factor v2",
      description:
        "PERFORMANCE from current-season WCL parse percentiles (peak/consistency) with optional historical best-average",
      status: ScoreModelStatus.ACTIVE,
      config: defaultModelConfigV2,
      activatedAt: new Date(),
    },
    create: {
      key: "default",
      version: 2,
      name: "Default Trust Factor v2",
      description:
        "PERFORMANCE from current-season WCL parse percentiles (peak/consistency) with optional historical best-average",
      status: ScoreModelStatus.ACTIVE,
      config: defaultModelConfigV2,
      activatedAt: new Date(),
    },
  });

  // Ensure only one ACTIVE model for key=default.
  await prisma.scoreModel.updateMany({
    where: { key: "default", version: { not: 2 }, status: ScoreModelStatus.ACTIVE },
    data: { status: ScoreModelStatus.ARCHIVED },
  });

  for (const metric of metricDefinitions) {
    await prisma.metricDefinition.upsert({
      where: { key: metric.key },
      update: {
        dimension: metric.dimension,
        valueType: metric.valueType,
        direction: metric.direction,
        description: metric.description,
        active: true,
      },
      create: {
        ...metric,
        active: true,
        defaultNormalization: {},
      },
    });
  }

  for (const flag of redFlags) {
    await prisma.redFlagDefinition.upsert({
      where: { key: flag.key },
      update: {
        label: flag.label,
        description: flag.description,
        severity: flag.severity,
        public: flag.public,
        active: true,
      },
      create: {
        ...flag,
        active: true,
      },
    });
  }

  console.log("Seed completed (idempotent): EU region, placeholder season, model v2 ACTIVE (v1 archived), metrics, red flags.");
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
