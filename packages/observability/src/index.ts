import { randomUUID } from "node:crypto";
import pino, { type Logger, type LoggerOptions } from "pino";

export const SECRET_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.clientSecret",
  "*.client_secret",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.ADMIN_API_KEY",
  "*.SESSION_SECRET",
  "*.BLIZZARD_CLIENT_SECRET",
  "*.WCL_CLIENT_SECRET",
  "*.RAIDERIO_APP_KEY",
] as const;

export function createLogger(options?: {
  level?: string;
  name?: string;
  base?: Record<string, unknown>;
}): Logger {
  const opts: LoggerOptions = {
    name: options?.name ?? "mplus",
    level: options?.level ?? "info",
    base: options?.base ?? undefined,
    redact: {
      paths: [...SECRET_REDACT_PATHS],
      censor: "[Redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return pino(opts);
}

export function createRequestId(existing?: string | null): string {
  if (existing && existing.trim().length > 0) {
    return existing.trim();
  }
  return randomUUID();
}

export type { Logger };

export {
  constantTimeEqual,
  escapeHtml,
  isAllowedProviderHost,
  assertAllowedProviderUrl,
  redactSecretsInObject,
  DEFAULT_ALLOWED_PROVIDER_HOSTS,
} from "./security.js";

export {
  MetricsRegistry,
  getMetricsRegistry,
  resetMetricsRegistry,
  type ProviderRequestLabels,
  type WclBudgetSnapshot,
} from "./metrics.js";
