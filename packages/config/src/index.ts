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
    ACTIVE_SCORE_MODEL_VERSION: z.coerce.number().int().positive().default(6),
    /**
     * Utility OBSERVED_CONTRIBUTION publication gate.
     * - off: do not compute observed Utility
     * - shadow (default): compute admin diagnostics only; public Utility / Trust unchanged
     * - published: publish utility.observed_contribution when model v6 eligibility gates pass
     * Thresholds live on ScoreModel.config.utilityPublicationEligibility — not env.
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
    /**
     * Emergency shared-key fallback for machine/admin recovery.
     * Default false — must be explicitly enabled. Local `.env.example` sets true for development only.
     * Never accepted from SPA code; every successful use is audited; startup warns when enabled.
     */
    ADMIN_API_KEY_EMERGENCY_FALLBACK: booleanFromString.default(false),
    SESSION_SECRET: z.string().min(32),
    /**
     * AES key material for provider OAuth tokens at rest. Defaults to SESSION_SECRET when unset.
     * Prefer a dedicated value in staging/production.
     */
    PROVIDER_TOKEN_ENCRYPTION_SECRET: z.string().min(32).optional(),
    COOKIE_DOMAIN: z.string().default("localhost"),
    SESSION_COOKIE_NAME: z.string().default("mplus_session"),
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
    OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    /** Comma-separated absolute callback URLs allowlisted for Battle.net OAuth. */
    BATTLENET_OAUTH_CALLBACK_URLS: z.string().default("http://localhost:3000/api/v1/auth/battlenet/callback"),
    BATTLENET_OAUTH_SCOPES: z.string().default("openid wow.profile"),
    BATTLENET_OAUTH_AUTHORIZE_URL: z.string().url().default("https://oauth.battle.net/authorize"),
    BATTLENET_OAUTH_TOKEN_URL: z.string().url().default("https://oauth.battle.net/token"),
    BATTLENET_OAUTH_USERINFO_URL: z.string().url().default("https://oauth.battle.net/userinfo"),
    /** MVP ownership sync region. Only EU is supported; other values are rejected. */
    BATTLENET_OWNERSHIP_SYNC_REGION: z.string().default("eu"),
    /** When true, owners may bypass manual refresh cooldown (still subject to WCL global safety). */
    OWNER_REFRESH_COOLDOWN_BYPASS: booleanFromString.default(false),
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
  adminApiKeyEmergencyFallback: boolean;
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
    adminApiKeyEmergencyFallback: env.ADMIN_API_KEY_EMERGENCY_FALLBACK,
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

/** Secret used to encrypt Battle.net provider tokens at rest. */
export function providerTokenEncryptionSecret(env: AppEnv): string {
  return env.PROVIDER_TOKEN_ENCRYPTION_SECRET ?? env.SESSION_SECRET;
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

export {
  ACTIVE_EXPANSION_METADATA_V1,
  type ActiveExpansionMetadataV1,
} from "./game-metadata.js";

export {
  OWNED_CHARACTER_RELEVANCE_POLICY_V1,
  evaluateOwnedCharacterRelevanceV1,
  type OwnedCharacterRelevanceInput,
  type OwnedCharacterRelevancePolicyV1,
  type OwnedCharacterRelevanceResult,
  type RelevanceReason,
} from "./owned-character-relevance-policy.js";

export {
  BLIZZARD_PLAYABLE_CLASS_ID_TO_SLUG,
  WOW_CLASS_COLORS,
  WOW_CLASS_DISPLAY_NAMES,
  WOW_CLASS_ICON_URLS,
  presentWowClass,
  slugFromBlizzardPlayableClassId,
  type WowClassPresentation,
} from "./wow-class-presentation.js";
