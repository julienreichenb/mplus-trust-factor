/**
 * Relevant-character discovery: Raider.IO addon-db → classify → enqueue refresh.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideScoreRefresh } from "@mplus/config";
import type { RelevantCharacterDiscoveryJob, RegionCode } from "@mplus/contracts";
import { normalizeRealmSlug } from "@mplus/domain";
import {
  extractRequiredAddonFiles,
  layoutFromProviderHeader,
  loadLookupBuffer,
  parseNamedCharacterOffsets,
  parseProviderHeader,
  selectRelevantCandidatesFromAddonSnapshot,
  validatePackedProviderHeader,
  type MythicPlusPackedLayout,
} from "@mplus/provider-raiderio";
import type { Logger } from "@mplus/observability";
import type { WorkerContainer } from "../container.js";
import type { QueueProducers } from "../queues.js";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";
import { resolveEnqueueAbilityCatalogExecutionPin } from "./ability-catalog-enqueue-pin.js";
import { requireEffectiveScoringSeasonRow } from "./active-mplus-season/effective-season-peek.js";
import {
  classifyRelevantCharacterRefresh,
  priorityForRelevantClass,
} from "./relevant-character-classify.js";
import { loadRelevantRefreshSettings } from "./relevant-refresh-settings.js";
import { readWclAdmissionSnapshot } from "./refresh-admission/redis-ops.js";
import {
  computePointsResetInSeconds,
  isWclPreResetDrainActive,
} from "@mplus/config";

export interface RelevantDiscoveryCounters {
  mode: RelevantCharacterDiscoveryJob["mode"];
  regionCode: string;
  scanned: number;
  eligible: number;
  thresholdMedianKey: number;
  newCount: number;
  staleCount: number;
  freshSkipped: number;
  enqueued: number;
  deduped: number;
  drainActive: boolean;
}

function unescapeAddonRealm(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export async function isDrainFeedWindowActive(input: {
  redis: { get: (key: string) => Promise<string | null> } | null;
  appEnv: string;
  drainWindowSeconds: number;
}): Promise<boolean> {
  if (!input.redis) return false;
  const snapshot = await readWclAdmissionSnapshot(input.redis as Parameters<typeof readWclAdmissionSnapshot>[0], input.appEnv);
  if (!snapshot?.resetAt) return false;
  const resetIn = computePointsResetInSeconds(snapshot.resetAt);
  return isWclPreResetDrainActive(resetIn, input.drainWindowSeconds);
}

async function loadRegionalAddonSnapshot(
  _container: WorkerContainer,
  _seasonId: string,
  regionCode: RegionCode,
  _logger: Logger,
): Promise<{
  lookup: Uint8Array;
  named: Awaited<ReturnType<typeof parseNamedCharacterOffsets>>["named"];
  layout: MythicPlusPackedLayout;
}> {
  const workingDir = join(tmpdir(), `mplus-relevant-${randomUUID()}`);
  const { downloadReleaseZip, selectLatestMainlineAddonRelease } = await import("@mplus/provider-raiderio");
  const selected = await selectLatestMainlineAddonRelease();
  const { zipPath } = await downloadReleaseZip(selected.assetUrl, workingDir);
  const files = await extractRequiredAddonFiles(zipPath, workingDir, regionCode);
  const lookupText = (await readFile(files.lookupPath)).toString("latin1");
  const lookupHeader = parseProviderHeader(lookupText.slice(0, 32_768));
  validatePackedProviderHeader(lookupHeader);
  const layout = layoutFromProviderHeader(lookupHeader);
  const lookup = loadLookupBuffer(lookupText);
  const { named } = await parseNamedCharacterOffsets(
    files.charactersPath,
    lookupHeader.recordSizeInBytes,
  );
  return { lookup, named, layout };
}

export async function runRelevantCharacterDiscovery(
  container: WorkerContainer,
  job: RelevantCharacterDiscoveryJob,
  producers: Pick<QueueProducers, "enqueueRefreshCharacter">,
  hooks?: {
    loadAddon?: typeof loadRegionalAddonSnapshot;
  },
): Promise<{ counters: RelevantDiscoveryCounters }> {
  const { prisma, env, logger, repositories } = container;
  const settings = await loadRelevantRefreshSettings(prisma, env);
  const counters: RelevantDiscoveryCounters = {
    mode: job.mode,
    regionCode: job.regionCode,
    scanned: 0,
    eligible: 0,
    thresholdMedianKey: 0,
    newCount: 0,
    staleCount: 0,
    freshSkipped: 0,
    enqueued: 0,
    deduped: 0,
    drainActive: false,
  };

  if (settings.killSwitchActive) {
    logger.info(
      { event: "relevant_discovery_skipped", reason: "kill_switch" },
      "relevant discovery blocked by infrastructure kill switch",
    );
    return { counters };
  }

  const isAdminTrigger = job.trigger === "admin";
  if (!settings.runtimeEnabled && !isAdminTrigger) {
    logger.info({ event: "relevant_discovery_skipped", reason: "disabled" }, "relevant discovery disabled");
    return { counters };
  }

  let admissionRedis: ReturnType<WorkerContainer["createRedisConnection"]> | null = null;
  try {
    admissionRedis = container.createRedisConnection();
  } catch {
    admissionRedis = null;
  }

  if (job.mode === "drain_feed") {
    counters.drainActive = await isDrainFeedWindowActive({
      redis: admissionRedis,
      appEnv: env.APP_ENV,
      drainWindowSeconds: settings.wclPreResetDrainSeconds,
    });
    if (!counters.drainActive) {
      logger.info({ event: "relevant_drain_feed_skipped", reason: "outside_drain_window" });
      if (admissionRedis) await admissionRedis.quit().catch(() => undefined);
      return { counters };
    }
  }

  const regionCode = job.regionCode as RegionCode;
  const region = await prisma.region.findFirst({ where: { code: regionCode } });
  if (!region) {
    logger.warn({ regionCode }, "relevant discovery: region missing");
    if (admissionRedis) await admissionRedis.quit().catch(() => undefined);
    return { counters };
  }

  const season = await requireEffectiveScoringSeasonRow(prisma, { regionId: region.id });
  const scoreModel = await repositories.score.getActiveModel();
  if (!scoreModel) {
    logger.warn("relevant discovery: no active score model");
    if (admissionRedis) await admissionRedis.quit().catch(() => undefined);
    return { counters };
  }

  const abilityCatalogExecutionPin = await resolveEnqueueAbilityCatalogExecutionPin({ prisma });

  const { contract, hash: refreshContractHash } = resolveActiveRefreshContract({
    scoringModelKey: scoreModel.key,
    scoringModelVersion: scoreModel.version,
    activeSeasonId: season.slug,
    providerMode: env.PROVIDER_MODE ?? "fixture",
    zoneId: season.wclZoneId ?? undefined,
    abilityCatalogExecutionPin,
  });

  const loadAddon = hooks?.loadAddon ?? loadRegionalAddonSnapshot;
  const { lookup, named, layout } = await loadAddon(container, season.id, regionCode, logger);

  const selection = selectRelevantCandidatesFromAddonSnapshot({
    lookup,
    named,
    percentileBps: settings.candidatePercentileBps,
    layout,
    maxCandidates: settings.candidateTarget * 4,
  });
  counters.scanned = selection.scanned;
  counters.eligible = selection.eligible;
  counters.thresholdMedianKey = selection.thresholdMedianKey;

  const toProcess = selection.candidates.slice(0, settings.candidateTarget);

  for (const candidate of toProcess) {
    const realmSlug = normalizeRealmSlug(unescapeAddonRealm(candidate.realm));
    const name = unescapeAddonRealm(candidate.name);
    const character = await repositories.character.upsertCharacter(
      { region: regionCode, realmSlug, name },
      { lastSeenAt: new Date() },
    );

    const published = await prisma.characterPublishedScore.findFirst({
      where: {
        characterId: character.id,
        seasonId: season.id,
        scoreModelId: scoreModel.id,
        scopeType: "CHARACTER",
        scopeKey: null,
      },
      include: { publishedSnapshot: { select: { calculatedAt: true } } },
    });

    const activeJob = await prisma.ingestionJob.findFirst({
      where: {
        characterId: character.id,
        jobType: "refresh-character",
        status: { in: ["QUEUED", "ACTIVE"] },
      },
      orderBy: { scheduledAt: "asc" },
    });

    const latestJob = await prisma.ingestionJob.findFirst({
      where: { characterId: character.id, jobType: "refresh-character" },
      orderBy: { scheduledAt: "desc" },
    });

    const latestJobErrorCode =
      latestJob?.error && typeof latestJob.error === "object"
        ? String((latestJob.error as { code?: unknown }).code ?? "")
        : null;

    const refreshInput = {
      hasPublishedScore: published != null,
      scoreCalculatedAt: published?.publishedSnapshot?.calculatedAt ?? null,
      scoreTtlSeconds: env.SCORE_TTL_SECONDS,
      failureBackoffSeconds: env.REFRESH_FAILURE_BACKOFF_SECONDS,
      activeJobStatus:
        activeJob?.status === "QUEUED" || activeJob?.status === "ACTIVE" ? activeJob.status : null,
      latestJobStatus: latestJob?.status ?? null,
      latestJobFinishedAt: latestJob?.completedAt ?? null,
      latestJobErrorCode,
      contractReasons: [] as string[],
      forceRefresh: false,
      notRefreshEligible: false,
    };

    const characterClass = classifyRelevantCharacterRefresh(refreshInput);
    if (characterClass === "FRESH") {
      counters.freshSkipped += 1;
      continue;
    }
    if (characterClass === "NEW") counters.newCount += 1;
    if (characterClass === "STALE") counters.staleCount += 1;

    const decision = decideScoreRefresh(refreshInput);
    if (decision.action !== "ENQUEUE") {
      counters.freshSkipped += 1;
      continue;
    }

    const result = await producers.enqueueRefreshCharacter({
      characterId: character.id,
      region: regionCode,
      realmSlug,
      name,
      priority: priorityForRelevantClass(characterClass),
      forceRefresh: false,
      triggerSource: "RELEVANT_DISCOVERY",
      refreshContractHash,
      scoringModelKey: scoreModel.key,
      scoringModelVersion: scoreModel.version,
      authoritativeSeasonId: season.blizzardSeasonId ?? undefined,
      authoritativeSeasonSlug: season.slug,
      authoritySource: "effective_scoring_season",
      abilityCatalogExecutionPin,
      workloadClass: "OPERATION",
    });

    if (result.reused) counters.deduped += 1;
    else if (result.enqueued !== false) counters.enqueued += 1;
  }

  logger.info(
    {
      event: "relevant_discovery_complete",
      ...counters,
      contractHash: refreshContractHash,
      scoreModelKey: contract.scoringModelKey,
    },
    "relevant character discovery finished",
  );

  if (admissionRedis) {
    await admissionRedis.quit().catch(() => undefined);
  }

  return { counters };
}
