/**
 * Historical backfill of fight rankings for canonical EvidenceManifest V2 slots.
 * Does not select an independent Boost sample.
 *
 * Usage:
 *   pnpm wcl:hydrate:rankings -- --region EU --realm ravencrest --name Own
 */
import { loadEnv, resetEnvCache } from "@mplus/config";
import type { RegionCode } from "@mplus/contracts";
import { CharacterScoreRepository, WclFightRankingRepository } from "@mplus/database";
import {
  WCL_FIGHT_RANKING_ACQUISITION_VERSION,
  WCL_FIGHT_RANKING_LEGACY_ACQUISITION_VERSION,
} from "@mplus/database";
import {
  LiveWarcraftLogsProvider,
  OPERATIONS,
  type WclGraphQlClient,
} from "@mplus/provider-warcraftlogs";
import { createWorkerContainer } from "../container.js";
import { pickUniqueRaw } from "../boost-assessment/pick-unique-raw.js";
import { persistWclFightRankingsFromReport } from "./persist-from-report.js";

const HARD_MAX = 16;

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseArgs(argv: string[]) {
  let region = "";
  let realm = "";
  let name = "";
  let seasonId = "";
  let reportCode = "";
  let fightId: number | null = null;
  let limit = HARD_MAX;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = argv[i + 1];
    if (a === "--region" && next) {
      region = next;
      i++;
    } else if (a === "--realm" && next) {
      realm = next;
      i++;
    } else if ((a === "--name" || a === "--character") && next) {
      name = next;
      i++;
    } else if (a === "--season" && next) {
      seasonId = next;
      i++;
    } else if (a === "--report-code" && next) {
      reportCode = next;
      i++;
    } else if (a === "--fight-id" && next) {
      fightId = Number(next);
      i++;
    } else if (a === "--limit" && next) {
      limit = Number(next);
      i++;
    }
  }
  return {
    region: region.toUpperCase() as RegionCode,
    realm: realm.toLowerCase(),
    name,
    seasonId: seasonId || null,
    reportCode: reportCode || null,
    fightId: fightId != null && Number.isInteger(fightId) ? fightId : null,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, HARD_MAX) : HARD_MAX,
  };
}

async function fetchRateLimit(client: WclGraphQlClient) {
  const result = await client.requestPermissive<{
    rateLimitData?: { limitPerHour?: number; pointsSpentThisHour?: number };
  }>({
    operationName: OPERATIONS.RateLimitData.operationName,
    query: OPERATIONS.RateLimitData.query,
    variables: {},
  });
  return result.response.data?.rateLimitData ?? null;
}

async function main() {
  resetEnvCache();
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    process.stderr.write(
      "REFUSED: wcl:hydrate:rankings requires ALLOW_LIVE_PROVIDER_CALLS=true (never enable this in CI).\n",
    );
    process.exit(2);
  }
  const env = loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.region || !args.realm || !args.name) {
    process.stderr.write(
      "Usage: pnpm wcl:hydrate:rankings -- --region EU --realm <realm> --name <character>\n",
    );
    process.exit(1);
  }

  const container = createWorkerContainer(env);
  const character = await container.repositories.character.findByIdentity({
    region: args.region,
    realmSlug: args.realm,
    name: args.name,
  });
  if (!character) {
    process.stderr.write(`Character not found: ${args.region}/${args.realm}/${args.name}\n`);
    process.exit(2);
  }

  let seasonId = args.seasonId;
  if (!seasonId) {
    const scores = new CharacterScoreRepository(container.prisma);
    seasonId = (await scores.findLatestForCharacter(character.id))?.seasonId ?? null;
  }
  if (!seasonId) {
    process.stderr.write("Could not resolve a persisted season. Pass --season.\n");
    process.exit(3);
  }

  const scoreRow = await container.prisma.characterScore.findFirst({
    where: { characterId: character.id, seasonId },
    orderBy: { calculatedAt: "desc" },
  });
  const selected = Array.isArray(scoreRow?.selectedRuns) ? scoreRow.selectedRuns : [];
  const slots = (selected as Array<Record<string, unknown>>).filter(
    (s) => typeof s.reportCode === "string" && typeof s.fightId === "number",
  );
  const extraSlot =
    args.reportCode && args.fightId != null
      ? [{ reportCode: args.reportCode, fightId: args.fightId, dungeonSlug: "(explicit)", keyLevel: null, reportRevision: null }]
      : [];
  if (slots.length === 0 && extraSlot.length === 0) {
    process.stderr.write(
      "SCORING_SELECTION_LINEAGE_MISSING — CharacterScore.selectedRuns empty. Run a normal refresh first.\n",
    );
    process.exit(4);
  }

  const rankingRepo = new WclFightRankingRepository(container.prisma);
  const provider = new LiveWarcraftLogsProvider({ env });
  const client = provider.getGraphQlClient();
  const rateBefore = await fetchRateLimit(client);

  let wclCalls = 1;
  let hydrated = 0;
  let skippedExisting = 0;
  let skippedNoRaw = 0;
  let failed = 0;
  let fetches = 0;
  const targets = [...slots, ...extraSlot.filter((e) => !slots.some((s) => String(s.reportCode) === e.reportCode && Number(s.fightId) === e.fightId))];
  const lines: string[] = [
    `character: ${character.displayName} (${character.id})`,
    `ranking semantic: ${WCL_FIGHT_RANKING_ACQUISITION_VERSION}`,
    `targets: CharacterScore.selectedRuns (${slots.length}) plus explicit ${extraSlot.length}`,
    "",
  ];

  const hydrateOne = async (slot: Record<string, unknown>) => {
    const identity = {
      reportCode: String(slot.reportCode),
      fightId: Number(slot.fightId),
      reportRevision: typeof slot.reportRevision === "number" ? slot.reportRevision : null,
    };
    const dungeonSlug = typeof slot.dungeonSlug === "string" ? slot.dungeonSlug : "?";
    const rawCandidates = await container.prisma.wclRunRaw.findMany({
      where: { reportCode: identity.reportCode, fightId: identity.fightId },
    });
    const raw = pickUniqueRaw(rawCandidates, identity.reportRevision);
    if (!raw || raw === "ambiguous") {
      skippedNoRaw += 1;
      lines.push(`${dungeonSlug} ${identity.reportCode}#${identity.fightId}  SKIP ${raw === "ambiguous" ? "AMBIGUOUS_RAW" : "NO_COMPATIBLE_RAW"}`);
      return;
    }
    const existing = await rankingRepo.findLatestSnapshotForRawRun(raw.id);
    if (existing) {
      skippedExisting += 1;
      lines.push(`${dungeonSlug} ${identity.reportCode}#${identity.fightId}  SKIP compatible v2 snapshot ${existing.id}`);
      return;
    }
    if (fetches >= args.limit) {
      lines.push(`${dungeonSlug} ${identity.reportCode}#${identity.fightId}  SKIP fetch limit`);
      return;
    }
    try {
      const result = await client.requestPermissive<{
        reportData?: {
          report?: {
            fights?: Array<{ id?: number; friendlyPlayers?: unknown }>;
            masterData?: unknown;
            rankings?: unknown;
          } | null;
        };
      }>({
        operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
        query: OPERATIONS.ReportWithFightAndMasterData.query,
        variables: { code: identity.reportCode, fightIDs: [identity.fightId] },
        region: args.region,
      });
      wclCalls += 1;
      fetches += 1;
      const report = result.response.data?.reportData?.report;
      const fight = (report?.fights ?? []).find((f) => f.id === identity.fightId);
      const persist = await persistWclFightRankingsFromReport({
        prisma: container.prisma,
        rawRunId: raw.id,
        rankings: report?.rankings ?? null,
        masterData: report?.masterData ?? null,
        friendlyPlayers: fight?.friendlyPlayers ?? null,
        fightId: identity.fightId,
        fetchedAt: new Date(),
      });
      if (persist.status === "skipped") {
        lines.push(`${dungeonSlug} ${identity.reportCode}#${identity.fightId}  SKIP rankings null`);
        return;
      }
      hydrated += 1;
      lines.push(
        `${dungeonSlug} +${slot.keyLevel ?? "?"}  ${identity.reportCode}#${identity.fightId}  snapshot=${persist.snapshotId} created=${persist.created} aligned=${persist.alignedCount}`,
      );
    } catch (err) {
      failed += 1;
      lines.push(
        `${identity.reportCode}#${identity.fightId}  FAIL ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  for (const slot of targets) {
    await hydrateOne(slot);
  }

  const rateAfter = await fetchRateLimit(client);
  wclCalls += 1;
  lines.push("");
  lines.push(`scoring selectedRuns: ${slots.length}`);
  lines.push(`new snapshots: ${hydrated}  already present: ${skippedExisting}  no raw: ${skippedNoRaw}  failed: ${failed}`);
  lines.push(`WCL report calls: ${fetches}  GraphQL ops incl RateLimitData: ${wclCalls}`);
  if (rateBefore && rateAfter) {
    lines.push(`approx points delta: ${rateAfter.pointsSpentThisHour! - rateBefore.pointsSpentThisHour!}`);
  }

  const fmtPct = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? "n/a" : String(v);
  const median = (values: number[]) => {
    if (values.length === 0) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  };
  const subjectRow = (
    entries: Array<{ name: string; bracketPercent: number | null }>,
  ) => entries.find((e) => e.name.toLowerCase() === args.name.toLowerCase());

  lines.push("");
  lines.push("old v1 vs new v2 Key % (Boost-compatible = v2 only)");
  lines.push(
    ["Dungeon", "Slot", "Report#Fight", "oldv1", "newv2", "peerOld", "peerNew", "deltaV2", "class"].join("\t"),
  );
  for (const slot of slots) {
    const reportCode = String(slot.reportCode);
    const fightId = Number(slot.fightId);
    const dungeonSlug = typeof slot.dungeonSlug === "string" ? slot.dungeonSlug : "?";
    const slotIndex = typeof slot.slotIndex === "number" ? slot.slotIndex : "?";
    const rawCandidates = await container.prisma.wclRunRaw.findMany({
      where: { reportCode, fightId },
    });
    const raw = pickUniqueRaw(rawCandidates, typeof slot.reportRevision === "number" ? slot.reportRevision : null);
    if (!raw || raw === "ambiguous") {
      lines.push([dungeonSlug, String(slotIndex), `${reportCode}#${fightId}`, "n/a", "n/a", "n/a", "n/a", "n/a", raw === "ambiguous" ? "AMBIGUOUS" : "NO_RAW"].join("\t"));
      continue;
    }
    const v1 = await rankingRepo.findLatestSnapshotForRawRun(raw.id, WCL_FIGHT_RANKING_LEGACY_ACQUISITION_VERSION);
    const v2 = await rankingRepo.findLatestSnapshotForRawRun(raw.id);
    const v1Entries = (v1?.entries ?? []) as Array<{ name: string; bracketPercent: number | null }>;
    const v2Entries = (v2?.entries ?? []) as Array<{ name: string; bracketPercent: number | null }>;
    const s1 = subjectRow(v1Entries)?.bracketPercent ?? null;
    const s2 = subjectRow(v2Entries)?.bracketPercent ?? null;
    const peers = (entries: typeof v1Entries, subjectName: string) =>
      entries
        .filter((e) => e.name.toLowerCase() !== subjectName.toLowerCase())
        .map((e) => e.bracketPercent)
        .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    const p1 = median(peers(v1Entries, args.name));
    const p2 = median(peers(v2Entries, args.name));
    const delta = s2 != null && p2 != null ? s2 - p2 : null;
    let klass = "MISSING_V2";
    if (s2 != null && p2 != null) {
      if (delta! <= -40) klass = "RED";
      else if (delta! >= 15) klass = "GREEN";
      else klass = "NEUTRAL";
    }
    lines.push(
      [dungeonSlug, String(slotIndex), `${reportCode}#${fightId}`, fmtPct(s1), fmtPct(s2), fmtPct(p1), fmtPct(p2), fmtPct(delta), klass].join("\t"),
    );
  }

  if (args.reportCode && args.fightId != null) {
    const rawCandidates = await container.prisma.wclRunRaw.findMany({
      where: { reportCode: args.reportCode, fightId: args.fightId },
    });
    const raw = pickUniqueRaw(rawCandidates, null);
    if (raw && raw !== "ambiguous") {
      const v2 = await rankingRepo.findLatestSnapshotForRawRun(raw.id);
      lines.push("");
      lines.push(`persisted v2 snapshot for ${args.reportCode}#${args.fightId}: ${v2?.id ?? "none"} version=${v2?.rankingAcquisitionVersion ?? "n/a"}`);
      for (const e of (v2?.entries ?? []) as Array<{
        name: string;
        realmName: string | null;
        role: string | null;
        bracketPercent: number | null;
        rankPercent: number | null;
        reportActorId: number;
      }>) {
        lines.push(
          `  ${e.role ?? "?"} ${e.name} ${e.realmName ?? ""} actor=${e.reportActorId} rankPercent=${fmtPct(e.rankPercent)} bracketPercent=${fmtPct(e.bracketPercent)}`,
        );
      }
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  await container.prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
