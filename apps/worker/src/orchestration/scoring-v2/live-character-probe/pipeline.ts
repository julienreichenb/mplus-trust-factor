/**
 * Live Scoring V2 character probe pipeline (read-only).
 * Reuses production discovery, Evidence Manifest V2 selector, extractors, calculators.
 * Does not publish scores, mutate DB, enqueue jobs, or flip V2 flags.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CharacterIdentityInput,
  CharacterSeasonEvidenceManifestV2,
  EvidenceCandidateAcquisitionResult,
  EvidenceCandidateMetadataV2,
  EvidenceRole,
  ProviderFetchContext,
} from "@mplus/contracts";
import { discoveryIdentityKey, EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";
import { getAbilityCatalog } from "@mplus/abilities";
import { loadEnv } from "@mplus/config";
import {
  LiveWarcraftLogsProvider,
  OPERATIONS,
  buildDatasetRequirements,
  buildDiscoveryPlan,
  classSlugFromWclClassId,
  ENCOUNTER_DUNGEON_MAP,
  extractPerformanceProfileAggregateFactV2,
  extractPerformanceRunParseFactV2,
  extractSurvivalFactDocumentV2FromSharedEvidence,
  extractUtilityV2RunFactSetFromSharedEvidence,
  hydrateFightUnknownCandidates,
  InMemorySharedEvidenceStore,
  ingestSharedEvidenceBundle,
  PERFORMANCE_V2_EXTRACTOR_FAMILY,
  PERFORMANCE_V2_EXTRACTOR_VERSION,
  PERFORMANCE_V2_FACT_SCHEMA_VERSION,
  resolveDungeonSlug,
  resolveMplusZoneConfig,
  resolveTargetActorId,
  slugifyDungeonName,
  SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
  toCandidateMetadataV2,
  toPerformanceRunParseFactV2,
  classifyDatasetStatus,
  classifyDimensionExecutable,
  classifyOverallVerdict,
  summarizeMissingDungeonSlots,
  buildSummaryMarkdown,
  type DatasetCoverageRow,
  type DiscoverySourceRow,
  type PerformanceFactDocumentV2,
  type RankingParseEvidenceV2,
  type SharedEvidenceDatasetKey,
  type SlotHydrationSummary,
  type WclRankingObservation,
  type WclRunEvidenceBundle,
} from "@mplus/provider-warcraftlogs";
import {
  buildEvidenceAcquisitionPlanV2,
  buildSlotFactSetBindingHash,
  computePerformanceV2,
  computeSurvivalV2,
  computeUtilityV2,
  createManualDifficultyPolicyV2,
  finalizeEvidenceManifestV2,
  resolveActiveSeasonDungeonPool,
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  SURVIVAL_V2_SCHEMA_VERSION,
  UTILITY_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_EXTRACTOR_VERSION,
  UTILITY_V2_SCHEMA_VERSION,
  type PerformanceRunParseFactV2,
  type SurvivalFactDocumentV2,
  type UtilityV2RunFactSet,
} from "@mplus/scoring";
import { collectAndComputeExperienceV3 } from "./experience.js";

export interface ProbeCliArgs {
  region: "EU" | "US" | "KR" | "TW";
  realm: string;
  name: string;
  outputRoot?: string;
}

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function parseProbeArgs(argv: string[]): ProbeCliArgs {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    flags[key] = next;
    i += 1;
  }
  const region = String(flags.region ?? "eu").trim().toUpperCase();
  const realm = String(flags.realm ?? "archimonde").trim().toLowerCase();
  const name = String(flags.name ?? "Wallidrixe").trim();
  if (!["EU", "US", "KR", "TW"].includes(region)) {
    throw new Error(`Unsupported region "${region}"`);
  }
  if (!realm || !name) {
    throw new Error("Usage: --region <EU|US|KR|TW> --realm <slug> --name <exact-name>");
  }
  return {
    region: region as ProbeCliArgs["region"],
    realm,
    name,
    outputRoot: flags["output-root"]?.trim() || undefined,
  };
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function fingerprintIdentity(
  reportCode: string,
  fightId: number,
  reportRevision: number,
  family: string,
  version: string,
): string {
  return createHash("sha256")
    .update([reportCode, String(fightId), String(reportRevision), family, version].join("|"))
    .digest("hex");
}

function rankingEvidenceFor(
  rankings: WclRankingObservation[],
  reportCode: string,
  fightId: number,
  reportRevision: number,
  dungeonSlug: string,
  keyLevel: number,
): RankingParseEvidenceV2 | null {
  const row = rankings.find((r) => r.reportCode === reportCode && r.fightId === fightId);
  if (!row) return null;
  return {
    reportCode,
    fightId,
    reportRevision,
    dungeonSlug: dungeonSlug || ENCOUNTER_DUNGEON_MAP[row.encounterId] || "unknown",
    keyLevel: keyLevel || row.keyLevel || 0,
    bracketPercent: row.bracketPercent,
    rankPercent: row.rankPercent ?? row.percentile,
    amountPercent: null,
    amount: row.amount,
    partition: null,
  };
}

function sharedKeysFromRequirements(): SharedEvidenceDatasetKey[] {
  const reqs = buildDatasetRequirements(["PERFORMANCE", "SURVIVAL", "UTILITY"], {
    includeOptional: true,
  });
  const map: Record<string, SharedEvidenceDatasetKey> = {
    MASTER_DATA: "masterData",
    CASTS: "Casts",
    HOSTILE_CASTS: "HostileCasts",
    INTERRUPTS: "Interrupts",
    DEATHS: "Deaths",
    DAMAGE_TAKEN: "DamageTaken",
    DAMAGE_DONE: "DamageDone",
    BUFFS: "Buffs",
    DEBUFFS: "Debuffs",
    DISPELS: "Dispels",
    HEALING: "Healing",
    COMBATANT_INFO: "CombatantInfo",
  };
  const keys: SharedEvidenceDatasetKey[] = [];
  const seen = new Set<string>();
  for (const r of reqs) {
    const key = map[r.dataset];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function datasetRowsForBundle(input: {
  bundle: WclRunEvidenceBundle | null;
  reportCode: string;
  fightId: number;
  actorId: number | null;
  requiredKeys: SharedEvidenceDatasetKey[];
  rankingAvailable: boolean;
  rankingFailed: boolean;
}): DatasetCoverageRow[] {
  const rows: DatasetCoverageRow[] = [];
  rows.push({
    dataset: "RANKING_PARSE",
    status: classifyDatasetStatus({
      required: true,
      requested: true,
      available: input.rankingAvailable,
      eventCount: input.rankingAvailable ? 1 : null,
      pageCount: input.rankingAvailable ? 1 : null,
      failed: input.rankingFailed && !input.rankingAvailable,
      failureReasonCode: input.rankingAvailable ? null : "ranking_parse_row_absent",
    }),
    providerOperation: "Character.zoneRankings",
    reportCode: input.reportCode,
    fightId: input.fightId,
    actorId: input.actorId,
    pageCount: input.rankingAvailable ? 1 : 0,
    eventCount: input.rankingAvailable ? 1 : 0,
    normalizedFactCount: null,
    failureReasonCode: input.rankingAvailable ? null : "ranking_parse_row_absent",
  });

  for (const key of input.requiredKeys) {
    const ds = input.bundle?.eventDatasets?.[key] ?? null;
    const master = key === "masterData" ? input.bundle?.masterData ?? null : null;
    const available = key === "masterData" ? master != null : ds != null;
    const eventCount =
      key === "masterData"
        ? master
          ? 1
          : 0
        : (ds?.eventCount ?? null);
    const pageCount = key === "masterData" ? (available ? 1 : 0) : (ds?.pageCount ?? null);
    const failed = ds?.state === "ERROR";
    rows.push({
      dataset: key,
      status: classifyDatasetStatus({
        required: true,
        requested: true,
        available,
        eventCount,
        pageCount,
        truncated: ds?.truncated === true,
        failed,
        failureReasonCode: failed ? "dataset_fetch_error" : available ? null : "dataset_absent",
      }),
      providerOperation: key === "masterData" ? "Report.masterData" : "Report.events",
      reportCode: input.reportCode,
      fightId: input.fightId,
      actorId: input.actorId,
      pageCount,
      eventCount,
      normalizedFactCount: null,
      failureReasonCode: failed ? "dataset_fetch_error" : available ? null : "dataset_absent",
    });
  }
  return rows;
}

function majorityRole(rankings: WclRankingObservation[]): EvidenceRole {
  const counts = new Map<string, number>();
  for (const r of rankings) {
    const role = (r.roleSlug ?? "").toUpperCase();
    if (!role) continue;
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  let best = "DPS";
  let n = -1;
  for (const [role, count] of counts) {
    if (count > n) {
      best = role;
      n = count;
    }
  }
  if (best.includes("TANK")) return "TANK";
  if (best.includes("HEAL")) return "HEALER";
  return "DPS";
}

function majoritySpec(rankings: WclRankingObservation[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rankings) {
    const spec = (r.specSlug ?? "").toLowerCase();
    if (!spec) continue;
    counts.set(spec, (counts.get(spec) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = -1;
  for (const [spec, count] of counts) {
    if (count > n) {
      best = spec;
      n = count;
    }
  }
  return best;
}

export async function runScoringV2LiveCharacterProbe(args: ProbeCliArgs): Promise<{
  outputDir: string;
  overallVerdict: string;
}> {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    throw new Error("ALLOW_LIVE_PROVIDER_CALLS=true is required (never enable in CI)");
  }

  loadEnv();

  const clientId = process.env.WCL_CLIENT_ID ?? "";
  const clientSecret = process.env.WCL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("WCL_CLIENT_ID and WCL_CLIENT_SECRET are required");
  }

  const zoneConfig = resolveMplusZoneConfig({ env: process.env });
  const identity: CharacterIdentityInput = {
    region: args.region,
    realmSlug: args.realm,
    name: args.name,
  };
  const now = new Date().toISOString();
  const ctx: ProviderFetchContext = {
    region: args.region,
    requestId: `scoring-v2-live-probe-${Date.now()}`,
    correlationId: `scoring-v2-live-probe-${args.name.toLowerCase()}`,
    forceRefresh: false,
    now,
    targetCharacter: identity,
  };

  const timestamp = now.replace(/[:.]/g, "-");
  const characterLabel = `${args.region.toLowerCase()}-${args.realm}-${args.name.toLowerCase()}`;
  const repoRoot = process.cwd().endsWith("apps\\worker") || process.cwd().endsWith("apps/worker")
    ? join(process.cwd(), "..", "..")
    : process.cwd();
  const outputDir = join(
    args.outputRoot ?? join(repoRoot, "tmp", "scoring-v2-live-character-probe"),
    `${characterLabel}-${timestamp}`,
  );
  await mkdir(outputDir, { recursive: true });

  let wclRequests = 0;
  let estimatedPoints = 0;

  const provider = new LiveWarcraftLogsProvider({
    env: {
      WCL_CLIENT_ID: clientId,
      WCL_CLIENT_SECRET: clientSecret,
      WCL_PUBLIC_GRAPHQL_URL:
        process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client",
      WCL_TOKEN_URL: process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token",
      WCL_RATE_WARN_PERCENT: Number(process.env.WCL_RATE_WARN_PERCENT ?? 70),
      WCL_RATE_DEFER_PERCENT: Number(process.env.WCL_RATE_DEFER_PERCENT ?? 80),
      WCL_RATE_STOP_PERCENT: Number(process.env.WCL_RATE_STOP_PERCENT ?? 90),
      WCL_CHARACTER_TTL_SECONDS: Number(process.env.WCL_CHARACTER_TTL_SECONDS ?? 43_200),
    },
    processEnv: process.env,
    zoneId: zoneConfig.zoneId,
    zoneExpiresAt: zoneConfig.expiresAt,
  });
  const client = provider.getGraphQlClient();

  // Active dungeon pool from configured WCL zone encounters (not hardcoded season IDs).
  const zoneResult = await client.requestPermissive<{
    worldData?: {
      zone?: {
        id: number;
        name: string;
        encounters?: Array<{ id: number; name?: string | null }> | null;
      } | null;
    };
  }>({
    operationName: OPERATIONS.WorldDataZone.operationName,
    query: OPERATIONS.WorldDataZone.query,
    variables: { id: zoneConfig.zoneId },
    region: args.region,
  });
  wclRequests += 1;
  estimatedPoints += zoneResult.costUnits ?? 1;
  const encounters = zoneResult.response.data?.worldData?.zone?.encounters ?? [];
  /** Live zone encounter → slug map (static map is fallback only). */
  const liveEncounterSlugById = new Map<number, string>();
  for (const e of encounters) {
    const slug =
      ENCOUNTER_DUNGEON_MAP[e.id] ?? (e.name ? slugifyDungeonName(e.name) : null);
    if (slug) liveEncounterSlugById.set(e.id, slug);
  }
  const zoneDungeonSlugs = [...new Set(liveEncounterSlugById.values())].sort();
  const dungeonPool = resolveActiveSeasonDungeonPool({
    expectedDungeonCount: 8,
    blizzardSeasonDungeonSlugs: zoneDungeonSlugs.slice(0, 8),
    wclDungeonSlugs: zoneDungeonSlugs,
  });
  const activeDungeonSlugs = dungeonPool.canonicalSlugs;
  const activeDungeonSet = new Set(activeDungeonSlugs.map((s) => s.trim().toLowerCase()));
  const seasonName =
    zoneResult.response.data?.worldData?.zone?.name ?? `wcl-zone-${zoneConfig.zoneId}`;

  // Single discovery + hydration pass (avoid double WCL character queries).
  const discovery = await provider.discoverCharacter(identity, ctx);
  wclRequests += 5;
  const hydrated = await hydrateFightUnknownCandidates({
    candidates: discovery.candidates,
    characterName: args.name,
    realmSlug: args.realm,
    maxReports: 8,
    fetchReport: async (code) => {
      const reportResult = await client.requestPermissive<{
        reportData?: {
          report?: {
            code: string;
            startTime: number;
            endTime?: number | null;
            visibility?: string | null;
            zone?: { id: number; name?: string | null } | null;
            fights: Array<{
              id: number;
              encounterID?: number | null;
              name?: string | null;
              difficulty?: number | null;
              kill?: boolean | null;
              startTime: number;
              endTime: number;
              keystoneLevel?: number | null;
              friendlyPlayers?: Array<number | { id: number; name?: string; server?: string }>;
            }>;
            masterData?: {
              actors?: Array<{ id: number; name: string; type: string; server?: string | null }>;
            } | null;
          } | null;
        };
      }>({
        operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
        query: OPERATIONS.ReportWithFightAndMasterData.query,
        variables: { code },
        region: args.region,
      });
      wclRequests += 1;
      estimatedPoints += reportResult.costUnits ?? 1;
      // Return provider report payload as-is (same shape hydrateFightUnknownCandidates expects).
      return (reportResult.response.data?.reportData?.report as never) ?? null;
    },
  });
  wclRequests += hydrated.hydratedReportCount;

  const rankingByKey = new Map<string, WclRankingObservation>();
  for (const r of discovery.rankings) {
    rankingByKey.set(`${r.reportCode}:${r.fightId}`, r);
  }

  function resolveCandidateDungeonSlug(input: {
    encounterId: number | null | undefined;
    dungeonSlug: string | null | undefined;
    fightName?: string | null;
  }): string | null {
    if (input.encounterId != null) {
      const live = liveEncounterSlugById.get(input.encounterId);
      if (live) return live;
      const mapped = ENCOUNTER_DUNGEON_MAP[input.encounterId];
      if (mapped) return mapped;
    }
    if (input.dungeonSlug && input.dungeonSlug !== "unknown") {
      return input.dungeonSlug.trim().toLowerCase();
    }
    if (input.fightName?.trim()) return slugifyDungeonName(input.fightName);
    return null;
  }

  const sourceRows: DiscoverySourceRow[] = [];
  for (const c of hydrated.candidates) {
    if (c.incompleteness.fightUnknown || c.fightId <= 0) continue;
    const dungeonSlug = resolveCandidateDungeonSlug({
      encounterId: c.encounterId,
      dungeonSlug: c.dungeonSlug,
    });
    if (!dungeonSlug || !activeDungeonSet.has(dungeonSlug)) continue;
    if (c.keyLevel == null || c.keyLevel <= 0) continue;
    const ranking = rankingByKey.get(`${c.reportCode}:${c.fightId}`);
    sourceRows.push({
      reportCode: c.reportCode,
      fightId: c.fightId,
      dungeonSlug,
      keyLevel: c.keyLevel,
      timed: c.timed,
      runScore: c.score ?? ranking?.score ?? null,
      completedAt: c.completedAt,
      fightDurationMs: c.durationMs,
      actorId: c.targetActorId ?? null,
      reportRevision: null,
      source: c.source === "zoneRankings" ? "zone_rankings" : "recent_reports",
      parsePercentile:
        ranking?.bracketPercent ?? ranking?.percentile ?? ranking?.rankPercent ?? null,
      visibility: "public",
      fightAccessible: true,
      hardError: false,
      // Fight + dungeon + actor resolved via hydration — eligible for WS02 planning.
      identityResolution: "RESOLVED",
    });
  }

  // Zone-ranking parse rows (may already include report/fight identity).
  for (const r of discovery.rankings) {
    const dungeonSlug = resolveCandidateDungeonSlug({
      encounterId: r.encounterId,
      dungeonSlug: ENCOUNTER_DUNGEON_MAP[r.encounterId] ?? null,
    });
    if (!dungeonSlug || !activeDungeonSet.has(dungeonSlug)) continue;
    const keyLevel = r.keyLevel ?? r.bracket ?? null;
    if (keyLevel == null || keyLevel <= 0) continue;
    const key = `${r.reportCode}:${r.fightId}`;
    if (sourceRows.some((row) => `${row.reportCode}:${row.fightId}` === key)) continue;
    sourceRows.push({
      reportCode: r.reportCode,
      fightId: r.fightId,
      dungeonSlug,
      keyLevel,
      timed: r.timed,
      runScore: r.score,
      completedAt: r.startTimeMs != null ? new Date(r.startTimeMs).toISOString() : null,
      fightDurationMs: r.durationMs,
      actorId: null,
      reportRevision: null,
      source: "parse_row",
      parsePercentile: r.bracketPercent ?? r.percentile ?? r.rankPercent ?? null,
      visibility: "public",
      fightAccessible: true,
      hardError: false,
      identityResolution: "RESOLVED",
    });
  }

  const discoveryPlan = buildDiscoveryPlan({
    zoneRankingCandidates: sourceRows,
    parseRows: sourceRows.filter((r) => r.source === "parse_row"),
    activeDungeonSlugs,
  });

  const metadataCandidates: EvidenceCandidateMetadataV2[] = [];
  for (const planned of discoveryPlan.candidates) {
    const dungeonSlug = planned.dungeonSlug?.trim().toLowerCase() ?? null;
    if (dungeonSlug == null || planned.keyLevel == null || planned.keyLevel <= 0) continue;
    if (!activeDungeonSet.has(dungeonSlug)) continue;
    try {
      metadataCandidates.push(
        toCandidateMetadataV2(planned, {
          dungeonSlug,
          keyLevel: planned.keyLevel,
        }),
      );
    } catch {
      // skip incomplete
    }
  }

  const characterId = `probe:${args.region}:${args.realm}:${args.name}`.toLowerCase();
  const seasonId = `wcl-zone-${zoneConfig.zoneId}`;
  const role = majorityRole(discovery.rankings);
  const classSlug = classSlugFromWclClassId(discovery.summary.classId);
  const specSlug = majoritySpec(discovery.rankings);

  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope: {
      characterId,
      seasonId,
      seasonSlug: seasonName,
      specializationId: specSlug,
      classSlug,
      specSlug,
      role,
      activeDungeonSlugs,
      highKeyPolicyId: "probe-high-key-policy",
      evidenceCutoffAt: now,
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      refreshContractHash: createHash("sha256").update(`probe|${characterId}|${now}`).digest("hex"),
    },
    candidates: metadataCandidates,
    plannedAt: now,
  });

  const sharedKeys = sharedKeysFromRequirements();
  const store = new InMemorySharedEvidenceStore();
  const acquisitionResults: EvidenceCandidateAcquisitionResult[] = [];
  const acquisitionByKey = new Map<
    string,
    {
      result: EvidenceCandidateAcquisitionResult;
      bundle: WclRunEvidenceBundle | null;
      ranking: RankingParseEvidenceV2 | null;
      performanceFact: PerformanceFactDocumentV2 | null;
      survivalFact: SurvivalFactDocumentV2 | null;
      utilityFact: UtilityV2RunFactSet | null;
      datasetRows: DatasetCoverageRow[];
    }
  >();

  // Unique candidates from plan, ordered by first appearance.
  const uniqueAttempts: Array<{
    reportCode: string;
    fightId: number;
    dungeonSlug: string;
    keyLevel: number;
    timed: boolean | null;
    runScore: number | null;
    completedAt: string | null;
    actorId: number | null;
    evidenceCompleteness: number;
  }> = [];
  const seenAttempt = new Set<string>();
  for (const slot of plan.slots) {
    for (const attempt of slot.orderedCandidates) {
      const key = discoveryIdentityKey(attempt.discoveryIdentity);
      if (seenAttempt.has(key)) continue;
      seenAttempt.add(key);
      uniqueAttempts.push({
        reportCode: attempt.discoveryIdentity.reportCode,
        fightId: attempt.discoveryIdentity.fightId,
        dungeonSlug: slot.dungeonSlug,
        keyLevel: attempt.keyLevel,
        timed: attempt.timed,
        runScore: attempt.runScore,
        completedAt: attempt.completedAt,
        actorId: attempt.actorId,
        evidenceCompleteness: attempt.evidenceCompleteness,
      });
    }
  }

  // Cap acquisition work: plan already bounds candidates; still hard-cap at 40.
  for (const attempt of uniqueAttempts.slice(0, 40)) {
    const identityKey = discoveryIdentityKey({
      reportCode: attempt.reportCode,
      fightId: attempt.fightId,
    });
    try {
      const reportResult = await client.requestPermissive<{
        reportData?: {
          report?: {
            code: string;
            revision: number;
            startTime: number;
            endTime: number;
            visibility?: string | null;
            fights?: Array<{
              id: number;
              encounterID?: number | null;
              name?: string | null;
              startTime: number;
              endTime: number;
              keystoneLevel?: number | null;
              friendlyPlayers?: Array<number | { id: number; name?: string; server?: string }>;
            }> | null;
            masterData?: {
              actors?: Array<{ id: number; name: string; type: string; server?: string | null }>;
            } | null;
          } | null;
        };
      }>({
        operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
        query: OPERATIONS.ReportWithFightAndMasterData.query,
        variables: { code: attempt.reportCode, fightIDs: [attempt.fightId] },
        region: args.region,
      });
      wclRequests += 1;
      estimatedPoints += reportResult.costUnits ?? 1;

      const report = reportResult.response.data?.reportData?.report ?? null;
      if (!report) {
        acquisitionResults.push({
          discoveryIdentity: { reportCode: attempt.reportCode, fightId: attempt.fightId },
          acquisitionStatus: "REJECTED",
          reportRevision: null,
          rejectionReason: "ACQUISITION_FAILED",
          rejectionDetail: "report_not_found",
          datasetHashes: [],
          factSetHash: null,
          dimensionValidity: null,
          keyLevel: attempt.keyLevel,
          timed: attempt.timed,
          runScore: attempt.runScore,
          completedAt: attempt.completedAt,
          actorId: attempt.actorId,
          evidenceCompleteness: attempt.evidenceCompleteness,
        });
        continue;
      }

      const fight = (report.fights ?? []).find((f) => f.id === attempt.fightId);
      if (!fight) {
        acquisitionResults.push({
          discoveryIdentity: { reportCode: attempt.reportCode, fightId: attempt.fightId },
          acquisitionStatus: "REJECTED",
          reportRevision: null,
          rejectionReason: "ACQUISITION_FAILED",
          rejectionDetail: "fight_not_found",
          datasetHashes: [],
          factSetHash: null,
          dimensionValidity: null,
          keyLevel: attempt.keyLevel,
          timed: attempt.timed,
          runScore: attempt.runScore,
          completedAt: attempt.completedAt,
          actorId: attempt.actorId,
          evidenceCompleteness: attempt.evidenceCompleteness,
        });
        continue;
      }

      const reportRevision = report.revision;
      const actors = report.masterData?.actors ?? [];
      const playerActorId =
        resolveTargetActorId(actors, fight.friendlyPlayers, args.name, args.realm) ??
        attempt.actorId;
      const dungeonSlug =
        resolveDungeonSlug(fight, null) ??
        attempt.dungeonSlug ??
        "unknown";

      const before = store.providerFetchCount;
      const bundle = await ingestSharedEvidenceBundle({
        client,
        store,
        reportCode: attempt.reportCode,
        reportRevision,
        fightId: attempt.fightId,
        playerActorId,
        ownedPetActorIds: [],
        dungeonSlug,
        startTime: fight.startTime,
        endTime: fight.endTime,
        consumers: ["survival", "utility"],
        datasets: sharedKeys,
        region: args.region,
      });
      const providerCalls = Math.max(0, store.providerFetchCount - before);
      wclRequests += providerCalls;
      estimatedPoints += bundle.accounting.pointsConsumed ?? providerCalls;

      const ranking = rankingEvidenceFor(
        discovery.rankings,
        attempt.reportCode,
        attempt.fightId,
        reportRevision,
        dungeonSlug,
        attempt.keyLevel,
      );

      const slotBinding = {
        slotId: `${dungeonSlug}:pending`,
        dungeonSlug,
        slotIndex: 0 as const,
        keyLevel: attempt.keyLevel,
        identity: {
          reportCode: attempt.reportCode,
          fightId: attempt.fightId,
          reportRevision,
        },
      };

      const perfOutcome = extractPerformanceRunParseFactV2({
        slot: slotBinding,
        evidence: ranking,
      });

      let survivalFact: SurvivalFactDocumentV2 | null = null;
      let utilityFact: UtilityV2RunFactSet | null = null;
      if (playerActorId != null && classSlug) {
        const catalog = getAbilityCatalog({ classSlug, specSlug });
        const survivalOutcome = extractSurvivalFactDocumentV2FromSharedEvidence({
          bundle,
          slot: slotBinding,
          characterId,
          identity: {
            region: args.region,
            realmSlug: args.realm,
            name: args.name,
          },
          playerActorId,
          ownedPetActorIds: [],
          catalog,
          classSlug,
          specSlug,
          keyLevel: attempt.keyLevel,
        });
        survivalFact = survivalOutcome.fact;
        const utilityOutcome = extractUtilityV2RunFactSetFromSharedEvidence({
          bundle,
          slot: { ...slotBinding, slotIndex: 0 },
          classSlug,
          specSlug,
        });
        utilityFact = utilityOutcome.fact;
      }

      const writtenMembers = [
        perfOutcome.fact
          ? {
              extractorFamily: PERFORMANCE_V2_EXTRACTOR_FAMILY,
              extractorVersion: PERFORMANCE_V2_EXTRACTOR_VERSION,
              inputFingerprint: fingerprintIdentity(
                attempt.reportCode,
                attempt.fightId,
                reportRevision,
                PERFORMANCE_V2_EXTRACTOR_FAMILY,
                PERFORMANCE_V2_EXTRACTOR_VERSION,
              ),
              facts: perfOutcome.fact,
            }
          : null,
        survivalFact
          ? {
              extractorFamily: SURVIVAL_V2_EXTRACTOR_FAMILY,
              extractorVersion: SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
              inputFingerprint: fingerprintIdentity(
                attempt.reportCode,
                attempt.fightId,
                reportRevision,
                SURVIVAL_V2_EXTRACTOR_FAMILY,
                SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
              ),
              facts: survivalFact,
            }
          : null,
        utilityFact
          ? {
              extractorFamily: UTILITY_V2_EXTRACTOR_FAMILY,
              extractorVersion: UTILITY_V2_EXTRACTOR_VERSION,
              inputFingerprint: fingerprintIdentity(
                attempt.reportCode,
                attempt.fightId,
                reportRevision,
                UTILITY_V2_EXTRACTOR_FAMILY,
                UTILITY_V2_EXTRACTOR_VERSION,
              ),
              facts: utilityFact,
            }
          : null,
      ].filter((m): m is NonNullable<typeof m> => m != null);

      const factSetHash =
        writtenMembers.length > 0
          ? buildSlotFactSetBindingHash(writtenMembers)
          : fingerprintIdentity(
              attempt.reportCode,
              attempt.fightId,
              reportRevision,
              "scoring-v2-acquisition",
              "2.0.0",
            );

      const result: EvidenceCandidateAcquisitionResult = {
        discoveryIdentity: { reportCode: attempt.reportCode, fightId: attempt.fightId },
        acquisitionStatus: "ACQUIRED",
        reportRevision,
        rejectionReason: null,
        rejectionDetail: null,
        datasetHashes: [],
        factSetHash,
        dimensionValidity: {
          performance: perfOutcome.status === "WRITTEN" ? "VALID" : "PARTIAL",
          survival: survivalFact ? "VALID" : "PARTIAL",
          utility: utilityFact ? "VALID" : "PARTIAL",
          reasons: [],
        },
        keyLevel: attempt.keyLevel,
        timed: attempt.timed,
        runScore: attempt.runScore,
        completedAt: attempt.completedAt,
        actorId: playerActorId,
        evidenceCompleteness: attempt.evidenceCompleteness,
      };
      acquisitionResults.push(result);

      const datasetRows = datasetRowsForBundle({
        bundle,
        reportCode: attempt.reportCode,
        fightId: attempt.fightId,
        actorId: playerActorId,
        requiredKeys: sharedKeys,
        rankingAvailable: ranking != null,
        rankingFailed: ranking == null,
      });

      acquisitionByKey.set(identityKey, {
        result,
        bundle,
        ranking,
        performanceFact: perfOutcome.fact,
        survivalFact,
        utilityFact,
        datasetRows,
      });
    } catch (error) {
      acquisitionResults.push({
        discoveryIdentity: { reportCode: attempt.reportCode, fightId: attempt.fightId },
        acquisitionStatus: "REJECTED",
        reportRevision: null,
        rejectionReason: "HARD_PROVIDER_ERROR",
        rejectionDetail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        datasetHashes: [],
        factSetHash: null,
        dimensionValidity: null,
        keyLevel: attempt.keyLevel,
        timed: attempt.timed,
        runScore: attempt.runScore,
        completedAt: attempt.completedAt,
        actorId: attempt.actorId,
        evidenceCompleteness: attempt.evidenceCompleteness,
      });
    }
  }

  const { manifest } = finalizeEvidenceManifestV2({
    plan,
    acquisitionResults,
    selectedAt: new Date().toISOString(),
  });

  // Re-bind facts to finalized slot IDs for selected slots.
  const selectedPerfFacts: PerformanceRunParseFactV2[] = [];
  const survivalDocs: SurvivalFactDocumentV2[] = [];
  const utilityFacts: UtilityV2RunFactSet[] = [];
  const datasetCoverage: DatasetCoverageRow[] = [];
  const slotSummaries: SlotHydrationSummary[] = [];
  let fullyHydratedSlots = 0;
  let datasetFailedSlots = 0;
  let factExtractionFailedSlots = 0;

  for (const slot of manifest.slots) {
    const slotId = `${slot.dungeonSlug}:${slot.slotIndex}`;
    if (slot.state !== "SELECTED" || !slot.identity) {
      slotSummaries.push({
        dungeonSlug: slot.dungeonSlug,
        slotIndex: slot.slotIndex as 0 | 1,
        state: slot.state,
        reportCode: null,
        fightId: null,
        reportRevision: null,
        actorId: null,
        fullyHydrated: false,
        wclReportValid: false,
        missingReason: slot.state === "SELECTED" ? "missing_identity" : "not_selected",
      });
      continue;
    }
    const key = discoveryIdentityKey({
      reportCode: slot.identity.reportCode,
      fightId: slot.identity.fightId,
    });
    const acquired = acquisitionByKey.get(key);
    const hydrated = Boolean(acquired?.result.reportRevision != null && acquired.bundle);
    if (hydrated) fullyHydratedSlots += 1;
    if (acquired?.datasetRows.some((r) => r.status === "FAILED")) datasetFailedSlots += 1;
    if (
      !acquired?.performanceFact &&
      !acquired?.survivalFact &&
      !acquired?.utilityFact
    ) {
      factExtractionFailedSlots += 1;
    }

    slotSummaries.push({
      dungeonSlug: slot.dungeonSlug,
      slotIndex: slot.slotIndex as 0 | 1,
      state: slot.state,
      reportCode: slot.identity.reportCode,
      fightId: slot.identity.fightId,
      reportRevision: slot.identity.reportRevision,
      actorId: acquired?.result.actorId ?? null,
      fullyHydrated: hydrated,
      wclReportValid: acquired?.result.acquisitionStatus === "ACQUIRED",
      missingReason: hydrated ? null : "incomplete_hydration",
    });

    if (acquired) {
      for (const row of acquired.datasetRows) datasetCoverage.push({ ...row });
      if (acquired.performanceFact) {
        const rebound: PerformanceFactDocumentV2 = {
          ...acquired.performanceFact,
          slotId,
          dungeonSlug: slot.dungeonSlug,
          identity: { ...slot.identity },
        };
        selectedPerfFacts.push(toPerformanceRunParseFactV2(rebound));
      }
      if (acquired.survivalFact) {
        survivalDocs.push({
          ...acquired.survivalFact,
          dungeonSlug: slot.dungeonSlug,
          slotIndex: slot.slotIndex,
          identity: { ...slot.identity },
        });
      }
      if (acquired.utilityFact) {
        utilityFacts.push({
          ...acquired.utilityFact,
          slotId,
          dungeonSlug: slot.dungeonSlug,
          slotIndex: slot.slotIndex as 0 | 1,
          reportCode: slot.identity.reportCode,
          fightId: slot.identity.fightId,
          reportRevision: slot.identity.reportRevision,
        });
      }
    }
  }

  const profileOutcome = extractPerformanceProfileAggregateFactV2({
    pointsAndDamagePayload: discovery.performance?.raw ?? null,
  });

  const difficultyPolicy = createManualDifficultyPolicyV2({
    seasonId,
    region: args.region,
    role,
    specSlug,
    k50: 8,
    k90: 12,
    k99: 15,
    confidence: 0.7,
  });

  const performanceInput = {
    manifest: {
      contentHash: manifest.contentHash,
      schemaVersion: manifest.schemaVersion,
      selectorVersion: manifest.selectorVersion,
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      seasonSlug: manifest.seasonSlug,
      specSlug: manifest.specSlug,
      role: manifest.role,
      highKeyPolicyId: manifest.highKeyPolicyId,
      activeDungeonSlugs: manifest.activeDungeonSlugs,
      expectedSlotCount: manifest.expectedSlotCount,
      selectedSlotCount: manifest.selectedSlotCount,
      evidenceCutoffAt: manifest.evidenceCutoffAt,
    },
    runParseFacts: selectedPerfFacts,
    profileAggregate: profileOutcome.fact,
    difficultyPolicy,
    expectedPartition: null,
    logFreshness: 1,
    computedAt: now,
  };

  let performanceResult = null;
  const performanceMissing: string[] = [];
  const performanceFailures: string[] = [];
  try {
    if (selectedPerfFacts.length === 0) {
      performanceMissing.push("run_parse_facts");
      performanceFailures.push("missing_ranking_parse_evidence");
    } else {
      performanceResult = computePerformanceV2(performanceInput);
    }
  } catch (error) {
    performanceFailures.push(
      error instanceof Error ? `performance_compute:${error.message}` : "performance_compute",
    );
  }

  const survivalInput = {
    manifest: manifest as CharacterSeasonEvidenceManifestV2,
    factSets: survivalDocs,
    relativeDamageMode: "off" as const,
    scoreModelId: null,
  };
  let survivalResult = null;
  const survivalMissing: string[] = [];
  const survivalFailures: string[] = [];
  try {
    if (survivalDocs.length === 0) {
      survivalMissing.push("survival_fact_documents");
      survivalFailures.push("missing_survival_fact_documents");
    } else {
      survivalResult = computeSurvivalV2(survivalInput);
    }
  } catch (error) {
    survivalFailures.push(
      error instanceof Error ? `survival_compute:${error.message}` : "survival_compute",
    );
  }

  const utilityInput = {
    manifest: {
      contentHash: manifest.contentHash,
      schemaVersion: manifest.schemaVersion,
      selectorVersion: manifest.selectorVersion,
      expectedSlotCount: manifest.expectedSlotCount,
      selectedSlotCount: manifest.selectedSlotCount,
      activeDungeonSlugs: manifest.activeDungeonSlugs,
      slots: manifest.slots.map((s) => ({
        slotId: `${s.dungeonSlug}:${s.slotIndex}`,
        dungeonSlug: s.dungeonSlug,
        slotIndex: s.slotIndex as 0 | 1,
        state: s.state,
        identity: s.identity
          ? {
              reportCode: s.identity.reportCode,
              fightId: s.identity.fightId,
              reportRevision: s.identity.reportRevision,
            }
          : null,
      })),
    },
    factSets: utilityFacts,
  };
  let utilityResult = null;
  const utilityMissing: string[] = [];
  const utilityFailures: string[] = [];
  try {
    if (utilityFacts.length === 0) {
      utilityMissing.push("utility_fact_sets");
      utilityFailures.push("missing_utility_fact_sets");
    } else {
      utilityResult = computeUtilityV2(utilityInput);
    }
  } catch (error) {
    utilityFailures.push(
      error instanceof Error ? `utility_compute:${error.message}` : "utility_compute",
    );
  }

  const experience = await collectAndComputeExperienceV3({
    identity,
    ctx,
    manifest,
    activeDungeonSlugs,
    computedAt: now,
  });

  const performanceReady = classifyDimensionExecutable({
    calculated: performanceResult != null,
    availability: performanceResult?.state ?? null,
    missingFields: performanceMissing,
    failureReasons: performanceFailures,
  });
  const survivalReady = classifyDimensionExecutable({
    calculated: survivalResult != null,
    availability: survivalResult?.state ?? null,
    missingFields: survivalMissing,
    failureReasons: survivalFailures,
  });
  const utilityReady = classifyDimensionExecutable({
    calculated: utilityResult != null,
    availability: utilityResult?.availabilityState ?? null,
    missingFields: utilityMissing,
    failureReasons: utilityFailures,
  });
  const experienceReady = classifyDimensionExecutable({
    calculated: experience.result != null,
    availability: experience.result?.state ?? null,
    missingFields: experience.missingFields,
    failureReasons: experience.failureReasons,
  });

  const missingDungeonSlots = summarizeMissingDungeonSlots({
    activeDungeonSlugs,
    slots: manifest.slots.map((s) => ({
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex as 0 | 1,
      state: s.state,
    })),
  });

  const overallVerdict = classifyOverallVerdict({
    dungeonCount: activeDungeonSlugs.length,
    selectedSlotCount: manifest.selectedSlotCount,
    expectedSlotCount: manifest.expectedSlotCount,
    fullyHydratedSlots,
    discoveryFailed: metadataCandidates.length === 0,
    datasetFailedSlots,
    factExtractionFailedSlots,
    performance: {
      executable: performanceReady,
      calculated: performanceResult != null,
      availability: performanceResult?.state ?? null,
      missingFields: performanceMissing,
      failureReasons: performanceFailures,
    },
    survival: {
      executable: survivalReady,
      calculated: survivalResult != null,
      availability: survivalResult?.state ?? null,
      missingFields: survivalMissing,
      failureReasons: survivalFailures,
    },
    utility: {
      executable: utilityReady,
      calculated: utilityResult != null,
      availability: utilityResult?.availabilityState ?? null,
      missingFields: utilityMissing,
      failureReasons: utilityFailures,
    },
    experience: {
      executable: experienceReady,
      calculated: experience.result != null,
      availability: experience.result?.state ?? null,
      missingFields: experience.missingFields,
      failureReasons: experience.failureReasons,
    },
  });

  const performanceSummary = {
    executable: performanceReady,
    score: performanceResult?.score ?? null,
    confidence: performanceResult?.confidence ?? null,
    availability: performanceResult?.state ?? "UNAVAILABLE",
    detailedContribution: performanceResult?.detailedSeasonPerformance ?? null,
    profileContribution: performanceResult?.profilePerformance ?? null,
    dungeonCoverage: performanceResult?.slotCoverage ?? null,
    limitations: performanceResult?.explanation?.confidenceLimits ?? performanceFailures,
    missingFields: performanceMissing,
    factCount: selectedPerfFacts.length,
    schemaVersion: PERFORMANCE_V2_FACT_SCHEMA_VERSION,
    algorithmFamily: PERFORMANCE_V2_EXTRACTOR_FAMILY,
  };
  const survivalSummary = {
    executable: survivalReady,
    score: survivalResult?.score ?? null,
    confidence: survivalResult?.confidence ?? null,
    availability: survivalResult?.state ?? "UNAVAILABLE",
    deathsOutcomeInputs: survivalDocs.map((d) => ({
      dungeonSlug: d.dungeonSlug,
      slotIndex: d.slotIndex,
      deathCount: d.deaths?.count ?? null,
      healthMode: d.healthEvidence?.mode ?? null,
    })),
    defensiveInputs: survivalDocs.map((d) => ({
      dungeonSlug: d.dungeonSlug,
      slotIndex: d.slotIndex,
      byCategory: d.defensiveActivations?.byCategory ?? null,
      toolkitSize: d.defensiveActivations?.toolkit?.length ?? null,
    })),
    recoveryInputs: survivalDocs.map((d) => ({
      dungeonSlug: d.dungeonSlug,
      slotIndex: d.slotIndex,
      recoveryEligibleWindows:
        d.dangerWindows?.filter((w) => w.recoveryEligible === true).length ?? 0,
      recoveryUsefulWindows:
        d.dangerWindows?.filter((w) => w.recoveryUseful === true).length ?? 0,
    })),
    limitations: survivalResult?.explanation?.limitations ?? survivalFailures,
    missingFields: survivalMissing,
    factCount: survivalDocs.length,
    schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
    extractorFamily: SURVIVAL_V2_EXTRACTOR_FAMILY,
  };
  const utilitySummary = {
    executable: utilityReady,
    score: utilityResult?.score ?? null,
    confidence: utilityResult?.confidence ?? null,
    availability: utilityResult?.availabilityState ?? "UNAVAILABLE",
    observedDomains: utilityResult?.explanation?.applicableDomains ?? null,
    matchedUnmatched: {
      interruptCounts: utilityResult?.interruptCounts ?? null,
      unmatchedAttempts: utilityResult?.interruptCounts?.UNMATCHED_ATTEMPT ?? null,
    },
    catalogCoverage: utilityResult?.context?.catalogCoverage ?? null,
    floorBehavior: utilityResult?.explanation?.scoreFloor ?? null,
    limitations: utilityResult?.explanation?.notes ?? utilityFailures,
    missingFields: utilityMissing,
    factCount: utilityFacts.length,
    schemaVersion: UTILITY_V2_SCHEMA_VERSION,
    extractorFamily: UTILITY_V2_EXTRACTOR_FAMILY,
  };
  const experienceSummary = {
    executable: experienceReady,
    score: experience.result?.score ?? null,
    confidence: experience.result?.confidence ?? null,
    availability: experience.result?.state ?? "UNAVAILABLE",
    sourceStatuses: experience.sourceStatuses,
    limitations: experience.limitations,
    missingFields: experience.missingFields,
    note: "Experience uses Blizzard/Raider.IO history — not the 16 WCL log slots.",
  };

  const summaryJson = {
    character: `${args.region}/${args.realm}/${args.name}`,
    activeSeason: seasonName,
    wclZoneId: zoneConfig.zoneId,
    dungeonCount: activeDungeonSlugs.length,
    activeDungeonSlugs,
    selectedSlotCount: manifest.selectedSlotCount,
    expectedSlotCount: manifest.expectedSlotCount,
    fullyHydratedSlots,
    missingDungeonSlots,
    performanceExecutable: performanceReady,
    survivalExecutable: survivalReady,
    utilityExecutable: utilityReady,
    experienceExecutable: experienceReady,
    overallVerdict,
    wclRequests,
    estimatedWclPoints: estimatedPoints,
    classSlug,
    specSlug,
    role,
    publication: false,
    scoringV2FlagsEnabled: false,
    characterPublishedScoreWritten: false,
    performance: performanceSummary,
    survival: survivalSummary,
    utility: utilitySummary,
    experience: experienceSummary,
  };

  const summaryMd = buildSummaryMarkdown({
    header: {
      character: `${args.region}/${args.realm}/${args.name}`,
      activeSeason: seasonName,
      dungeonCount: activeDungeonSlugs.length,
      selectedSlotCount: manifest.selectedSlotCount,
      expectedSlotCount: manifest.expectedSlotCount,
      fullyHydratedSlots,
      performanceExecutable: performanceReady,
      survivalExecutable: survivalReady,
      utilityExecutable: utilityReady,
      experienceExecutable: experienceReady,
      overallVerdict,
    },
    missingDungeonSlots,
    slots: slotSummaries,
    wclRequests,
    estimatedWclPoints: estimatedPoints,
    datasetCoverageNotes: [
      `Rows audited: ${datasetCoverage.length}`,
      `FAILED rows: ${datasetCoverage.filter((r) => r.status === "FAILED").length}`,
      `AVAILABLE rows: ${datasetCoverage.filter((r) => r.status === "AVAILABLE").length}`,
      `EMPTY_VALID rows: ${datasetCoverage.filter((r) => r.status === "EMPTY_VALID").length}`,
    ],
    factSetCoverageNotes: [
      `Performance facts: ${selectedPerfFacts.length}`,
      `Survival facts: ${survivalDocs.length}`,
      `Utility facts: ${utilityFacts.length}`,
      `Experience history: ${experience.input ? "present" : "absent"}`,
    ],
    performance: performanceSummary,
    survival: survivalSummary,
    utility: utilitySummary,
    experience: experienceSummary,
    confirmations: [
      "No CharacterPublishedScore write",
      "No Scoring V2 feature flag enabled",
      "No refresh job enqueued",
      "No cohort executed",
      "Live provider calls bounded to one character / ≤16 selected slots",
    ],
  });

  await writeFile(join(outputDir, "summary.md"), summaryMd, "utf8");
  await writeJson(join(outputDir, "summary.json"), summaryJson);
  await writeJson(join(outputDir, "evidence-manifest.json"), manifest);
  await writeJson(join(outputDir, "selected-slots.json"), {
    slots: slotSummaries,
    missingDungeonSlots,
  });
  await writeJson(join(outputDir, "dataset-coverage.json"), { rows: datasetCoverage });
  await writeJson(join(outputDir, "performance-input.json"), {
    ...performanceInput,
    // Avoid dumping huge policy internals twice; keep calculator-shaped input.
  });
  await writeJson(join(outputDir, "performance-result.json"), performanceResult ?? {
    state: "UNAVAILABLE",
    missingFields: performanceMissing,
    failureReasons: performanceFailures,
  });
  await writeJson(join(outputDir, "survival-input.json"), {
    manifestContentHash: manifest.contentHash,
    factCount: survivalDocs.length,
    factSets: survivalDocs,
    relativeDamageMode: "off",
  });
  await writeJson(join(outputDir, "survival-result.json"), survivalResult ?? {
    state: "UNAVAILABLE",
    missingFields: survivalMissing,
    failureReasons: survivalFailures,
  });
  await writeJson(join(outputDir, "utility-input.json"), {
    manifest: utilityInput.manifest,
    factCount: utilityFacts.length,
    factSets: utilityFacts,
  });
  await writeJson(join(outputDir, "utility-result.json"), utilityResult ?? {
    availabilityState: "UNAVAILABLE",
    missingFields: utilityMissing,
    failureReasons: utilityFailures,
  });
  await writeJson(join(outputDir, "experience-input.json"), experience.input);
  await writeJson(join(outputDir, "experience-result.json"), experience.result ?? {
    state: "UNAVAILABLE",
    missingFields: experience.missingFields,
    failureReasons: experience.failureReasons,
    limitations: experience.limitations,
    sourceStatuses: experience.sourceStatuses,
  });

  return { outputDir, overallVerdict };
}
