/**
 * Manual Warcraft Logs live smoke + optional --deep diagnostic.
 *
 * Usage:
 *   pnpm wcl:smoke -- --region EU --realm archimonde --name Wallidrixe
 *   pnpm wcl:smoke -- --region EU --realm archimonde --name Wallidrixe --deep
 *
 * Requires ALLOW_LIVE_PROVIDER_CALLS=true. Never invoked by CI.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CharacterIdentityInput, ProviderFetchContext } from "@mplus/contracts";
import { LiveWarcraftLogsProvider } from "./live/live-provider.js";
import { OPERATIONS } from "./operations/queries.js";
import { DETAILED_EVENT_TYPES } from "./operations/queries.js";
import { shouldQueryZoneRankings } from "./discovery/mplus-zone.js";
import {
  DEFAULT_MATCHING_CONFIG,
  isAcceptedWclMatchForAnalysis,
  isDungeonSlugUnknown,
  matchRunCandidate,
} from "./discovery/run-matching.js";
import { mapRegionToWcl } from "./discovery/run-discovery.js";
import {
  assertWorkerWclPath,
  rejectionReasonFromMatch,
  reportCodeFingerprint,
  sanitizeReportRef,
} from "./smoke/sanitize.js";
import {
  buildEightRunRawFactRows,
  buildScoringDataFoundationSnapshot,
  type EightRunCombatAnalysis,
} from "./smoke/eight-run-facts.js";
import type { ExternalRunMatchInput, RunMatchResult, WclRunCandidate } from "./types.js";
import {
  MIDNIGHT_S1_SEASON,
  resolveSeasonDungeonSet,
} from "@mplus/mechanics";
import { selectScoringRuns, type SelectableScoringRun } from "@mplus/scoring";
function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseArgs(argv: string[]): {
  region: string;
  realm: string;
  name: string;
  deep: boolean;
} {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "deep") {
      flags.deep = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    flags[key] = next;
    i += 1;
  }

  const region = String(flags.region ?? "").trim().toUpperCase();
  const realm = String(flags.realm ?? "").trim().toLowerCase();
  const name = String(flags.name ?? "").trim();
  if (!region || !realm || !name) {
    throw new Error(
      "Usage: --region <EU|US|KR|TW> --realm <slug> --name <exact-name> [--deep]",
    );
  }
  if (!["EU", "US", "KR", "TW"].includes(region)) {
    throw new Error(`Unsupported region "${region}"`);
  }
  return { region, realm, name, deep: Boolean(flags.deep) };
}

function print(label: string, payload: unknown): void {
  console.log(label);
  console.log(JSON.stringify(payload, null, 2));
}

function buildCtx(identity: CharacterIdentityInput): ProviderFetchContext {
  return {
    region: identity.region,
    requestId: `wcl-smoke-${Date.now()}`,
    correlationId: null,
    forceRefresh: true,
    now: new Date().toISOString(),
    targetCharacter: identity,
  };
}

async function fetchBlizzardSelectedRuns(
  identity: CharacterIdentityInput,
): Promise<ExternalRunMatchInput[]> {
  const clientId = process.env.BLIZZARD_CLIENT_ID ?? "";
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) return [];

  const region = String(identity.region).toLowerCase();
  const tokenRes = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) return [];
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenJson.access_token;
  if (!accessToken) return [];

  const locale = process.env.BLIZZARD_DEFAULT_LOCALE ?? "en_GB";
  const indexUrl = new URL(
    `https://${region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(identity.realmSlug)}/${encodeURIComponent(identity.name.toLowerCase())}/mythic-keystone-profile`,
  );
  indexUrl.searchParams.set("namespace", `profile-${region}`);
  indexUrl.searchParams.set("locale", locale);
  const indexRes = await fetch(indexUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!indexRes.ok) return [];
  const indexBody = (await indexRes.json()) as {
    current_period?: { id?: number };
    seasons?: Array<{ id: number }>;
  };
  // seasons[0] is typically the current season; never use the oldest entry.
  const seasonId = indexBody.seasons?.[0]?.id ?? null;
  if (seasonId == null) return [];

  const seasonUrl = new URL(
    `https://${region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(identity.realmSlug)}/${encodeURIComponent(identity.name.toLowerCase())}/mythic-keystone-profile/season/${seasonId}`,
  );
  seasonUrl.searchParams.set("namespace", `profile-${region}`);
  seasonUrl.searchParams.set("locale", locale);
  const seasonRes = await fetch(seasonUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!seasonRes.ok) return [];
  const seasonBody = (await seasonRes.json()) as {
    best_runs?: Array<{
      dungeon?: { name?: string };
      keystone_level?: number;
      completed_timestamp?: number;
      duration?: number;
      members?: Array<{
        character?: { name?: string; realm?: { slug?: string } };
      }>;
    }>;
  };

  const slugify = (value: string) =>
    value
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("en-US")
      .replace(/['']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  return (seasonBody.best_runs ?? [])
    .filter((run) => run.completed_timestamp != null && run.keystone_level != null)
    .slice(0, 8)
    .map((run) => ({
      dungeonSlug: slugify(run.dungeon?.name ?? "unknown"),
      keyLevel: run.keystone_level!,
      completedAt: new Date(run.completed_timestamp!).toISOString(),
      durationMs: run.duration ?? 0,
      participants: (run.members ?? []).map((m) => ({
        realmSlug: (m.character?.realm?.slug ?? identity.realmSlug).toLowerCase(),
        name: m.character?.name ?? "unknown",
      })),
    }));
}

type RaiderIoRunHint = ExternalRunMatchInput & {
  score: number | null;
  timed: boolean | null;
};

async function fetchRaiderIoRunHints(
  identity: CharacterIdentityInput,
): Promise<RaiderIoRunHint[]> {
  const region = String(identity.region).toLowerCase();
  const url = new URL("https://raider.io/api/v1/characters/profile");
  url.searchParams.set("region", region);
  url.searchParams.set("realm", identity.realmSlug);
  url.searchParams.set("name", identity.name);
  url.searchParams.set("fields", "mythic_plus_recent_runs,mythic_plus_best_runs");
  const headers: Record<string, string> = {};
  if (process.env.RAIDERIO_APP_KEY) {
    headers["X-Raider-Api-Key"] = process.env.RAIDERIO_APP_KEY;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    mythic_plus_recent_runs?: Array<{
      dungeon?: string;
      short_name?: string;
      mythic_level?: number;
      completed_at?: string;
      clear_time_ms?: number;
      score?: number;
      num_keystone_upgrades?: number;
    }>;
    mythic_plus_best_runs?: Array<{
      dungeon?: string;
      short_name?: string;
      mythic_level?: number;
      completed_at?: string;
      clear_time_ms?: number;
      score?: number;
      num_keystone_upgrades?: number;
    }>;
  };

  const slugify = (value: string) =>
    value
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("en-US")
      .replace(/['']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const rows = [...(body.mythic_plus_recent_runs ?? []), ...(body.mythic_plus_best_runs ?? [])];
  const seen = new Set<string>();
  const out: RaiderIoRunHint[] = [];
  for (const run of rows) {
    if (!run.completed_at || run.mythic_level == null) continue;
    const dungeonSlug = slugify(run.dungeon ?? run.short_name ?? "unknown");
    const key = `${dungeonSlug}|${run.mythic_level}|${run.completed_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      dungeonSlug,
      keyLevel: run.mythic_level,
      completedAt: new Date(run.completed_at).toISOString(),
      durationMs: run.clear_time_ms ?? 0,
      participants: [{ realmSlug: identity.realmSlug, name: identity.name }],
      score: typeof run.score === "number" ? run.score : null,
      timed:
        typeof run.num_keystone_upgrades === "number" ? run.num_keystone_upgrades > 0 : null,
    });
    if (out.length >= 24) break;
  }
  return out;
}

/** Keep only runs inside the active scoring window (exclude historical seasons). */
function filterActiveExternalRuns<T extends ExternalRunMatchInput>(
  runs: T[],
  nowMs = Date.now(),
  maxAgeMs = 180 * 24 * 60 * 60 * 1000,
): T[] {
  return runs.filter((run) => {
    const completedMs = Date.parse(run.completedAt);
    if (Number.isNaN(completedMs)) return false;
    return nowMs - completedMs <= maxAgeMs;
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function probeRankingsDiagnostics(
  provider: LiveWarcraftLogsProvider,
  identity: CharacterIdentityInput,
  zoneId: number,
  queried: boolean,
): Promise<{
  zoneRankingsQueried: boolean;
  rawRankingRowCount: number;
  totalParsesSum: number | null;
  graphqlErrors: string[];
  payloadKind: string | null;
  payloadTopKeys: string[] | null;
  firstRankingKeys: string[] | null;
  firstRankingNestedKeys: Record<string, string[] | string> | null;
  hasReportFightFields: boolean | null;
}> {
  if (!queried) {
    return {
      zoneRankingsQueried: false,
      rawRankingRowCount: 0,
      totalParsesSum: null,
      graphqlErrors: [],
      payloadKind: null,
      payloadTopKeys: null,
      firstRankingKeys: null,
      firstRankingNestedKeys: null,
      hasReportFightFields: null,
    };
  }
  const client = provider.getGraphQlClient();
  try {
    const result = await client.request({
      operationName: OPERATIONS.CharacterZoneRankings.operationName,
      query: OPERATIONS.CharacterZoneRankings.query,
      variables: {
        name: identity.name,
        serverSlug: identity.realmSlug,
        serverRegion: mapRegionToWcl(identity.region),
        zoneID: zoneId,
      },
      region: identity.region,
    });
    let zoneRankings = (
      result.response.data as {
        characterData?: {
          character?: {
            zoneRankings?: unknown;
          } | null;
        };
      }
    )?.characterData?.character?.zoneRankings;

    if (typeof zoneRankings === "string") {
      try {
        zoneRankings = JSON.parse(zoneRankings) as unknown;
      } catch {
        /* keep string */
      }
    }

    const payloadKind =
      zoneRankings == null
        ? "null"
        : Array.isArray(zoneRankings)
          ? "array"
          : typeof zoneRankings;
    const payloadTopKeys =
      zoneRankings && typeof zoneRankings === "object" && !Array.isArray(zoneRankings)
        ? Object.keys(zoneRankings as object).slice(0, 20)
        : null;
    const asObj = zoneRankings as {
      totalParses?: number | null;
      rankings?: unknown;
    } | null;
    const rankings = Array.isArray(asObj?.rankings)
      ? asObj!.rankings
      : Array.isArray(zoneRankings)
        ? zoneRankings
        : [];
    const first = rankings[0];
    const firstRankingKeys =
      first && typeof first === "object" ? Object.keys(first as object).slice(0, 30) : null;
    const firstRankingNestedKeys: Record<string, string[] | string> = {};
    if (first && typeof first === "object") {
      for (const [key, value] of Object.entries(first as Record<string, unknown>).slice(0, 20)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          firstRankingNestedKeys[key] = Object.keys(value as object).slice(0, 20);
        } else if (Array.isArray(value)) {
          firstRankingNestedKeys[key] = `array(${value.length})`;
        } else {
          firstRankingNestedKeys[key] = typeof value;
        }
      }
    }

    return {
      zoneRankingsQueried: true,
      rawRankingRowCount: rankings.length,
      totalParsesSum: typeof asObj?.totalParses === "number" ? asObj.totalParses : null,
      graphqlErrors: (result.response.errors ?? []).map((e) => e.message),
      payloadKind,
      payloadTopKeys,
      firstRankingKeys,
      firstRankingNestedKeys,
      hasReportFightFields: Boolean(
        first &&
          typeof first === "object" &&
          (("report" in (first as object) && "fightID" in (first as object)) ||
            ("fightId" in (first as object) && "reportCode" in (first as object))),
      ),
    };
  } catch (error) {
    return {
      zoneRankingsQueried: true,
      rawRankingRowCount: 0,
      totalParsesSum: null,
      graphqlErrors: [errorMessage(error)],
      payloadKind: null,
      payloadTopKeys: null,
      firstRankingKeys: null,
      firstRankingNestedKeys: null,
      hasReportFightFields: null,
    };
  }
}

async function probeRecentReportsList(
  provider: LiveWarcraftLogsProvider,
  identity: CharacterIdentityInput,
): Promise<{
  total: number | null;
  codes: string[];
  graphqlErrors: string[];
}> {
  const client = provider.getGraphQlClient();
  try {
    const result = await client.request({
      operationName: OPERATIONS.CharacterRecentReports.operationName,
      query: OPERATIONS.CharacterRecentReports.query,
      variables: {
        name: identity.name,
        serverSlug: identity.realmSlug,
        serverRegion: mapRegionToWcl(identity.region),
        limit: 10,
        page: 1,
      },
      region: identity.region,
    });
    const page = (
      result.response.data as {
        characterData?: {
          character?: {
            recentReports?: {
              total?: number | null;
              data?: Array<{ code?: string; visibility?: string }>;
            } | null;
          } | null;
        };
      }
    )?.characterData?.character?.recentReports;
    const codes = (page?.data ?? [])
      .filter((r) => r.code && (r.visibility ?? "public").toLowerCase() === "public")
      .map((r) => r.code!)
      .slice(0, 5);
    return {
      total: typeof page?.total === "number" ? page.total : null,
      codes,
      graphqlErrors: (result.response.errors ?? []).map((e) => e.message),
    };
  } catch (error) {
    return { total: null, codes: [], graphqlErrors: [errorMessage(error)] };
  }
}

async function probeRecentReportDetails(
  provider: LiveWarcraftLogsProvider,
  identity: CharacterIdentityInput,
  reportCodes: string[],
): Promise<
  Array<{
    report: ReturnType<typeof sanitizeReportRef>;
    startTimeMs: number | null;
    endTimeMs: number | null;
    fightCount: number;
    targetAppearsInMasterData: boolean | null;
    targetAppearsInRankedOrFriendly: boolean | null;
    graphqlErrors: string[];
  }>
> {
  const client = provider.getGraphQlClient();
  const out = [];
  for (const code of reportCodes.slice(0, 3)) {
    try {
      const result = await client.request({
        operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
        query: OPERATIONS.ReportWithFightAndMasterData.query,
        variables: { code },
        region: identity.region,
      });
      const report = (result.response.data as {
        reportData?: {
          report?: {
            startTime?: number;
            endTime?: number;
            fights?: Array<{
              id: number;
              friendlyPlayers?: Array<number | { name?: string; server?: string; id?: number }>;
            }>;
            masterData?: {
              actors?: Array<{
                id?: number;
                name?: string;
                server?: string | null;
                type?: string;
              }>;
            };
          } | null;
        };
      })?.reportData?.report;

      const actors = report?.masterData?.actors ?? [];
      const targetName = identity.name.toLowerCase();
      const targetRealm = identity.realmSlug.toLowerCase();
      const nameMatches = (name: string | undefined, server: string | null | undefined) =>
        (name ?? "").toLowerCase() === targetName &&
        ((server ?? "").toLowerCase() === targetRealm || !server);
      const inMaster = actors.some((a) => a.type === "Player" && nameMatches(a.name, a.server));
      const actorsById = new Map(actors.filter((a) => a.id != null).map((a) => [a.id!, a]));
      const inFriendly = (report?.fights ?? []).some((f) =>
        (f.friendlyPlayers ?? []).some((p) => {
          if (typeof p === "number") {
            const actor = actorsById.get(p);
            return nameMatches(actor?.name, actor?.server);
          }
          return nameMatches(p.name, p.server);
        }),
      );

      out.push({
        report: sanitizeReportRef(code),
        startTimeMs: report?.startTime ?? null,
        endTimeMs: report?.endTime ?? null,
        fightCount: report?.fights?.length ?? 0,
        targetAppearsInMasterData: report ? inMaster : null,
        targetAppearsInRankedOrFriendly: report ? inMaster || inFriendly : null,
        graphqlErrors: (result.response.errors ?? []).map((e) => e.message),
      });
    } catch (error) {
      out.push({
        report: sanitizeReportRef(code),
        startTimeMs: null,
        endTimeMs: null,
        fightCount: 0,
        targetAppearsInMasterData: null,
        targetAppearsInRankedOrFriendly: null,
        graphqlErrors: [errorMessage(error)],
      });
    }
  }
  return out;
}

function bestCandidateForExternal(
  external: ExternalRunMatchInput,
  candidates: WclRunCandidate[],
): {
  candidate: WclRunCandidate | null;
  confidence: string;
  evidence: RunMatchResult["evidence"] | null;
  rejectionReason: string | null;
  acceptedForAnalysis: boolean;
  match: RunMatchResult | null;
} {
  let best: RunMatchResult | null = null;
  let bestCandidate: WclRunCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.incompleteness.fightUnknown) continue;
    // Empty dungeon slugs are unknown — they must not win known-dungeon matching.
    if (isDungeonSlugUnknown(candidate.dungeonSlug)) {
      candidate.incompleteness.dungeonUnknown = true;
    }
    const match = matchRunCandidate(candidate, external, [], DEFAULT_MATCHING_CONFIG);
    if (
      !best ||
      ["NONE", "LOW", "MEDIUM", "HIGH"].indexOf(match.confidence) >
        ["NONE", "LOW", "MEDIUM", "HIGH"].indexOf(best.confidence)
    ) {
      best = match;
      bestCandidate = candidate;
    } else if (
      best &&
      match.confidence === best.confidence &&
      isAcceptedWclMatchForAnalysis(match) &&
      !isAcceptedWclMatchForAnalysis(best)
    ) {
      best = match;
      bestCandidate = candidate;
    } else if (
      best &&
      match.confidence === best.confidence &&
      isAcceptedWclMatchForAnalysis(match) &&
      isAcceptedWclMatchForAnalysis(best)
    ) {
      const bestTime = best.evidence.timeDeltaMs ?? Number.POSITIVE_INFINITY;
      const nextTime = match.evidence.timeDeltaMs ?? Number.POSITIVE_INFINITY;
      if (nextTime < bestTime) {
        best = match;
        bestCandidate = candidate;
      }
    }
  }
  if (!best || !bestCandidate) {
    return {
      candidate: null,
      confidence: "NONE",
      evidence: null,
      rejectionReason: "no_wcl_candidate_with_known_fight",
      acceptedForAnalysis: false,
      match: null,
    };
  }
  const acceptedForAnalysis = isAcceptedWclMatchForAnalysis(best);
  return {
    candidate: bestCandidate,
    confidence: best.confidence,
    evidence: best.evidence,
    acceptedForAnalysis,
    match: best,
    rejectionReason: rejectionReasonFromMatch({
      confidence: best.confidence,
      evidence: best.evidence,
      autoMergeAllowed: best.autoMergeAllowed,
      timeToleranceMs: DEFAULT_MATCHING_CONFIG.timeToleranceMs,
      durationToleranceMs: DEFAULT_MATCHING_CONFIG.durationToleranceMs,
      acceptedForAnalysis,
    }),
  };
}

type PrismaSmokeClient = {
  region: { findUnique: (args: unknown) => Promise<{ id: string } | null> };
  realm: { findUnique: (args: unknown) => Promise<{ id: string } | null> };
  character: { findUnique: (args: unknown) => Promise<{ id: string } | null> };
  characterProviderState: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  mythicRun: {
    findMany: (args: unknown) => Promise<Array<{ canonicalFingerprint: string }>>;
  };
  runSourceReference: {
    count: (args: unknown) => Promise<number>;
  };
  metricObservation: {
    findMany: (args: unknown) => Promise<
      Array<{
        sourceProvider: string;
        confidence: string | null;
        metricDefinition?: { key: string } | null;
        metricKey?: string;
      }>
    >;
  };
  $disconnect: () => Promise<void>;
};

async function loadCreatePrismaClient(): Promise<(url?: string) => PrismaSmokeClient> {
  try {
    const mod = (await import("@mplus/database")) as {
      createPrismaClient: (url?: string) => PrismaSmokeClient;
    };
    return mod.createPrismaClient;
  } catch {
    /* fall through */
  }

  const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const distEntry = resolvePath(root, "packages/database/dist/index.js");
  const srcEntry = resolvePath(root, "packages/database/src/index.ts");

  if (existsSync(distEntry)) {
    const requireFromDb = createRequire(resolvePath(root, "packages/database/package.json"));
    const mod = requireFromDb("./dist/index.js") as {
      createPrismaClient: (url?: string) => PrismaSmokeClient;
    };
    return mod.createPrismaClient;
  }

  if (existsSync(srcEntry)) {
    const mod = (await import(pathToFileURL(srcEntry).href)) as {
      createPrismaClient: (url?: string) => PrismaSmokeClient;
    };
    return mod.createPrismaClient;
  }

  throw new Error(
    "Cannot load @mplus/database — build packages/database or ensure src/index.ts is available",
  );
}

async function readPersistenceDiagnostics(identity: CharacterIdentityInput): Promise<unknown> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { available: false, reason: "DATABASE_URL unset" };
  }
  try {
    const createPrismaClient = await loadCreatePrismaClient();
    const prisma = createPrismaClient(databaseUrl);
    try {
      const region = await prisma.region.findUnique({ where: { code: identity.region } });
      if (!region) return { available: true, characterFound: false };
      const realm = await prisma.realm.findUnique({
        where: { regionId_slug: { regionId: region.id, slug: identity.realmSlug } },
      });
      if (!realm) return { available: true, characterFound: false };
      const character = await prisma.character.findUnique({
        where: {
          regionId_realmId_normalizedName: {
            regionId: region.id,
            realmId: realm.id,
            normalizedName: identity.name.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
          },
        },
      });
      if (!character) return { available: true, characterFound: false };

      const [providerState, observations, canonicalRuns, providerSourceReferenceCount] =
        await Promise.all([
        prisma.characterProviderState.findUnique({
          where: {
            characterId_provider: { characterId: character.id, provider: "WARCRAFT_LOGS" },
          },
        }),
        prisma.metricObservation.findMany({
          where: { characterId: character.id },
          orderBy: { observedAt: "desc" },
          take: 50,
          select: {
            sourceProvider: true,
            confidence: true,
            metricDefinition: { select: { key: true } },
          },
        }),
        prisma.mythicRun.findMany({
          where: {
            participants: {
              some: { characterId: character.id, isTargetCharacter: true },
            },
          },
          select: { canonicalFingerprint: true },
          distinct: ["canonicalFingerprint"],
        }),
        prisma.runSourceReference.count({
          where: {
            run: {
              participants: {
                some: { characterId: character.id, isTargetCharacter: true },
              },
            },
          },
        }),
      ]);

      const wclObservations = observations.filter((o) => o.sourceProvider === "WARCRAFT_LOGS");
      const excludedRaw = providerState?.excludedObservations;
      const excludedReasons = Array.isArray(excludedRaw)
        ? (excludedRaw as Array<{ reason?: string }>).map((e) => e.reason ?? "unknown")
        : [];
      const metricKeys = observations.map(
        (o) => o.metricDefinition?.key ?? o.metricKey ?? "unknown",
      );
      const wclMetricKeys = wclObservations.map(
        (o) => o.metricDefinition?.key ?? o.metricKey ?? "unknown",
      );
      const uniqueCanonicalFingerprintCount = canonicalRuns.length;

      return {
        available: true,
        characterFound: true,
        characterIdFingerprint: createHash("sha256")
          .update(character.id, "utf8")
          .digest("hex")
          .slice(0, 12),
        providerState: providerState
          ? {
              state: providerState.state,
              wclVisibility: providerState.wclVisibility,
              detail: providerState.detail,
              lastSuccessAt:
                providerState.lastSuccessAt instanceof Date
                  ? providerState.lastSuccessAt.toISOString()
                  : (providerState.lastSuccessAt ?? null),
              fetchedAt:
                providerState.fetchedAt instanceof Date
                  ? providerState.fetchedAt.toISOString()
                  : (providerState.fetchedAt ?? null),
              metadata: providerState.metadata,
            }
          : null,
        observationsTotal: observations.length,
        wclObservationsCount: wclObservations.length,
        metricKeysEmitted: [...new Set(metricKeys)],
        wclMetricKeys: [...new Set(wclMetricKeys)],
        excludedObservationReasons: excludedReasons,
        /** seasonSummary.runCount semantics: unique MythicRun fingerprints, not provider records. */
        uniqueCanonicalFingerprintCount,
        providerSourceReferenceCount,
        matchedPairCount:
          typeof (providerState?.metadata as { matchedPairCount?: unknown } | null)?.matchedPairCount ===
          "number"
            ? (providerState?.metadata as { matchedPairCount: number }).matchedPairCount
            : null,
        mergedCanonicalRunCount:
          typeof (providerState?.metadata as { mergedCanonicalRunCount?: unknown } | null)
            ?.mergedCanonicalRunCount === "number"
            ? (providerState?.metadata as { mergedCanonicalRunCount: number }).mergedCanonicalRunCount
            : uniqueCanonicalFingerprintCount,
        unresolvedCrossProviderMatches:
          typeof (providerState?.metadata as { unresolvedCrossProviderMatches?: unknown } | null)
            ?.unresolvedCrossProviderMatches === "number"
            ? (providerState?.metadata as { unresolvedCrossProviderMatches: number })
                .unresolvedCrossProviderMatches
            : null,
        runCountSemantics:
          "uniqueCanonicalFingerprintCount === seasonSummary.runCount; providerSourceReferenceCount may be higher when RIO+WCL share a run",
      };
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    return {
      available: false,
      reason: errorMessage(error),
    };
  }
}

async function runShallow(
  provider: LiveWarcraftLogsProvider,
  identity: CharacterIdentityInput,
  ctx: ProviderFetchContext,
): Promise<void> {
  const summary = await provider.discoverCharacterSummary!(identity, ctx);
  print("wcl.smoke", {
    identity,
    visibility: summary.data.visibility,
    warnings: summary.data.warnings,
  });
  console.log("OK");
}

async function runDeep(
  provider: LiveWarcraftLogsProvider,
  identity: CharacterIdentityInput,
  ctx: ProviderFetchContext,
): Promise<void> {
  const pipelineSource = readFileSync(
    resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../../../apps/worker/src/orchestration/refresh-pipeline.ts",
    ),
    "utf8",
  );
  const missingWorkerCalls = assertWorkerWclPath(pipelineSource);

  const zone = provider.getZoneConfig();
  const zoneQueried = shouldQueryZoneRankings(zone);

  let discovery: Awaited<ReturnType<LiveWarcraftLogsProvider["discoverCharacter"]>>;
  let discoveryError: string | null = null;
  try {
    discovery = await provider.discoverCharacter(identity, ctx);
  } catch (error) {
    discoveryError = errorMessage(error);
    const details =
      error && typeof error === "object" && "details" in error
        ? (error as { details?: unknown }).details
        : undefined;
    // Shape-only fingerprint for Zod failures — no report codes / player payloads.
    let shapeHint: unknown = null;
    try {
      const rankingsProbe = await probeRankingsDiagnostics(
        provider,
        identity,
        zone.zoneId,
        zoneQueried,
      );
      shapeHint = {
        rankingsProbe,
        zodDetails: details,
      };
    } catch (probeError) {
      shapeHint = { probeError: errorMessage(probeError), zodDetails: details };
    }
    print("wcl.smoke.deep", {
      identity: {
        region: identity.region,
        realmSlug: identity.realmSlug,
        name: identity.name,
      },
      fatal: { stage: "discoverCharacter", error: discoveryError, shapeHint },
      workerPath: {
        requiredCalls: ["discoverCharacterSummary", "discoverCharacterRuns", "getReportFightDetails"],
        missingFromRefreshPipeline: missingWorkerCalls,
      },
      rankings: {
        configuredZoneId: zone.zoneId,
        zoneRankingsQueried: zoneQueried,
        zoneExpired: zone.expired,
        zoneSource: zone.source,
        zoneWarning: zone.warning,
      },
    });
    process.exit(1);
  }

  const blizzardRuns = filterActiveExternalRuns(await fetchBlizzardSelectedRuns(identity));
  const rioRuns = filterActiveExternalRuns(await fetchRaiderIoRunHints(identity)) as RaiderIoRunHint[];
  const selectedExternals = [...blizzardRuns, ...rioRuns].slice(0, 12);

  const runsResult = await provider.discoverCharacterRuns(identity, {
    ...ctx,
    wclHydrationHints: selectedExternals.map((run) => ({
      completedAt: run.completedAt,
      dungeonSlug: run.dungeonSlug,
      keyLevel: run.keyLevel,
    })),
  });
  const rankingsProbe = await probeRankingsDiagnostics(
    provider,
    identity,
    zone.zoneId,
    zoneQueried,
  );
  const recentList = await probeRecentReportsList(provider, identity);
  const reportCodes = [
    ...new Set([
      ...recentList.codes,
      ...discovery.candidates.filter((c) => c.reportCode).map((c) => c.reportCode),
    ]),
  ].slice(0, 5);
  const recentDetails = await probeRecentReportDetails(provider, identity, reportCodes);

  // Prefer hydrated fight-known candidates for matching (discoverCharacterRuns already hydrated).
  const matchCandidates =
    runsResult.data.length > 0
      ? discovery.candidates
          .filter((c) => !c.incompleteness.fightUnknown)
          .concat(
            // Synthesize matchable candidates from discoverCharacterRuns DTOs when discovery stubs were hydrated.
            runsResult.data.map((run) => {
              const dungeonUnknown =
                run.dungeonSlug === "unknown" || isDungeonSlugUnknown(run.dungeonSlug);
              return {
              reportCode: run.sources[0]?.reportCode ?? run.id,
              fightId: run.sources[0]?.fightId ?? 0,
              encounterId: 0,
              zoneId: null,
              dungeonSlug: dungeonUnknown ? null : run.dungeonSlug,
              seasonSlug: run.seasonSlug === "unknown" ? null : run.seasonSlug,
              keyLevel: run.keyLevel > 0 ? run.keyLevel : null,
              score: run.scoreValue,
              startTimeMs: Date.parse(run.completedAt) - (run.durationMs || 0),
              completedAt: run.completedAt,
              durationMs: run.durationMs,
              timed: run.timed,
              selectionTags: [] as Array<"LATEST" | "HIGHEST">,
              source: "recentReports" as const,
              matchConfidence: null,
              targetActorId: null,
              incompleteness: {
                dungeonUnknown,
                seasonUnknown: run.seasonSlug === "unknown",
                timedUnknown: false,
                keyLevelUnknown: run.keyLevel <= 0,
                rosterIncomplete: true,
                fightUnknown: false,
              },
              warnings: [],
            };
            }),
          )
      : discovery.candidates;

  const matchRows = selectedExternals.map((external, index) => {
    const best = bestCandidateForExternal(external, matchCandidates);
    return {
      selectedRun: {
        sourceHint: index < blizzardRuns.length ? "blizzard" : "raiderio",
        dungeonSlug: external.dungeonSlug,
        keyLevel: external.keyLevel,
        completedAt: external.completedAt,
        durationMs: external.durationMs,
      },
      bestWclCandidate: best.candidate
        ? {
            ...sanitizeReportRef(best.candidate.reportCode),
            fightId: best.candidate.fightId,
            dungeonSlug: best.candidate.dungeonSlug,
            keyLevel: best.candidate.keyLevel,
            completedAt: best.candidate.completedAt,
            fightUnknown: best.candidate.incompleteness.fightUnknown,
            dungeonUnknown: best.candidate.incompleteness.dungeonUnknown,
          }
        : null,
      confidence: best.confidence,
      acceptedForAnalysis: best.acceptedForAnalysis,
      evidence: best.evidence,
      rejectionReason: best.rejectionReason,
    };
  });

  let analysis: unknown = null;
  const analyzableAccepted = matchRows.find((m) => m.acceptedForAnalysis)?.bestWclCandidate;
  const skyreachAccepted = matchRows.find(
    (m) =>
      m.acceptedForAnalysis &&
      m.selectedRun.dungeonSlug === "skyreach" &&
      m.selectedRun.keyLevel === 22,
  )?.bestWclCandidate;
  const analyzableMatch = skyreachAccepted ?? analyzableAccepted;
  const analyzableCandidate =
    matchCandidates.find((c) => !c.incompleteness.fightUnknown && c.fightId > 0) ?? null;

  let reportCode: string | null = null;
  let fightId = 0;
  if (analyzableMatch) {
    fightId = analyzableMatch.fightId;
    reportCode =
      matchCandidates.find(
        (c) =>
          c.fightId === analyzableMatch.fightId &&
          sanitizeReportRef(c.reportCode).fingerprint === analyzableMatch.fingerprint,
      )?.reportCode ?? null;
  } else if (analyzableCandidate) {
    fightId = analyzableCandidate.fightId;
    reportCode = analyzableCandidate.reportCode;
  }

  if (reportCode && fightId > 0) {
    try {
      const details = await provider.fetchReportFightDetails(
        reportCode,
        fightId,
        identity.name,
        identity.realmSlug,
        ctx,
        `smoke-deep-${Date.now()}`,
        false,
      );
      const facts = details.combatFacts;
      const coverageEntries = Object.entries(facts.coverage);
      const querySucceeded = true;
      const actorPresent = typeof facts.targetSourceId === "number" && facts.targetSourceId > 0;
      const eventsReturned =
        facts.casts.length +
          facts.interrupts.length +
          facts.deaths.length +
          facts.damageTaken.length +
          facts.auras.length +
          facts.dispels.length +
          facts.healing.length >
        0;
      const metricExtractable = eventsReturned && actorPresent;
      analysis = {
        report: sanitizeReportRef(reportCode),
        fightId: details.fight.id,
        actorResolved: facts.targetSourceId,
        fightWindow: {
          startTime: details.fight.startTime,
          endTime: details.fight.endTime,
        },
        eventTypesFetched: DETAILED_EVENT_TYPES,
        counts: {
          deaths: facts.deaths.length,
          interrupts: facts.interrupts.length,
          casts: facts.casts.length,
          dispels: facts.dispels.length,
          damageTaken: facts.damageTaken.length,
          auras: facts.auras.length,
          healing: facts.healing.length,
        },
        /** Query HTTP/GraphQL success must not be equated with metric extractability. */
        extractionValidation: {
          querySucceeded,
          actorPresent,
          eventsReturned,
          metricExtractable,
          petAttributedSourceCount: [...facts.actorMap.byId.values()].filter(
            (a) => a.petOwnerId === facts.targetSourceId,
          ).length,
        },
        coverage: facts.coverage,
        coverageRatio:
          coverageEntries.length === 0
            ? 0
            : coverageEntries.filter(([, v]) => v).length / coverageEntries.length,
        limitations: facts.limitations,
      };
    } catch (error) {
      analysis = {
        report: sanitizeReportRef(reportCode),
        fightId,
        error: errorMessage(error),
        extractionValidation: {
          querySucceeded: false,
          actorPresent: false,
          eventsReturned: false,
          metricExtractable: false,
        },
      };
    }
  } else {
    analysis = {
      skipped: true,
      reason: "no_candidate_with_known_fight_id",
      hint:
        "discoverCharacterRuns filters fightUnknown stubs; empty zoneRankings leaves only recentReports stubs and blocks getReportFightDetails.",
    };
  }

  const persistence = await readPersistenceDiagnostics(identity);

  const season = resolveSeasonDungeonSet({
    seasonSlug: process.env.SCORING_SEASON_SLUG ?? MIDNIGHT_S1_SEASON.seasonSlug,
    dungeonSlugs: MIDNIGHT_S1_SEASON.dungeonSlugs,
    expectedDungeonCount: 8,
    source: "configured",
  });

  const selectablePool: SelectableScoringRun[] = [];
  const pushSelectable = (run: {
    dungeonSlug: string;
    keyLevel: number;
    completedAt: string;
    durationMs: number;
    score: number | null;
    timed: boolean | null;
    match: ReturnType<typeof bestCandidateForExternal>;
    idPrefix: string;
  }) => {
    const accepted = run.match.acceptedForAnalysis && run.match.candidate != null;
    const candidate = run.match.candidate;
    selectablePool.push({
      id: `${run.idPrefix}:${run.dungeonSlug}:${run.keyLevel}:${run.completedAt}`,
      dungeonSlug: run.dungeonSlug,
      seasonSlug: season.seasonSlug,
      keyLevel: run.keyLevel,
      timed: run.timed,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      raiderIoScore: run.score,
      wclReportMatched: accepted,
      wclCoverageRatio: null,
      wclReportCode: accepted ? candidate!.reportCode : null,
      wclReportFingerprint: accepted ? reportCodeFingerprint(candidate!.reportCode) : null,
      wclFightId: accepted ? candidate!.fightId : null,
      matchConfidence: (run.match.confidence as SelectableScoringRun["matchConfidence"]) ?? null,
      matchEvidence: run.match.evidence
        ? {
            dungeonMatch: run.match.evidence.dungeonMatch,
            keyLevelMatch: run.match.evidence.keyLevelMatch,
            timeDeltaMs: run.match.evidence.timeDeltaMs,
            durationDeltaMs: run.match.evidence.durationDeltaMs,
            rosterOverlapRatio: run.match.evidence.rosterOverlapRatio,
          }
        : null,
    });
  };

  for (const run of blizzardRuns) {
    const match = bestCandidateForExternal(run, matchCandidates);
    pushSelectable({
      dungeonSlug: run.dungeonSlug,
      keyLevel: run.keyLevel,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      score: null,
      timed: null,
      match,
      idPrefix: "blizzard",
    });
  }
  for (const run of rioRuns) {
    const match = bestCandidateForExternal(run, matchCandidates);
    pushSelectable({
      dungeonSlug: run.dungeonSlug,
      keyLevel: run.keyLevel,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      score: run.score,
      timed: run.timed,
      match,
      idPrefix: "raiderio",
    });
  }

  const scoringSelection = selectScoringRuns({
    season,
    runs: selectablePool,
    observedAt: new Date().toISOString(),
  });

  const eightRunAnalyses: EightRunCombatAnalysis[] = [];
  const truncatedCategoriesObserved: string[] = [];
  let eightRunPointCost: number | null = null;
  let deduplicatedFightFetches = 0;
  const fightDetailsCache = new Map<
    string,
    Awaited<ReturnType<LiveWarcraftLogsProvider["fetchReportFightDetails"]>>
  >();
  const graphQl = provider.getGraphQlClient();
  graphQl.resetRequestCount();
  try {
    const rate = await provider.fetchRateLimit(ctx);
    if (rate && typeof rate === "object" && "pointsSpentThisHour" in rate) {
      eightRunPointCost = Number((rate as { pointsSpentThisHour?: number }).pointsSpentThisHour ?? 0);
    }
  } catch {
    /* optional */
  }
  // Rate-limit probe is not part of scoring-v3 analysis session accounting.
  graphQl.resetRequestCount();

  const selectableById = new Map(selectablePool.map((s) => [s.id, s]));

  for (const selected of scoringSelection.selectedRuns) {
    const fromPool = selectableById.get(selected.canonicalRunId);
    const reportCode = fromPool?.wclReportCode ?? null;
    const fightId = fromPool?.wclFightId ?? null;
    const selectable: SelectableScoringRun = {
      id: selected.canonicalRunId,
      dungeonSlug: selected.dungeonSlug,
      seasonSlug: season.seasonSlug,
      keyLevel: selected.keyLevel,
      timed: selected.timed,
      completedAt: selected.completedAt,
      durationMs: selected.durationMs,
      raiderIoScore: selected.raiderIoScore,
      wclReportMatched: selected.wclReportMatched,
      wclCoverageRatio: selected.wclCoverageRatio,
      wclReportCode: reportCode,
      wclReportFingerprint: selected.wclReportFingerprint,
      wclFightId: fightId,
      matchConfidence: selected.matchConfidence,
      matchEvidence: selected.matchEvidence,
    };

    if (!selected.wclReportMatched || !reportCode || !fightId || fightId <= 0) {
      eightRunAnalyses.push({
        selectable,
        reportCode: null,
        fightId: null,
        combatFacts: null,
        parsePercentile: null,
        apiPointCost: null,
        analysisError: selected.rejectionReasons[0] ?? "wcl_detail_unavailable_on_highest_run",
        classSlug: "warlock",
        specSlug: "demonology",
        region: identity.region,
      });
      continue;
    }

    const cacheKey = `${reportCode}:${fightId}`;
    try {
      let details = fightDetailsCache.get(cacheKey);
      if (details) {
        deduplicatedFightFetches += 1;
      } else {
        details = await provider.fetchReportFightDetails(
          reportCode,
          fightId,
          identity.name,
          identity.realmSlug,
          ctx,
          `smoke-v3-${selected.dungeonSlug}-${Date.now()}`,
          true,
        );
        fightDetailsCache.set(cacheKey, details);
      }
      truncatedCategoriesObserved.push(...details.combatFacts.limitations.truncatedPages);
      const ranking = discovery.rankings.find(
        (r) =>
          r.reportCode === reportCode &&
          r.fightId === fightId &&
          typeof r.percentile === "number",
      );
      eightRunAnalyses.push({
        selectable,
        reportCode,
        fightId,
        combatFacts: details.combatFacts,
        parsePercentile: ranking?.percentile ?? null,
        apiPointCost: null,
        analysisError: null,
        classSlug: "warlock",
        specSlug: "demonology",
        region: identity.region,
      });
    } catch (error) {
      eightRunAnalyses.push({
        selectable,
        reportCode,
        fightId,
        combatFacts: null,
        parsePercentile: null,
        apiPointCost: null,
        analysisError: errorMessage(error),
        classSlug: "warlock",
        specSlug: "demonology",
        region: identity.region,
      });
    }
  }

  const wclApiCallCount = graphQl.getRequestCount();
  const wclApiCallsByOperation = graphQl.getRequestCountsByOperation();

  const eightRunRows = buildEightRunRawFactRows({
    selection: scoringSelection,
    analyses: eightRunAnalyses,
  });
  const scoringV3Foundation = buildScoringDataFoundationSnapshot({
    selection: scoringSelection,
    rows: eightRunRows,
    providerPointCost: eightRunPointCost,
    truncatedCategoriesObserved: [...new Set(truncatedCategoriesObserved)],
  });
  const selectedRunCount = scoringSelection.selectedRuns.length;
  const acceptedMatchedSelectedRunCount = scoringSelection.selectedRuns.filter(
    (r) => r.wclReportMatched,
  ).length;
  const analyzedFightCount = eightRunRows.filter((r) => r.detailAvailable).length;
  const missingCombatFactCount = eightRunRows.filter((r) => !r.detailAvailable).length;

  const skyreachExtraction = (() => {
    const row = scoringV3Foundation.rows.find((r) => r.dungeonSlug === "skyreach");
    const analysisRow = eightRunAnalyses.find((a) => a.selectable.dungeonSlug === "skyreach");
    if (!row || !analysisRow) return null;
    const facts = analysisRow.combatFacts;
    return {
      dungeonSlug: "skyreach",
      keyLevel: row.keyLevel,
      wclReportFingerprint: row.wclReportFingerprint,
      wclFightId: row.wclFightId,
      detailAvailable: row.detailAvailable,
      extractionValidation: facts
        ? {
            querySucceeded: true,
            actorPresent: facts.targetSourceId > 0,
            eventsReturned:
              facts.casts.length + facts.damageTaken.length + facts.deaths.length > 0,
            metricExtractable:
              facts.targetSourceId > 0 &&
              (facts.casts.length > 0 || facts.damageTaken.length > 0),
            castCount: facts.casts.length,
            damageTakenCount: facts.damageTaken.length,
            petAttributedSourceCount: [...facts.actorMap.byId.values()].filter(
              (a) => a.petOwnerId === facts.targetSourceId,
            ).length,
          }
        : {
            querySucceeded: false,
            actorPresent: false,
            eventsReturned: false,
            metricExtractable: false,
            reason: analysisRow.analysisError,
          },
    };
  })();

  print("wcl.smoke.deep", {
    identity: {
      region: identity.region,
      realmSlug: identity.realmSlug,
      name: identity.name,
    },
    workerPath: {
      requiredCalls: ["discoverCharacterSummary", "discoverCharacterRuns", "getReportFightDetails"],
      missingFromRefreshPipeline: missingWorkerCalls,
      note:
        "Worker enrichWarcraftLogs runs after Blizzard/Raider.IO, passes hydration hints, then discoverCharacterRuns hydrates fightUnknown stubs before filtering.",
    },
    characterDiscovery: {
      characterId: discovery.summary.wclCharacterId,
      canonicalId: discovery.summary.canonicalId,
      hidden: discovery.summary.hidden,
      visibility: discovery.summary.visibility,
      warnings: discovery.summary.warnings,
      wclServerRegion: mapRegionToWcl(identity.region),
    },
    rankings: {
      configuredZoneId: zone.zoneId,
      zoneExpired: zone.expired,
      zoneSource: zone.source,
      zoneRankingsQueried: rankingsProbe.zoneRankingsQueried,
      rawRankingRowCount: rankingsProbe.rawRankingRowCount,
      totalParses: rankingsProbe.totalParsesSum,
      rankingObservationCount: discovery.rankings.length,
      graphqlErrors: rankingsProbe.graphqlErrors,
      zoneWarning: zone.warning,
    },
    recentReports: {
      total: recentList.total,
      listGraphqlErrors: recentList.graphqlErrors,
      candidateStubCount: discovery.candidates.filter((c) => c.source === "recentReports").length,
      probedReports: recentDetails,
      note: "recentReports stubs are hydrated (bounded) before discoverCharacterRuns filtering; probed rows show masterData target presence.",
    },
    normalizedCandidates: {
      total: matchCandidates.length,
      withKnownFight: matchCandidates.filter((c) => !c.incompleteness.fightUnknown).length,
      returnedByDiscoverCharacterRuns: runsResult.data.length,
      candidatesTruncated: discovery.candidatesTruncated,
      privateReportsSkipped: discovery.privateReportsSkipped,
      sample: matchCandidates.slice(0, 12).map((c) => ({
        ...sanitizeReportRef(c.reportCode),
        fightId: c.fightId,
        dungeonSlug: c.dungeonSlug,
        keyLevel: c.keyLevel,
        completedAt: c.completedAt,
        startTimeMs: c.startTimeMs,
        targetActorId: c.targetActorId ?? null,
        source: c.source,
        fightUnknown: c.incompleteness.fightUnknown,
        dungeonUnknown: c.incompleteness.dungeonUnknown,
        warnings: c.warnings.slice(0, 3),
      })),
      note: "Fight-known candidates come from zoneRankings Parses rows and/or bounded recentReports hydration.",
    },
    matching: {
      externalRunCount: selectedExternals.length,
      blizzardRunCount: blizzardRuns.length,
      raiderIoRunCount: rioRuns.length,
      rows: matchRows,
    },
    detailedAnalysis: analysis,
    scoringV3Foundation: {
      seasonSlug: scoringV3Foundation.seasonSlug,
      expectedDungeonCount: scoringV3Foundation.expectedDungeonCount,
      selectedRunCount,
      acceptedMatchedSelectedRunCount,
      analyzedFightCount,
      missingCombatFactCount,
      wclApiCallCount,
      wclApiCallsByOperation,
      deduplicatedFightFetches,
      selectionConfidence: scoringV3Foundation.selection.selectionConfidence,
      missingDungeonSlugs: scoringV3Foundation.selection.missingDungeonSlugs,
      aggregateCoverage: scoringV3Foundation.aggregateCoverage,
      providerPointCost: scoringV3Foundation.providerPointCost,
      pagination: scoringV3Foundation.pagination,
      formulaVersion: scoringV3Foundation.formulaVersion,
      abilityCatalogVersion: scoringV3Foundation.abilityCatalogVersion,
      mechanicCatalogVersion: scoringV3Foundation.mechanicCatalogVersion,
      skyreachExtraction,
      rows: scoringV3Foundation.rows.map((row) => {
        const selected = scoringSelection.selectedRuns.find(
          (s) => s.dungeonSlug === row.dungeonSlug,
        );
        return {
        dungeonSlug: row.dungeonSlug,
        canonicalRunFingerprint: row.canonicalRunFingerprint,
        keyLevel: row.keyLevel,
        durationMs: row.durationMs,
        timed: row.timed,
        selectionReason: row.selectionReason,
        wclReportFingerprint: row.wclReportFingerprint ?? selected?.wclReportFingerprint ?? null,
        wclFightId: row.wclFightId ?? selected?.wclFightId ?? null,
        detailAvailable: row.detailAvailable,
        combatCoverageState: row.detailAvailable
          ? "AVAILABLE"
          : (selected?.combatCoverageState ?? "UNAVAILABLE"),
        matchConfidence: selected?.matchConfidence ?? null,
        matchEvidence: selected?.matchEvidence ?? null,
        rejectionReasons: row.rejectionReasons,
        missingDataReasons: row.missingDataReasons,
        parsePercentile: row.performance.parsePercentile,
        keyDifficultyInputs: row.performance.keyDifficultyInputs,
        deaths: row.survival.deaths,
        totalDamageTaken: row.survival.totalDamageTaken,
        avoidableDamageTaken: row.survival.avoidableDamageTaken,
        maxHealth: row.survival.maxHealth,
        personalDefensiveCasts: row.survival.personalDefensiveCasts,
        selfHealEffective: row.survival.selfHealEffective,
        selfHealOverheal: row.survival.selfHealOverheal,
        healthPotionCasts: row.survival.healthPotionCasts,
        kickCasts: row.utility.kickCasts,
        successfulInterrupts: row.utility.successfulInterrupts,
        effectiveKickCooldownMs: row.utility.effectiveKickCooldownMs,
        distinctCcTargets: row.utility.distinctCcTargets,
        groupSupportCasts: row.utility.groupSupportCasts,
        defensiveDispels: row.utility.defensiveDispels,
        offensiveDispels: row.utility.offensiveDispels,
        fieldStatus: {
          survival: row.survival.fieldStatus,
          utility: row.utility.fieldStatus,
          performance: row.performance.fieldStatus,
        },
      };
      }),
    },
    persistence,
  });

  if (missingWorkerCalls.length > 0) {
    console.error("FAIL: worker refresh pipeline missing required WCL calls", missingWorkerCalls);
    process.exit(1);
  }
  console.log("OK");
}

async function main(): Promise<void> {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    console.error(
      "REFUSED: live smoke requires ALLOW_LIVE_PROVIDER_CALLS=true (never enable this in CI).",
    );
    process.exit(2);
  }

  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const clientId = process.env.WCL_CLIENT_ID ?? "";
  const clientSecret = process.env.WCL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    console.error("FAIL: WCL_CLIENT_ID and WCL_CLIENT_SECRET are required.");
    process.exit(1);
  }

  print("config", {
    providerMode: process.env.PROVIDER_MODE ?? "fixture",
    allowLiveProviderCalls: process.env.ALLOW_LIVE_PROVIDER_CALLS ?? "false",
    deep: args.deep,
    wclCredentialsConfigured: true,
    blizzardCredentialsConfigured: Boolean(
      process.env.BLIZZARD_CLIENT_ID && process.env.BLIZZARD_CLIENT_SECRET,
    ),
    raiderioAppKeyConfigured: Boolean(process.env.RAIDERIO_APP_KEY),
    mplusZoneId: process.env.WCL_MPLUS_ZONE_ID ?? null,
  });

  const identity: CharacterIdentityInput = {
    region: args.region,
    realmSlug: args.realm,
    name: args.name,
  };
  const ctx = buildCtx(identity);

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
  });

  if (args.deep) {
    await runDeep(provider, identity, ctx);
  } else {
    await runShallow(provider, identity, ctx);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
