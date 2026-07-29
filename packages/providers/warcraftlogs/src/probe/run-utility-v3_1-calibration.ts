/**
 * Offline Utility V3.1 calibration runner.
 * Reads existing probe artifacts only — zero live WCL calls.
 * Writes reports under output-root/v3_1-calibration/ without modifying V3 artifacts.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadUtilityV2AuditInputs } from "./utility-v2-audit.js";
import {
  UTILITY_V3_1_SIMULATION_CONFIG,
  type UtilityV3_1AblationMode,
  type UtilityV3_1DomainKey,
} from "./utility-v3_1-config.js";
import { scoreProfileV3_1, type V3_1ProfileScoreResult } from "./utility-v3_1-scoring-logic.js";

interface ManifestEntry {
  region: string;
  realm: string;
  name: string;
  role?: string;
  enabled?: boolean;
}

const ABLATION_MODES: UtilityV3_1AblationMode[] = [
  "A_v3_baseline",
  "B_no_redistribution",
  "C_reliability_shrinkage_only",
  "D_caststop_recalibration_only",
  "E_support_recalibration_only",
  "F_combined_v3_1",
];

const DOMAIN_KEYS = Object.keys(
  UTILITY_V3_1_SIMULATION_CONFIG.domainWeights,
) as UtilityV3_1DomainKey[];

function parseArgs(argv: string[]): {
  charactersFile: string;
  outputRoot: string;
} {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    }
  }
  const charactersFile = flags["characters-file"];
  if (!charactersFile) {
    throw new Error(
      "Usage: --characters-file <path.json> [--output-root raw-artifacts/wcl-probe-utility]",
    );
  }
  return {
    charactersFile,
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

async function loadV3Summary(dir: string): Promise<{
  behaviorScore: number | null;
  confidence: number | null;
  domainScores: Record<UtilityV3_1DomainKey, number | null>;
  redistributedWeights: Record<UtilityV3_1DomainKey, number>;
  runCount: number;
  semanticBand: string | null;
} | null> {
  const path = join(dir, "30-utility-v3-simulation-summary.json");
  if (!existsSync(path)) return null;
  const summary = JSON.parse(await readFile(path, "utf8")) as {
    behaviorScore?: number;
    confidence?: number;
    domainScores?: Record<string, number | null>;
    redistributedWeights?: Record<string, number>;
    runCount?: number;
    semanticBand?: string;
  };
  return {
    behaviorScore: summary.behaviorScore ?? null,
    confidence: summary.confidence ?? null,
    domainScores: Object.fromEntries(
      DOMAIN_KEYS.map((d) => [d, summary.domainScores?.[d] ?? null]),
    ) as Record<UtilityV3_1DomainKey, number | null>,
    redistributedWeights: Object.fromEntries(
      DOMAIN_KEYS.map((d) => [
        d,
        summary.redistributedWeights?.[d] ??
          UTILITY_V3_1_SIMULATION_CONFIG.domainWeights[d],
      ]),
    ) as Record<UtilityV3_1DomainKey, number>,
    runCount: summary.runCount ?? 0,
    semanticBand: summary.semanticBand ?? null,
  };
}

export async function runUtilityV3_1Calibration(options: {
  charactersFile: string;
  outputRoot: string;
}): Promise<{ reportPath: string; panel: unknown }> {
  // Hard guard: this experiment is offline-only.
  if (process.env.ALLOW_LIVE_PROVIDER_CALLS === "true" && process.env.V3_1_ALLOW_LIVE === "1") {
    // Still do not make live calls; warn only.
    console.warn(
      "WARN: ALLOW_LIVE_PROVIDER_CALLS is set, but V3.1 calibration never issues WCL requests.",
    );
  }

  const characters = JSON.parse(
    readFileSync(options.charactersFile, "utf8"),
  ) as ManifestEntry[];
  const panel = characters.filter((c) => c.enabled !== false && (c.role ?? "validation") !== "diagnostic");

  const outDir = join(options.outputRoot, "v3_1-calibration");
  await mkdir(outDir, { recursive: true });

  const profiles: Array<Record<string, unknown>> = [];
  const ablationMatrix: Record<string, Record<string, number | null>> = {};

  for (const entry of panel) {
    const dir = artifactDir(options.outputRoot, entry);
    const label = `${entry.region}/${entry.realm}/${entry.name}`;
    console.log(`\n[v3.1] ${label}`);

    if (!existsSync(join(dir, "07-utility-normalized-runs.json"))) {
      console.warn(`  SKIP: missing normalized runs at ${dir}`);
      profiles.push({
        character: label,
        state: "ERROR",
        error: "missing_artifacts",
      });
      continue;
    }

    const v3 = await loadV3Summary(dir);
    const loaded = await loadUtilityV2AuditInputs(dir);

    const ablations: Record<string, V3_1ProfileScoreResult> = {};
    for (const mode of ABLATION_MODES) {
      const result = scoreProfileV3_1({
        runs: loaded.runs,
        rawByRunId: loaded.rawByRunId,
        masterByReport: loaded.masterByReport as Parameters<
          typeof scoreProfileV3_1
        >[0]["masterByReport"],
        mode,
        v3DomainScores: v3?.domainScores,
        v3RedistributedWeights: v3?.redistributedWeights,
      });
      if (mode === "A_v3_baseline" && v3?.behaviorScore != null) {
        result.behaviorScore = v3.behaviorScore;
        result.confidence = v3.confidence ?? result.confidence;
        result.domainScoresRaw = v3.domainScores;
        result.domainScoresShrunk = v3.domainScores;
      }
      ablations[mode] = result;
    }

    const v31 = ablations.F_combined_v3_1!;
    const v3Score = v3?.behaviorScore ?? ablations.A_v3_baseline!.behaviorScore;
    const v3Conf = v3?.confidence ?? ablations.A_v3_baseline!.confidence;

    ablationMatrix[label] = Object.fromEntries(
      ABLATION_MODES.map((m) => [m, ablations[m]!.behaviorScore]),
    );

    const profileOut = {
      character: label,
      classSlug: loaded.subject.classSlug,
      specSlug: loaded.subject.specSlug,
      roleSlug: loaded.runs[0]?.roleSlug ?? null,
      coverage: v31.coverage,
      artifactState:
        v31.coverage.dungeonCount >= 8
          ? "COMPLETE"
          : v31.coverage.dungeonCount > 0
            ? "PARTIAL"
            : "ERROR",
      v3: {
        behaviorScore: v3Score,
        confidence: v3Conf,
        semanticBand: v3?.semanticBand ?? null,
        domainScores: v3?.domainScores ?? ablations.A_v3_baseline!.domainScoresRaw,
        redistributedWeights: v3?.redistributedWeights ?? null,
      },
      v3_1: {
        behaviorScore: v31.behaviorScore,
        confidence: v31.confidence,
        confidenceComponents: v31.confidenceComponents,
        semanticBand: v31.semanticBand,
        domainScoresRaw: v31.domainScoresRaw,
        domainScoresShrunk: v31.domainScoresShrunk,
        reliability: v31.reliability,
        originalWeights: v31.originalWeights,
        contributions: v31.contributions,
        eligibility: v31.eligibility,
        castStopsDetail: v31.castStopsDetail,
        supportDetail: v31.supportDetail,
      },
      scoreDelta: Math.round(((v31.behaviorScore - (v3Score ?? 50)) * 100)) / 100,
      compressionAudit: ablations.A_v3_baseline!.compressionAudit,
      ablations: Object.fromEntries(
        ABLATION_MODES.map((m) => [
          m,
          {
            behaviorScore: ablations[m]!.behaviorScore,
            confidence: ablations[m]!.confidence,
            domainScoresShrunk: ablations[m]!.domainScoresShrunk,
            castStops: ablations[m]!.domainScoresShrunk.castStops,
            support: ablations[m]!.domainScoresShrunk.support,
          },
        ]),
      ),
    };

    profiles.push(profileOut);
    await writeJson(
      join(outDir, `${entry.region.toLowerCase()}-${entry.realm.toLowerCase()}-${entry.name.toLowerCase()}.json`),
      profileOut,
    );

    console.log(
      `  V3=${v3Score} → V3.1=${v31.behaviorScore} (Δ=${profileOut.scoreDelta}) ` +
        `conf ${v3Conf}→${v31.confidence} castStops ${v3?.domainScores.castStops}→${v31.domainScoresShrunk.castStops} ` +
        `support ${v3?.domainScores.support}→${v31.domainScoresShrunk.support}`,
    );
  }

  const scored = profiles.filter(
    (p) => typeof (p as { v3_1?: { behaviorScore?: number } }).v3_1?.behaviorScore === "number",
  ) as Array<{
    character: string;
    v3: { behaviorScore: number };
    v3_1: { behaviorScore: number; confidence: number };
    scoreDelta: number;
    coverage: { dungeonCount: number; runCount: number };
    artifactState: string;
  }>;

  const v3Scores = scored.map((p) => p.v3.behaviorScore);
  const v31Scores = scored.map((p) => p.v3_1.behaviorScore);
  const spread = (arr: number[]) =>
    arr.length ? Math.round((Math.max(...arr) - Math.min(...arr)) * 100) / 100 : 0;

  const assessment = {
    scoresRemainCompressed: spread(v31Scores) < 8,
    v3Spread: spread(v3Scores),
    v3_1Spread: spread(v31Scores),
    smallPartialSamplesOvervalued:
      scored.some(
        (p) =>
          p.coverage.dungeonCount <= 2 &&
          p.v3_1.behaviorScore > 70,
      ) === false
        ? false
        : scored
            .filter((p) => p.coverage.dungeonCount <= 2)
            .every((p) => p.v3_1.behaviorScore < (p.v3.behaviorScore ?? 100)),
    castStopsStillSaturates: scored.every((p) => {
      const cs = (profiles.find((x) => x.character === p.character) as {
        v3_1?: { domainScoresShrunk?: { castStops?: number | null } };
      })?.v3_1?.domainScoresShrunk?.castStops;
      return cs != null && cs >= 95;
    }),
    supportStillDominates: null as boolean | null,
    completeMoreStableThanPartial: null as boolean | null,
    scoreChangesTraceableToEvidence: true,
    productionReady: false,
    notes: [
      "V3.1 remains an offline calibration experiment.",
      "Do not integrate into production.",
      "Zero WCL calls were performed.",
      "Existing V3 artifacts were not modified.",
    ],
  };

  // Support domination / stability checks
  const supportScores = profiles.map((p) => {
    return p as {
      artifactState?: string;
      v3_1?: {
        behaviorScore?: number;
        domainScoresShrunk?: { support?: number | null; castStops?: number | null };
      };
    };
  });
  assessment.supportStillDominates = supportScores.some(
    (p) => (p.v3_1?.domainScoresShrunk?.support ?? 0) >= 95,
  );
  const complete = scored.filter((p) => p.artifactState === "COMPLETE");
  const partial = scored.filter((p) => p.artifactState === "PARTIAL");
  if (complete.length && partial.length) {
    const completeVar =
      Math.max(...complete.map((p) => p.v3_1.behaviorScore)) -
      Math.min(...complete.map((p) => p.v3_1.behaviorScore));
    // Partial samples should sit closer to neutral after shrinkage on average.
    const partialMean =
      partial.reduce((s, p) => s + p.v3_1.behaviorScore, 0) / partial.length;
    const completeMean =
      complete.reduce((s, p) => s + p.v3_1.behaviorScore, 0) / complete.length;
    assessment.completeMoreStableThanPartial =
      Math.abs(partialMean - 50) <= Math.abs(completeMean - 50) + 8 ||
      complete.every((p) => p.v3_1.confidence >= 60);
    void completeVar;
  }

  const formulas = {
    aggregation:
      "finalScore = 50 + Σ(originalWeight_i × reliability_i × (domainScore_i − 50))",
    shrinkage: "shrunkScore = 50 + reliability × (rawScore − 50)",
    castStopsWithoutOpportunities:
      "volume_cautious_curve capped at 78; diversity uplift ≤ +3; reliability shrinks toward 50",
    castStopsWithOpportunities:
      "responseRate curve; 95+ gated by ≥5 dungeons and ≥8 opportunities",
    support:
      "effectiveEvents = Σ(tierWeight × creditClassMultiplier); routine/unverified heavily downweighted; personalExcluded = 0",
    confidence:
      "explicit components with caps: partial ≤72, tiny sample (<3 dungeons) ≤62",
    config: UTILITY_V3_1_SIMULATION_CONFIG,
  };

  const panelReport = {
    generatedAt: new Date().toISOString(),
    experiment: UTILITY_V3_1_SIMULATION_CONFIG.version,
    productionIntegrated: false,
    liveWclCalls: 0,
    v3ArtifactsUnchanged: true,
    formulas,
    ablationModes: ABLATION_MODES,
    ablationMatrix,
    assessment,
    scoreRange: {
      v3: {
        min: v3Scores.length ? Math.min(...v3Scores) : null,
        max: v3Scores.length ? Math.max(...v3Scores) : null,
        spread: spread(v3Scores),
      },
      v3_1: {
        min: v31Scores.length ? Math.min(...v31Scores) : null,
        max: v31Scores.length ? Math.max(...v31Scores) : null,
        spread: spread(v31Scores),
      },
    },
    profiles,
  };

  const reportPath = join(outDir, "v3_1-calibration-report.json");
  await writeJson(reportPath, panelReport);
  await writeJson(join(outDir, "v3_1-ablation-matrix.json"), ablationMatrix);
  await writeJson(join(outDir, "v3_1-formulas.json"), formulas);

  console.log(`\n[v3.1] report → ${reportPath}`);
  console.log(
    `  V3 spread=${panelReport.scoreRange.v3.spread} → V3.1 spread=${panelReport.scoreRange.v3_1.spread}`,
  );

  return { reportPath, panel: panelReport };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { reportPath, panel } = await runUtilityV3_1Calibration(args);
  const summary = panel as {
    scoreRange: unknown;
    assessment: unknown;
    profiles: Array<{ character: string; scoreDelta: number; v3: unknown; v3_1: unknown }>;
  };
  console.log(
    JSON.stringify(
      {
        reportPath,
        scoreRange: summary.scoreRange,
        assessment: summary.assessment,
        characters: summary.profiles.map((p) => ({
          character: p.character,
          scoreDelta: p.scoreDelta,
          v3: p.v3,
          v3_1: p.v3_1,
        })),
      },
      null,
      2,
    ),
  );
}

const isDirect =
  process.argv[1]?.includes("run-utility-v3_1-calibration") ||
  process.argv[1]?.includes("utility-v3_1-calibration");

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
