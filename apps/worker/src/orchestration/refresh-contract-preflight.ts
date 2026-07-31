/**
 * Fail-fast refresh-contract preflight barrier.
 *
 * Runs at the start of every refresh-character job, before provider calls,
 * provider-state mutation, run ingestion, metric writes, or WCL budget use.
 *
 * The late publication/TOCTOU guard in refresh-pipeline.ts remains mandatory —
 * it catches contract changes that occur after this preflight succeeds.
 */
import type { Logger } from "@mplus/observability";
import type { BlizzardProvider, RefreshCharacterJob, RefreshContractVersions } from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import type { AppEnv } from "@mplus/config";
import { ensureRegion } from "../persistence/realm-repository.js";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";
import {
  requireVerifiedSeasonAuthority,
  type SeasonAuthorityDeps,
  type VerifiedSeasonAuthority,
} from "./season-authority.js";

export const REFRESH_CONTRACT_PREFLIGHT_MISMATCH = "REFRESH_CONTRACT_PREFLIGHT_MISMATCH" as const;
export const REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH =
  "REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH" as const;

export const REFRESH_CONTRACT_PREFLIGHT_MISMATCH_EVENT = "refresh_contract_preflight_mismatch";

export type RefreshContractPreflightCode =
  | typeof REFRESH_CONTRACT_PREFLIGHT_MISMATCH
  | typeof REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH;

export class RefreshContractPreflightError extends Error {
  readonly code: RefreshContractPreflightCode;
  readonly retryable = false;
  /** Never classify as provider failure / provider-failure backoff. */
  readonly providerFailure = false;
  readonly requestedHash: string | null;
  readonly computedHash: string | null;
  readonly authoritativeSeasonSlug: string | null;
  readonly stage = "preflight" as const;
  readonly providerCalls = 0;

  constructor(input: {
    code: RefreshContractPreflightCode;
    message: string;
    requestedHash: string | null;
    computedHash: string | null;
    authoritativeSeasonSlug?: string | null;
  }) {
    super(input.message);
    this.name = "RefreshContractPreflightError";
    this.code = input.code;
    this.requestedHash = input.requestedHash;
    this.computedHash = input.computedHash;
    this.authoritativeSeasonSlug = input.authoritativeSeasonSlug ?? null;
  }

  /** Durable job.error payload — preserves code without leaking into public DTOs. */
  toJobError(): {
    code: RefreshContractPreflightCode;
    message: string;
    retryable: false;
    providerFailure: false;
    requestedHash: string | null;
    computedHash: string | null;
    stage: "preflight";
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: false,
      providerFailure: false,
      requestedHash: this.requestedHash,
      computedHash: this.computedHash,
      stage: "preflight",
    };
  }
}

export interface RefreshContractPreflightResult {
  contract: RefreshContractVersions;
  hash: string;
  authority: VerifiedSeasonAuthority;
  activeModel: { key: string; version: number };
  /** Fixture-only: job lacked a hash and was allowed to proceed. */
  missingHashAllowed: boolean;
  elapsedMs: number;
}

export interface RefreshContractPreflightDeps {
  prisma: PrismaClient;
  blizzard: BlizzardProvider;
  logger: Logger;
  env: Pick<AppEnv, "PROVIDER_MODE" | "ACTIVE_SCORE_MODEL_KEY" | "ACTIVE_SCORE_MODEL_VERSION">;
  getActiveModel: (key?: string) => Promise<{ key: string; version: number } | null>;
  /** Override for tests — defaults to requireVerifiedSeasonAuthority. */
  requireAuthority?: typeof requireVerifiedSeasonAuthority;
  /** Prefer explicit env so API/worker/tests share one resolution path. */
  processEnv?: NodeJS.ProcessEnv;
  zoneId?: number | null;
  partition?: number | null;
  now?: () => Date;
}

/**
 * Resolve authoritative season + active model + canonical refresh contract,
 * then compare against the job's requested hash before any provider work.
 */
export async function runRefreshContractPreflight(
  deps: RefreshContractPreflightDeps,
  jobPayload: RefreshCharacterJob,
  opts: { jobId: string; correlationId?: string | null } = { jobId: "unknown" },
): Promise<RefreshContractPreflightResult> {
  const startedAt = deps.now?.() ?? new Date();
  const startedMs = startedAt.getTime();

  const region = await ensureRegion(deps.prisma, jobPayload.region);
  const authorityDeps: SeasonAuthorityDeps = {
    prisma: deps.prisma,
    blizzard: deps.blizzard,
    logger: deps.logger,
    now: deps.now,
  };

  // Worker execution may sync when cache is cold; character/profile providers stay untouched.
  const requireAuthority = deps.requireAuthority ?? requireVerifiedSeasonAuthority;
  const authority = await requireAuthority(authorityDeps, region.code, region.id, {
    allowProviderSync: true,
    correlationId: opts.correlationId ?? jobPayload.correlationId ?? null,
  });

  const activeModel =
    (await deps.getActiveModel()) ?? {
      key: deps.env.ACTIVE_SCORE_MODEL_KEY,
      version: deps.env.ACTIVE_SCORE_MODEL_VERSION,
    };

  const { contract, hash: computedHash } = resolveActiveRefreshContract({
    scoringModelKey: activeModel.key,
    scoringModelVersion: activeModel.version,
    activeSeasonId: authority.slug,
    providerMode: deps.env.PROVIDER_MODE,
    env: deps.processEnv ?? process.env,
    zoneId: deps.zoneId,
    partition: deps.partition,
  });

  const requestedHash = jobPayload.refreshContractHash ?? null;
  const elapsedMs = Math.max(0, (deps.now?.() ?? new Date()).getTime() - startedMs);
  const logBase = {
    event: REFRESH_CONTRACT_PREFLIGHT_MISMATCH_EVENT,
    stage: "preflight" as const,
    jobId: opts.jobId,
    characterId: jobPayload.characterId ?? null,
    triggerSource: jobPayload.triggerSource ?? "UNKNOWN",
    requestedHash,
    computedHash,
    authoritativeSeasonSlug: authority.slug,
    authoritativeSeasonId: authority.blizzardSeasonId,
    providerCalls: 0,
    elapsedMs,
  };

  if (!requestedHash) {
    // Fixture / legacy test jobs: allow missing hash with minimum compatibility.
    // Live production jobs must fail closed — never run an expensive refresh without identity.
    if (deps.env.PROVIDER_MODE === "fixture") {
      deps.logger.warn(
        {
          ...logBase,
          event: "refresh_contract_preflight_missing_hash_allowed",
          reason: "fixture_compatibility",
        },
        "refresh contract preflight: missing hash allowed in fixture mode",
      );
      return {
        contract,
        hash: computedHash,
        authority,
        activeModel: { key: activeModel.key, version: activeModel.version },
        missingHashAllowed: true,
        elapsedMs,
      };
    }

    deps.logger.error(
      { ...logBase, event: REFRESH_CONTRACT_PREFLIGHT_MISMATCH_EVENT, reason: "missing_hash" },
      "refresh contract preflight: missing hash — refusing live refresh",
    );
    throw new RefreshContractPreflightError({
      code: REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH,
      message: "Refresh contract hash required before provider execution",
      requestedHash: null,
      computedHash,
      authoritativeSeasonSlug: authority.slug,
    });
  }

  if (requestedHash !== computedHash) {
    deps.logger.error(
      { ...logBase, event: REFRESH_CONTRACT_PREFLIGHT_MISMATCH_EVENT },
      "refresh contract preflight mismatch — refusing provider execution",
    );
    throw new RefreshContractPreflightError({
      code: REFRESH_CONTRACT_PREFLIGHT_MISMATCH,
      message: "Refresh contract preflight mismatch",
      requestedHash,
      computedHash,
      authoritativeSeasonSlug: authority.slug,
    });
  }

  deps.logger.info(
    {
      ...logBase,
      event: "refresh_contract_preflight_ok",
      providerCalls: 0,
    },
    "refresh contract preflight ok",
  );

  return {
    contract,
    hash: computedHash,
    authority,
    activeModel: { key: activeModel.key, version: activeModel.version },
    missingHashAllowed: false,
    elapsedMs,
  };
}

/** True when an error is the dedicated non-retryable preflight barrier failure. */
export function isRefreshContractPreflightError(error: unknown): error is RefreshContractPreflightError {
  if (error instanceof RefreshContractPreflightError) return true;
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === REFRESH_CONTRACT_PREFLIGHT_MISMATCH || code === REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH
  );
}
