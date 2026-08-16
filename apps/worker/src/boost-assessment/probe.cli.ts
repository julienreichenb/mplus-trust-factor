/**
 * Provider-free Boost Suspicion probe.
 *
 * Usage (repo root):
 *   pnpm boost:probe -- --region EU --realm sylvanas --name Khaelt
 *   pnpm boost:probe -- --region EU --realm ravencrest --name Own --persist
 *
 * Never calls Blizzard, Warcraft Logs, or Raider.IO.
 */
import { loadEnv, resetEnvCache } from "@mplus/config";
import type { RegionCode } from "@mplus/contracts";
import { CharacterScoreRepository } from "@mplus/database";
import type { PrismaClient } from "@mplus/database";
import { createWorkerContainer } from "../container.js";
import { runBoostAssessmentFromPersisted } from "./run-assessment.js";
import { wclDamageDoneReportUrl } from "./wcl-report-url.js";

async function lookupPersistedKeyLevels(
  prisma: PrismaClient,
  slots: Array<{ reportCode: string | null; fightId: number | null; reportRevision: number | null; keyLevel: number | null }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const missing = slots.filter((s) => s.keyLevel == null && s.reportCode && s.fightId != null);
  for (const s of slots) {
    if (s.keyLevel != null && s.reportCode && s.fightId != null) {
      out.set(`${s.reportCode}#${s.fightId}`, s.keyLevel);
    }
  }
  if (missing.length === 0) return out;
  const codes = [...new Set(missing.map((s) => s.reportCode!))];
  const digests = await prisma.wclRunSourceDigest.findMany({
    where: { reportCode: { in: codes } },
    select: { reportCode: true, fightId: true, reportRevision: true, keyLevel: true },
  });
  for (const d of digests) {
    if (d.keyLevel == null) continue;
    const key = `${d.reportCode}#${d.fightId}`;
    if (!out.has(key)) out.set(key, d.keyLevel);
  }
  const stillMissing = missing.filter((s) => !out.has(`${s.reportCode}#${s.fightId}`));
  if (stillMissing.length > 0) {
    const refs = await prisma.runSourceReference.findMany({
      where: {
        provider: "WARCRAFT_LOGS",
        reportCode: { in: [...new Set(stillMissing.map((s) => s.reportCode!))] },
      },
      select: { reportCode: true, fightId: true, run: { select: { keyLevel: true } } },
    });
    for (const r of refs) {
      if (r.reportCode == null || r.fightId == null || r.run?.keyLevel == null) continue;
      const key = `${r.reportCode}#${r.fightId}`;
      if (!out.has(key)) out.set(key, r.run.keyLevel);
    }
  }
  return out;
}

function parseArgs(argv: string[]) {
  let region = "";
  let realm = "";
  let name = "";
  let seasonId = "";
  let persist = false;
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
    } else if (a === "--persist") {
      persist = true;
    }
  }
  return {
    region: region.toUpperCase() as RegionCode,
    realm: realm.toLowerCase(),
    name,
    seasonId: seasonId || null,
    persist,
  };
}

function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toFixed(digits);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main() {
  resetEnvCache();
  const env = loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.region || !args.realm || !args.name) {
    process.stderr.write(
      "Usage: pnpm boost:probe -- --region EU --realm <realm> --name <character> [--season id] [--persist]\n",
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
      `Character not found in DB: ${args.region}/${args.realm}/${args.name}. Refresh first; this probe does not fetch providers.\n`,
    );
    process.exit(2);
  }

  let seasonId = args.seasonId;
  if (!seasonId) {
    const scores = new CharacterScoreRepository(container.prisma);
    const latest = await scores.findLatestForCharacter(character.id);
    seasonId = latest?.seasonId ?? null;
  }
  if (!seasonId) {
    const current = await container.prisma.season.findFirst({
      where: { isCurrent: true, region: { code: args.region } },
      orderBy: { startsAt: "desc" },
    });
    seasonId = current?.id ?? null;
  }
  if (!seasonId) {
    process.stderr.write(
      "Could not resolve a persisted season (no CharacterScore and no current Season row). Pass --season.\n",
    );
    process.exit(3);
  }

  const season = await container.prisma.season.findUnique({ where: { id: seasonId } });

  const { result, persistedId, lineage } = await runBoostAssessmentFromPersisted({
    prisma: container.prisma,
    characterId: character.id,
    seasonId,
    persist: args.persist,
  });

  const s = result.sample;
  const lines = [
    `character: ${character.displayName} (${character.id})`,
    `season: ${season?.slug ?? seasonId} (${seasonId})`,
    "",
    "CHARACTER CONTEXT",
    `  median timed key: ${fmt(s.subjectMedianTimedKey, 1)}`,
    `  median percentile: ${s.subjectMedianKeyPercentileLabel ?? "n/a"} (${s.subjectMedianKeyPercentileBps ?? "n/a"} bps)`,
    `  P99 key anchor: ${fmt(s.p99KeyThreshold, 1)}`,
    `  P99.9 key anchor: ${fmt(s.p999KeyThreshold, 1)}`,
    `  median sample size: ${s.timedRunCountUsedForMedian}`,
    `  boost sample size: ${s.boostSampleSize}`,
    `  exceptional operating level: ${s.exceptionalOperatingLevel}`,
    "",
    "CANONICAL PRIMARY RUNS",
  ];

  const ctxBy = new Map((s.dungeonContexts ?? []).map((c) => [c.dungeonSlug, c]));
  const analyzedByDungeon = new Map<string, typeof s.analyzedRuns>();
  for (const run of s.analyzedRuns) {
    const key = run.dungeonSlug ?? run.dungeonName ?? "?";
    const list = analyzedByDungeon.get(key) ?? [];
    list.push(run);
    analyzedByDungeon.set(key, list);
  }
  const primarySlots = lineage.boostSlots
    .filter((slot) => slot.slotIndex === 0)
    .sort((a, b) => a.dungeonSlug.localeCompare(b.dungeonSlug));
  const keyByFight = await lookupPersistedKeyLevels(container.prisma, primarySlots);
  for (const slot of primarySlots) {
    const ctx = ctxBy.get(slot.dungeonSlug);
    const primaryRun = (analyzedByDungeon.get(slot.dungeonSlug) ?? []).find((r) => r.dungeonSlotRole === "PRIMARY");
    const blizzardBest = ctx?.blizzardBestKeyLevel ?? null;
    const selectedKey =
      slot.keyLevel ??
      (slot.reportCode && slot.fightId != null ? (keyByFight.get(`${slot.reportCode}#${slot.fightId}`) ?? null) : null);
    const matched =
      blizzardBest != null && selectedKey != null && blizzardBest === selectedKey;
    const url = wclDamageDoneReportUrl(slot.reportCode, slot.fightId);
    lines.push(`Dungeon: ${slot.dungeonSlug}`);
    lines.push(`Blizzard best: ${blizzardBest != null ? `+${blizzardBest}` : "n/a"}`);
    lines.push(`Selected PRIMARY: ${selectedKey != null ? `+${selectedKey}` : "n/a"}`);
    lines.push(`Report: ${slot.reportCode ?? "n/a"}`);
    lines.push(`Fight: ${slot.fightId ?? "n/a"}`);
    lines.push(`Revision: ${slot.reportRevision ?? "n/a"}`);
    lines.push(`URL: ${url ?? "n/a"}`);
    lines.push(`Own Key %: ${fmt(primaryRun?.subjectKeyParse, 1)}`);
    lines.push(`Peer median: ${fmt(primaryRun?.peerMedianKeyParse, 1)}`);
    lines.push(`Delta: ${fmt(primaryRun?.performanceDelta, 1)}`);
    if (matched) {
      lines.push("Blizzard best matched: YES");
    } else {
      lines.push("Blizzard best matched: NO");
      if (blizzardBest != null) lines.push(`Blizzard best: +${blizzardBest}`);
      if (selectedKey != null) lines.push(`Selected WCL PRIMARY: +${selectedKey}`);
      if (blizzardBest != null && selectedKey != null) {
        lines.push(`Gap: ${blizzardBest - selectedKey} key levels`);
      }
    }
    lines.push("");
  }

  lines.push(
    pad("#", 3) +
      pad("Dungeon", 18) +
      pad("Date", 12) +
      pad("Key", 5) +
      pad("Sub%", 7) +
      pad("Peers", 28) +
      pad("PeerMed", 8) +
      pad("PeerMax", 8) +
      pad("Gap", 7) +
      pad("Class", 13) +
      pad("Slot", 10) +
      pad("W", 6) +
      pad("Dth", 4) +
      "Src",
  );

  s.analyzedRuns.forEach((run, i) => {
    const date = run.completedAt ? run.completedAt.slice(0, 10) : "n/a";
    const dungeon = run.dungeonName ?? run.dungeonSlug ?? "?";
    const peers = (run.peerKeyParses ?? [])
      .map((p) => `${p.displayName ?? p.identityKey}:${Number.isFinite(p.keyParse) ? p.keyParse : "?"}`)
      .join(",") || "n/a";
    lines.push(
      pad(String(i + 1), 3) +
        pad(dungeon, 18) +
        pad(date, 12) +
        pad(String(run.keyLevel), 5) +
        pad(fmt(run.subjectKeyParse, 0), 7) +
        pad(peers, 28) +
        pad(fmt(run.peerMedianKeyParse, 1), 8) +
        pad(fmt(run.peerMaxKeyParse, 1), 8) +
        pad(fmt(run.peerPerformanceGap, 1), 7) +
        pad(run.gapClass, 13) +
        pad(run.dungeonSlotRole, 10) +
        pad(fmt(run.dungeonSlotWeight, 2), 6) +
        pad(run.deathCount == null ? "n/a" : String(run.deathCount), 4) +
        `${run.evidenceSource ?? run.missingReason ?? "n/a"}`,
    );
    const slot = lineage.boostSlots.find(
      (row) => row.dungeonSlug === (run.dungeonSlug ?? run.dungeonName) && row.slotIndex === (run.slotIndex ?? 0),
    );
    const runUrl = wclDamageDoneReportUrl(slot?.reportCode, slot?.fightId);
    if (runUrl) lines.push(`    URL: ${runUrl}`);
    if (run.recurringStrongPeers.length > 0) {
      lines.push(`    recurring strong peers: ${run.recurringStrongPeers.join(", ")}`);
    }
  });

  lines.push("");
  lines.push("PER DUNGEON (Blizzard best vs public WCL vs signed delta)");
  const byDungeon = analyzedByDungeon;
  const dungeonNames = [...new Set([...ctxBy.keys(), ...byDungeon.keys()])].sort();
  for (const dungeon of dungeonNames) {
    const ctx = ctxBy.get(dungeon);
    const runs = byDungeon.get(dungeon) ?? [];
    const primary = runs.find((r) => r.dungeonSlotRole === "PRIMARY");
    const secondary = runs.find((r) => r.dungeonSlotRole === "SECONDARY");
    lines.push(dungeon);
    lines.push(
      `  Blizzard highest key=${ctx?.blizzardBestKeyLevel ?? "n/a"} date=${ctx?.blizzardBestCompletedAt ?? "n/a"}`,
    );
    lines.push(
      `  Public highest WCL key=${ctx?.publicAnalysableBestKeyLevel ?? "n/a"} topPublic=${ctx?.topPublicEvidenceAvailable ?? "n/a"} gap=${ctx?.keyLevelVerificationGap ?? "n/a"}`,
    );
    lines.push(
      `  PRIMARY analysed=${primary?.usedInBoostSample ?? false} sub%=${fmt(primary?.subjectKeyParse, 1)} peerMed=${fmt(primary?.peerMedianKeyParse, 1)} delta=${fmt(primary?.performanceDelta, 1)} ${primary?.gapPolarity ?? "n/a"} deaths=${primary?.deathCount ?? "n/a"} peers=${(primary?.recurringStrongPeers ?? []).join(",") || "none"}`,
    );
    lines.push(
      `  SECONDARY analysed=${secondary?.usedInBoostSample ?? false} sub%=${fmt(secondary?.subjectKeyParse, 1)} peerMed=${fmt(secondary?.peerMedianKeyParse, 1)} delta=${fmt(secondary?.performanceDelta, 1)} ${secondary?.gapPolarity ?? "n/a"}`,
    );
  }

  lines.push("");
  lines.push("SIGNAL CONTRIBUTIONS");
  for (const signal of result.signals) {
    lines.push(
      `  ${signal.code} status=${signal.status} contribution=${signal.contribution} ${signal.summary}`,
    );
  }

  const peerGapSignal = result.signals.find((sig) => sig.code === "STRONG_PEER_PERFORMANCE_GAP");
  const ev = peerGapSignal?.evidence ?? {};
  lines.push("");
  lines.push("PEER GAP");
  lines.push(
    `  analyzablePrimary=${String(ev.comparablePrimaryRunCount ?? "n/a")} redPrimary=${String(ev.redPrimaryCount ?? "n/a")} extremePrimary=${String(ev.extremePrimaryCount ?? "n/a")} greenPrimary=${String(ev.greenPrimaryCount ?? "n/a")}`,
  );
  lines.push(
    `  redEvidence=${String(ev.redPeerEvidence ?? "n/a")} greenEvidence=${String(ev.greenPeerEvidence ?? "n/a")} contribution=${peerGapSignal?.contribution ?? "n/a"}`,
  );
  const cohortSignal = result.signals.find((sig) => sig.code === "RECURRENT_STRONG_PEER_COHORT");
  const identities = Array.isArray(cohortSignal?.evidence.identities)
    ? (cohortSignal.evidence.identities as Array<Record<string, unknown>>)
    : [];
  lines.push("RECURRENT STRONGER PEERS");
  if (identities.length === 0) lines.push("  none");
  for (const id of identities) {
    lines.push(
      `  ${String(id.displayName ?? id.identityKey)} dungeons=${String(id.distinctDungeons ?? "n/a")} weightedAnomalous=${String(id.weightedMaterialGapAppearances ?? "n/a")} medianAdvantage=${String(id.medianPeerAdvantage ?? "n/a")}`,
    );
  }

  lines.push("");
  lines.push("FINAL");
  lines.push(`  status: ${result.status}  completeness: ${result.assessmentCompleteness}`);
  lines.push(`  primary evidence available: ${result.primaryEvidenceAvailable}`);
  lines.push(
    `  suspicion: ${result.suspicionScore ?? "n/a"} / 100  band=${result.suspicionBand ?? "n/a"}`,
  );
  lines.push(`  confidence: ${(result.confidence * 100).toFixed(0)}%`);
  lines.push(
    `  parse coverage: ${fmt(s.parseCoverage, 2)} (${s.parseCoveredRunCount}/${s.boostSampleSize})`,
  );
  lines.push(
    `  peer coverage: ${fmt(s.peerCoverage, 2)} (${s.peerComparableRunCount}/${s.boostSampleSize})`,
  );
  lines.push(`  ranking snapshots: ${(s.rankingSnapshotIds ?? []).length}`);
  lines.push(`  detector: ${result.detectorVersion}`);
  lines.push(`  provider calls: 0`);
  lines.push("");
  lines.push("SCORING SELECTED RUNS vs BOOST INPUT");
  lines.push(`  source: ${lineage.source}`);
  lines.push(`  set equality: ${lineage.setsEqual}`);
  lines.push(
    pad("slot", 22) +
      pad("dung", 18) +
      pad("report", 18) +
      pad("fight", 6) +
      pad("rev", 5) +
      pad("raw?", 6) +
      pad("snap?", 6) +
      "missing",
  );
  for (const slot of lineage.boostSlots) {
    lines.push(
      pad(slot.slotId, 22) +
        pad(slot.dungeonSlug, 18) +
        pad(slot.reportCode ?? "-", 18) +
        pad(String(slot.fightId ?? "-"), 6) +
        pad(String(slot.reportRevision ?? "-"), 5) +
        pad(slot.rawRunId ? "yes" : "no", 6) +
        pad(slot.rankingSnapshotId ? "yes" : "no", 6) +
        `${slot.missingClass ?? ""} Boost used=YES`,
    );
    const slotUrl = wclDamageDoneReportUrl(slot.reportCode, slot.fightId);
    if (slotUrl) lines.push(`    URL: ${slotUrl}`);
  }
  lines.push("");
  for (const signal of result.signals) {
    lines.push(`signal ${signal.code}`);
    lines.push(`  status=${signal.status} contribution=${signal.contribution} confidence=${signal.confidence}`);
    lines.push(`  summary: ${signal.summary}`);
    if (signal.missingReason) lines.push(`  missing: ${signal.missingReason}`);
    lines.push(`  evidence: ${JSON.stringify(signal.evidence)}`);
    lines.push("");
  }
  if (persistedId) lines.push(`persisted assessment id: ${persistedId}`);
  else if (args.persist) lines.push("persist requested but no id returned");
  else lines.push("not persisted (pass --persist to write)");

  process.stdout.write(`${lines.join("\n")}\n`);
  await container.prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
