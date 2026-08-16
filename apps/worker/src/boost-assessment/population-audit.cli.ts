/**
 * Provider-free Boost v2.0 vs v2.1 population replay (local persisted evidence only).
 *
 * Intentional developer tooling, same class as `boost:probe`:
 * - never calls Blizzard, Warcraft Logs, or Raider.IO
 * - never writes CharacterBoostAssessment or CharacterScore
 *
 *   pnpm boost:population-audit
 *   pnpm --filter @mplus/worker run boost:population-audit
 */
import { loadEnv, resetEnvCache } from "@mplus/config";
import {
  assessBoostSuspicionV1,
  BOOST_ASSESSMENT_POLICY,
  dungeonRunSlotWeight,
  toPublicBoostAssessment,
  type BoostAnalyzedRunRow,
  type BoostAssessmentResult,
} from "@mplus/scoring";
import { createWorkerContainer } from "../container.js";
import { loadBoostAssessmentEvidence } from "./load-persisted-evidence.js";

function isRed(cls: string): boolean {
  return cls === "RED_MATERIAL" || cls === "RED_EXTREME" || cls === "MATERIAL_GAP" || cls === "EXTREME_GAP";
}

function isExtreme(cls: string): boolean {
  return cls === "RED_EXTREME" || cls === "EXTREME_GAP";
}

function bandFor(score: number | null): "LOW" | "ELEVATED" | "HIGH" | null {
  if (score == null) return null;
  if (score >= BOOST_ASSESSMENT_POLICY.bands.highMin) return "HIGH";
  if (score >= BOOST_ASSESSMENT_POLICY.bands.elevatedMin) return "ELEVATED";
  return "LOW";
}

function oldClassify(subject: number, peer: number): "RED_EXTREME" | "RED_MATERIAL" | "GREEN_EXTREME" | "GREEN_MATERIAL" | "NEUTRAL" {
  const delta = subject - peer;
  if (delta <= -50 && subject <= 20 && peer >= 80) return "RED_EXTREME";
  if (delta <= -25) return "RED_MATERIAL";
  if (delta >= 50) return "GREEN_EXTREME";
  if (delta >= 25) return "GREEN_MATERIAL";
  return "NEUTRAL";
}

function signedDeltaSeverity(absDelta: number): number {
  if (!Number.isFinite(absDelta) || absDelta < 15) return 0;
  const t = (absDelta - 15) / (70 - 15);
  const clamped = Math.max(0, Math.min(1, t));
  return clamped ** 1.35;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalizeRate(rate: number, onset: number, saturation: number): number {
  if (!Number.isFinite(rate) || saturation <= onset) return 0;
  if (rate <= onset) return 0;
  if (rate >= saturation) return 1;
  return (rate - onset) / (saturation - onset);
}

function oldPeerFromAnalyzed(rows: BoostAnalyzedRunRow[]): {
  contribution: number;
  extremePrimaryDungeonCount: number;
} {
  const comparable = rows.filter(
    (r) =>
      r.usedInBoostSample &&
      r.subjectKeyParse != null &&
      r.peerMedianKeyParse != null &&
      Number.isFinite(r.subjectKeyParse) &&
      Number.isFinite(r.peerMedianKeyParse),
  );
  if (comparable.length < BOOST_ASSESSMENT_POLICY.minPeerComparableRuns) {
    return { contribution: 0, extremePrimaryDungeonCount: 0 };
  }
  let comparableWeight = 0;
  let redMass = 0;
  let greenMass = 0;
  let materialWeight = 0;
  let extremeWeight = 0;
  const extremeDungeons = new Set<string>();
  for (const row of comparable) {
    const subject = row.subjectKeyParse!;
    const peer = row.peerMedianKeyParse!;
    const delta = subject - peer;
    const cls = oldClassify(subject, peer);
    const weight = dungeonRunSlotWeight(row.slotIndex);
    const sev = signedDeltaSeverity(Math.abs(delta));
    const red = delta < 0 ? sev : 0;
    const green = delta > 0 ? sev : 0;
    comparableWeight += weight;
    redMass += red * weight;
    greenMass += green * weight;
    if (isRed(cls)) materialWeight += weight;
    if (isExtreme(cls)) {
      extremeWeight += weight;
      if (row.dungeonSlotRole === "PRIMARY" && row.dungeonSlug) extremeDungeons.add(row.dungeonSlug);
    }
  }
  const weightedRedSeverity = comparableWeight > 0 ? redMass / comparableWeight : 0;
  const weightedGreenSeverity = comparableWeight > 0 ? greenMass / comparableWeight : 0;
  const weightedMaterialRate = comparableWeight > 0 ? materialWeight / comparableWeight : 0;
  const weightedExtremeRate = comparableWeight > 0 ? extremeWeight / comparableWeight : 0;
  const recurrence = Math.max(
    normalizeRate(weightedMaterialRate, 0.2, 0.65),
    normalizeRate(weightedExtremeRate, 0.2, 0.5),
  );
  let redValue = clamp(
    weightedRedSeverity * Math.max(recurrence, weightedRedSeverity > 0.8 ? 1 : recurrence),
    0,
    1,
  );
  let value = clamp(redValue - 0.5 * weightedGreenSeverity, 0, 1);
  const extremeDungeonCount = extremeDungeons.size;
  if (extremeDungeonCount >= 4) {
    value = Math.max(value, 0.9);
    redValue = Math.max(redValue, 0.9);
  }
  return {
    contribution: Number((value * BOOST_ASSESSMENT_POLICY.weights.strongPeerPerformanceGap).toFixed(2)),
    extremePrimaryDungeonCount: extremeDungeonCount,
  };
}

function oldCombine(args: {
  peer: number;
  cohort: number;
  deaths: number;
  missing: number;
  temporal: number;
  extremePrimaryDungeonCount: number;
  signalsPositive: Array<{ code: string; contribution: number }>;
}): number {
  const direct = args.peer + args.cohort;
  const behavioral = args.deaths;
  let context = args.missing + args.temporal;
  if (direct + behavioral < 25) context = Math.min(context, 28);
  let raw = direct + behavioral + context;
  const positive = args.signalsPositive.filter((s) => s.contribution > 0.5);
  if (positive.length === 1 && positive[0]?.code === "RECURRENT_STRONG_PEER_COHORT") raw = Math.min(raw, 22);
  if (positive.length === 1 && positive[0]?.code === "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE") raw = Math.min(raw, 22);
  if (positive.length === 1 && positive[0]?.code === "HIGHEST_RUN_TEMPORAL_CLUSTER") raw = Math.min(raw, 15);
  if (args.extremePrimaryDungeonCount >= 5) raw = Math.max(raw, 82);
  else if (args.extremePrimaryDungeonCount >= 4) raw = Math.max(raw, 72);
  return clamp(Math.round(raw), 0, 100);
}

function contrib(result: BoostAssessmentResult, code: string): number {
  return result.signals.find((s) => s.code === code && s.status === "COMPUTED")?.contribution ?? 0;
}

function floorReasons(input: {
  analyzablePrimaryRunCount: number;
  redPrimaryCount: number;
  veryStrongPrimaryCount: number;
  extremePrimaryDungeonCount: number;
  medianPrimaryPerformanceDelta: number | null;
}): { floor: number; reasons: string[] } {
  const n = input.analyzablePrimaryRunCount;
  const median = input.medianPrimaryPerformanceDelta;
  const reasons: string[] = [];
  if (input.extremePrimaryDungeonCount >= 5) reasons.push(">=5 extreme PRIMARY dungeons => 82");
  if (n >= 4 && input.veryStrongPrimaryCount >= 4) reasons.push(">=4 very-strong PRIMARY (n>=4) => 74");
  if (n >= 4 && input.extremePrimaryDungeonCount >= 3 && median != null && median <= -40) {
    reasons.push(">=3 extreme PRIMARY + median<=-40 (n>=4) => 72");
  }
  if (n >= 5 && input.redPrimaryCount >= 5 && median != null && median <= -35) {
    reasons.push(">=5 material PRIMARY + median<=-35 (n>=5) => 72");
  }
  if (
    n >= 6 &&
    input.redPrimaryCount >= 4 &&
    input.veryStrongPrimaryCount >= 3 &&
    median != null &&
    median <= -30
  ) {
    reasons.push(">=4 material + >=3 very-strong of n>=6 + median<=-30 => 70");
  }
  const floor = Math.max(
    input.extremePrimaryDungeonCount >= 5 ? 82 : 0,
    n >= 4 && input.veryStrongPrimaryCount >= 4 ? 74 : 0,
    n >= 4 && input.extremePrimaryDungeonCount >= 3 && median != null && median <= -40 ? 72 : 0,
    n >= 5 && input.redPrimaryCount >= 5 && median != null && median <= -35 ? 72 : 0,
    n >= 6 &&
      input.redPrimaryCount >= 4 &&
      input.veryStrongPrimaryCount >= 3 &&
      median != null &&
      median <= -30
      ? 70
      : 0,
  );
  return { floor, reasons: reasons.length ? reasons : ["none"] };
}

function pad(s: string, n: number): string {
  const t = s.length > n ? s.slice(0, n) : s;
  return t + " ".repeat(Math.max(0, n - t.length));
}

async function main() {
  resetEnvCache();
  const env = loadEnv();
  const container = createWorkerContainer(env);
  const pairs = await container.prisma.characterScore.findMany({
    distinct: ["characterId", "seasonId"],
    select: { characterId: true, seasonId: true },
  });
  const chars = await container.prisma.character.findMany({
    where: { id: { in: [...new Set(pairs.map((p) => p.characterId))] } },
    select: { id: true, displayName: true, realm: { select: { slug: true } }, region: { select: { code: true } } },
  });
  const byId = new Map(chars.map((c) => [c.id, c]));

  type Row = {
    label: string;
    analyzablePrimary: number;
    median: number | null;
    material: number;
    veryStrong: number;
    extreme: number;
    oldScore: number | null;
    oldBand: string;
    newScore: number | null;
    newBand: string;
    scoreDelta: string;
    transition: string;
    floor: string;
    primaryDeltas: number[];
    primaryRows: BoostAnalyzedRunRow[];
  };
  const applicable: Row[] = [];
  let skipped = 0;
  let failed = 0;

  for (const pair of pairs) {
    const identity = byId.get(pair.characterId);
    const label = identity
      ? `${identity.displayName}-${identity.realm.slug} ${identity.region?.code ?? ""}`.trim()
      : pair.characterId;
    try {
      const evidence = await loadBoostAssessmentEvidence({
        prisma: container.prisma,
        characterId: pair.characterId,
        seasonId: pair.seasonId,
      });
      if (evidence.lineage.source === "missing" || evidence.runs.length === 0) {
        skipped += 1;
        continue;
      }
      const v21 = assessBoostSuspicionV1({
        subjectCharacterId: pair.characterId,
        seasonId: pair.seasonId,
        calculatedAt: "2026-08-16T00:00:00.000Z",
        runs: evidence.runs,
        seasonHighKeyContext: evidence.seasonHighKeyContext,
        dungeonContexts: evidence.dungeonContexts,
      });
      const pub = toPublicBoostAssessment(v21);
      if (pub.applicability.status !== "APPLICABLE") {
        skipped += 1;
        continue;
      }
      const analyzed = v21.sample.analyzedRuns ?? [];
      const primary = analyzed.filter(
        (r) =>
          r.dungeonSlotRole === "PRIMARY" &&
          r.usedInBoostSample &&
          r.performanceDelta != null &&
          Number.isFinite(r.performanceDelta),
      );
      const deltas = primary.map((r) => r.performanceDelta!);
      const sorted = [...deltas].sort((a, b) => a - b);
      const median =
        sorted.length === 0
          ? null
          : sorted.length % 2 === 1
            ? sorted[(sorted.length - 1) / 2]!
            : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
      const material = primary.filter((r) => r.performanceDelta! <= -25).length;
      const veryStrong = primary.filter((r) => r.performanceDelta! <= -40).length;
      const extreme = primary.filter((r) => r.performanceDelta! <= -50).length;
      const extremeDungeons = new Set(
        primary.filter((r) => isExtreme(r.gapClass) && r.dungeonSlug).map((r) => r.dungeonSlug!),
      );
      const oldPeer = oldPeerFromAnalyzed(analyzed);
      const peerNew = contrib(v21, "STRONG_PEER_PERFORMANCE_GAP");
      const cohort = contrib(v21, "RECURRENT_STRONG_PEER_COHORT");
      const deaths = contrib(v21, "HIGH_KEY_SURVIVAL_MISMATCH");
      const missing = contrib(v21, "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE");
      const temporal = contrib(v21, "HIGHEST_RUN_TEMPORAL_CLUSTER");
      const oldScore = v21.suspicionScore == null
        ? null
        : oldCombine({
            peer: oldPeer.contribution,
            cohort,
            deaths,
            missing,
            temporal,
            extremePrimaryDungeonCount: oldPeer.extremePrimaryDungeonCount,
            signalsPositive: [
              { code: "STRONG_PEER_PERFORMANCE_GAP", contribution: oldPeer.contribution },
              { code: "RECURRENT_STRONG_PEER_COHORT", contribution: cohort },
              { code: "HIGH_KEY_SURVIVAL_MISMATCH", contribution: deaths },
              { code: "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE", contribution: missing },
              { code: "HIGHEST_RUN_TEMPORAL_CLUSTER", contribution: temporal },
            ],
          });
      const newScore = v21.suspicionScore;
      const oldBand = bandFor(oldScore) ?? "n/a";
      const newBand = v21.suspicionBand ?? "n/a";
      const floors = floorReasons({
        analyzablePrimaryRunCount: primary.length,
        redPrimaryCount: material,
        veryStrongPrimaryCount: veryStrong,
        extremePrimaryDungeonCount: extremeDungeons.size,
        medianPrimaryPerformanceDelta: median,
      });
      applicable.push({
        label,
        analyzablePrimary: primary.length,
        median,
        material,
        veryStrong,
        extreme,
        oldScore,
        oldBand,
        newScore,
        newBand,
        scoreDelta: oldScore == null || newScore == null ? "n/a" : String(newScore - oldScore),
        transition: `${oldBand} -> ${newBand}`,
        floor: floors.floor > 0 ? `${floors.floor} (${floors.reasons.join("; ")})` : "none",
        primaryDeltas: deltas,
        primaryRows: primary,
      });
      void peerNew;
    } catch (err) {
      failed += 1;
      process.stderr.write(`FAIL ${label}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  applicable.sort((a, b) => a.label.localeCompare(b.label));
  const lines: string[] = [];
  lines.push(`APPLICABLE replayed: ${applicable.length}  skipped_non_applicable_or_missing=${skipped}  failed=${failed}`);
  lines.push("");
  lines.push(
    pad("character", 36) +
      pad("nP", 4) +
      pad("medΔ", 8) +
      pad("mat", 4) +
      pad("vS", 4) +
      pad("ext", 4) +
      pad("old", 8) +
      pad("oBand", 10) +
      pad("new", 8) +
      pad("nBand", 10) +
      pad("dScore", 8) +
      pad("transition", 22) +
      "floor",
  );
  for (const r of applicable) {
    lines.push(
      pad(r.label, 36) +
        pad(String(r.analyzablePrimary), 4) +
        pad(r.median == null ? "n/a" : r.median.toFixed(1), 8) +
        pad(String(r.material), 4) +
        pad(String(r.veryStrong), 4) +
        pad(String(r.extreme), 4) +
        pad(r.oldScore == null ? "n/a" : String(r.oldScore), 8) +
        pad(r.oldBand, 10) +
        pad(r.newScore == null ? "n/a" : String(r.newScore), 8) +
        pad(r.newBand, 10) +
        pad(r.scoreDelta, 8) +
        pad(r.transition, 22) +
        r.floor,
    );
  }

  const counts = new Map<string, number>();
  for (const r of applicable) counts.set(r.transition, (counts.get(r.transition) ?? 0) + 1);
  lines.push("");
  lines.push("TRANSITION MATRIX");
  for (const [k, v] of [...counts.entries()].sort()) lines.push(`  ${k}: ${v}`);

  const newlyHigh = applicable.filter((r) => r.oldBand !== "HIGH" && r.newBand === "HIGH");
  lines.push("");
  lines.push(`NEWLY HIGH: ${newlyHigh.length}`);
  for (const r of newlyHigh) {
    lines.push(`--- ${r.label} old=${r.oldScore}/${r.oldBand} new=${r.newScore}/${r.newBand} floor=${r.floor}`);
    lines.push(
      `  n=${r.analyzablePrimary} median=${r.median?.toFixed(2) ?? "n/a"} material=${r.material} veryStrong=${r.veryStrong} extreme=${r.extreme}`,
    );
    for (const row of r.primaryRows) {
      lines.push(
        `  PRIMARY ${row.dungeonSlug} sub=${row.subjectKeyParse} peer=${row.peerMedianKeyParse} Δ=${row.performanceDelta} class=${row.gapClass}`,
      );
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  await container.prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
