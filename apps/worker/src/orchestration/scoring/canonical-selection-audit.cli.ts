/**
 * Provider-free audit: are CharacterScore.selectedRuns PRIMARY/SECONDARY
 * slots actually the production-comparator top 2 eligible runs per dungeon?
 *
 *   pnpm --filter @mplus/worker exec tsx src/orchestration/scoring/canonical-selection-audit.cli.ts --region EU --realm ravencrest --name Own
 */
import { loadEnv, resetEnvCache } from "@mplus/config";
import type { RegionCode } from "@mplus/contracts";
import { compareEvidenceCandidatesV2, orderEvidenceCandidatesV2 } from "@mplus/scoring";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import { CharacterScoreRepository } from "@mplus/database";
import { createWorkerContainer } from "../../container.js";

function parseArgs(argv: string[]) {
  let region = "";
  let realm = "";
  let name = "";
  let seasonId = "";
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
    }
  }
  return {
    region: region.toUpperCase() as RegionCode,
    realm: realm.toLowerCase(),
    name,
    seasonId: seasonId || null,
  };
}

function asRec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function iso(d: Date | string | null | undefined): string {
  if (!d) return "n/a";
  return typeof d === "string" ? d : d.toISOString();
}

function fightKey(reportCode: string | null, fightId: number | null): string {
  if (!reportCode || fightId == null) return "";
  return `${reportCode}:${fightId}`;
}

function toCandidate(input: {
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string | null;
  runScore: number | null;
}): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode: input.reportCode, fightId: input.fightId },
    reportRevision: null,
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel,
    timed: input.timed,
    runScore: input.runScore,
    evidenceCompleteness: 1,
    completedAt: input.completedAt,
    fightDurationMs: null,
    actorId: null,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
  };
}

async function main() {
  resetEnvCache();
  const env = loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.region || !args.realm || !args.name) {
    process.stderr.write(
      "Usage: canonical-selection-audit --region EU --realm ravencrest --name Own\n",
    );
    process.exit(1);
  }

  const container = createWorkerContainer(env);
  const prisma = container.prisma;
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
    const scores = new CharacterScoreRepository(prisma);
    const latest = await scores.findLatestForCharacter(character.id);
    seasonId = latest?.seasonId ?? null;
  }
  if (!seasonId) {
    process.stderr.write("Could not resolve season.\n");
    process.exit(3);
  }

  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { seasonDungeons: { include: { dungeon: true } } },
  });
  const activeSlugs = (season?.seasonDungeons ?? [])
    .map((sd) => sd.dungeon.slug.toLowerCase())
    .sort();

  const score = await prisma.characterScore.findFirst({
    where: { characterId: character.id, seasonId },
    orderBy: { calculatedAt: "desc" },
  });
  const selectedRaw = Array.isArray(score?.selectedRuns) ? score.selectedRuns : [];
  const selectedRuns = selectedRaw
    .map((row) => asRec(row))
    .filter((r): r is Record<string, unknown> => r != null)
    .map((r) => ({
      slotId: String(r.slotId ?? ""),
      dungeonSlug: String(r.dungeonSlug ?? ""),
      slotIndex: typeof r.slotIndex === "number" ? r.slotIndex : 0,
      reportCode: typeof r.reportCode === "string" ? r.reportCode : null,
      fightId: typeof r.fightId === "number" ? r.fightId : null,
      reportRevision: typeof r.reportRevision === "number" ? r.reportRevision : null,
      jsonKeyLevel: num(r.keyLevel),
      jsonTimed: typeof r.timed === "boolean" ? r.timed : null,
      jsonCompletedAt: typeof r.completedAt === "string" ? r.completedAt : null,
    }));

  const manifest = await prisma.evidenceManifest.findFirst({
    where: { characterId: character.id, seasonId },
    orderBy: { frozenAt: "desc" },
    include: { slots: { include: { run: { include: { dungeon: true, sources: true } } } } },
  });

  const jobs = await prisma.ingestionJob.findMany({
    where: { characterId: character.id },
    orderBy: { scheduledAt: "desc" },
    take: 8,
    select: {
      jobType: true,
      status: true,
      scheduledAt: true,
      startedAt: true,
      completedAt: true,
    },
  });

  const mythic = await prisma.mythicRun.findMany({
    where: {
      seasonId,
      participants: { some: { characterId: character.id } },
    },
    include: {
      dungeon: true,
      sources: true,
      participants: { where: { characterId: character.id } },
    },
    orderBy: [{ keyLevel: "desc" }, { completedAt: "desc" }],
  });

  const reportCodes = [
    ...new Set(
      [
        ...selectedRuns.map((s) => s.reportCode),
        ...mythic.flatMap((m) => m.sources.map((s) => s.reportCode)),
      ].filter((c): c is string => Boolean(c)),
    ),
  ];

  const rawRuns = await prisma.wclRunRaw.findMany({
    where: { reportCode: { in: reportCodes.length > 0 ? reportCodes : ["__none__"] } },
    include: {
      fightRankingSnapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
        include: { entries: true },
      },
      digests: { where: { characterId: character.id } },
    },
  });
  const rawByFight = new Map(rawRuns.map((r) => [`${r.reportCode}:${r.fightId}:${r.reportRevision}`, r]));
  const rawByCodeFight = new Map<string, typeof rawRuns>();
  for (const r of rawRuns) {
    const k = `${r.reportCode}:${r.fightId}`;
    const list = rawByCodeFight.get(k) ?? [];
    list.push(r);
    rawByCodeFight.set(k, list);
  }

  const allOwnDigests = await prisma.characterRunDigest.findMany({
    where: { characterId: character.id },
    include: { rawRun: true },
  });

  const subjectZeroHits = await prisma.wclFightRankingEntry.findMany({
    where: {
      name: { equals: character.displayName, mode: "insensitive" },
      bracketPercent: { lte: 0.5 },
    },
    include: {
      snapshot: {
        include: {
          rawRun: true,
          entries: true,
        },
      },
    },
    take: 50,
  });

  const peerPatternHits: Array<{
    reportCode: string;
    fightId: number;
    revision: number;
    percents: number[];
    subject: number | null;
  }> = [];
  const wanted = [96, 82, 99, 95];
  for (const raw of rawRuns) {
    const snap = raw.fightRankingSnapshots[0];
    if (!snap) continue;
    const percents = snap.entries
      .map((e) => e.bracketPercent)
      .filter((p): p is number => p != null)
      .map((p) => Math.round(p));
    const matches = wanted.filter((w) => percents.includes(w)).length;
    if (matches >= 3) {
      const subject = snap.entries.find(
        (e) => e.name.toLowerCase() === character.displayName.toLowerCase(),
      );
      peerPatternHits.push({
        reportCode: raw.reportCode,
        fightId: raw.fightId,
        revision: raw.reportRevision,
        percents,
        subject: subject?.bracketPercent ?? null,
      });
    }
  }

  const lines: string[] = [];
  lines.push(`character: ${character.displayName} (${character.id})`);
  lines.push(`season: ${season?.slug ?? seasonId} (${seasonId})`);
  lines.push(`active dungeons: ${activeSlugs.join(", ")}`);
  lines.push(`CharacterScore.calculatedAt: ${iso(score?.calculatedAt)}`);
  lines.push(`CharacterScore.id: ${score?.id ?? "n/a"}`);
  lines.push(`EvidenceManifest.frozenAt: ${iso(manifest?.frozenAt)}`);
  lines.push(`EvidenceManifest.selectedSlotCount: ${manifest?.selectedSlotCount ?? "n/a"}`);
  lines.push(`provider calls: 0`);
  lines.push("");
  lines.push("REFRESH / JOB TIMESTAMPS (latest 8)");
  for (const j of jobs) {
    lines.push(
      `  ${j.jobType} ${j.status} scheduled=${iso(j.scheduledAt)} started=${iso(j.startedAt)} completed=${iso(j.completedAt)}`,
    );
  }
  if (jobs.length === 0) lines.push("  none");

  type InventoryRow = {
    dungeon: string;
    keyLevel: number;
    timed: boolean | null;
    completedAt: string;
    mythicRunId: string | null;
    reportCode: string | null;
    fightId: number | null;
    reportRevision: number | null;
    wclSource: boolean;
    raw: boolean;
    digest: boolean;
    snapshot: boolean;
    subjectBracket: number | null;
    access: string;
    selected: "PRIMARY" | "SECONDARY" | "not selected";
    origin: string;
  };

  const inventory: InventoryRow[] = [];

  for (const run of mythic) {
    const wcl = run.sources.find((s) => s.provider === "WARCRAFT_LOGS" && s.reportCode && s.fightId != null);
    const blizzard = run.sources.find((s) => s.provider === "BLIZZARD");
    const code = wcl?.reportCode ?? null;
    const fightId = wcl?.fightId ?? null;
    const rev = wcl?.revision ?? null;
    const rawList = code && fightId != null ? (rawByCodeFight.get(`${code}:${fightId}`) ?? []) : [];
    const raw =
      rev != null
        ? rawByFight.get(`${code}:${fightId}:${rev}`) ?? rawList[0]
        : rawList[0];
    const digest = raw?.digests[0] ?? null;
    const snap = raw?.fightRankingSnapshots[0] ?? null;
    const subject = snap?.entries.find(
      (e) => e.name.toLowerCase() === character.displayName.toLowerCase(),
    );
    const sel = selectedRuns.find(
      (s) => s.reportCode === code && s.fightId === fightId && s.dungeonSlug === run.dungeon.slug,
    );
    inventory.push({
      dungeon: run.dungeon.slug,
      keyLevel: run.keyLevel,
      timed: run.timed,
      completedAt: iso(run.completedAt),
      mythicRunId: run.id,
      reportCode: code,
      fightId,
      reportRevision: raw?.reportRevision ?? rev,
      wclSource: Boolean(wcl),
      raw: Boolean(raw),
      digest: Boolean(digest),
      snapshot: Boolean(snap),
      subjectBracket: subject?.bracketPercent ?? null,
      access: blizzard ? `blizzard:${blizzard.externalRunId}` : "no-blizzard-source",
      selected:
        sel == null ? "not selected" : sel.slotIndex === 0 ? "PRIMARY" : "SECONDARY",
      origin: "mythic_run",
    });
  }

  for (const digest of allOwnDigests) {
    const meta = asRec(digest.sourceMetadata);
    const nested = asRec(meta?.digest) ?? meta;
    const dungeon =
      typeof nested?.dungeonSlug === "string" ? nested.dungeonSlug.toLowerCase() : "unknown";
    const keyLevel = num(nested?.keyLevel) ?? 0;
    const already = inventory.some(
      (r) =>
        r.reportCode === digest.rawRun.reportCode && r.fightId === digest.rawRun.fightId,
    );
    if (already) continue;
    const sel = selectedRuns.find(
      (s) => s.reportCode === digest.rawRun.reportCode && s.fightId === digest.rawRun.fightId,
    );
    const snap = digest.rawRun
      ? (rawByFight.get(
          `${digest.rawRun.reportCode}:${digest.rawRun.fightId}:${digest.rawRun.reportRevision}`,
        )?.fightRankingSnapshots[0] ?? null)
      : null;
    const subject = snap?.entries.find(
      (e) => e.name.toLowerCase() === character.displayName.toLowerCase(),
    );
    inventory.push({
      dungeon,
      keyLevel,
      timed: typeof nested?.timed === "boolean" ? nested.timed : null,
      completedAt: typeof nested?.completedAt === "string" ? nested.completedAt : "n/a",
      mythicRunId: null,
      reportCode: digest.rawRun.reportCode,
      fightId: digest.rawRun.fightId,
      reportRevision: digest.rawRun.reportRevision,
      wclSource: true,
      raw: true,
      digest: true,
      snapshot: Boolean(snap),
      subjectBracket: subject?.bracketPercent ?? null,
      access: "digest-only",
      selected: sel == null ? "not selected" : sel.slotIndex === 0 ? "PRIMARY" : "SECONDARY",
      origin: "digest_without_mythic_run",
    });
  }

  const byDungeon = new Map<string, InventoryRow[]>();
  for (const row of inventory) {
    const list = byDungeon.get(row.dungeon) ?? [];
    list.push(row);
    byDungeon.set(row.dungeon, list);
  }

  lines.push("");
  lines.push("=== 1. CANDIDATE INVENTORY (grouped by dungeon) ===");
  for (const dungeon of [...byDungeon.keys()].sort()) {
    const rows = byDungeon.get(dungeon)!;
    const eligibleMeta = rows
      .filter((r) => r.timed === true && r.reportCode && r.fightId != null && r.keyLevel > 0)
      .map((r) =>
        toCandidate({
          reportCode: r.reportCode!,
          fightId: r.fightId!,
          dungeonSlug: dungeon,
          keyLevel: r.keyLevel,
          timed: r.timed,
          completedAt: r.completedAt === "n/a" ? null : r.completedAt,
          runScore: null,
        }),
      );
    const unique = new Map<string, EvidenceCandidateMetadataV2>();
    for (const c of eligibleMeta) {
      const k = fightKey(c.discoveryIdentity.reportCode, c.discoveryIdentity.fightId);
      const prev = unique.get(k);
      if (!prev || compareEvidenceCandidatesV2(c, prev) < 0) unique.set(k, c);
    }
    const ordered = orderEvidenceCandidatesV2([...unique.values()]);
    lines.push("");
    lines.push(`DUNGEON ${dungeon}  (eligible WCL-mapped timed: ${ordered.length})`);
    const sortedPrint = [...rows].sort((a, b) => {
      if (a.keyLevel !== b.keyLevel) return b.keyLevel - a.keyLevel;
      if (a.timed !== b.timed) return Number(b.timed) - Number(a.timed);
      return fightKey(a.reportCode, a.fightId).localeCompare(fightKey(b.reportCode, b.fightId));
    });
    sortedPrint.forEach((r, i) => {
      lines.push(
        `  #${i + 1} key=${r.keyLevel} timed=${String(r.timed)} ${r.completedAt} mythic=${r.mythicRunId ?? "-"} ${r.reportCode ?? "-"}/${r.fightId ?? "-"} rev=${r.reportRevision ?? "-"} wclSrc=${r.wclSource} raw=${r.raw} digest=${r.digest} snap=${r.snapshot} sub%=${r.subjectBracket ?? "n/a"} selected=${r.selected} origin=${r.origin} ${r.access}`,
      );
    });
    lines.push("  comparator eligible order:");
    ordered.forEach((c, i) => {
      lines.push(
        `    candidate #${i + 1} key=${c.keyLevel} ${c.discoveryIdentity.reportCode}/${c.discoveryIdentity.fightId} timed=${String(c.timed)}`,
      );
    });
    const p = selectedRuns.find((s) => s.dungeonSlug === dungeon && s.slotIndex === 0);
    const s = selectedRuns.find((s) => s.dungeonSlug === dungeon && s.slotIndex === 1);
    const pKey = fightKey(p?.reportCode ?? null, p?.fightId ?? null);
    const sKey = fightKey(s?.reportCode ?? null, s?.fightId ?? null);
    const c1 = ordered[0] ? fightKey(ordered[0].discoveryIdentity.reportCode, ordered[0].discoveryIdentity.fightId) : "";
    const c2 = ordered[1] ? fightKey(ordered[1].discoveryIdentity.reportCode, ordered[1].discoveryIdentity.fightId) : "";
    lines.push(
      `  persisted PRIMARY   ${p?.reportCode ?? "-"}/${p?.fightId ?? "-"}  match comparator#1=${pKey !== "" && pKey === c1}`,
    );
    lines.push(
      `  persisted SECONDARY ${s?.reportCode ?? "-"}/${s?.fightId ?? "-"}  match comparator#2=${sKey !== "" && sKey === c2}`,
    );
  }

  lines.push("");
  lines.push("=== 3. CURRENT 16 — resolved keyLevel ===");
  for (const sel of [...selectedRuns].sort((a, b) => {
    const d = a.dungeonSlug.localeCompare(b.dungeonSlug);
    return d !== 0 ? d : a.slotIndex - b.slotIndex;
  })) {
    const inv = inventory.find(
      (r) => r.reportCode === sel.reportCode && r.fightId === sel.fightId,
    );
    const slotRow = manifest?.slots.find(
      (sl) => sl.reportCode === sel.reportCode && sl.fightId === sel.fightId,
    );
    const role = sel.slotIndex === 0 ? "PRIMARY" : "SECONDARY";
    const key =
      inv?.keyLevel && inv.keyLevel > 0
        ? inv.keyLevel
        : slotRow?.keyLevel && slotRow.keyLevel > 0
          ? slotRow.keyLevel
          : sel.jsonKeyLevel && sel.jsonKeyLevel > 0
            ? sel.jsonKeyLevel
            : null;
    lines.push(
      `  ${sel.dungeonSlug} ${role} slot=${sel.slotIndex} key=${key ?? "UNRESOLVED"} timed=${inv?.timed ?? sel.jsonTimed ?? slotRow?.run?.timed ?? "n/a"} ${sel.reportCode}/${sel.fightId} rev=${sel.reportRevision} jsonKey=${sel.jsonKeyLevel ?? "absent"} manifestKey=${slotRow?.keyLevel ?? "n/a"} mythicKey=${inv?.keyLevel ?? "n/a"} candidateRank=${slotRow?.candidateRank ?? "n/a"} sub%=${inv?.subjectBracket ?? "n/a"}`,
    );
  }

  lines.push("");
  lines.push("=== 5. SUBJECT Key% ~0 / peer pattern 96/82/99/95 ===");
  if (subjectZeroHits.length === 0) {
    lines.push("  no ranking entry named Own with bracketPercent <= 0.5 in local snapshots");
  }
  for (const hit of subjectZeroHits) {
    const raw = hit.snapshot.rawRun;
    const peers = hit.snapshot.entries
      .filter((e) => e.id !== hit.id)
      .map((e) => `${e.name}:${e.bracketPercent}`)
      .join(", ");
    const inv = inventory.find((r) => r.reportCode === raw.reportCode && r.fightId === raw.fightId);
    lines.push(
      `  FOUND subject%=${hit.bracketPercent} ${raw.reportCode}/${raw.fightId} rev=${raw.reportRevision} dungeon=${inv?.dungeon ?? "?"} key=${inv?.keyLevel ?? "?"} selected=${inv?.selected ?? "?"} peers=${peers}`,
    );
  }
  if (peerPatternHits.length === 0) {
    lines.push("  no local snapshot with ≥3 of peer percents {96,82,99,95}");
  }
  for (const hit of peerPatternHits) {
    lines.push(
      `  PEER PATTERN ${hit.reportCode}/${hit.fightId} rev=${hit.revision} subject=${hit.subject} percents=${hit.percents.join(",")}`,
    );
  }

  const extraZero = await prisma.wclFightRankingEntry.findMany({
    where: { bracketPercent: 0 },
    include: { snapshot: { include: { rawRun: true } } },
    take: 30,
  });
  const ownishZero = extraZero.filter((e) => e.name.toLowerCase().includes("own"));
  lines.push(`  any local bracketPercent=0 entries named *own*: ${ownishZero.length}`);
  for (const e of ownishZero) {
    lines.push(
      `    ${e.name}=${e.bracketPercent} ${e.snapshot.rawRun.reportCode}/${e.snapshot.rawRun.fightId}`,
    );
  }

  const digestOnlyZero = allOwnDigests.filter((d) => {
    const meta = asRec(d.sourceMetadata);
    const nested = asRec(meta?.digest) ?? meta;
    return num(nested?.keyLevel) != null;
  });
  lines.push(`  Own digests persisted: ${allOwnDigests.length} (with keyLevel in metadata: ${digestOnlyZero.length})`);
  lines.push(`  Own MythicRuns this season: ${mythic.length}`);
  lines.push(`  max MythicRun keyLevel: ${mythic.reduce((m, r) => Math.max(m, r.keyLevel), 0)}`);
  const maxSelectedKey = selectedRuns.map((s) => {
    const inv = inventory.find((r) => r.reportCode === s.reportCode && r.fightId === s.fightId);
    return inv?.keyLevel ?? 0;
  });
  lines.push(`  max selected 16 keyLevel: ${Math.max(0, ...maxSelectedKey)}`);

  process.stdout.write(`${lines.join("\n")}\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
