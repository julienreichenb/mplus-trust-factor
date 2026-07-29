import { z } from "zod";

const booleanFromString = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
});

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    APP_VERSION: z.string().default("0.1.0"),
    API_HOST: z.string().default("0.0.0.0"),
    API_PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    TZ: z.string().default("UTC"),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    RAW_ARTIFACTS_DIR: z.string().default("./data/raw-artifacts"),
    RAW_ARTIFACT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

    PROVIDER_MODE: z.enum(["fixture", "live"]).default("fixture"),

    /** Explicit opt-in for manual live smoke commands only. Never enable in CI. */
    ALLOW_LIVE_PROVIDER_CALLS: booleanFromString.default(false),

    BLIZZARD_ENABLED: booleanFromString.default(true),
    BLIZZARD_CLIENT_ID: z.string().optional().default(""),
    BLIZZARD_CLIENT_SECRET: z.string().optional().default(""),
    BLIZZARD_DEFAULT_REGION: z.string().default("eu"),
    BLIZZARD_DEFAULT_LOCALE: z.string().default("en_GB"),
    BLIZZARD_REQUEST_CONCURRENCY: z.coerce.number().int().positive().default(4),
    BLIZZARD_CHARACTER_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),

    WCL_ENABLED: booleanFromString.default(true),
    WCL_CLIENT_ID: z.string().optional().default(""),
    WCL_CLIENT_SECRET: z.string().optional().default(""),
    WCL_PUBLIC_GRAPHQL_URL: z.string().url().default("https://www.warcraftlogs.com/api/v2/client"),
    WCL_TOKEN_URL: z.string().url().default("https://www.warcraftlogs.com/oauth/token"),
    WCL_RATE_WARN_PERCENT: z.coerce.number().min(0).max(100).default(70),
    WCL_RATE_DEFER_PERCENT: z.coerce.number().min(0).max(100).default(80),
    WCL_RATE_STOP_PERCENT: z.coerce.number().min(0).max(100).default(90),
    WCL_CHARACTER_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),

    RAIDERIO_ENABLED: booleanFromString.default(true),
    RAIDERIO_BASE_URL: z.string().url().default("https://raider.io"),
    RAIDERIO_APP_KEY: z.string().optional().default(""),
    RAIDERIO_SOFT_RPM: z.coerce.number().int().positive().default(60),
    RAIDERIO_REQUEST_CONCURRENCY: z.coerce.number().int().positive().default(2),
    RAIDERIO_CHARACTER_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
    RAIDERIO_NEGATIVE_CACHE_SECONDS: z.coerce.number().int().positive().default(2700),
    RAIDERIO_CUTOFFS_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
    RAIDERIO_STATIC_DATA_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),

    ACTIVE_SCORE_MODEL_KEY: z.string().default("default"),
    ACTIVE_SCORE_MODEL_VERSION: z.coerce.number().int().positive().default(5),
    /**
     * Utility OBSERVED_CONTRIBUTION publication gate.
     * - off: do not compute shadow diagnostics
     * - shadow (default): compute admin-only score; public Utility / Trust unchanged
     * - published: blocked (not implemented) — safety guard refuses publication path
     */
    UTILITY_PUBLICATION_MODE: z.enum(["off", "shadow", "published"]).default("shadow"),
    MANUAL_REFRESH_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(900),

    /**
     * Refresh orchestration (Agent 39).
     * Recurring production enqueue stays disabled by default.
     */
    REFRESH_SCHEDULER_ENABLED: booleanFromString.default(false),
    REFRESH_DRY_RUN_ONLY: booleanFromString.default(true),
    REFRESH_SAFETY_RESERVE_FRACTION: z.coerce.number().min(0).max(1).default(0.1),
    REFRESH_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    REFRESH_GLOBAL_CONCURRENCY: z.coerce.number().int().positive().default(2),
    REFRESH_PER_CHARACTER_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(3600),
    REFRESH_SPREAD_HOURS: z.coerce.number().int().positive().default(24),
    /** Indicative share of the configured tracked denominator — not a global WoW percentile. */
    REFRESH_TRACKED_TOP_PERCENT: z.coerce.number().min(1).max(100).default(25),
    REFRESH_RATING_THRESHOLD: z.coerce.number().min(0).default(2500),

    /** MVP entitlement flag: when true, the API serializer omits no fields for any client. */
    PUBLIC_DETAILS_ALL: booleanFromString.default(true),

    ADMIN_API_KEY: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
    COOKIE_DOMAIN: z.string().default("localhost"),
    TRUST_PROXY: booleanFromString.default(false),

    /** Worker-only HTTP health port (Docker HEALTHCHECK). 0 disables the listener. */
    WORKER_HEALTH_PORT: z.coerce.number().int().min(0).default(3001),
  })
  .superRefine((env, ctx) => {
    if (env.PROVIDER_MODE !== "live") {
      return;
    }

    if (env.BLIZZARD_ENABLED && (!env.BLIZZARD_CLIENT_ID || !env.BLIZZARD_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Blizzard live mode requires BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET when BLIZZARD_ENABLED=true (or set BLIZZARD_ENABLED=false)",
        path: ["BLIZZARD_CLIENT_ID"],
      });
    }

    if (env.WCL_ENABLED && (!env.WCL_CLIENT_ID || !env.WCL_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Warcraft Logs live mode requires WCL_CLIENT_ID and WCL_CLIENT_SECRET when WCL_ENABLED=true (or set WCL_ENABLED=false)",
        path: ["WCL_CLIENT_ID"],
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

/** Safe startup summary: booleans and modes only — never credential values. */
export interface ConfigSummary {
  appEnv: AppEnv["APP_ENV"];
  nodeEnv: AppEnv["NODE_ENV"];
  providerMode: AppEnv["PROVIDER_MODE"];
  allowLiveProviderCalls: boolean;
  blizzardEnabled: boolean;
  wclEnabled: boolean;
  raiderioEnabled: boolean;
  blizzardCredentialsConfigured: boolean;
  wclCredentialsConfigured: boolean;
  raiderioAppKeyConfigured: boolean;
  logLevel: AppEnv["LOG_LEVEL"];
}

export function getConfigSummary(env: AppEnv): ConfigSummary {
  return {
    appEnv: env.APP_ENV,
    nodeEnv: env.NODE_ENV,
    providerMode: env.PROVIDER_MODE,
    allowLiveProviderCalls: env.ALLOW_LIVE_PROVIDER_CALLS,
    blizzardEnabled: env.BLIZZARD_ENABLED,
    wclEnabled: env.WCL_ENABLED,
    raiderioEnabled: env.RAIDERIO_ENABLED,
    blizzardCredentialsConfigured: Boolean(env.BLIZZARD_CLIENT_ID && env.BLIZZARD_CLIENT_SECRET),
    wclCredentialsConfigured: Boolean(env.WCL_CLIENT_ID && env.WCL_CLIENT_SECRET),
    raiderioAppKeyConfigured: Boolean(env.RAIDERIO_APP_KEY),
    logLevel: env.LOG_LEVEL,
  };
}

let cachedEnv: AppEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  cachedEnv = parsed.data;
  return parsed.data;
}

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}

export {
  buildFreshnessConfig,
  ttlForDataset,
  isDatasetFresh,
  FRESHNESS_CONFIG_VERSION,
  type FreshnessConfig,
  type FreshnessDataset,
} from "./freshness.js";

export {
  buildRefreshPolicyConfig,
  assignCadenceTier,
  freshnessTtlMsForTier,
  DEFAULT_CADENCE_TIERS,
  REFRESH_POLICY_VERSION,
  type CadenceTier,
  type CadenceTierPolicy,
  type RefreshPolicyConfig,
  type RefreshPolicyEnv,
} from "./refresh-policy.js";
