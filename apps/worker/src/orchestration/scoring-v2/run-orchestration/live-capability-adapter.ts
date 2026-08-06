/**
 * Production live capability acquisition for Scoring V2 digest orchestration.
 * One shared CapabilityEvidencePackageV1 per source fight — never per participant
 * or dimension. Fail-closed unless every live gate is explicit.
 */
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import type { AppEnv } from "@mplus/config";
import {
  assertCapabilityEvidencePackageV1,
} from "@mplus/contracts";
import type { ArtifactRepository, WclSourceRepository } from "@mplus/database";
import {
  acquireCapabilityEvidencePackage,
  OPERATIONS,
  type WclGraphQlClient,
} from "@mplus/provider-warcraftlogs";
import { createPersistentSharedEvidenceStore } from "../persistent-shared-evidence-store.js";
import { persistCapabilityPackageToPostgres } from "./production-ports.js";
import {
  type AcquireCapabilityPackageResult,
  type CompatiblePackageHit,
  type OrchestrationParticipant,
  type SourceFightIdentity,
} from "./orchestrator.js";
import { CapabilityEvidencePackageRepository } from "@mplus/database";
import type { PrismaClient } from "@mplus/database";

export type LiveCapabilityCostSource =
  | "MEASURED_RATE_LIMIT_DELTA"
  | "PACKAGE_ACCOUNTING"
  | "ESTIMATED_CONSERVATIVE"
  | "UNKNOWN";

export interface LiveCapabilityAcquisitionAccounting {
  providerCalls: number;
  pagesFetched: number;
  filterBatchCount: number;
  /** Measured when available; null when unknown (never coerced to 0). */
  pointsConsumed: number | null;
  estimatedPointsConsumed: number | null;
  costSource: LiveCapabilityCostSource;
  packageArtifactId: string;
  contentHash: string;
  compatibilityKey: string;
}

export interface LiveCapabilityAcquireResult extends AcquireCapabilityPackageResult {
  accounting: LiveCapabilityAcquisitionAccounting;
}

export interface LiveCapabilityPermissionInput {
  providerMode: AppEnv["PROVIDER_MODE"] | string;
  wclEnabled: boolean;
  allowLiveProviderCalls: boolean;
  liveProviderPermissionGranted: boolean;
  scoringV2PublicationEnabled: boolean;
  /** Credentials may exist but must never imply permission. */
  hasWclCredentials: boolean;
}

export type LiveCapabilityPermissionDenial =
  | "PROVIDER_MODE_NOT_LIVE"
  | "WCL_DISABLED"
  | "ALLOW_LIVE_PROVIDER_CALLS_FALSE"
  | "ORCHESTRATION_LIVE_PERMISSION_FORBIDDEN"
  | "PUBLICATION_ENABLED"
  | "WCL_CREDENTIALS_MISSING";

/**
 * Fail-closed revision gate. Never substitutes a default revision.
 * Unknown actual revision is treated as a mismatch against the expected identity.
 */
export function assertExpectedFightRevision(input: {
  reportCode: string;
  fightId: number;
  expectedRevision: number;
  actualRevision: number | null | undefined;
}): asserts input is {
  reportCode: string;
  fightId: number;
  expectedRevision: number;
  actualRevision: number;
} {
  if (
    input.actualRevision == null ||
    !Number.isFinite(input.actualRevision) ||
    input.actualRevision !== input.expectedRevision
  ) {
    throw Object.assign(
      new Error(
        `fight_revision_mismatch:expected=${input.expectedRevision} actual=${input.actualRevision ?? "null"}`,
      ),
      { code: "FIGHT_REVISION_MISMATCH" },
    );
  }
}

export function evaluateLiveCapabilityPermission(
  input: LiveCapabilityPermissionInput,
): { allowed: true } | { allowed: false; reasons: LiveCapabilityPermissionDenial[] } {
  const reasons: LiveCapabilityPermissionDenial[] = [];
  if (input.providerMode !== "live") reasons.push("PROVIDER_MODE_NOT_LIVE");
  if (!input.wclEnabled) reasons.push("WCL_DISABLED");
  if (!input.allowLiveProviderCalls) reasons.push("ALLOW_LIVE_PROVIDER_CALLS_FALSE");
  if (!input.liveProviderPermissionGranted) {
    reasons.push("ORCHESTRATION_LIVE_PERMISSION_FORBIDDEN");
  }
  if (input.scoringV2PublicationEnabled) reasons.push("PUBLICATION_ENABLED");
  if (!input.hasWclCredentials) reasons.push("WCL_CREDENTIALS_MISSING");
  // Credentials alone never grant: even with credentials, other gates must pass.
  if (reasons.length > 0) return { allowed: false, reasons };
  return { allowed: true };
}

/** Conservative documented estimate when measured points are unavailable. */
export const CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT = 45;

export interface ResolveFightMetadataResult {
  reportRevision: number;
  fightStartMs: number;
  fightEndMs: number;
  dungeonSlug: string;
  masterData: unknown;
  friendlyPlayerActorIds: number[];
  providerCalls: number;
}

export async function resolveAuthoritativeFightMetadata(input: {
  client: WclGraphQlClient;
  reportCode: string;
  fightId: number;
  expectedRevision: number;
  region: string;
}): Promise<ResolveFightMetadataResult> {
  const result = await input.client.requestPermissive<{
    reportData?: {
      report?: {
        revision?: number;
        fights?: Array<{
          id?: number;
          startTime?: number;
          endTime?: number;
          name?: string;
          keystoneLevel?: number;
          friendlyPlayers?: Array<number | { id?: number }> | null;
        }>;
        masterData?: unknown;
      } | null;
    };
  }>({
    operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
    query: OPERATIONS.ReportWithFightAndMasterData.query,
    variables: {
      code: input.reportCode,
      fightIDs: [input.fightId],
    },
    region: input.region,
  });

  const report = result.response.data?.reportData?.report;
  if (!report) {
    throw Object.assign(new Error(`fight_metadata_report_absent:${input.reportCode}`), {
      code: "FIGHT_METADATA_ABSENT",
    });
  }
  const fight = (report.fights ?? []).find((f) => f.id === input.fightId);
  if (!fight || fight.startTime == null || fight.endTime == null) {
    throw Object.assign(
      new Error(`fight_bounds_unavailable:${input.reportCode}:${input.fightId}`),
      { code: "FIGHT_BOUNDS_UNAVAILABLE" },
    );
  }
  const revision =
    typeof report.revision === "number" ? report.revision : null;
  assertExpectedFightRevision({
    reportCode: input.reportCode,
    fightId: input.fightId,
    expectedRevision: input.expectedRevision,
    actualRevision: revision,
  });

  const friendlyPlayerActorIds = (fight.friendlyPlayers ?? [])
    .map((entry) => (typeof entry === "number" ? entry : entry?.id))
    .filter((id): id is number => typeof id === "number");

  return {
    reportRevision: revision!,
    fightStartMs: fight.startTime,
    fightEndMs: fight.endTime,
    dungeonSlug: fight.name
      ? fight.name.toLowerCase().replace(/\s+/g, "-")
      : "unknown",
    masterData: report.masterData ?? null,
    friendlyPlayerActorIds,
    providerCalls: 1,
  };
}

export interface CreateLiveCapabilityAcquireHookInput {
  env: AppEnv;
  prisma: PrismaClient;
  artifacts: ArtifactRepository;
  wclSource: WclSourceRepository;
  client: WclGraphQlClient;
  region: string;
  permission: LiveCapabilityPermissionInput;
  /** Optional measured points for this acquisition (rate-limit delta). */
  measurePointsConsumed?: () => Promise<number | null>;
}

export function createLiveCapabilityAcquireHook(
  deps: CreateLiveCapabilityAcquireHookInput,
): (input: {
  sourceFight: SourceFightIdentity;
  dungeonSlug: string | null;
  keyLevel: number | null;
  participants: OrchestrationParticipant[];
}) => Promise<LiveCapabilityAcquireResult> {
  return async (input) => {
    const gate = evaluateLiveCapabilityPermission(deps.permission);
    if (!gate.allowed) {
      throw Object.assign(
        new Error(`live_capability_acquire_refused:${gate.reasons.join(",")}`),
        { code: "LIVE_ACQUIRE_REFUSED", reasons: gate.reasons },
      );
    }

    const packages = new CapabilityEvidencePackageRepository(
      deps.prisma,
      deps.artifacts,
    );

    // Pre-check: never call WCL when a complete package already exists.
    const existing = await packages.findCompleteBySourceFight(input.sourceFight);
    if (existing && existing.package.complete === true) {
      return {
        package: existing.package,
        packageArtifactId: existing.packageArtifactId,
        contentHash: existing.contentHash,
        providerCalls: 0,
        created: false,
        accounting: {
          providerCalls: 0,
          pagesFetched: existing.package.accounting.pagesFetched,
          filterBatchCount: existing.package.accounting.filterBatchCount,
          pointsConsumed: 0,
          estimatedPointsConsumed: 0,
          costSource: "PACKAGE_ACCOUNTING",
          packageArtifactId: existing.packageArtifactId,
          contentHash: existing.contentHash,
          compatibilityKey: existing.package.compatibilityKey,
        },
      };
    }

    const meta = await resolveAuthoritativeFightMetadata({
      client: deps.client,
      reportCode: input.sourceFight.reportCode,
      fightId: input.sourceFight.fightId,
      expectedRevision: input.sourceFight.reportRevision,
      region: deps.region,
    });

    const store = createPersistentSharedEvidenceStore({
      wclSource: deps.wclSource,
      artifacts: deps.artifacts,
      treatLegacyPayloadMissingAsCacheMiss: true,
      replaceLegacyPageArtifactsOnSave: true,
    });

    const dungeonSlug = input.dungeonSlug ?? meta.dungeonSlug;
    const friendlyFromParticipants = input.participants.map((p) => p.playerActorId);
    const friendlyPlayerActorIds =
      friendlyFromParticipants.length > 0
        ? friendlyFromParticipants
        : meta.friendlyPlayerActorIds;
    if (friendlyPlayerActorIds.length === 0) {
      throw Object.assign(
        new Error(
          `capability_acquisition_requires_friendly_players:${input.sourceFight.reportCode}:${input.sourceFight.fightId}`,
        ),
        { code: "FRIENDLY_PLAYERS_REQUIRED" },
      );
    }
    const acquired = await acquireCapabilityEvidencePackage({
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      client: deps.client,
      store,
      reportCode: input.sourceFight.reportCode,
      reportRevision: input.sourceFight.reportRevision,
      fightId: input.sourceFight.fightId,
      dungeonSlug,
      fightStartMs: meta.fightStartMs,
      fightEndMs: meta.fightEndMs,
      region: deps.region,
      masterData: meta.masterData,
      friendlyPlayerActorIds,
      ownedPetActorIds: [
        ...new Set(input.participants.flatMap((p) => p.ownedPetActorIds)),
      ],
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      forceRefetch: false,
    });

    const pkg = assertCapabilityEvidencePackageV1(acquired.package);
    if (pkg.complete !== true) {
      throw Object.assign(
        new Error(`incomplete_capability_package:${pkg.compatibilityKey}`),
        { code: "INCOMPLETE_CAPABILITY_PACKAGE" },
      );
    }

    const persisted = await persistCapabilityPackageToPostgres({
      artifacts: deps.artifacts,
      packages,
      package: pkg,
    });

    // Reload verification (provider-free).
    const reloaded = await packages.findByCompatibilityKey(pkg.compatibilityKey);
    if (!reloaded) {
      throw Object.assign(new Error("capability_package_reload_missing"), {
        code: "PACKAGE_RELOAD_MISSING",
      });
    }
    if (reloaded.contentHash !== pkg.contentHash) {
      throw Object.assign(new Error("capability_package_reload_hash_mismatch"), {
        code: "PACKAGE_RELOAD_HASH_MISMATCH",
      });
    }
    if (reloaded.package.compatibilityKey !== pkg.compatibilityKey) {
      throw Object.assign(new Error("capability_package_reload_compat_mismatch"), {
        code: "PACKAGE_RELOAD_COMPAT_MISMATCH",
      });
    }
    if (reloaded.complete !== true || reloaded.package.complete !== true) {
      throw Object.assign(new Error("capability_package_reload_incomplete"), {
        code: "PACKAGE_RELOAD_INCOMPLETE",
      });
    }

    const providerCalls = meta.providerCalls + acquired.providerCalls;
    let pointsConsumed: number | null = null;
    let costSource: LiveCapabilityCostSource = "UNKNOWN";
    if (deps.measurePointsConsumed) {
      pointsConsumed = await deps.measurePointsConsumed();
      if (pointsConsumed != null) costSource = "MEASURED_RATE_LIMIT_DELTA";
    }
    if (pointsConsumed == null && typeof pkg.accounting.providerCalls === "number") {
      costSource = "PACKAGE_ACCOUNTING";
    }
    const estimatedPointsConsumed =
      pointsConsumed != null ? null : CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT;

    if (pointsConsumed == null && estimatedPointsConsumed != null) {
      costSource = "ESTIMATED_CONSERVATIVE";
    }

    return {
      package: reloaded.package,
      packageArtifactId: persisted.packageArtifactId,
      contentHash: reloaded.contentHash,
      providerCalls,
      created: true,
      accounting: {
        providerCalls,
        pagesFetched: pkg.accounting.pagesFetched,
        filterBatchCount: pkg.accounting.filterBatchCount,
        pointsConsumed,
        estimatedPointsConsumed,
        costSource,
        packageArtifactId: persisted.packageArtifactId,
        contentHash: reloaded.contentHash,
        compatibilityKey: pkg.compatibilityKey,
      },
    };
  };
}

/** Test helper: wrap a fixture package as a successful acquire result. */
export function liveAcquireResultFromPackage(input: {
  hit: CompatiblePackageHit;
  providerCalls: number;
  created: boolean;
  pointsConsumed?: number | null;
  costSource?: LiveCapabilityCostSource;
}): LiveCapabilityAcquireResult {
  const pkg = input.hit.package;
  return {
    package: pkg,
    packageArtifactId: input.hit.packageArtifactId,
    contentHash: input.hit.contentHash,
    providerCalls: input.providerCalls,
    created: input.created,
    accounting: {
      providerCalls: input.providerCalls,
      pagesFetched: pkg.accounting.pagesFetched,
      filterBatchCount: pkg.accounting.filterBatchCount,
      pointsConsumed: input.pointsConsumed ?? null,
      estimatedPointsConsumed:
        input.pointsConsumed != null ? null : CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT,
      costSource: input.costSource ?? "ESTIMATED_CONSERVATIVE",
      packageArtifactId: input.hit.packageArtifactId,
      contentHash: input.hit.contentHash,
      compatibilityKey: pkg.compatibilityKey,
    },
  };
}
