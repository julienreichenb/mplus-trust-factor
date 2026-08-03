/**
 * Bounded-concurrency execute path for cohort bootstrap.
 * Reuses CharacterService.resolveCharacter (normal pipeline) — does not insert Character rows directly.
 */
import type { CharacterIdentityInput, CharacterResolveResponse } from "@mplus/contracts";
import type {
  BootstrapErrorCode,
  BootstrapManifestEntry,
  BootstrapPlanEntry,
  BootstrapPlanState,
} from "./cohort-bootstrap-types.js";

export const BOOTSTRAP_EVENTS = {
  started: "calibration.bootstrap.started",
  identityPlanned: "calibration.bootstrap.identity_planned",
  jobEnqueued: "calibration.bootstrap.job_enqueued",
  identitySkipped: "calibration.bootstrap.identity_skipped",
  completed: "calibration.bootstrap.completed",
  failed: "calibration.bootstrap.failed",
} as const;

export type BootstrapEventName = (typeof BOOTSTRAP_EVENTS)[keyof typeof BOOTSTRAP_EVENTS];

export interface BootstrapEventSink {
  emit(event: BootstrapEventName, payload: Record<string, unknown>): void;
}

export interface ResolveCharacterFn {
  (
    identity: CharacterIdentityInput,
    opts?: {
      correlationId?: string | null;
      forceRetry?: boolean;
      workloadClass?: "CALIBRATION" | "OPERATION";
    },
  ): Promise<{
    statusCode: number;
    body: CharacterResolveResponse;
  }>;
}

export interface ExecuteBootstrapDeps {
  resolveCharacter: ResolveCharacterFn;
  emit: BootstrapEventSink["emit"];
  /** Safety ledger — tests assert these stay empty / unused. */
  safety: {
    characterPublishedScoreMutations: number;
    modelActivations: number;
    publicationJobsCreated: number;
    featureFlagsMutated: number;
    providerCalls: number;
  };
}

export interface ExecuteBootstrapResult {
  overrides: Map<string, Partial<BootstrapManifestEntry>>;
  enqueuedJobIds: string[];
  skippedIdentityKeys: string[];
  failedIdentityKeys: string[];
}

type MappedResolve = {
  resultState: BootstrapPlanState;
  errorCode: BootstrapErrorCode;
  jobIds: string[];
  characterId: string | null;
  reason: string;
  attemptDelta: number;
};

function isProfileOnlyBootstrapIncomplete(
  body: CharacterResolveResponse,
): body is Extract<CharacterResolveResponse, { status: "PROFILE_ONLY" }> & {
  reason: "BOOTSTRAP_INCOMPLETE";
} {
  return body.status === "PROFILE_ONLY" && body.reason === "BOOTSTRAP_INCOMPLETE";
}

function mapResolveToResult(
  body: CharacterResolveResponse,
  plan: BootstrapPlanEntry,
): MappedResolve {
  switch (body.status) {
    case "READY":
      return {
        resultState: "TERMINAL_SUCCESS",
        errorCode: "NONE",
        jobIds: [],
        characterId: body.characterId,
        reason: "Normal resolve returned READY (no new refresh enqueue).",
        attemptDelta: 1,
      };
    case "PROFILE_ONLY":
      return {
        resultState: "FOUND_INCOMPLETE",
        errorCode: "NONE",
        jobIds: [],
        characterId: body.characterId,
        reason: `Normal resolve returned PROFILE_ONLY (${body.reason}).`,
        attemptDelta: 1,
      };
    case "QUEUED":
    case "PROCESSING":
      return {
        resultState: "ALREADY_ENQUEUED",
        errorCode: "NONE",
        jobIds: [body.refreshId],
        characterId: body.characterId,
        reason: `Normal resolve enqueued/reused refresh job ${body.refreshId} (${body.status}).`,
        attemptDelta: 1,
      };
    case "NOT_FOUND":
      return {
        resultState: "TERMINAL_FAILURE",
        errorCode: "NOT_FOUND",
        jobIds: [],
        characterId: plan.characterId,
        reason: "Normal resolve returned NOT_FOUND.",
        attemptDelta: 1,
      };
    case "PROVIDER_UNAVAILABLE":
      return {
        resultState: "RETRYABLE_FAILURE",
        errorCode: "PROVIDER_UNAVAILABLE",
        jobIds: [],
        characterId: plan.characterId,
        reason: "Normal resolve returned PROVIDER_UNAVAILABLE.",
        attemptDelta: 1,
      };
    case "FAILED":
      return {
        resultState: body.retryable ? "RETRYABLE_FAILURE" : "TERMINAL_FAILURE",
        errorCode: "RESOLVE_FAILED",
        jobIds: [],
        characterId: plan.characterId,
        reason: `Normal resolve FAILED: ${body.message}`.slice(0, 240),
        attemptDelta: 1,
      };
    default:
      return {
        resultState: "INCOMPATIBLE_IDENTITY",
        errorCode: "INCOMPATIBLE",
        jobIds: [],
        characterId: plan.characterId,
        reason: `Unexpected resolve status: ${(body as { status: string }).status}`,
        attemptDelta: 1,
      };
  }
}

/**
 * Map the bounded forceRetry repair response. A second PROFILE_ONLY /
 * BOOTSTRAP_INCOMPLETE is an explicit retryable failure — never a false success.
 */
function mapRepairResolveToResult(
  body: CharacterResolveResponse,
  plan: BootstrapPlanEntry,
): MappedResolve {
  if (isProfileOnlyBootstrapIncomplete(body)) {
    return {
      resultState: "RETRYABLE_FAILURE",
      errorCode: "BOOTSTRAP_REPAIR_INCOMPLETE",
      jobIds: [],
      characterId: body.characterId,
      reason:
        "Bounded forceRetry repair still returned PROFILE_ONLY (BOOTSTRAP_INCOMPLETE).",
      attemptDelta: 1,
    };
  }
  return mapResolveToResult(body, plan);
}

function isFailedResultState(state: BootstrapPlanState): boolean {
  return (
    state === "TERMINAL_FAILURE" ||
    state === "RETRYABLE_FAILURE" ||
    state === "FOUND_INCOMPLETE" ||
    state === "INCOMPATIBLE_IDENTITY"
  );
}

/**
 * Run resolve/enqueue for planned identities with bounded concurrency.
 * Never uses uncontrolled Promise.all over the full cohort.
 *
 * PROFILE_ONLY / BOOTSTRAP_INCOMPLETE triggers exactly one CharacterService
 * forceRetry repair attempt (canonical incomplete-shell repair path).
 */
export async function executeBootstrapPlan(
  planEntries: BootstrapPlanEntry[],
  deps: ExecuteBootstrapDeps,
  opts: { concurrency: number; correlationPrefix: string },
): Promise<ExecuteBootstrapResult> {
  const concurrency = Math.max(1, Math.min(opts.concurrency, 8));
  const toRun = planEntries.filter((e) => e.plannedOperation === "ENQUEUE_RESOLVE_REFRESH");
  const overrides = new Map<string, Partial<BootstrapManifestEntry>>();
  const enqueuedJobIds: string[] = [];
  const skippedIdentityKeys: string[] = [];
  const failedIdentityKeys: string[] = [];

  for (const entry of planEntries) {
    if (entry.plannedOperation === "ENQUEUE_RESOLVE_REFRESH") continue;
    skippedIdentityKeys.push(entry.identityKey);
    deps.emit(BOOTSTRAP_EVENTS.identitySkipped, {
      event: BOOTSTRAP_EVENTS.identitySkipped,
      identityKey: entry.identityKey,
      initialState: entry.initialState,
      reason: entry.reason,
    });
    overrides.set(entry.identityKey, {
      resultState: entry.initialState,
      jobIds: [],
      attemptCount: 0,
      errorCode: entry.errorCode,
      reason: entry.reason,
    });
  }

  let index = 0;
  async function worker(): Promise<void> {
    while (index < toRun.length) {
      const current = index;
      index += 1;
      const entry = toRun[current]!;
      deps.emit(BOOTSTRAP_EVENTS.identityPlanned, {
        event: BOOTSTRAP_EVENTS.identityPlanned,
        identityKey: entry.identityKey,
        initialState: entry.initialState,
        plannedOperation: entry.plannedOperation,
      });
      const identity: CharacterIdentityInput = {
        region: entry.region,
        realmSlug: entry.realmSlug,
        name: entry.name,
      };
      const correlationId = `${opts.correlationPrefix}:${entry.bootstrapJobKey.slice(0, 24)}`;
      try {
        const first = await deps.resolveCharacter(identity, {
          correlationId,
          forceRetry: entry.initialState === "RETRYABLE_FAILURE",
          workloadClass: "CALIBRATION",
        });

        let mapped: MappedResolve;
        let finalBody = first.body;

        if (isProfileOnlyBootstrapIncomplete(first.body)) {
          // Exactly one bounded repair via CharacterService forceRetry — no recursion.
          const repair = await deps.resolveCharacter(identity, {
            correlationId,
            forceRetry: true,
            workloadClass: "CALIBRATION",
          });
          finalBody = repair.body;
          const repairMapped = mapRepairResolveToResult(repair.body, entry);
          mapped = {
            ...repairMapped,
            attemptDelta: 1 + repairMapped.attemptDelta,
            reason:
              repairMapped.resultState === "RETRYABLE_FAILURE" &&
              repairMapped.errorCode === "BOOTSTRAP_REPAIR_INCOMPLETE"
                ? repairMapped.reason
                : `After PROFILE_ONLY/BOOTSTRAP_INCOMPLETE, forceRetry repair: ${repairMapped.reason}`,
          };
        } else {
          mapped = mapResolveToResult(first.body, entry);
        }

        if (mapped.jobIds.length > 0) {
          for (const jobId of mapped.jobIds) {
            enqueuedJobIds.push(jobId);
            deps.emit(BOOTSTRAP_EVENTS.jobEnqueued, {
              event: BOOTSTRAP_EVENTS.jobEnqueued,
              identityKey: entry.identityKey,
              jobId,
              reused: finalBody.status === "PROCESSING" || finalBody.status === "QUEUED",
            });
          }
        }
        if (isFailedResultState(mapped.resultState)) {
          failedIdentityKeys.push(entry.identityKey);
        }
        overrides.set(entry.identityKey, {
          resultState: mapped.resultState,
          jobIds: mapped.jobIds,
          attemptCount: mapped.attemptDelta,
          errorCode: mapped.errorCode,
          characterId: mapped.characterId,
          reason: mapped.reason,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 240) : "unknown error";
        failedIdentityKeys.push(entry.identityKey);
        deps.emit(BOOTSTRAP_EVENTS.failed, {
          event: BOOTSTRAP_EVENTS.failed,
          identityKey: entry.identityKey,
          errorCode: "QUEUE_ENQUEUE_FAILED",
          message,
        });
        overrides.set(entry.identityKey, {
          resultState: "RETRYABLE_FAILURE",
          jobIds: [],
          attemptCount: 1,
          errorCode: "QUEUE_ENQUEUE_FAILED",
          reason: message,
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(toRun.length, 1)) }, () =>
    worker(),
  );
  await Promise.all(workers);

  return { overrides, enqueuedJobIds, skippedIdentityKeys, failedIdentityKeys };
}
