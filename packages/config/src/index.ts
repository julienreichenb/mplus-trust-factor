import { z } from "zod";

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
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

    BLIZZARD_CLIENT_ID: z.string().optional().default(""),
    BLIZZARD_CLIENT_SECRET: z.string().optional().default(""),
    BLIZZARD_DEFAULT_REGION: z.string().default("eu"),
    BLIZZARD_DEFAULT_LOCALE: z.string().default("en_GB"),
    BLIZZARD_REQUEST_CONCURRENCY: z.coerce.number().int().positive().default(4),
    BLIZZARD_CHARACTER_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),

    WCL_CLIENT_ID: z.string().optional().default(""),
    WCL_CLIENT_SECRET: z.string().optional().default(""),
    WCL_PUBLIC_GRAPHQL_URL: z
      .string()
      .url()
      .default("https://www.warcraftlogs.com/api/v2/client"),
    WCL_TOKEN_URL: z.string().url().default("https://www.warcraftlogs.com/oauth/token"),
    WCL_RATE_WARN_PERCENT: z.coerce.number().min(0).max(100).default(70),
    WCL_RATE_DEFER_PERCENT: z.coerce.number().min(0).max(100).default(80),
    WCL_RATE_STOP_PERCENT: z.coerce.number().min(0).max(100).default(90),
    WCL_CHARACTER_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),

    RAIDERIO_BASE_URL: z.string().url().default("https://raider.io"),
    RAIDERIO_APP_KEY: z.string().optional().default(""),
    RAIDERIO_SOFT_RPM: z.coerce.number().int().positive().default(60),
    RAIDERIO_REQUEST_CONCURRENCY: z.coerce.number().int().positive().default(2),
    RAIDERIO_CHARACTER_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),

    ACTIVE_SCORE_MODEL_KEY: z.string().default("default"),
    ACTIVE_SCORE_MODEL_VERSION: z.coerce.number().int().positive().default(1),
    MANUAL_REFRESH_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(900),

    /** MVP entitlement flag: when true, the API serializer omits no fields for any client. */
    PUBLIC_DETAILS_ALL: booleanFromString.default(true),

    ADMIN_API_KEY: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
    COOKIE_DOMAIN: z.string().default("localhost"),
    TRUST_PROXY: booleanFromString.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.PROVIDER_MODE === "live") {
      if (!env.BLIZZARD_CLIENT_ID || !env.BLIZZARD_CLIENT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Blizzard credentials required when PROVIDER_MODE=live",
          path: ["BLIZZARD_CLIENT_ID"],
        });
      }
      if (!env.WCL_CLIENT_ID || !env.WCL_CLIENT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Warcraft Logs credentials required when PROVIDER_MODE=live",
          path: ["WCL_CLIENT_ID"],
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

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
