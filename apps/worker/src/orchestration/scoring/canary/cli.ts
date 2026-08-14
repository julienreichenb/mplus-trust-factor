/**
 * INTERNAL / TEST_ONLY Scoring V2 canary CLI.
 *
 * Public operator surface is `public-cli.ts`:
 *   pnpm scoring:canary | scoring:replay | scoring:doctor
 *
 * This module remains for focused unit tests (`canary:internal`) and must not
 * be re-exported as root package scripts.
 *
 * Do not document hard-coded character/report/fight identities as operator steps.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isWclSnapshotFresh, loadEnv, type AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import { EVIDENCE_SELECTOR_VERSION, type CharacterIdentityInput } from "@mplus/contracts";
import type { CharacterSeasonEvidenceManifestV2 } from "@mplus/contracts";
import type { WclRateLimitSnapshot } from "@mplus/provider-warcraftlogs";
import { createMemoryOrchestrationPorts } from "../run-orchestration/memory-ports.js";
import {
  isManifestCompatibleWithSeasonPool,
  runScoringCanaryPreflight,
} from "../run-orchestration/canary-preflight.js";
import {
  isScoringEnabled,
  assertPublicationBlocked,
} from "../acquisition.js";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import {
  parseOptionalCliZoneId,
  resolveCanaryZoneId,
  resolveCanaryZoneIdFromEffectiveSeason,
  type ResolvedCanaryZone,
} from "./canary-zone.js";
import {
  assertNotSentinelCharacterId,
  assertOperatorRepositoryMode,
  createMemoryCanaryDependencies,
  createProductionCanaryDependencies,
  resolveCanaryCharacterIdentity,
  type CanaryCharacterResolution,
  type CanaryRepositoryMode,
  CharacterNotFoundError,
} from "./canary-deps.js";
import {
  assertSeasonCatalogOk,
  resolveCanarySeasonCatalog,
  SeasonCatalogMismatchError,
  type CanarySeasonResolution,
} from "./canary-season.js";
import { diagnoseSeasonCatalog } from "./canary-diagnose.js";
import {
  applyActiveMplusSeasonRepair,
  planActiveMplusSeasonRepair,
} from "../../active-mplus-season/index.js";
import { MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID } from "./canary-catalog.js";
import { createWorkerContainer } from "../../../container.js";
import {
  evaluateCanaryDiscoveryGates,
  isDiscoveryExecuteArmed,
} from "./canary-discovery-gates.js";
import {
  createDiscoveryForbiddenAcquireHook,
  runScoringCanaryDiscovery,
} from "./canary-discover.js";
import type {
  CanaryDiscoveryCandidateSource,
  CanaryDiscoveryReport,
} from "./canary-discover-types.js";
import type { EvidenceRole } from "@mplus/contracts";
import type { WclGraphQlClient } from "@mplus/provider-warcraftlogs";
import { observeAuthoritativeReportRevision } from "../run-orchestration/live-capability-adapter.js";
import { discoverShadowCanaryCandidates } from "../shadow-canary/discover.js";
import {
  bootstrapCanaryRateLimitSnapshot,
  defaultCanaryRateSnapshotPath,
  fetchCanaryRateLimitSnapshotLive,
  readPersistedCanaryRateSnapshot,
  type CanaryRateSnapshotBootstrapReport,
} from "./canary-rate-snapshot.js";
import {
  runScoringCanaryLive,
  type CanaryLiveReport,
} from "./canary-live.js";
import { formatCanaryDimensionCliSummary } from "./canary-authoritative-report.js";
import { runScoringCanaryReplay } from "./canary-replay.js";
import { runTargetDigestDiagnostic } from "./canary-target-digest-diagnostic.js";

export interface CanaryCliArgs {
  mode:
    | "preflight"
    | "discover"
    | "rate-snapshot"
    | "live"
    | "reconcile-revisions"
    | "diagnose-catalog"
    | "repair-catalog"
    | "replay"
    | "diagnose-target-digests"
    | "ranking-hydrate"
    | "repair-package";
  region: string;
  realm: string;
  character: string;
  zoneIdOverride: number | null;
  allowZoneIdOverride: boolean;
  confirmLive: boolean;
  confirmDiscovery: boolean;
  confirmRevisionReconcile: boolean;
  confirmRepair: boolean;
  confirmRankingHydrate: boolean;
  confirmTargetedReacquire: boolean;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  outputDir: string | null;
  characterId?: string;
  seasonId?: string;
  candidates?: EvidenceCandidateMetadataV2[];
  activeDungeonSlugs?: string[];
}

export function parseCanaryCliArgs(argv: string[]): CanaryCliArgs {
  const args = [...argv];
  let mode: CanaryCliArgs["mode"] = "preflight";
  if (
    args[0] === "live" ||
    args[0] === "preflight" ||
    args[0] === "discover" ||
    args[0] === "rate-snapshot" ||
    args[0] === "reconcile-revisions" ||
    args[0] === "diagnose-catalog" ||
    args[0] === "repair-catalog" ||
    args[0] === "replay" ||
    args[0] === "diagnose-target-digests" ||
    args[0] === "ranking-hydrate" ||
    args[0] === "repair-package"
  ) {
    mode = args.shift() as CanaryCliArgs["mode"];
  }
  let region = "";
  let realm = "";
  let character = "";
  let zoneIdOverride: number | null = null;
  let allowZoneIdOverride = false;
  let confirmLive = false;
  let confirmDiscovery = false;
  let confirmRevisionReconcile = false;
  let confirmRepair = false;
  let confirmRankingHydrate = false;
  let confirmTargetedReacquire = false;
  let reportCode: string | null = null;
  let fightId: number | null = null;
  let reportRevision: number | null = null;
  let outputDir: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = args[i + 1];
    if (a === "--region" && next) {
      region = next;
      i++;
    } else if (a === "--realm" && next) {
      realm = next;
      i++;
    } else if ((a === "--character" || a === "--name") && next) {
      character = next;
      i++;
    } else if (a === "--zone-id" && next) {
      zoneIdOverride = parseOptionalCliZoneId(next);
      i++;
    } else if (a === "--allow-zone-id-override") {
      allowZoneIdOverride = true;
    } else if (a === "--confirm-live") {
      confirmLive = true;
    } else if (a === "--confirm-discovery") {
      confirmDiscovery = true;
    } else if (a === "--confirm-revision-reconcile") {
      confirmRevisionReconcile = true;
    } else if (a === "--confirm-local-repair") {
      confirmRepair = true;
    } else if (a === "--confirm-ranking-hydrate") {
      confirmRankingHydrate = true;
    } else if (a === "--confirm-targeted-reacquire") {
      confirmTargetedReacquire = true;
    } else if (a === "--report-code" && next) {
      reportCode = next;
      i++;
    } else if (a === "--fight-id" && next) {
      fightId = Number.parseInt(next, 10);
      i++;
    } else if (a === "--report-revision" && next) {
      reportRevision = Number.parseInt(next, 10);
      i++;
    } else if (a === "--output-dir" && next) {
      outputDir = next;
      i++;
    } else if (a === "--mode" && next) {
      if (
        next === "live" ||
        next === "preflight" ||
        next === "discover" ||
        next === "rate-snapshot" ||
        next === "reconcile-revisions" ||
        next === "diagnose-catalog" ||
        next === "repair-catalog"
      ) {
        mode = next;
      }
      i++;
    }
  }

  const common = {
    region: region.toLowerCase(),
    realm: realm.toLowerCase(),
    character,
    zoneIdOverride,
    allowZoneIdOverride,
    confirmLive,
    confirmDiscovery,
    confirmRevisionReconcile,
    confirmRepair,
    confirmRankingHydrate,
    confirmTargetedReacquire,
    reportCode,
    fightId: fightId != null && Number.isFinite(fightId) ? fightId : null,
    reportRevision:
      reportRevision != null && Number.isFinite(reportRevision)
        ? reportRevision
        : null,
    outputDir,
  };

  if (mode === "diagnose-catalog") {
    return { mode, ...common, region: region.toLowerCase() || "eu" };
  }

  if (mode === "rate-snapshot") {
    return {
      mode,
      ...common,
      region: region.toLowerCase() || "eu",
      character: character || "rate-snapshot",
      confirmDiscovery: true,
      confirmRevisionReconcile: false,
    };
  }

  if (mode === "repair-catalog") {
    if (!region) {
      throw Object.assign(new Error("required: --region"), {
        code: "CANARY_ARGS_INCOMPLETE",
      });
    }
    return { mode, ...common };
  }

  if (mode === "repair-package") {
    if (!region || !realm || !character) {
      throw Object.assign(
        new Error("required: --region --realm --character"),
        { code: "CANARY_ARGS_INCOMPLETE" },
      );
    }
    if (!reportCode || fightId == null || reportRevision == null) {
      throw Object.assign(
        new Error(
          "required: --report-code --fight-id --report-revision --confirm-targeted-reacquire",
        ),
        { code: "CANARY_ARGS_INCOMPLETE" },
      );
    }
    return { mode, ...common };
  }

  if (!region || !realm || !character) {
    throw Object.assign(
      new Error("required: --region --realm --character"),
      { code: "CANARY_ARGS_INCOMPLETE" },
    );
  }
  if (/[*?]/.test(character) || character.toLowerCase() === "all") {
    throw Object.assign(new Error("canary_refuses_wildcard_or_cohort"), {
      code: "CANARY_REFUSES_BATCH",
    });
  }

  return { mode, ...common };
}

export interface CanaryLiveGateInput {
  env: Pick<
    AppEnv,
    | "PROVIDER_MODE"
    | "WCL_ENABLED"
    | "ALLOW_LIVE_PROVIDER_CALLS"
    | "SCORING_ENABLED"
    | "SCORING_ENABLED"
    | "SCORING_ENABLED"
    | "SCORING_PUBLICATION_ENABLED"
    | "WCL_CLIENT_ID"
    | "WCL_CLIENT_SECRET"
  >;
  confirmLive: boolean;
  characterCount: number;
}

export type CanaryLiveGateDenial =
  | "MISSING_CONFIRM_LIVE"
  | "PROVIDER_MODE_NOT_LIVE"
  | "ALLOW_LIVE_PROVIDER_CALLS_FALSE"
  | "SHADOW_FLAGS_DISABLED"
  | "PUBLICATION_ENABLED"
  | "MULTIPLE_CHARACTERS"
  | "WCL_CREDENTIALS_MISSING"
  | "WCL_DISABLED";

export function evaluateCanaryLiveGates(
  input: CanaryLiveGateInput,
): { allowed: true } | { allowed: false; reasons: CanaryLiveGateDenial[] } {
  const reasons: CanaryLiveGateDenial[] = [];
  if (!input.confirmLive) reasons.push("MISSING_CONFIRM_LIVE");
  if (input.env.PROVIDER_MODE !== "live") reasons.push("PROVIDER_MODE_NOT_LIVE");
  if (!input.env.ALLOW_LIVE_PROVIDER_CALLS) {
    reasons.push("ALLOW_LIVE_PROVIDER_CALLS_FALSE");
  }
  if (!isScoringEnabled(input.env as never)) {
    reasons.push("SHADOW_FLAGS_DISABLED");
  }
  if (input.env.SCORING_PUBLICATION_ENABLED) {
    reasons.push("PUBLICATION_ENABLED");
  }
  if (input.characterCount !== 1) reasons.push("MULTIPLE_CHARACTERS");
  if (!input.env.WCL_ENABLED) reasons.push("WCL_DISABLED");
  if (!input.env.WCL_CLIENT_ID || !input.env.WCL_CLIENT_SECRET) {
    reasons.push("WCL_CREDENTIALS_MISSING");
  }
  if (reasons.length > 0) return { allowed: false, reasons };
  try {
    assertPublicationBlocked(input.env as never);
  } catch {
    return { allowed: false, reasons: ["PUBLICATION_ENABLED"] };
  }
  return { allowed: true };
}

export async function resolveZoneForCanaryCommand(
  args: CanaryCliArgs,
  options?: {
    env?: NodeJS.ProcessEnv;
    log?: (message: string) => void;
    prisma?: PrismaClient;
    regionId?: string;
    regionCode?: string;
  },
): Promise<ResolvedCanaryZone> {
  void options?.env;
  const log = options?.log;

  if (args.zoneIdOverride != null) {
    return resolveCanaryZoneId({
      cliZoneId: args.zoneIdOverride,
      log,
    });
  }

  if (options?.prisma && options.regionId) {
    return resolveCanaryZoneIdFromEffectiveSeason({
      prisma: options.prisma,
      regionId: options.regionId,
      regionCode: options.regionCode ?? args.region,
      log,
    });
  }

  // Caller must overwrite from season catalog (production) or pass prisma.
  return {
    zoneId: 0,
    envZoneId: 0,
    source: "effective-season",
    overrideActive: false,
  };
}

function identityFromArgs(args: CanaryCliArgs): CharacterIdentityInput {
  return {
    region: args.region.toUpperCase(),
    realmSlug: args.realm,
    name: args.character,
  };
}

async function loadPersistedManifest(input: {
  prisma: PrismaClient;
  characterId: string;
  seasonId: string;
  expectedDungeonSlugs: readonly string[];
}): Promise<CharacterSeasonEvidenceManifestV2 | null> {
  const row = await input.prisma.evidenceManifest.findFirst({
    where: { characterId: input.characterId, seasonId: input.seasonId },
    orderBy: { frozenAt: "desc" },
  });
  if (!row?.document || typeof row.document !== "object") return null;
  const doc = row.document as CharacterSeasonEvidenceManifestV2;
  if (!Array.isArray(doc.slots)) return null;
  if (!isManifestCompatibleWithSeasonPool(doc, input.expectedDungeonSlugs)) {
    return null;
  }
  return doc;
}

export async function runCanaryPreflightCommand(
  args: CanaryCliArgs,
  options?: {
    /** Defaults to PRODUCTION for operator CLI. Tests may set MEMORY with allowNonProductionRepositories. */
    repositoryMode?: CanaryRepositoryMode;
    allowNonProductionRepositories?: boolean;
    ports?: ReturnType<typeof createMemoryOrchestrationPorts>;
    candidates?: EvidenceCandidateMetadataV2[];
    activeDungeonSlugs?: string[];
    characterId?: string;
    seasonId?: string;
    seasonResolution?: CanarySeasonResolution;
    existingManifest?: CharacterSeasonEvidenceManifestV2 | null;
    allowSyntheticManifest?: boolean;
    env?: NodeJS.ProcessEnv;
    appEnv?: AppEnv;
    rateBudgetConfig?: {
      warnPercent: number;
      deferPercent: number;
      stopPercent: number;
    };
    log?: (message: string) => void;
    outputDir?: string;
  },
): Promise<{
  reportPath: string;
  report: Awaited<ReturnType<typeof runScoringCanaryPreflight>>;
  zone: ResolvedCanaryZone;
  seasonResolution: CanarySeasonResolution | null;
  characterResolution: CanaryCharacterResolution;
}> {
  let zone = await resolveZoneForCanaryCommand(args, {
    env: options?.env ?? process.env,
    log: options?.log ?? ((msg) => console.warn(msg)),
  });
  const repositoryMode: CanaryRepositoryMode = options?.repositoryMode ?? "PRODUCTION";
  if (repositoryMode !== "PRODUCTION") {
    if (!options?.allowNonProductionRepositories) {
      assertOperatorRepositoryMode(repositoryMode);
    }
  } else {
    assertOperatorRepositoryMode(repositoryMode);
  }

  const env =
    options?.appEnv ??
    (repositoryMode === "PRODUCTION" ? loadEnv() : null);
  const rateBudgetConfig = options?.rateBudgetConfig ?? {
    warnPercent: env?.WCL_RATE_WARN_PERCENT ?? 70,
    deferPercent: env?.WCL_RATE_DEFER_PERCENT ?? 80,
    stopPercent: env?.WCL_RATE_STOP_PERCENT ?? 90,
  };

  const identity = identityFromArgs(args);
  let characterResolution: CanaryCharacterResolution;
  let ports;
  let seasonResolution: CanarySeasonResolution | null = options?.seasonResolution ?? null;
  let seasonId = options?.seasonId ?? args.seasonId ?? null;
  let activeDungeonSlugs =
    options?.activeDungeonSlugs ?? args.activeDungeonSlugs ?? null;
  let existingManifest = options?.existingManifest;
  let container: ReturnType<typeof createWorkerContainer> | null = null;

  if (repositoryMode === "PRODUCTION") {
    if (!env) {
      throw new Error("production_canary_requires_app_env");
    }
    const deps = await createProductionCanaryDependencies({ env, identity });
    container = deps.container;
    ports = deps.ports;
    characterResolution = deps.characterResolution;
    assertNotSentinelCharacterId(characterResolution.characterId);

    seasonResolution = await resolveCanarySeasonCatalog({
      prisma: deps.container.prisma,
      regionId: deps.character.regionId,
      regionCode: args.region,
      env: options?.env ?? process.env,
    });
    try {
      assertSeasonCatalogOk(seasonResolution);
    } catch (err) {
      await deps.container.prisma.$disconnect().catch(() => undefined);
      throw err;
    }
    // Prefer effective-season catalog zone unless an explicit --zone-id was supplied.
    if (
      !args.zoneIdOverride &&
      seasonResolution.configuredZoneId != null &&
      seasonResolution.configuredZoneId > 0
    ) {
      zone = {
        zoneId: seasonResolution.configuredZoneId,
        envZoneId: seasonResolution.configuredZoneId,
        source: "effective-season",
        overrideActive: false,
        applicationSeasonId: seasonResolution.seasonId ?? undefined,
        activeSeasonId: seasonResolution.seasonSlug ?? undefined,
        blizzardSeasonId: seasonResolution.blizzardSeasonId ?? undefined,
      };
    }
    seasonId = seasonResolution.seasonId;
    activeDungeonSlugs = seasonResolution.activeDungeonSlugs;
    if (existingManifest === undefined) {
      existingManifest = await loadPersistedManifest({
        prisma: deps.container.prisma,
        characterId: characterResolution.characterId,
        seasonId,
        expectedDungeonSlugs: activeDungeonSlugs,
      });
    }
  } else {
    const characterId =
      options?.characterId ?? args.characterId;
    if (!characterId) {
      throw new CharacterNotFoundError(identity);
    }
    assertNotSentinelCharacterId(characterId);
    const mem = createMemoryCanaryDependencies({
      ports:
        options?.ports ??
        createMemoryOrchestrationPorts({ autoSeedRanking: false }),
      characterId,
      identity,
      repositoryMode,
    });
    ports = mem.ports;
    characterResolution = mem.characterResolution;
    if (!activeDungeonSlugs || activeDungeonSlugs.length === 0) {
      throw Object.assign(
        new Error(
          "SEASON_DUNGEON_BINDINGS_MISSING: memory canary path requires explicit activeDungeonSlugs (no static Midnight fallback)",
        ),
        { code: "SEASON_DUNGEON_BINDINGS_MISSING" },
      );
    }
    seasonId = seasonId ?? "test-season";
  }

  if (!seasonId || !activeDungeonSlugs) {
    throw new SeasonCatalogMismatchError(
      seasonResolution ?? {
        configuredZoneId: zone.zoneId,
        resolutionMode: "AUTO",
        seasonId: null,
        seasonSlug: null,
        seasonName: null,
        blizzardSeasonId: null,
        expansion: null,
        productSeasonSlug: null,
        catalogSource: "none",
        catalogVersion: "none",
        dungeonCount: 0,
        dungeons: [],
        activeDungeonSlugs: [],
        dungeonPoolHash: null,
        expectedSlotCount: 0,
        validationStatus: "SEASON_CATALOG_MISMATCH",
        validationReasons: ["season_or_dungeon_pool_unresolved"],
        isCurrent: null,
        startsAt: null,
        endsAt: null,
        authority: null,
        warnings: [],
      },
    );
  }

  const candidates = options?.candidates ?? args.candidates ?? [];

  // Provider-free: reuse a persisted RateLimitData snapshot when still within TTL.
  // Never fetch live during preflight.
  let rateLimitSnapshot: WclRateLimitSnapshot | null = null;
  const rateLimitSnapshotIsProviderCall = false;
  let rateSnapshotMeta: {
    snapshotSource: "PERSISTED" | "ABSENT";
    snapshotAgeMs: number | null;
    ttlSeconds: number;
  } | null = null;
  if (repositoryMode === "PRODUCTION" && env) {
    const outDir =
      args.outputDir ??
      join(process.cwd(), "artifacts", "scoring-canary");
    const snapPath = defaultCanaryRateSnapshotPath(outDir);
    const persisted = await readPersistedCanaryRateSnapshot(snapPath);
    const ttlSeconds = env.WCL_CANARY_RATE_SNAPSHOT_TTL_SECONDS;
    if (
      persisted &&
      isWclSnapshotFresh({
        fetchedAt: persisted.snapshot.fetchedAt,
        maxAgeSeconds: ttlSeconds,
      })
    ) {
      rateLimitSnapshot = persisted.snapshot;
      rateSnapshotMeta = {
        snapshotSource: "PERSISTED",
        snapshotAgeMs: Math.max(
          0,
          Date.now() - Date.parse(persisted.snapshot.fetchedAt),
        ),
        ttlSeconds,
      };
    } else {
      rateSnapshotMeta = {
        snapshotSource: "ABSENT",
        snapshotAgeMs: persisted?.snapshot?.fetchedAt
          ? Math.max(0, Date.now() - Date.parse(persisted.snapshot.fetchedAt))
          : null,
        ttlSeconds,
      };
    }
  }

  const report = await runScoringCanaryPreflight({
    characterId: characterResolution.characterId,
    characterName: args.character,
    region: args.region,
    realm: args.realm,
    zoneId: zone.zoneId,
    seasonId,
    scoringModelId: "canary-model",
    scope: {
      characterId: characterResolution.characterId,
      seasonId,
      seasonSlug: seasonResolution?.seasonSlug ?? seasonId,
      specializationId: null,
      classSlug: null,
      specSlug: null,
      role: "DPS",
      refreshContractHash: "canary-preflight",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs,
    },
    candidates,
    ports,
    existingManifest: existingManifest ?? null,
    allowSyntheticManifest: options?.allowSyntheticManifest === true,
    repositoryMode,
    characterResolution,
    seasonResolution,
    rateBudgetConfig,
    rateLimitSnapshot,
    rateLimitSnapshotIsProviderCall,
  });

  // Enrich DEFER explanation with persisted-snapshot source/TTL (still provider-free).
  if (rateSnapshotMeta && report.costAdmissionDefer) {
    report.costAdmissionDefer = {
      ...report.costAdmissionDefer,
      snapshotSource: rateSnapshotMeta.snapshotSource,
      snapshotAgeMs: rateSnapshotMeta.snapshotAgeMs,
      ttlSeconds: rateSnapshotMeta.ttlSeconds,
    };
  } else if (rateSnapshotMeta && report.cost.rateLimit.admission === "DEFER") {
    report.costAdmissionDefer = {
      snapshotSource: rateSnapshotMeta.snapshotSource,
      snapshotAgeMs: rateSnapshotMeta.snapshotAgeMs,
      ttlSeconds: rateSnapshotMeta.ttlSeconds,
      projectedPoints: report.cost.estimatedPointsTotal,
      thresholdResponsible: "no_snapshot_blocks_cold_live",
      reasons: [...report.cost.rateLimit.reasons],
    };
  }

  if (report.providerCalls !== 0) {
    throw new Error("preflight_must_make_zero_provider_calls");
  }
  if (report.zoneId !== zone.zoneId) {
    throw new Error("preflight_zone_id_mismatch");
  }
  if (repositoryMode === "PRODUCTION") {
    assertNotSentinelCharacterId(report.characterId);
    if (report.repositoryMode !== "PRODUCTION") {
      throw new Error("preflight_repository_mode_mismatch");
    }
  }

  const outDir =
    options?.outputDir ??
    args.outputDir ??
    join(process.cwd(), "artifacts", "scoring-canary");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(
    outDir,
    `preflight-${args.region}-${args.realm}-${args.character}.json`,
  );
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        ...report,
        zoneResolution: zone,
        seasonResolution,
        characterResolution,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (container) {
    await container.prisma.$disconnect().catch(() => undefined);
  }

  return {
    reportPath,
    report,
    zone,
    seasonResolution,
    characterResolution,
  };
}

export async function runCanaryDiagnoseCatalogCommand(
  args: CanaryCliArgs,
): Promise<{ reportPath: string; report: Awaited<ReturnType<typeof diagnoseSeasonCatalog>> }> {
  const env = loadEnv();
  const container = createWorkerContainer(env);
  try {
    const report = await diagnoseSeasonCatalog(container.prisma);
    const outDir =
      args.outputDir ??
      join(process.cwd(), "artifacts", "scoring-canary");
    await mkdir(outDir, { recursive: true });
    const reportPath = join(outDir, "season-catalog-diagnostic.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    return { reportPath, report };
  } finally {
    await container.prisma.$disconnect().catch(() => undefined);
  }
}

export async function runCanaryRepairCatalogCommand(
  args: CanaryCliArgs,
): Promise<unknown> {
  const env = loadEnv();
  if (env.APP_ENV === "staging" || env.APP_ENV === "production") {
    throw Object.assign(
      new Error("repair_refused: APP_ENV is staging/production"),
      { code: "CANARY_REPAIR_FORBIDDEN_ENV" },
    );
  }
  const container = createWorkerContainer(env);
  try {
    const regionCode = args.region.toUpperCase();
    const region = await container.prisma.region.findFirst({
      where: { code: regionCode },
    });
    if (!region) {
      throw Object.assign(new Error(`REGION_NOT_FOUND:${regionCode}`), {
        code: "REGION_NOT_FOUND",
      });
    }
    const blizzardSeasonId = MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID;
    const plan = await planActiveMplusSeasonRepair({
      prisma: container.prisma,
      regionId: region.id,
      regionCode,
      blizzardSeasonId,
    });
    if (!args.confirmRepair) {
      return {
        dryRun: true,
        message:
          "pass --confirm-local-repair to apply (local DB only; never staging/production)",
        plan,
      };
    }
    const applied = await applyActiveMplusSeasonRepair({
      prisma: container.prisma,
      regionId: region.id,
      regionCode,
      blizzardSeasonId,
      confirmLocalRepair: true,
      appEnv: env.APP_ENV,
      wclZoneId: args.zoneIdOverride ?? 47,
    });
    return { dryRun: false, plan: applied.plan, sync: applied.sync };
  } finally {
    await container.prisma.$disconnect().catch(() => undefined);
  }
}

export async function runCanaryDiscoverCommand(
  args: CanaryCliArgs,
  options?: {
    env?: NodeJS.ProcessEnv;
    discoverOverride?: () => Promise<CanaryDiscoveryCandidateSource>;
    ensureRateLimitSnapshotOverride?: () => Promise<CanaryRateSnapshotBootstrapReport>;
    log?: (message: string) => void;
  },
): Promise<{
  reportPath: string;
  report: CanaryDiscoveryReport;
}> {
  assertOperatorRepositoryMode("PRODUCTION");
  const env = loadEnv();
  const processEnv = options?.env ?? process.env;

  const gate = evaluateCanaryDiscoveryGates({
    env: {
      ...env,
      SCORING_CANARY_DISCOVERY_EXECUTE: isDiscoveryExecuteArmed(processEnv),
    },
    discoveryExecuteArmed: isDiscoveryExecuteArmed(processEnv),
    confirmDiscovery: args.confirmDiscovery,
    characterCount: 1,
    repositoryMode: "PRODUCTION",
  });
  if (!gate.allowed) {
    throw Object.assign(
      new Error(`canary_discovery_refused:${gate.reasons.join(",")}`),
      { code: "CANARY_DISCOVERY_REFUSED", reasons: gate.reasons },
    );
  }

  // Prove SCORING_CANARY_EXECUTE alone does not authorize discovery.
  void processEnv.SCORING_CANARY_EXECUTE;

  const identity = identityFromArgs(args);
  const deps = await createProductionCanaryDependencies({ env, identity });
  try {
    // Capability acquire must remain unreachable on this path.
    void createDiscoveryForbiddenAcquireHook;

    const seasonResolution = await resolveCanarySeasonCatalog({
      prisma: deps.container.prisma,
      regionId: deps.character.regionId,
      regionCode: args.region,
      env: processEnv,
    });
    assertSeasonCatalogOk(seasonResolution);

    const role = (deps.character.role ?? "DPS") as EvidenceRole;
    const outDir =
      args.outputDir ??
      join(process.cwd(), "artifacts", "scoring-canary");
    const snapshotPath = defaultCanaryRateSnapshotPath(outDir);

    const classSpec = await resolveCanaryCharacterIdentity({
      prisma: deps.container.prisma,
      characterId: deps.characterResolution.characterId,
      fallbackRole: role === "TANK" || role === "HEALER" || role === "DPS" ? role : "DPS",
    });
    const { report } = await runScoringCanaryDiscovery({
      prisma: deps.container.prisma,
      artifacts: deps.container.repositories.artifacts,
      evidence: deps.container.repositories.evidence,
      characterId: deps.characterResolution.characterId,
      characterResolution: deps.characterResolution,
      seasonResolution,
      role: classSpec.role,
      classSlug: classSpec.classSlug,
      specSlug: classSpec.specSlug,
      rateBudgetConfig: {
        warnPercent: env.WCL_RATE_WARN_PERCENT,
        deferPercent: env.WCL_RATE_DEFER_PERCENT,
        stopPercent: env.WCL_RATE_STOP_PERCENT,
      },
      ensureRateLimitSnapshot:
        options?.ensureRateLimitSnapshotOverride ??
        (async () =>
          bootstrapCanaryRateLimitSnapshot({
            persistPath: snapshotPath,
            ttlSeconds: env.WCL_CANARY_RATE_SNAPSHOT_TTL_SECONDS,
            fetchLive: async () => {
              const wcl = deps.container.providers.warcraftlogs as {
                getGraphQlClient?: () => WclGraphQlClient;
              };
              if (typeof wcl.getGraphQlClient !== "function") {
                throw new Error("wcl_graphql_client_unavailable_for_rate_snapshot");
              }
              return fetchCanaryRateLimitSnapshotLive(wcl.getGraphQlClient());
            },
          })),
      resolveReportRevision: async ({ reportCode, fightId }) => {
        const wcl = deps.container.providers.warcraftlogs as {
          getGraphQlClient?: () => WclGraphQlClient;
        };
        if (typeof wcl.getGraphQlClient !== "function") return null;
        return observeAuthoritativeReportRevision({
          client: wcl.getGraphQlClient(),
          reportCode,
          fightId,
          region: args.region,
        });
      },
      discover:
        options?.discoverOverride ??
        (async () => {
          const shadow = await discoverShadowCanaryCandidates({
            container: deps.container,
            region: args.region.toUpperCase() as "EU" | "US" | "KR" | "TW",
            realmSlug: args.realm,
            characterName: args.character,
            characterId: deps.characterResolution.characterId,
            activeDungeonSlugs: seasonResolution.activeDungeonSlugs,
            activeDungeonEncounters: seasonResolution.dungeons.map((d) => ({
              dungeonSlug: d.slug,
              encounterId:
                d.wclZoneOrEncounterId != null
                  ? Number(d.wclZoneOrEncounterId)
                  : null,
            })),
            dungeonPoolSource: seasonResolution.catalogSource,
          });
          const allowed = new Set(
            seasonResolution.activeDungeonSlugs.map((s) => s.toLowerCase()),
          );
          const candidates = shadow.candidates.filter((c) =>
            allowed.has(c.dungeonSlug.toLowerCase()),
          );
          const allowedFights = new Set(
            candidates.map(
              (c) => `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`,
            ),
          );
          return {
            candidates,
            rankingEvidence: shadow.rankingEvidence.filter((r) =>
              allowedFights.has(`${r.reportCode}:${r.fightId}`),
            ),
            fightsExamined: shadow.diagnostics.discoveredCandidateCount,
            graphqlRequestCount: shadow.diagnostics.providerCalls,
            // Capability/detail combat event pages stay unreachable on this path.
            capabilityEventPageRequestCount: 0,
            measuredPoints: null,
            estimatedPoints: shadow.diagnostics.providerCalls,
            discoveryStrategy: shadow.diagnostics.discoveryStrategy,
            providerCallBreakdown: shadow.diagnostics.providerCallBreakdown,
            candidateNormalization: shadow.diagnostics.candidateNormalization,
          };
        }),
    });

    await mkdir(outDir, { recursive: true });
    const reportPath = join(outDir, "discovery-report.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

    const log = options?.log ?? console.log;
    log(
      JSON.stringify(
        {
          summary: "scoring-canary-discovery",
          discoveryStrategy: "encounter_rankings",
          candidateNormalization: report.candidateNormalization ?? null,
          fightsExamined: report.fightsExamined,
          candidateCount: report.candidateCount,
          eligibleCandidateCount: report.eligibleCandidateCount,
          selectedSlotCount: report.selectedSlotCount,
          expectedSlotCount: report.expectedSlotCount,
          selectedRunsPerDungeon: report.selectedRunsPerDungeon,
          missingSlots: report.missingSlots,
          supersedesManifestId: report.supersedesManifestId,
          manifestId: report.manifestId,
          manifestStatus: report.manifestStatus,
          analysisStatus: report.analysisStatus,
          graphqlRequestCount: report.graphqlRequestCount,
          rateAdmission: report.rateAdmission,
        },
        null,
        2,
      ),
    );

    return { reportPath, report };
  } finally {
    await deps.container.prisma.$disconnect().catch(() => undefined);
  }
}

/**
 * Operator-only RateLimitData bootstrap. Does not discover reports/fights.
 */
export async function runCanaryRateSnapshotCommand(
  args: CanaryCliArgs,
  options?: { env?: NodeJS.ProcessEnv },
): Promise<{ reportPath: string; bootstrap: CanaryRateSnapshotBootstrapReport }> {
  assertOperatorRepositoryMode("PRODUCTION");
  const env = loadEnv();
  const processEnv = options?.env ?? process.env;

  // Live-provider gates only — does not require --confirm-discovery.
  const reasons: string[] = [];
  if (env.PROVIDER_MODE !== "live") reasons.push("PROVIDER_MODE_NOT_LIVE");
  if (!env.ALLOW_LIVE_PROVIDER_CALLS) reasons.push("ALLOW_LIVE_PROVIDER_CALLS_FALSE");
  if (!env.WCL_ENABLED) reasons.push("WCL_DISABLED");
  if (!env.WCL_CLIENT_ID || !env.WCL_CLIENT_SECRET) {
    reasons.push("WCL_CREDENTIALS_MISSING");
  }
  if (env.SCORING_PUBLICATION_ENABLED) reasons.push("PUBLICATION_ENABLED");
  if (reasons.length > 0) {
    throw Object.assign(
      new Error(`canary_rate_snapshot_refused:${reasons.join(",")}`),
      { code: "CANARY_RATE_SNAPSHOT_REFUSED", reasons },
    );
  }
  void processEnv;

  const container = createWorkerContainer(env);
  try {
    const outDir =
      args.outputDir ??
      join(process.cwd(), "artifacts", "scoring-canary");
    const snapshotPath = defaultCanaryRateSnapshotPath(outDir);
    const bootstrap = await bootstrapCanaryRateLimitSnapshot({
      persistPath: snapshotPath,
      ttlSeconds: env.WCL_CANARY_RATE_SNAPSHOT_TTL_SECONDS,
      fetchLive: async () => {
        const wcl = container.providers.warcraftlogs as {
          getGraphQlClient?: () => WclGraphQlClient;
        };
        if (typeof wcl.getGraphQlClient !== "function") {
          throw new Error("wcl_graphql_client_unavailable_for_rate_snapshot");
        }
        return fetchCanaryRateLimitSnapshotLive(wcl.getGraphQlClient());
      },
    });
    await mkdir(outDir, { recursive: true });
    const reportPath = join(outDir, "rate-snapshot-report.json");
    await writeFile(reportPath, JSON.stringify(bootstrap, null, 2), "utf8");
    if (!bootstrap.succeeded) {
      throw Object.assign(new Error("RATE_LIMIT_SNAPSHOT_UNAVAILABLE"), {
        code: "RATE_LIMIT_SNAPSHOT_UNAVAILABLE",
        bootstrap,
      });
    }
    return { reportPath, bootstrap };
  } finally {
    await container.prisma.$disconnect().catch(() => undefined);
  }
}

export async function runCanaryLiveCommand(
  args: CanaryCliArgs,
  options?: {
    env?: NodeJS.ProcessEnv;
    log?: (message: string) => void;
    /** Test injection — skip production WCL wiring. */
    liveRunner?: typeof runScoringCanaryLive;
    ensureRateLimitSnapshotOverride?: () => Promise<CanaryRateSnapshotBootstrapReport>;
    ports?: ReturnType<typeof createMemoryOrchestrationPorts>;
    outputDir?: string;
  },
): Promise<{ reportPath: string; report: CanaryLiveReport }> {
  let zone = await resolveZoneForCanaryCommand(args, {
    env: options?.env ?? process.env,
    log: options?.log ?? ((msg) => console.warn(msg)),
  });
  assertOperatorRepositoryMode("PRODUCTION");
  const env = loadEnv();
  const processEnv = options?.env ?? process.env;
  const identity = identityFromArgs(args);
  const deps = await createProductionCanaryDependencies({ env, identity });
  try {
    const seasonResolution = await resolveCanarySeasonCatalog({
      prisma: deps.container.prisma,
      regionId: deps.character.regionId,
      regionCode: args.region,
      env: processEnv,
    });
    assertSeasonCatalogOk(seasonResolution);

    if (
      !args.zoneIdOverride &&
      seasonResolution.configuredZoneId != null &&
      seasonResolution.configuredZoneId > 0
    ) {
      zone = {
        zoneId: seasonResolution.configuredZoneId,
        envZoneId: seasonResolution.configuredZoneId,
        source: "effective-season",
        overrideActive: false,
        applicationSeasonId: seasonResolution.seasonId ?? undefined,
        activeSeasonId: seasonResolution.seasonSlug ?? undefined,
        blizzardSeasonId: seasonResolution.blizzardSeasonId ?? undefined,
      };
    } else if (!args.zoneIdOverride) {
      zone = await resolveZoneForCanaryCommand(args, {
        prisma: deps.container.prisma,
        regionId: deps.character.regionId,
        regionCode: args.region,
        log: options?.log ?? ((msg) => console.warn(msg)),
      });
    }

    const gate = evaluateCanaryLiveGates({
      env,
      confirmLive: args.confirmLive,
      characterCount: 1,
    });
    if (!gate.allowed) {
      throw Object.assign(
        new Error(`canary_live_refused:${gate.reasons.join(",")}`),
        {
          code: "CANARY_LIVE_REFUSED",
          reasons: gate.reasons,
          zone,
          characterResolution: deps.characterResolution,
          seasonResolution,
        },
      );
    }

    if (processEnv.SCORING_CANARY_EXECUTE !== "true") {
      throw Object.assign(
        new Error(
          "canary_live_gates_passed_but_execute_not_armed: set SCORING_CANARY_EXECUTE=true after human approval",
        ),
        {
          code: "CANARY_EXECUTE_NOT_ARMED",
          zone,
          characterResolution: deps.characterResolution,
          seasonResolution,
        },
      );
    }

    assertPublicationBlocked(env);

    const rateBudgetConfig = {
      warnPercent: env.WCL_RATE_WARN_PERCENT ?? 70,
      deferPercent: env.WCL_RATE_DEFER_PERCENT ?? 80,
      stopPercent: env.WCL_RATE_STOP_PERCENT ?? 90,
    };

    const classSpec = await resolveCanaryCharacterIdentity({
      prisma: deps.container.prisma,
      characterId: deps.characterResolution.characterId,
      fallbackRole: "DPS",
    });
    const runner = options?.liveRunner ?? runScoringCanaryLive;
    const { report, reportPath } = await runner({
      prisma: deps.container.prisma,
      container: deps.container,
      characterId: deps.characterResolution.characterId,
      characterName: args.character,
      region: args.region,
      realm: args.realm,
      characterResolution: deps.characterResolution,
      seasonResolution,
      role: classSpec.role,
      classSlug: classSpec.classSlug,
      specSlug: classSpec.specSlug,
      rateBudgetConfig,
      env,
      ports: options?.ports,
      ensureRateLimitSnapshot: options?.ensureRateLimitSnapshotOverride,
      outputDir: options?.outputDir ?? args.outputDir ?? undefined,
      useRedisLock: options?.ports == null,
    });

    const log = options?.log ?? console.log;
    const dimSummary = [
      formatCanaryDimensionCliSummary("PERFORMANCE", report.dimensions.performance),
      formatCanaryDimensionCliSummary("SURVIVAL", report.dimensions.survival),
      formatCanaryDimensionCliSummary("UTILITY", report.dimensions.utility),
      formatCanaryDimensionCliSummary("EXPERIENCE", report.dimensions.experience),
    ].join("\n\n");
    log(dimSummary);
    log(
      JSON.stringify(
        {
          summary: "scoring-canary-live",
          reportPath,
          scoringAuthority: report.scoringAuthority,
          manifestId: report.manifestId,
          selectedSlotCount: report.selectedSlotCount,
          expectedSlotCount: report.expectedSlotCount,
          packageCacheHits: report.packageCacheHits,
          packageCacheMisses: report.packageCacheMisses,
          capabilityAcquisitionsAttempted: report.capabilityAcquisitionsAttempted,
          capabilityAcquisitionsSucceeded: report.capabilityAcquisitionsSucceeded,
          capabilityAcquisitionsFailed: report.capabilityAcquisitionsFailed,
          authoritativeProviderCalls: report.authoritativeProviderCalls,
          graphqlRequestCount: report.graphqlRequestCount,
          eventPageRequestCount: report.eventPageRequestCount,
          measuredWclPoints: report.measuredWclPoints,
          estimatedWclPoints: report.estimatedWclPoints,
          fightFailures: report.fightFailures,
          packagesCreated: report.packagesCreated,
          packagesReused: report.packagesReused,
          participantDigestsCreated: report.participantDigestsCreated,
          participantDigestsReused: report.participantDigestsReused,
          wallidrixeDigestCount: report.wallidrixeDigestCount,
          dimensions: {
            performance: {
              score: report.dimensions.performance.score,
              confidence: report.dimensions.performance.confidence,
              state: report.dimensions.performance.state,
              strengths: report.dimensions.performance.strengths,
              weaknesses: report.dimensions.performance.weaknesses,
              scoreFacts: report.dimensions.performance.scoreFacts,
              confidenceReasons:
                report.dimensions.performance.confidenceReasonLabels,
              scoreDrivers: report.dimensions.performance.scoreDrivers,
              confidenceReasonCodes:
                report.dimensions.performance.confidenceReasons,
            },
            survival: {
              score: report.dimensions.survival.score,
              confidence: report.dimensions.survival.confidence,
              state: report.dimensions.survival.state,
              strengths: report.dimensions.survival.strengths,
              weaknesses: report.dimensions.survival.weaknesses,
              scoreFacts: report.dimensions.survival.scoreFacts,
              confidenceReasons:
                report.dimensions.survival.confidenceReasonLabels,
              scoreDrivers: report.dimensions.survival.scoreDrivers,
              confidenceReasonCodes:
                report.dimensions.survival.confidenceReasons,
            },
            utility: {
              score: report.dimensions.utility.score,
              confidence: report.dimensions.utility.confidence,
              state: report.dimensions.utility.state,
              strengths: report.dimensions.utility.strengths,
              weaknesses: report.dimensions.utility.weaknesses,
              scoreFacts: report.dimensions.utility.scoreFacts,
              confidenceReasons:
                report.dimensions.utility.confidenceReasonLabels,
              scoreDrivers: report.dimensions.utility.scoreDrivers,
              confidenceReasonCodes: report.dimensions.utility.confidenceReasons,
            },
            experience: {
              score: report.dimensions.experience.score,
              confidence: report.dimensions.experience.confidence,
              state: report.dimensions.experience.state,
              strengths: report.dimensions.experience.strengths,
              weaknesses: report.dimensions.experience.weaknesses,
              scoreFacts: report.dimensions.experience.scoreFacts,
              confidenceReasons:
                report.dimensions.experience.confidenceReasonLabels,
              scoreDrivers: report.dimensions.experience.scoreDrivers,
              confidenceReasonCodes:
                report.dimensions.experience.confidenceReasons,
            },
          },
          composite: report.composite,
          confidence: report.confidence,
          evidenceCoverageDiagnostic: {
            confidenceScore:
              report.evidenceCoverageDiagnostic.confidenceScore,
            confidenceBand: report.evidenceCoverageDiagnostic.confidenceBand,
            note: "diagnostic_only_not_scoring_confidence",
          },
          authoritativeReplay: report.authoritativeReplay,
          explainabilityFingerprint: report.explainabilityFingerprint,
          characterScoreWrites: report.characterScoreWrites,
          persistCharacterScore: report.persistCharacterScore,
          publicationEnabled: report.publicationEnabled,
          publicScorePointerMutated: report.publicScorePointerMutated,
          charactersProcessed: report.charactersProcessed,
          orchestratorExecuted: report.orchestratorExecuted,
          zoneId: zone.zoneId,
        },
        null,
        2,
      ),
    );

    return { reportPath, report };
  } finally {
    await deps.container.prisma.$disconnect().catch(() => undefined);
  }
}
async function main(): Promise<void> {
  const args = parseCanaryCliArgs(process.argv.slice(2));
  if (args.mode === "diagnose-catalog") {
    const { reportPath, report } = await runCanaryDiagnoseCatalogCommand(args);
    console.log(
      JSON.stringify(
        {
          reportPath,
          providerCalls: report.providerCalls,
          seasonCount: report.seasons.length,
          staleManifestsRequireInvalidation:
            report.staleManifestsRequireInvalidation,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (args.mode === "replay") {
    const env = loadEnv();
    const identity = identityFromArgs(args);
    const deps = await createProductionCanaryDependencies({ env, identity });
    try {
      const season = await resolveCanarySeasonCatalog({
        prisma: deps.container.prisma,
        regionId: deps.character.regionId,
        regionCode: args.region,
      });
      assertSeasonCatalogOk(season);
      const classSpec = await resolveCanaryCharacterIdentity({
        prisma: deps.container.prisma,
        characterId: deps.characterResolution.characterId,
        fallbackRole: "DPS",
      });
      const { reportPath, report } = await runScoringCanaryReplay({
        env,
        prisma: deps.container.prisma,
        container: deps.container,
        characterId: deps.characterResolution.characterId,
        characterName: args.character,
        region: args.region,
        realm: args.realm,
        classSlug: classSpec.classSlug,
        specSlug: classSpec.specSlug,
        role: classSpec.role,
        season,
        repositoryMode: "PRODUCTION",
        outputDir: args.outputDir ?? undefined,
      });
      console.log(
        [
          formatCanaryDimensionCliSummary(
            "PERFORMANCE",
            report.dimensions.performance,
          ),
          formatCanaryDimensionCliSummary("SURVIVAL", report.dimensions.survival),
          formatCanaryDimensionCliSummary("UTILITY", report.dimensions.utility),
          formatCanaryDimensionCliSummary(
            "EXPERIENCE",
            report.dimensions.experience,
          ),
        ].join("\n\n"),
      );
      console.log(
        JSON.stringify(
          {
            reportPath,
            scoringAuthority: report.scoringAuthority,
            forceProviderFree: report.forceProviderFree,
            manifestId: report.manifestId,
            wallidrixeDigestCount: report.wallidrixeDigestCount,
            packagesReused: report.packagesReused,
            packageAcquisitions: report.packageAcquisitions,
            providerCalls: report.providerCalls,
            characterScoreWrites: report.characterScoreWrites,
            dimensions: {
              performance: {
                score: report.dimensions.performance.score,
                confidence: report.dimensions.performance.confidence,
                strengths: report.dimensions.performance.strengths,
                weaknesses: report.dimensions.performance.weaknesses,
                scoreFacts: report.dimensions.performance.scoreFacts,
                confidenceReasons:
                  report.dimensions.performance.confidenceReasonLabels,
              },
              survival: {
                score: report.dimensions.survival.score,
                confidence: report.dimensions.survival.confidence,
                strengths: report.dimensions.survival.strengths,
                weaknesses: report.dimensions.survival.weaknesses,
                scoreFacts: report.dimensions.survival.scoreFacts,
                confidenceReasons:
                  report.dimensions.survival.confidenceReasonLabels,
              },
              utility: {
                score: report.dimensions.utility.score,
                confidence: report.dimensions.utility.confidence,
                strengths: report.dimensions.utility.strengths,
                weaknesses: report.dimensions.utility.weaknesses,
                scoreFacts: report.dimensions.utility.scoreFacts,
                confidenceReasons:
                  report.dimensions.utility.confidenceReasonLabels,
              },
              experience: {
                score: report.dimensions.experience.score,
                confidence: report.dimensions.experience.confidence,
                strengths: report.dimensions.experience.strengths,
                weaknesses: report.dimensions.experience.weaknesses,
                scoreFacts: report.dimensions.experience.scoreFacts,
                confidenceReasons:
                  report.dimensions.experience.confidenceReasonLabels,
              },
            },
            composite: report.composite,
            explainabilityFingerprint: report.explainabilityFingerprint,
            targetDigestFailures: report.targetDigestFailures,
            publicationEnabled: report.publicationEnabled,
          },
          null,
          2,
        ),
      );
    } finally {
      await deps.container.prisma.$disconnect().catch(() => undefined);
    }
    return;
  }
  if (args.mode === "diagnose-target-digests") {
    const env = loadEnv();
    const identity = identityFromArgs(args);
    const deps = await createProductionCanaryDependencies({ env, identity });
    try {
      const season = await resolveCanarySeasonCatalog({
        prisma: deps.container.prisma,
        regionId: deps.character.regionId,
        regionCode: args.region,
      });
      assertSeasonCatalogOk(season);
      const frozen = await (
        await import("./canary-live.js")
      ).loadCompatibleFrozenManifest({
        prisma: deps.container.prisma,
        characterId: deps.characterResolution.characterId,
        seasonId: season.seasonId!,
        expectedDungeonSlugs: season.activeDungeonSlugs,
        dungeonPoolHash: season.dungeonPoolHash!,
      });
      if (!frozen) throw new Error("manifest_not_found");
      const { reportPath, report } = await runTargetDigestDiagnostic({
        prisma: deps.container.prisma,
        manifestId: frozen.rowId,
        characterId: deps.characterResolution.characterId,
        characterName: args.character,
        region: args.region,
        realm: args.realm,
        readArtifactBytes: (id) =>
          deps.container.repositories.artifacts.readVerified(id),
        outputDir: args.outputDir ?? undefined,
      });
      console.log(
        JSON.stringify(
          {
            reportPath,
            byStamp: report.targetDigestCountByStamp,
            byStable: report.targetDigestCountByStableIdentity,
            problemClassSummary: report.problemClassSummary,
            performance: report.performance,
            providerCalls: report.providerCalls,
          },
          null,
          2,
        ),
      );
    } finally {
      await deps.container.prisma.$disconnect().catch(() => undefined);
    }
    return;
  }
  if (args.mode === "repair-catalog") {
    const result = await runCanaryRepairCatalogCommand(args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.mode === "rate-snapshot") {
    try {
      const { reportPath, bootstrap } = await runCanaryRateSnapshotCommand(args);
      console.log(
        JSON.stringify(
          {
            reportPath,
            snapshotSource: bootstrap.snapshotSource,
            providerCalls: bootstrap.providerCalls,
            measuredPoints: bootstrap.measuredPoints,
            estimatedPoints: bootstrap.estimatedPoints,
            succeeded: bootstrap.succeeded,
            snapshotAgeMs: bootstrap.snapshotAgeMs,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.error(
        JSON.stringify(
          {
            code:
              err && typeof err === "object" && "code" in err
                ? (err as { code: unknown }).code
                : "CANARY_RATE_SNAPSHOT_FAILED",
            message: err instanceof Error ? err.message : String(err),
            reasons:
              err && typeof err === "object" && "reasons" in err
                ? (err as { reasons: unknown }).reasons
                : undefined,
            bootstrap:
              err && typeof err === "object" && "bootstrap" in err
                ? (err as { bootstrap: unknown }).bootstrap
                : undefined,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    return;
  }
  if (args.mode === "discover") {
    try {
      const { reportPath, report } = await runCanaryDiscoverCommand(args);
      console.log(
        JSON.stringify(
          {
            reportPath,
            repositoryMode: report.repositoryMode,
            characterId: report.characterId,
            seasonSlug: report.seasonSlug,
            wclZoneId: report.wclZoneId,
            dungeonPoolHash: report.dungeonPoolHash,
            selectedSlotCount: report.selectedSlotCount,
            expectedSlotCount: report.expectedSlotCount,
            manifestStatus: report.manifestStatus,
            manifestId: report.manifestId,
            bootstrapProviderCalls: report.bootstrapProviderCalls,
            graphqlRequestCount: report.graphqlRequestCount,
            eventPageRequestCount: report.eventPageRequestCount,
            capabilityPackageAcquisitions:
              report.forbiddenEffects.capabilityPackageAcquisitions,
            participantDigestsCreated: report.forbiddenEffects.participantDigestsCreated,
            scoreCalculations: report.forbiddenEffects.scoreCalculations,
            publicationEnabled: report.publicationEnabled,
            publicScorePointerMutated: report.publicScorePointerMutated,
            rateAdmission: report.rateAdmission,
            bootstrap: report.bootstrap,
            discoveryAdmission: report.discoveryAdmission
              ? {
                  action: report.discoveryAdmission.action,
                  admission: report.discoveryAdmission.admission,
                  projectedDiscoveryCost:
                    report.discoveryAdmission.projectedDiscoveryCost,
                  projectedUtilization:
                    report.discoveryAdmission.projectedUtilization,
                }
              : null,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.error(
        JSON.stringify(
          {
            code:
              err && typeof err === "object" && "code" in err
                ? (err as { code: unknown }).code
                : "CANARY_DISCOVERY_FAILED",
            message: err instanceof Error ? err.message : String(err),
            reasons:
              err && typeof err === "object" && "reasons" in err
                ? (err as { reasons: unknown }).reasons
                : undefined,
            bootstrap:
              err && typeof err === "object" && "bootstrap" in err
                ? (err as { bootstrap: unknown }).bootstrap
                : undefined,
            discoveryAdmission:
              err && typeof err === "object" && "discoveryAdmission" in err
                ? (err as { discoveryAdmission: unknown }).discoveryAdmission
                : undefined,
          },
          null,
          2,
        ),
      );
      // Explicit exit so pnpm run propagates refusal without false "tsx not found".
      process.exit(1);
    }
    return;
  }
  if (args.mode === "live") {
    try {
      const { reportPath, report } = await runCanaryLiveCommand(args);
      console.log(
        JSON.stringify(
          {
            reportPath,
            commandOutcome: report.commandOutcome,
            scoringAuthority: report.scoringAuthority,
            manifestId: report.manifestId,
            selectedSlotCount: report.selectedSlotCount,
            expectedSlotCount: report.expectedSlotCount,
            orchestratorExecuted: report.orchestratorExecuted,
            capabilityAcquisitionsAttempted: report.capabilityAcquisitionsAttempted,
            packagesCreated: report.packagesCreated,
            packagesReused: report.packagesReused,
            wallidrixeDigestCount: report.wallidrixeDigestCount,
            composite: report.composite,
            confidence: report.confidence,
            evidenceCoverageDiagnosticScore:
              report.evidenceCoverageDiagnostic.confidenceScore,
            authoritativeReplay: report.authoritativeReplay,
            explainabilityFingerprint: report.explainabilityFingerprint,
            authoritativeProviderCalls: report.authoritativeProviderCalls,
            characterScoreWrites: report.characterScoreWrites,
            publicationEnabled: report.publicationEnabled,
            publicScorePointerMutated: report.publicScorePointerMutated,
            charactersProcessed: report.charactersProcessed,
          },
          null,
          2,
        ),
      );
      if (report.commandOutcome === "PARTIAL_SUCCESS") {
        process.exitCode = 0;
      }
    } catch (err) {
      console.error(
        JSON.stringify(
          {
            code:
              err && typeof err === "object" && "code" in err
                ? (err as { code: unknown }).code
                : "CANARY_LIVE_FAILED",
            message: err instanceof Error ? err.message : String(err),
            reasons:
              err && typeof err === "object" && "reasons" in err
                ? (err as { reasons: unknown }).reasons
                : undefined,
            fightFailures:
              err && typeof err === "object" && "fightFailures" in err
                ? (err as { fightFailures: unknown }).fightFailures
                : undefined,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    return;
  }
  try {
    const { reportPath, report, zone, seasonResolution, characterResolution } =
      await runCanaryPreflightCommand(args);
    console.log(
      JSON.stringify(
        {
          reportPath,
          repositoryMode: report.repositoryMode,
          zoneId: zone.zoneId,
          characterId: characterResolution.characterId,
          characterResolutionSource:
            characterResolution.characterResolutionSource,
          seasonResolutionMode: seasonResolution?.resolutionMode ?? null,
          seasonSlug: seasonResolution?.seasonSlug ?? null,
          expansion: seasonResolution?.expansion ?? null,
          blizzardSeasonId: seasonResolution?.blizzardSeasonId ?? null,
          dungeonSlugs: seasonResolution?.activeDungeonSlugs ?? [],
          dungeonCount: seasonResolution?.dungeonCount ?? 0,
          dungeonPoolHash: seasonResolution?.dungeonPoolHash ?? null,
          catalogVersion: seasonResolution?.catalogVersion ?? null,
          catalogSource: seasonResolution?.catalogSource ?? null,
          lastKnownGood:
            seasonResolution?.authority?.lastKnownGood ?? null,
          metadataAgeMs: (() => {
            const synced = seasonResolution?.authority?.synchronizedAt;
            if (!synced) return null;
            return Math.max(0, Date.now() - new Date(synced).getTime());
          })(),
          diagnosticZoneId:
            seasonResolution?.authority?.diagnosticExpectedZoneId ?? null,
          diagnosticZoneMatch:
            seasonResolution?.authority?.diagnosticZoneMatch ?? null,
          autoDetectedZoneId:
            seasonResolution?.authority?.autoDetectedZoneId ?? null,
          manifestStatus: report.manifestStatus,
          providerCalls: report.providerCalls,
          selectedSlotCount: report.selectedSlotCount,
          expectedSlotCount: report.expectedSlotCount,
          fightsRequiringWcl:
            report.fightsRequiringWcl == null
              ? null
              : report.fightsRequiringWcl.length,
          rankingFactsMissing: report.rankingFactsMissing.length,
          blockers: report.blockers,
          safetyChecks: report.safetyChecks,
          publicationEligible: report.publicationEligible,
          warnings: seasonResolution?.warnings ?? [],
        },
        null,
        2,
      ),
    );
  } catch (err) {
    if (err instanceof SeasonCatalogMismatchError) {
      console.error(
        JSON.stringify(
          {
            code: err.code,
            message: err.message,
            seasonResolution: err.seasonResolution,
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }
    if (err instanceof CharacterNotFoundError) {
      console.error(
        JSON.stringify(
          { code: err.code, message: err.message, identity: err.identity },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

const isDirect =
  process.argv[1]?.includes("canary") ||
  process.argv[1]?.includes("scoring-canary");

if (isDirect) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
