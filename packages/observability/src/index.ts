import { randomUUID } from "node:crypto";
import pino, { type Logger, type LoggerOptions } from "pino";

export const SECRET_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers[\"x-admin-api-key\"]",
  "req.headers.x-admin-api-key",
  "*.clientSecret",
  "*.client_secret",
  "*.clientId",
  "*.client_id",
  "*.password",
  "*.token",
  "*.access_token",
  "*.accessToken",
  "*.refreshToken",
  "*.refresh_token",
  "*.reportCode",
  "*.report_code",
  "*.Authorization",
  "*.DATABASE_URL",
  "*.REDIS_URL",
  "*.ADMIN_API_KEY",
  "*.SESSION_SECRET",
  "*.BLIZZARD_CLIENT_ID",
  "*.BLIZZARD_CLIENT_SECRET",
  "*.WCL_CLIENT_ID",
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
  sanitizeSensitiveDeep,
  sanitizeFreeText,
  normalizeOperationalError,
  toJsonSafeSanitized,
  fingerprintIdentifier,
  maskReportCode,
  sanitizeReportRef,
  sanitizeCharacterRef,
  DEFAULT_ALLOWED_PROVIDER_HOSTS,
} from "./security.js";

export { OBS_EVENTS, type ObsEventName } from "./events.js";

export {
  MetricsRegistry,
  getMetricsRegistry,
  resetMetricsRegistry,
  type ProviderRequestLabels,
  type WclBudgetSnapshot,
} from "./metrics.js";

export {
  SCORING_JOB_SCHEMA_VERSION,
  SCORING_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  SCORING_ACQUISITION_PLAN_SCHEMA_VERSION,
  buildScoringLogContext,
  sanitizeScoringLogFields,
  boundOperationalReason,
  emitScoringEvent,
  runSafeTelemetry,
  recordManifestCoverage,
  recordInvalidCandidateReason,
  recordDatasetOutcome,
  recordFactSetWritten,
  recordSlotOutcome,
  recordBatchOutcome,
  recordAdmissionDecision,
  recordPublicationDecision,
  recordFinalizationRecovery,
  recordScoreConfidenceSample,
  recordV1V2Delta,
  recordQueueSnapshot,
  recordArtifactOrphan,
  recordCalibrationOutcome,
  recordReferenceSliceState,
  type ScoringEventName,
  type ScoringCorrelationFields,
  type SlotOutcomeKind,
} from "./scoring-metrics.js";

export {
  evaluateReadiness,
  evaluateWclProviderUsability,
  requiredProbesForModes,
  SCORING_CONTRACT_VERSIONS,
  type ScoringModeSnapshot,
  type ReadinessProbeResults,
  type ReadinessEvaluation,
  type WclProviderProbe,
} from "./readiness.js";
