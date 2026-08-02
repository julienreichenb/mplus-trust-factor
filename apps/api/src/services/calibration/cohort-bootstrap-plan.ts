/**
 * Pure cohort bootstrap planner — assigns exactly one bounded state per identity.
 */
import { buildBootstrapJobKey } from "./cohort-bootstrap-identity.js";
import type {
  BootstrapIdentity,
  BootstrapManifest,
  BootstrapManifestEntry,
  BootstrapPlanEntry,
  BootstrapPlanState,
  DbCharacterProbe,
} from "./cohort-bootstrap-types.js";

export interface PlanBootstrapInput {
  cohortId: string;
  identities: BootstrapIdentity[];
  /** Lookup by identityKey; null = missing from DB. */
  dbByIdentityKey: Map<string, DbCharacterProbe | null>;
  /** Explicit member overrides that may lift exclusions (incl. Myzouth). */
  includeMemberIds: Set<string>;
  /** Prior manifest for resume (optional). */
  resumeManifest?: BootstrapManifest | null;
  /** When true, RETRYABLE_FAILURE from resume may be planned for re-enqueue. */
  retryFailures?: boolean;
  limit?: number | null;
}

function resumeEntryFor(
  identityKey: string,
  resume: BootstrapManifest | null | undefined,
): BootstrapManifestEntry | undefined {
  return resume?.identities.find((e) => e.identityKey === identityKey);
}

function isTerminalSuccess(state: BootstrapPlanState): boolean {
  return state === "TERMINAL_SUCCESS" || state === "ALREADY_READY";
}

function exclusionLifted(identity: BootstrapIdentity, includeMemberIds: Set<string>): boolean {
  if (!identity.fullyExcluded && !identity.isMyzouth) return true;
  return identity.memberIds.some((id) => includeMemberIds.has(id));
}

/**
 * Assign planning state + operation for one identity (no I/O).
 */
export function planOneIdentity(
  identity: BootstrapIdentity,
  db: DbCharacterProbe | null | undefined,
  opts: {
    cohortId: string;
    includeMemberIds: Set<string>;
    resume?: BootstrapManifestEntry;
    retryFailures: boolean;
  },
): BootstrapPlanEntry {
  const bootstrapJobKey = buildBootstrapJobKey(opts.cohortId, identity.identityKey);
  const base = {
    identityKey: identity.identityKey,
    memberIds: [...identity.memberIds].sort(),
    region: identity.region,
    realmSlug: identity.realmSlug,
    name: identity.name,
    blizzardCharacterId: identity.blizzardCharacterId,
    bootstrapJobKey,
    characterId: db?.characterId ?? null,
  };

  if (!identity.region || !identity.realmSlug || !identity.normalizedName) {
    return {
      ...base,
      initialState: "INCOMPATIBLE_IDENTITY",
      plannedOperation: "NONE",
      reason: "Identity missing required region, realm slug, or character name after normalization.",
      errorCode: "IDENTITY_INVALID",
    };
  }

  // Resume short-circuits
  if (opts.resume) {
    if (isTerminalSuccess(opts.resume.resultState) || opts.resume.resultState === "TERMINAL_SUCCESS") {
      return {
        ...base,
        characterId: opts.resume.characterId ?? base.characterId,
        initialState: "TERMINAL_SUCCESS",
        plannedOperation: "SKIP",
        reason: "Resume manifest marks this identity as terminal success.",
        errorCode: "NONE",
      };
    }
    if (opts.resume.resultState === "TERMINAL_FAILURE") {
      return {
        ...base,
        characterId: opts.resume.characterId ?? base.characterId,
        initialState: "TERMINAL_FAILURE",
        plannedOperation: "SKIP",
        reason: "Resume manifest marks this identity as terminal failure.",
        errorCode: opts.resume.errorCode,
      };
    }
    if (opts.resume.resultState === "ALREADY_ENQUEUED") {
      return {
        ...base,
        characterId: opts.resume.characterId ?? base.characterId,
        initialState: "ALREADY_ENQUEUED",
        plannedOperation: "RESUME_WAIT",
        reason: `Resume manifest has active/queued job(s): ${(opts.resume.jobIds ?? []).join(",") || "(none)"}.`,
        errorCode: "NONE",
      };
    }
    if (opts.resume.resultState === "RETRYABLE_FAILURE") {
      if (!opts.retryFailures) {
        return {
          ...base,
          characterId: opts.resume.characterId ?? base.characterId,
          initialState: "RETRYABLE_FAILURE",
          plannedOperation: "SKIP",
          reason: "Resume manifest retryable failure; re-enqueue requires --retry-failures.",
          errorCode: opts.resume.errorCode,
        };
      }
      // Fall through to live DB planning with retry allowed.
    }
  }

  // Exclusion / Myzouth deferred (unless explicit include)
  if (identity.isMyzouth && !exclusionLifted(identity, opts.includeMemberIds)) {
    return {
      ...base,
      initialState: "EXCLUDED",
      plannedOperation: "NONE",
      reason:
        "Myzouth remains MYZOUTH_BOOTSTRAP_DEFERRED unless --include-member supplies an explicit override.",
      errorCode: "EXCLUDED_BY_POLICY",
    };
  }

  if (identity.fullyExcluded && !exclusionLifted(identity, opts.includeMemberIds)) {
    const reasons = [...new Set(identity.exclusionReasons.filter(Boolean))];
    return {
      ...base,
      initialState: "EXCLUDED",
      plannedOperation: "NONE",
      reason: `Excluded by cohort policy (${reasons.join(", ") || "unknown"}).`,
      errorCode: "EXCLUDED_BY_POLICY",
    };
  }

  if (!db) {
    return {
      ...base,
      initialState: "MISSING",
      plannedOperation: "ENQUEUE_RESOLVE_REFRESH",
      reason: "Identity not found in target database; plan normal resolve + refresh enqueue.",
      errorCode: "NONE",
    };
  }

  if (db.activeJobId) {
    return {
      ...base,
      characterId: db.characterId,
      initialState: "ALREADY_ENQUEUED",
      plannedOperation: "RESUME_WAIT",
      reason: `Active ${db.activeJobStatus ?? "QUEUED"} refresh job ${db.activeJobId} already exists.`,
      errorCode: "NONE",
    };
  }

  if (!db.incompleteBootstrap && db.hasPublicSnapshot) {
    return {
      ...base,
      characterId: db.characterId,
      initialState: "ALREADY_READY",
      plannedOperation: "SKIP",
      reason: "Character exists with complete bootstrap evidence and a public score snapshot.",
      errorCode: "NONE",
    };
  }

  // Latest job terminal states from DB
  if (db.latestJobStatus === "COMPLETED" && !db.incompleteBootstrap && db.hasPublicSnapshot) {
    return {
      ...base,
      characterId: db.characterId,
      initialState: "TERMINAL_SUCCESS",
      plannedOperation: "SKIP",
      reason: `Latest refresh job ${db.latestJobId} completed with ready character.`,
      errorCode: "NONE",
    };
  }

  if (db.latestJobStatus === "FAILED") {
    const code = db.latestJobErrorCode ?? "";
    const retryable =
      code === "PROVIDER_UNAVAILABLE" ||
      code === "RATE_LIMITED" ||
      code === "TIMEOUT" ||
      code === "TRANSIENT" ||
      code === "STALE_QUEUED";
    if (retryable) {
      return {
        ...base,
        characterId: db.characterId,
        initialState: "RETRYABLE_FAILURE",
        plannedOperation: opts.retryFailures ? "ENQUEUE_RESOLVE_REFRESH" : "SKIP",
        reason: opts.retryFailures
          ? `Prior job failed retryably (${code || "unknown"}); re-enqueue authorized.`
          : `Prior job failed retryably (${code || "unknown"}); pass --retry-failures to re-enqueue.`,
        errorCode: "RESOLVE_FAILED",
      };
    }
    if (code === "NOT_FOUND" || code === "IDENTITY_COLLISION") {
      return {
        ...base,
        characterId: db.characterId,
        initialState: "TERMINAL_FAILURE",
        plannedOperation: "SKIP",
        reason: `Prior job failed terminally (${code}).`,
        errorCode: code === "NOT_FOUND" ? "NOT_FOUND" : "INCOMPATIBLE",
      };
    }
  }

  return {
    ...base,
    characterId: db.characterId,
    initialState: "FOUND_INCOMPLETE",
    plannedOperation: "ENQUEUE_RESOLVE_REFRESH",
    reason: db.incompleteBootstrap
      ? "Character found but bootstrap evidence incomplete; plan normal resolve/repair + refresh."
      : "Character found without a usable public snapshot; plan normal resolve + refresh enqueue.",
    errorCode: "NONE",
  };
}

export function planBootstrapCohort(input: PlanBootstrapInput): {
  entries: BootstrapPlanEntry[];
  counts: Record<BootstrapPlanState, number>;
  limitedEntries: BootstrapPlanEntry[];
} {
  const counts = {
    ALREADY_READY: 0,
    FOUND_INCOMPLETE: 0,
    MISSING: 0,
    EXCLUDED: 0,
    ALREADY_ENQUEUED: 0,
    TERMINAL_SUCCESS: 0,
    TERMINAL_FAILURE: 0,
    RETRYABLE_FAILURE: 0,
    INCOMPATIBLE_IDENTITY: 0,
  } satisfies Record<BootstrapPlanState, number>;

  const entries: BootstrapPlanEntry[] = [];
  for (const identity of input.identities) {
    const entry = planOneIdentity(identity, input.dbByIdentityKey.get(identity.identityKey), {
      cohortId: input.cohortId,
      includeMemberIds: input.includeMemberIds,
      resume: resumeEntryFor(identity.identityKey, input.resumeManifest),
      retryFailures: Boolean(input.retryFailures),
    });
    counts[entry.initialState] += 1;
    entries.push(entry);
  }

  // Deterministic order
  entries.sort((a, b) => a.identityKey.localeCompare(b.identityKey));

  const actionable = entries.filter((e) => e.plannedOperation === "ENQUEUE_RESOLVE_REFRESH");
  const limit = input.limit != null && input.limit > 0 ? input.limit : null;
  const allowedKeys = new Set(
    (limit == null ? actionable : actionable.slice(0, limit)).map((e) => e.identityKey),
  );

  const limitedEntries = entries.map((e) => {
    if (e.plannedOperation !== "ENQUEUE_RESOLVE_REFRESH") return e;
    if (allowedKeys.has(e.identityKey)) return e;
    return {
      ...e,
      plannedOperation: "SKIP" as const,
      reason: `${e.reason} Skipped by --limit.`,
      errorCode: "LIMIT_SKIPPED" as const,
    };
  });

  return { entries: limitedEntries, counts, limitedEntries };
}

export function countByState(entries: BootstrapPlanEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    out[e.initialState] = (out[e.initialState] ?? 0) + 1;
  }
  out.plannedEnqueue = entries.filter((e) => e.plannedOperation === "ENQUEUE_RESOLVE_REFRESH").length;
  return out;
}
