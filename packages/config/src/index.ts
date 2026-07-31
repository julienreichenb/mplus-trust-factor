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

    /**
     * Empty-DB / seed bootstrap defaults only. Runtime active model comes from DB.
     * Do not edit these on the VPS to activate a new formula (see model-lifecycle.md).
     */
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
     * Published Trust Score freshness window (calculation/publication time).
     * Distinct from provider TTLs. Default 7 days.
     */
    SCORE_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
    /**
     * After a failed refresh, ordinary profile/search/account reads must not
     * re-enqueue until this backoff elapses. Last published score remains visible.
     */
    REFRESH_FAILURE_BACKOFF_SECONDS: z.coerce.number().int().nonnegative().default(3_600),

    /**
     * Refresh orchestration (Agent 39).
     * Recurring production enqueue stays disabled by default.
     */
    REFRESH_SCHEDULER_ENABLED: booleanFromString.default(false),
    REFRESH_DRY_RUN_ONLY: booleanFromString.default(true),
    REFRESH_SAFETY_RESERVE_FRACTION: z.coerce.number().min(0).max(1).default(0.1),
    REFRESH_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    /**
     * Environment-wide admitted refresh pipeline cap (distributed semaphore).
     * Not applied to BullMQ Worker concurrency. Unused until REFRESH_CONCURRENCY_ENABLED
     * and REFRESH_ADMISSION_MODE=enforce (later rollout stages).
     */
    REFRESH_GLOBAL_CONCURRENCY: z.coerce.number().int().positive().default(2),
    /**
     * Process-local BullMQ Worker concurrency for refresh-character.
     * Unused until REFRESH_CONCURRENCY_ENABLED (foundation keeps effective concurrency 1).
     */
    REFRESH_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
    REFRESH_WORKER_HARD_MAX: z.coerce.number().int().positive().default(8),
    REFRESH_GLOBAL_HARD_MAX: z.coerce.number().int().positive().default(8),
    REFRESH_MIN_EMERGENCY_RESERVE_POINTS: z.coerce.number().int().nonnegative().default(50),
    REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(60),
    REFRESH_LEASE_TTL_MS: z.coerce.number().int().positive().default(45_000),
    REFRESH_LEASE_HEARTBEAT_MS: z.coerce.number().int().positive().default(15_000),
    /**
     * Admission gate mode:
     * - off (default): no predict, no Redis mutation
     * - shadow: predict vs serial reality only (no Redis reservation/slot holds)
     * - enforce: reserved for later branches; foundation still refuses Redis mutation
     *   unless REFRESH_CONCURRENCY_ENABLED is also true (activation is a later stage)
     */
    REFRESH_ADMISSION_MODE: z.enum(["off", "shadow", "enforce"]).default("off"),
    REFRESH_ETA_ENABLED: booleanFromString.default(false),
    REFRESH_PRIORITY_IN_BULLMQ: booleanFromString.default(false),
    /** Master switch for applying global/local concurrency caps. Default false. */
    REFRESH_CONCURRENCY_ENABLED: booleanFromString.default(false),
    REFRESH_PER_CHARACTER_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(3600),
    REFRESH_SPREAD_HOURS: z.coerce.number().int().positive().default(24),
    /** Indicative share of the configured tracked denominator — not a global WoW percentile. */
    REFRESH_TRACKED_TOP_PERCENT: z.coerce.number().min(1).max(100).default(25),
    REFRESH_RATING_THRESHOLD: z.coerce.number().min(0).default(2500),

    /**
     * Maximum retail character level for refresh eligibility and owned-character relevance.
     * Single runtime authority. Default is ACTIVE_EXPANSION_METADATA_V1.maxCharacterLevel (90).
     * Expansion metadata must not independently override this value.
     */
    MAX_CHARACTER_LEVEL: z.coerce.number().int().positive().max(120).default(90),

    /** MVP entitlement flag: when true, the API serializer omits no fields for any client. */
    PUBLIC_DETAILS_ALL: booleanFromString.default(true),

    ADMIN_API_KEY: z.string().min(1),
    /**
     * Emergency shared-key fallback for machine/admin recovery.
     * Default false — must be explicitly enabled. Local `.env.example` sets true for development only.
     * Never accepted from SPA code; every successful use is audited; startup warns when enabled.
     */
    ADMIN_API_KEY_EMERGENCY_FALLBACK: booleanFromString.default(false),
    /**
     * Optional first-admin bootstrap (immutable id only). Exactly one may be set.
     * Applied on API startup when present; never accepts BattleTag/email.
     * Leave unset for local until the operator has completed first OAuth login, then use
     * `pnpm iam:grant-admin` or set one of these and restart.
     */
    ADMIN_BOOTSTRAP_USER_ID: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().uuid().optional(),
    ),
    ADMIN_BOOTSTRAP_BATTLENET_SUBJECT: z.preprocess(
      (value) => {
        if (typeof value !== "string") return value;
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
      },
      z.string().min(1).optional(),
    ),
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

    /**
     * Realm catalog freshness window for worker bootstrap (lastSyncedAt).
     * Stale-but-non-empty catalogs remain usable if a refresh fails (last-known-good).
     * Empty catalogs must be bootstrapped before the worker reports ready in live mode.
     * Default 7 days. Sync classifies details before public activation — not coupled to score-model seeding.
     */
    REALM_CATALOG_STALE_SECONDS: z.coerce.number().int().positive().default(604_800),
    /**
     * Bounded concurrency for Blizzard realm detail fetches during catalog sync.
     * Details are required to activate public catalog rows.
     */
    REALM_CATALOG_DETAIL_CONCURRENCY: z.coerce.number().int().positive().max(16).default(4),
  })
  .superRefine((env, ctx) => {
    if (env.ADMIN_BOOTSTRAP_USER_ID && env.ADMIN_BOOTSTRAP_BATTLENET_SUBJECT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide at most one of ADMIN_BOOTSTRAP_USER_ID or ADMIN_BOOTSTRAP_BATTLENET_SUBJECT (immutable identity only)",
        path: ["ADMIN_BOOTSTRAP_USER_ID"],
      });
    }

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
  buildRefreshAdmissionConfig,
  clampWorkerConcurrency,
  clampGlobalConcurrency,
  isRefreshAdmissionRedisMutationEnabled,
  isRefreshAdmissionShadowEnabled,
  computeEmergencyReservePoints,
  computeNormalAvailablePoints,
  computeEmergencyAvailablePoints,
  deriveWclWindowId,
  isWclSnapshotFresh,
  REFRESH_ADMISSION_POLICY_VERSION,
  DEFAULT_REFRESH_WORKER_HARD_MAX,
  DEFAULT_REFRESH_GLOBAL_HARD_MAX,
  DEFAULT_REFRESH_MIN_EMERGENCY_RESERVE_POINTS,
  DEFAULT_REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS,
  DEFAULT_REFRESH_LEASE_TTL_MS,
  DEFAULT_REFRESH_LEASE_HEARTBEAT_MS,
  type RefreshAdmissionMode,
  type RefreshAdmissionEnv,
  type RefreshAdmissionConfig,
} from "./refresh-admission-policy.js";

export {
  decideScoreRefresh,
  isScoreWithinTtl,
  isWithinFailureBackoff,
  isStaleContractFailureCode,
  extractJobErrorCode,
  preferRecalculateOnly,
  toAccountTrustStatus,
  scoreAgeMs,
  DEFAULT_SCORE_TTL_SECONDS,
  DEFAULT_REFRESH_FAILURE_BACKOFF_SECONDS,
  STALE_CONTRACT_FAILURE_CODES,
  ELIGIBILITY_FAILURE_CODES,
  isEligibilityFailureCode,
  type ScoreRefreshAction,
  type PublicScoreState,
  type ScoreRefreshReason,
  type ScoreRefreshDecision,
  type ScoreRefreshDecisionInput,
  type ScoreContractStaleReason,
  type CoarseRefreshStatus,
  type DetailedRefreshStatus as ScoreDetailedRefreshStatus,
  type AccountTrustLifecycleStatus,
} from "./score-refresh-decision.js";

export {
  ACTIVE_EXPANSION_METADATA_V1,
  type ActiveExpansionMetadataV1,
} from "./game-metadata.js";

export {
  OWNED_CHARACTER_RELEVANCE_POLICY_V1,
  buildOwnedCharacterRelevancePolicy,
  evaluateOwnedCharacterRelevanceV1,
  evaluateOwnedCharacterAutoRefreshEligibilityV1,
  type OwnedCharacterRelevanceInput,
  type OwnedCharacterRelevancePolicyV1,
  type OwnedCharacterRelevanceResult,
  type RelevanceReason,
} from "./owned-character-relevance-policy.js";

export {
  CHARACTER_REFRESH_ELIGIBILITY_POLICY_V1,
  CHARACTER_BELOW_MAX_LEVEL,
  CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE,
  CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN,
  CHARACTER_REFRESH_ELIGIBILITY_CODES,
  MAX_CHARACTER_LEVEL_CONFIG_KEY,
  buildCharacterRefreshEligibilityPolicy,
  evaluateCharacterRefreshEligibility,
  getConfiguredMaxCharacterLevel,
  isCharacterRefreshEligibilityCode,
  type CharacterRefreshEligibilityPolicyV1,
  type CharacterRefreshEligibilityCode,
  type CharacterRefreshEligibilityInput,
  type CharacterRefreshEligibilityResult,
} from "./character-refresh-eligibility.js";

export {
  BLIZZARD_PLAYABLE_CLASS_ID_TO_SLUG,
  WOW_CLASS_COLORS,
  WOW_CLASS_DISPLAY_NAMES,
  WOW_CLASS_ICON_URLS,
  presentWowClass,
  slugFromBlizzardPlayableClassId,
  type WowClassPresentation,
} from "./wow-class-presentation.js";
