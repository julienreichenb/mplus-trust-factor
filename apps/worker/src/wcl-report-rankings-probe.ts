/**
 * Developer-only: live WCL report rankings for ONE persisted fight.
 *
 * Usage:
 *   pnpm wcl:probe:report-rankings -- --region EU --realm ravencrest --name Own
 *
 * Does not persist rankings, scores, or boost assessments.
 */
import { loadEnv, resetEnvCache } from "@mplus/config";
import type { RegionCode } from "@mplus/contracts";
import { LiveWarcraftLogsProvider } from "@mplus/provider-warcraftlogs";
import {
  fetchReportFightRankingsProbe,
  friendlyActorsMissingRankings,
} from "@mplus/provider-warcraftlogs";
import { createWorkerContainer } from "./container.js";

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseArgs(argv: string[]) {
  let region = "";
  let realm = "";
  let name = "";
  let reportCode = "";
  let fightId: number | null = null;
  let runId = "";
  let limit = 1;
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
    } else if (a === "--report-code" && next) {
      reportCode = next;
      i++;
    } else if (a === "--fight-id" && next) {
      fightId = Number(next);
      i++;
    } else if (a === "--run-id" && next) {
      runId = next;
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
    reportCode: reportCode || null,
    fightId: fightId != null && Number.isInteger(fightId) ? fightId : null,
    runId: runId || null,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1) : 1,
  };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return String(v);
}

async function main() {
  resetEnvCache();
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    process.stderr.write(
      "REFUSED: report-rankings probe requires ALLOW_LIVE_PROVIDER_CALLS=true (never enable this in CI).\n",
    );
    process.exit(2);
  }
  const env = loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.region || !args.realm || !args.name) {
    process.stderr.write(
      "Usage: pnpm wcl:probe:report-rankings -- --region EU --realm <realm> --name <character> [--report-code x] [--fight-id n]\n",
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
    process.stderr.write(
      `Character not found in DB: ${args.region}/${args.realm}/${args.name}. Refresh first so a WCL-backed MythicRun exists.\n`,
    );
    process.exit(2);
  }

  let reportCode = args.reportCode;
  let fightId = args.fightId;

  if (!reportCode || fightId == null) {
    const whereRun = args.runId
      ? { id: args.runId, participants: { some: { characterId: character.id, isTargetCharacter: true } } }
      : {
          participants: { some: { characterId: character.id, isTargetCharacter: true } },
          timed: true,
          sources: { some: { provider: "WARCRAFT_LOGS" as const, reportCode: { not: null }, fightId: { not: null } } },
        };
    const run = await container.prisma.mythicRun.findFirst({
      where: whereRun,
      orderBy: [{ keyLevel: "desc" }, { completedAt: "desc" }],
      include: {
        dungeon: { select: { slug: true, name: true } },
        sources: {
          where: { provider: "WARCRAFT_LOGS", reportCode: { not: null }, fightId: { not: null } },
        },
      },
    });
    if (!run) {
      process.stderr.write("No persisted WCL-backed MythicRun found for this character.\n");
      process.exit(3);
    }
    const src = run.sources[0];
    reportCode = reportCode ?? src?.reportCode ?? null;
    fightId = fightId ?? src?.fightId ?? null;
    process.stdout.write(
      `persisted run: ${run.id}  dungeon=${run.dungeon.name}  key=${run.keyLevel}  timed=${run.timed}\n`,
    );
  }

  if (!reportCode || fightId == null) {
    process.stderr.write("Could not resolve reportCode + fightId.\n");
    process.exit(3);
  }

  const provider = new LiveWarcraftLogsProvider({ env });
  const live = await fetchReportFightRankingsProbe({
    client: provider.getGraphQlClient(),
    reportCode,
    fightId,
  });

  const missing = live.fight
    ? friendlyActorsMissingRankings({
        rows: live.rows,
        actors: live.actors,
        friendlyPlayers: live.fight.friendlyPlayers,
      })
    : [];

  const lines = [
    `character: ${character.displayName} (${character.id})`,
    `report: ${live.reportCode}  fightId=${fightId}  revision=${live.reportRevision ?? "n/a"}  visibility=${live.visibility ?? "n/a"}`,
    `fight: ${live.fight?.name ?? "n/a"}  encounterID=${live.fight?.encounterID ?? "n/a"}  keystoneLevel=${live.fight?.keystoneLevel ?? "n/a"}`,
    `rankings JSON shape: ${live.rawShape}`,
    `role buckets: ${live.roleBuckets.join(", ") || "(none)"}`,
    `graphql errors: ${live.graphqlErrors.length ? live.graphqlErrors.join(" | ") : "(none)"}`,
    `rankings op costUnits=${live.rankingsCostUnits ?? "n/a"} durationMs=${live.rankingsDurationMs}`,
    `rateLimit before: limitPerHour=${live.rateLimitBefore?.limitPerHour ?? "n/a"} pointsSpentThisHour=${live.rateLimitBefore?.pointsSpentThisHour ?? "n/a"}`,
    `rateLimit after:  limitPerHour=${live.rateLimitAfter?.limitPerHour ?? "n/a"} pointsSpentThisHour=${live.rateLimitAfter?.pointsSpentThisHour ?? "n/a"}`,
    live.rateLimitBefore && live.rateLimitAfter
      ? `rateLimit delta pointsSpentThisHour=${live.rateLimitAfter.pointsSpentThisHour - live.rateLimitBefore.pointsSpentThisHour} (includes RateLimitData calls)`
      : "rateLimit delta: n/a",
    "",
    pad("WclId", 9) +
      pad("Actor", 7) +
      pad("Name", 16) +
      pad("Server", 14) +
      pad("Role", 10) +
      pad("Spec", 14) +
      pad("Rank%", 8) +
      pad("Bracket%", 10) +
      pad("Amount", 12) +
      "Align",
  ];

  for (const row of live.rows) {
    lines.push(
      pad(fmt(row.wclCharacterId), 9) +
        pad(fmt(row.actorId), 7) +
        pad(row.name ?? "?", 16) +
        pad(row.server ?? "", 14) +
        pad(row.role ?? "", 10) +
        pad(row.spec ?? "", 14) +
        pad(fmt(row.rankPercent), 8) +
        pad(fmt(row.bracketPercent), 10) +
        pad(fmt(row.amount), 12) +
        row.alignment,
    );
  }
  if (live.rows.length === 0) lines.push("(no ranking rows parsed)");
  if (missing.length > 0) {
    lines.push("");
    lines.push("friendly players with no ranking row:");
    for (const a of missing) {
      lines.push(`  actor ${a.id} ${a.name} ${a.server ?? ""} ${a.subType ?? ""}`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  void args.limit;
  await container.prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
