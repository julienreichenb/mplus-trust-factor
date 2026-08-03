/**
 * Bounded types for Agent 11 cohort bootstrap plan / manifest / summary artifacts.
 */

export const BOOTSTRAP_PLAN_STATES = [
  "ALREADY_READY",
  "FOUND_INCOMPLETE",
  "MISSING",
  "EXCLUDED",
  "ALREADY_ENQUEUED",
  "TERMINAL_SUCCESS",
  "TERMINAL_FAILURE",
  "RETRYABLE_FAILURE",
  "INCOMPATIBLE_IDENTITY",
] as const;

export type BootstrapPlanState = (typeof BOOTSTRAP_PLAN_STATES)[number];

export const BOOTSTRAP_OPERATIONS = [
  "NONE",
  "ENQUEUE_RESOLVE_REFRESH",
  "SKIP",
  "RESUME_WAIT",
] as const;

export type BootstrapOperation = (typeof BOOTSTRAP_OPERATIONS)[number];

export const BOOTSTRAP_ERROR_CODES = [
  "NONE",
  "GUARD_REFUSED",
  "IDENTITY_INVALID",
  "EXCLUDED_BY_POLICY",
  "RESOLVE_FAILED",
  "PROVIDER_UNAVAILABLE",
  "NOT_FOUND",
  "QUEUE_ENQUEUE_FAILED",
  "INCOMPATIBLE",
  "LIMIT_SKIPPED",
  /** Bounded forceRetry repair still returned PROFILE_ONLY / BOOTSTRAP_INCOMPLETE. */
  "BOOTSTRAP_REPAIR_INCOMPLETE",
] as const;

export type BootstrapErrorCode = (typeof BOOTSTRAP_ERROR_CODES)[number];

export interface CohortBootstrapMemberInput {
  id: string;
  region: string;
  realm: string;
  character: string;
  expectedTier?: string;
  expectedLabel?: string;
  exclusionReason?: string | null;
  blizzardCharacterId?: string | null;
  characterId?: string | null;
  evidenceStatus?: string;
}

export interface CohortBootstrapDoc {
  schemaVersion: string;
  cohortId: string;
  members: CohortBootstrapMemberInput[];
  generatedAt?: string;
}

export interface BootstrapIdentityKeyParts {
  region: string;
  realmSlug: string;
  name: string;
  normalizedName: string;
}

/** One unique character identity after cohort dedupe (41 members → 40 identities). */
export interface BootstrapIdentity {
  identityKey: string;
  region: string;
  realmSlug: string;
  name: string;
  normalizedName: string;
  blizzardCharacterId: string | null;
  memberIds: string[];
  expectedLabels: string[];
  expectedTiers: string[];
  exclusionReasons: Array<string | null>;
  /** True when every member for this identity carries a non-null exclusion reason. */
  fullyExcluded: boolean;
  /** True when this identity is Myzouth (deferred by default). */
  isMyzouth: boolean;
}

export interface DbCharacterProbe {
  characterId: string;
  incompleteBootstrap: boolean;
  hasPublicSnapshot: boolean;
  activeJobId: string | null;
  activeJobStatus: "QUEUED" | "ACTIVE" | null;
  latestJobId: string | null;
  latestJobStatus: string | null;
  latestJobErrorCode: string | null;
}

export interface BootstrapPlanEntry {
  identityKey: string;
  memberIds: string[];
  region: string;
  realmSlug: string;
  name: string;
  blizzardCharacterId: string | null;
  initialState: BootstrapPlanState;
  plannedOperation: BootstrapOperation;
  reason: string;
  characterId: string | null;
  bootstrapJobKey: string;
  errorCode: BootstrapErrorCode;
}

export interface BootstrapManifestEntry {
  identityKey: string;
  memberIds: string[];
  region: string;
  realmSlug: string;
  name: string;
  initialState: BootstrapPlanState;
  plannedOperation: BootstrapOperation;
  bootstrapJobKey: string;
  jobIds: string[];
  attemptCount: number;
  resultState: BootstrapPlanState;
  errorCode: BootstrapErrorCode;
  characterId: string | null;
  reason: string;
}

export interface BootstrapManifest {
  schemaVersion: string;
  cohortId: string;
  sourceFileHash: string;
  targetEnvironment: "test";
  sanitizedDatabaseTarget: { hostname: string; port: string; database: string };
  generatedAt: string;
  runnerVersion: string;
  mode: "dry-run" | "execute";
  identities: BootstrapManifestEntry[];
}

export interface BootstrapPlanDocument {
  schemaVersion: string;
  cohortId: string;
  sourceFileHash: string;
  targetEnvironment: "test";
  sanitizedDatabaseTarget: { hostname: string; port: string; database: string };
  generatedAt: string;
  runnerVersion: string;
  mode: "dry-run" | "execute";
  counts: Record<string, number>;
  identities: BootstrapPlanEntry[];
}

export interface BootstrapSummaryDocument {
  schemaVersion: string;
  cohortId: string;
  sourceFileHash: string;
  targetEnvironment: "test";
  sanitizedDatabaseTarget: { hostname: string; port: string; database: string };
  generatedAt: string;
  runnerVersion: string;
  mode: "dry-run" | "execute";
  memberCount: number;
  uniqueIdentityCount: number;
  counts: Record<string, number>;
  enqueuedJobIds: string[];
  skippedIdentityKeys: string[];
  failedIdentityKeys: string[];
  concurrency: number;
  limit: number | null;
  retryFailures: boolean;
}
