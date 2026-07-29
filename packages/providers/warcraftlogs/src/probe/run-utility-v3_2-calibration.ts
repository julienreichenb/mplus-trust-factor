/**
 * Offline Utility V3.2 opportunity-engine calibration.
 * Zero live WCL calls. Does not modify V3/V3.1 artifacts.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadUtilityV2AuditInputs } from "./utility-v2-audit.js";
import {
  auditRawEvidenceForCharacter,
  extractRunOpportunities,
  summarizeOpportunityCoverage,
} from "./utility-opportunity-engine.js";
import type { RawEvidenceAuditFinding } from "./utility-opportunity-types.js";
import { scoreProfileV3_2 } from "./utility-v3_2-scoring-logic.js";
import { runSyntheticFixtureSuite } from "./utility-v3_2-fixtures.js";
import { UTILITY_V3_2_SIMULATION_CONFIG } from "./utility-v3_2-config.js";
import { scoreProfileV3_1 } from "./utility-v3_1-scoring-logic.js";

interface ManifestEntry {
  region: string;
  realm: string;
  name: string;
  role?: string;
  enabled?: boolean;
}

function parseArgs(argv: string[]): { charactersFile: string; outputRoot: string } {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[arg.slice(2)] = next;
      i += 1;
    }
  }
  if (!flags["characters-file"]) {
    throw new Error(
      "Usage: --characters-file <path.json> [--output-root raw-artifacts/wcl-probe-utility]",
    );
  }
  return {
    charactersFile: flags["characters-file"]!,
    outputRoot:
      flags["output-root"]?.trim() ||
      join(process.cwd(), "raw-artifacts", "wcl-probe-utility"),
  };
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function artifactDir(outputRoot: string, entry: ManifestEntry): string {
  return join(
    outputRoot,
    `${entry.region.toLowerCase()}-${entry.realm.toLowerCase()}-${entry.name.toLowerCase()}`,
  );
}

async function loadJsonIfExists<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function runUtilityV3_2Calibration(options: {
  charactersFile: string;
  outputRoot: string;
}): Promise<{ reportPath: string }> {
  console.log(
    "wcl.probe.utility.v3_2-calibration — offline only (zero WCL calls)",
  );

  const characters = JSON.parse(
    readFileSync(options.charactersFile, "utf8"),
  ) as ManifestEntry[];
  const panel = characters.filter(
    (c) => c.enabled !== false && (c.role ?? "validation") !== "diagnostic",
  );

  const outDir = join(options.outputRoot, "v3_2-calibration");
  await mkdir(outDir, { recursive: true });

  const profiles: Array<Record<string, unknown>> = [];
  const audits: RawEvidenceAuditFinding[] = [];

  for (const entry of panel) {
    const dir = artifactDir(options.outputRoot, entry);
    const label = `${entry.region}/${entry.realm}/${entry.name}`;
    console.log(`\n[v3.2] ${label}`);

    if (!existsSync(join(dir, "07-utility-normalized-runs.json"))) {
      console.warn(`  SKIP missing artifacts`);
      continue;
    }

    const casts = (await loadJsonIfExists<
      Array<{ dataset?: { events?: Array<Record<string, unknown>>; filterSourceId?: number | null } }>
    >(join(dir, "04-casts-raw.json"))) ?? [];
    const interrupts = (await loadJsonIfExists<
      Array<{ dataset?: { events?: Array<Record<string, unknown>> } }>
    >(join(dir, "03-interrupts-raw.json"))) ?? [];
    const buffs = (await loadJsonIfExists<
      Array<{
        buffs?: { events?: Array<Record<string, unknown>> };
        debuffs?: { events?: Array<Record<string, unknown>> };
      }>
    >(join(dir, "05-buffs-debuffs-raw.json"))) ?? [];
    const dispels = (await loadJsonIfExists<
      Array<{ dataset?: { events?: Array<Record<string, unknown>> } }>
    >(join(dir, "06-dispels-raw.json"))) ?? [];

    const loaded = await loadUtilityV2AuditInputs(dir);
    const audit = auditRawEvidenceForCharacter({
      character: label,
      castRuns: casts,
      interruptRuns: interrupts,
      buffRuns: buffs,
      dispelRuns: dispels,
      normalizedRuns: loaded.runs,
      deathsArtifactPresent: existsSync(join(dir, "03-deaths-raw.json")),
    });
    audits.push(audit);

    const opportunities = loaded.runs.flatMap((normalized) => {
      const runId = `${normalized.reportCode}:${normalized.fightId}`;
      const raw = loaded.rawByRunId.get(runId);
      return extractRunOpportunities({
        normalized,
        raw,
        castEvents: raw?.casts,
        interruptEvents: raw?.interrupts,
      });
    });

    const coverage = summarizeOpportunityCoverage(label, opportunities, {
      runs: loaded.runs.length,
      dungeons: new Set(loaded.runs.map((r) => r.dungeonSlug)).size,
      hostileCastWindowsAvailable: audit.castsNpcSourceCount > 0,
      mechanicCatalogPriorityInterrupts: 0,
    });

    const v3Summary = await loadJsonIfExists<{
      behaviorScore?: number;
      confidence?: number;
      domainScores?: Record<string, number | null>;
    }>(join(dir, "30-utility-v3-simulation-summary.json"));

    const v31 = scoreProfileV3_1({
      runs: loaded.runs,
      rawByRunId: loaded.rawByRunId,
      masterByReport: loaded.masterByReport as Parameters<
        typeof scoreProfileV3_1
      >[0]["masterByReport"],
      mode: "F_combined_v3_1",
      v3DomainScores: v3Summary?.domainScores as never,
    });

    const v32 = scoreProfileV3_2({
      runs: loaded.runs,
      rawByRunId: loaded.rawByRunId,
      masterByReport: loaded.masterByReport as Parameters<
        typeof scoreProfileV3_2
      >[0]["masterByReport"],
      opportunities,
    });

    const profile = {
      character: label,
      classSlug: loaded.subject.classSlug,
      specSlug: loaded.subject.specSlug,
      coverage: v32.coverage,
      artifactState:
        v32.coverage.dungeonCount >= 8
          ? "COMPLETE"
          : v32.coverage.dungeonCount > 0
            ? "PARTIAL"
            : "ERROR",
      v3: {
        behaviorScore: v3Summary?.behaviorScore ?? null,
        confidence: v3Summary?.confidence ?? null,
        domainScores: v3Summary?.domainScores ?? null,
      },
      v3_1: {
        behaviorScore: v31.behaviorScore,
        confidence: v31.confidence,
        domainScoresShrunk: v31.domainScoresShrunk,
      },
      v3_2: {
        rawBehaviorEstimate: v32.rawBehaviorEstimate,
        reliabilityAdjustedScore: v32.reliabilityAdjustedScore,
        confidence: v32.confidence,
        confidenceComponents: v32.confidenceComponents,
        reliability: v32.reliability,
        domainRaw: v32.domainRaw,
        castStops: v32.castStops,
        support: v32.support
          ? {
              rawScore: v32.support.rawScore,
              bySemantic: v32.support.bySemantic,
              byAbility: v32.support.byAbility.slice(0, 12),
              reactiveShare: v32.support.reactiveShare,
              notes: v32.support.notes,
            }
          : null,
      },
      opportunityCoverage: coverage,
      evidenceByHostileSpell: summarizeHostileSpells(opportunities),
    };

    profiles.push(profile);
    await writeJson(
      join(
        outDir,
        `${entry.region.toLowerCase()}-${entry.realm.toLowerCase()}-${entry.name.toLowerCase()}.json`,
      ),
      profile,
    );

    console.log(
      `  V3=${v3Summary?.behaviorScore ?? "?"} V3.1=${v31.behaviorScore} ` +
        `V3.2 raw=${v32.rawBehaviorEstimate} adj=${v32.reliabilityAdjustedScore} conf=${v32.confidence} ` +
        `intSuccessImplied=${coverage.interruptSuccessImplied} misses=${coverage.interruptConfirmedMisses} ` +
        `castStops=${v32.castStops.mode}/${v32.castStops.rawScore}`,
    );
  }

  const fixtures = runSyntheticFixtureSuite();
  const fixtureValidation = {
    monotonicMissesLowerScore:
      (fixtures.find((f) => f.id === "all_successfully_handled")?.castStopsRaw ?? 0) >
        (fixtures.find((f) => f.id === "half_missed")?.castStopsRaw ?? 0) &&
      (fixtures.find((f) => f.id === "half_missed")?.castStopsRaw ?? 0) >
        (fixtures.find((f) => f.id === "all_missed")?.castStopsRaw ?? 0),
    allMissBelow50:
      (fixtures.find((f) => f.id === "all_missed")?.castStopsRaw ?? 100) < 50,
    passiveSupportNotElite:
      (fixtures.find((f) => f.id === "passive_support_spam")?.supportRaw ?? 100) <= 65,
    reactiveBeatsPassive:
      (fixtures.find((f) => f.id === "reactive_high_impact_support")?.supportRaw ?? 0) >
      (fixtures.find((f) => f.id === "passive_support_spam")?.supportRaw ?? 100),
    lowVolumeQualityCanBeatHighVolumePoor:
      (fixtures.find((f) => f.id === "low_volume_perfect_dangerous")?.castStopsRaw ?? 0) >
      (fixtures.find((f) => f.id === "high_volume_poor_priority")?.castStopsRaw ?? 100),
    identicalBehaviorRawClose:
      Math.abs(
        (fixtures.find((f) => f.id === "small_sample_identical_behavior")?.castStopsRaw ?? 0) -
          (fixtures.find((f) => f.id === "complete_sample_identical_behavior")?.castStopsRaw ??
            0),
      ) < 5,
  };

  const adjScores = profiles
    .map((p) => (p as { v3_2?: { reliabilityAdjustedScore?: number } }).v3_2?.reliabilityAdjustedScore)
    .filter((x): x is number => typeof x === "number");
  const rawScores = profiles
    .map((p) => (p as { v3_2?: { rawBehaviorEstimate?: number } }).v3_2?.rawBehaviorEstimate)
    .filter((x): x is number => typeof x === "number");

  const report = {
    generatedAt: new Date().toISOString(),
    experiment: UTILITY_V3_2_SIMULATION_CONFIG.version,
    productionIntegrated: false,
    liveWclCalls: 0,
    v3ArtifactsUnchanged: true,
    v31ArtifactsUnchanged: true,
    formulas: {
      castStopsPrimary:
        "severity-weighted response rate over HIGH/MEDIUM player-actionable interrupt opportunities",
      castStopsFallback:
        "volume curve capped at 76 when miss denominator not observable",
      support:
        "semantic classes PERSONAL_MOBILITY=0, ROUTINE=0.08, REACTIVE/STRATEGIC/EMERGENCY full credit",
      rawBehaviorEstimate: "50 + Σ(w × (domainRaw − 50)) — no coverage shrinkage",
      reliabilityAdjustedScore: "50 + reliability × (rawBehaviorEstimate − 50)",
      confidence: "coverage/evidence components only",
      config: UTILITY_V3_2_SIMULATION_CONFIG,
    },
    sharedIngestionCompatibility: {
      consumes: [
        "run selection",
        "masterData",
        "casts (requires hostile NPC casts for miss observability)",
        "buffs/debuffs",
        "interrupts",
        "dispels",
        "actor resolution",
      ],
      doesNotFetchWcl: true,
      additionalUtilityDatasetsRequired: [
        {
          dataset: "Casts without player-only source filter (hostile NPC begincast/cast/castfailed)",
          reason:
            "Confirmed interrupt misses require hostile cast windows + interruptible evidence. Current artifacts only contain friendly player casts.",
          liveFetchJustified: true,
          performedInThisExperiment: false,
        },
        {
          dataset: "Deaths (optional, for disable/alive checks)",
          reason: "Improve miss confidence when player was dead/incapacitated",
          liveFetchJustified: false,
          performedInThisExperiment: false,
        },
        {
          dataset: "Active-season PRIORITY_INTERRUPT mechanic catalog",
          reason: "Severity weighting; currently seed/empty",
          liveFetchJustified: false,
          performedInThisExperiment: false,
        },
      ],
    },
    rawEvidenceAudit: audits,
    syntheticFixtures: fixtures,
    fixtureValidation,
    scoreRange: {
      v3_2_raw: rangeOf(rawScores),
      v3_2_adjusted: rangeOf(adjScores),
    },
    assessment: {
      realInterruptMissesExtractable: audits.some((a) => a.canDeriveInterruptMissesOffline),
      realInterruptSuccessesExtractable: audits.every(
        (a) => a.canDeriveInterruptSuccessesOffline,
      ),
      panelScoresBelow50: adjScores.some((s) => s < 50),
      reasonNoBelow50OnPanel:
        "No hostile NPC cast stream in persisted artifacts ⇒ no CAST_COMPLETED_CONFIRMED_MISS on live panel. Synthetic fixtures demonstrate below-50 with confirmed misses.",
      productionReady: false,
      notes: [
        "Do not integrate Utility into production.",
        "Zero WCL calls performed.",
        "Hostile cast ingestion is the proven blocker for real miss opportunities.",
      ],
    },
    profiles,
  };

  const reportPath = join(outDir, "v3_2-calibration-report.json");
  await writeJson(reportPath, report);
  await writeJson(join(outDir, "v3_2-raw-evidence-audit.json"), audits);
  await writeJson(join(outDir, "v3_2-synthetic-fixtures.json"), {
    fixtures,
    fixtureValidation,
  });
  await writeJson(join(outDir, "v3_2-formulas.json"), report.formulas);

  console.log(`\n[v3.2] report → ${reportPath}`);
  console.log(
    `  fixtureValidation`,
    JSON.stringify(fixtureValidation),
  );
  return { reportPath };
}

function rangeOf(arr: number[]): { min: number | null; max: number | null; spread: number | null } {
  if (!arr.length) return { min: null, max: null, spread: null };
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  return { min, max, spread: Math.round((max - min) * 100) / 100 };
}

function summarizeHostileSpells(
  opportunities: Array<{ hostileSpellId: number | null; outcome: string; opportunityType: string }>,
): Array<{ hostileSpellId: number; successes: number; misses: number; total: number }> {
  const map = new Map<number, { successes: number; misses: number; total: number }>();
  for (const o of opportunities) {
    if (o.opportunityType !== "interrupt" || o.hostileSpellId == null) continue;
    const row = map.get(o.hostileSpellId) ?? { successes: 0, misses: 0, total: 0 };
    row.total += 1;
    if (o.outcome === "SUCCESS_DIRECT_INTERRUPT" || o.outcome === "SUCCESS_ALTERNATIVE_STOP") {
      row.successes += 1;
    }
    if (o.outcome === "CAST_COMPLETED_CONFIRMED_MISS") row.misses += 1;
    map.set(o.hostileSpellId, row);
  }
  return [...map.entries()]
    .map(([hostileSpellId, v]) => ({ hostileSpellId, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { reportPath } = await runUtilityV3_2Calibration(args);
  console.log(JSON.stringify({ reportPath, ok: true }, null, 2));
}

if (
  process.argv[1]?.includes("run-utility-v3_2-calibration") ||
  process.argv[1]?.includes("utility-v3_2-calibration")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
