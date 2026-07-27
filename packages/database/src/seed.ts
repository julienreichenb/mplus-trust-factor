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

const defaultModelConfig = {
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
  eligibility: {
    minKnownRuns: 20,
    baselineKeyLevel: 10,
    topPopulationPercent: 25,
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
    description: "Season-aware Blizzard Mythic rating observation (not a fabricated percentile)",
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
    description: "Detailed combat logs are missing or incomplete",
    severity: RedFlagSeverity.MEDIUM,
    public: true,
  },
  {
    key: "insufficient_data",
    label: "Insufficient data",
    description: "Not enough observations for a confident score",
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
      description: "Initial configurable model from COMMON-CONTEXT",
      status: ScoreModelStatus.ACTIVE,
      config: defaultModelConfig,
      activatedAt: new Date(),
    },
    create: {
      key: "default",
      version: 1,
      name: "Default Trust Factor v1",
      description: "Initial configurable model from COMMON-CONTEXT",
      status: ScoreModelStatus.ACTIVE,
      config: defaultModelConfig,
      activatedAt: new Date(),
    },
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

  console.log("Seed completed (idempotent): EU region, placeholder season, model v1, metrics, red flags.");
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
