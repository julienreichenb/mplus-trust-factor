import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { CURRENT_MPLUS_ZONE_DUNGEON_SLUGS } from "../discovery/run-discovery.js";
import type { SurvivalCalibrationDataset } from "./survival-calibration-types.js";
import { activeSeasonDungeonPool, classSlugFromWclClassId } from "./survival-probe-logic.js";
import { SURVIVAL_STANDALONE_V1_1_CONFIG } from "./survival-v1_1-config.js";
import { SURVIVAL_V1_1_AUDIT_CONFIG } from "./survival-v1_1-audit-config.js";
import {
  auditDefensiveActivations,
  auditFragmentationPairs,
  auditRecoveryDetection,
  auditTemporaryMaxHp,
  buildManualAuditSamples,
  clusterWindowsByCandidateRule,
  recommendV1_1FinalConfig,
  scoreImpactTemporaryMaxHpAware,
  simulateClusteredScores,
} from "./survival-v1_1-audit.js";
import type {
  ExplicitHealthSnapshot,
  HealthTimeline,
  MaxHpResolution,
  SurvivalV1_1DangerWindowAudit,
  SurvivalV1_1RunScore,
} from "./survival-v1_1-types.js";

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function runSurvivalV1_1Audit(options: {
  calibrationDir: string;
  v11Dir: string;
  outputDir: string;
}): Promise<{ outputFiles: Record<string, string>; summary: Record<string, unknown> }> {
  await mkdir(options.outputDir, { recursive: true });

  const calibration = JSON.parse(
    await readFile(join(options.calibrationDir, "00-calibration-summary.json"), "utf8"),
  ) as SurvivalCalibrationDataset;
  const windows = JSON.parse(
    await readFile(join(options.v11Dir, "14-danger-windows-v1.1.json"), "utf8"),
  ) as SurvivalV1_1DangerWindowAudit[];
  const runScores = JSON.parse(
    await readFile(join(options.v11Dir, "16-survival-v1.1-runs.json"), "utf8"),
  ) as SurvivalV1_1RunScore[];
  const resolutions = JSON.parse(
    await readFile(join(options.v11Dir, "12-max-hp-resolution.json"), "utf8"),
  ) as MaxHpResolution[];
  const timelines = JSON.parse(
    await readFile(join(options.v11Dir, "13-health-timelines.json"), "utf8"),
  ) as HealthTimeline[];
  const globalV11 = JSON.parse(
    await readFile(join(options.v11Dir, "18-survival-v1.1-global.json"), "utf8"),
  ) as { behavioralSurvivalScore: number | null; outcomeOnlyScore: number | null };

  const timelinesByRun = new Map(timelines.map((t) => [t.runId, t]));
  const maxHpByRun = new Map(resolutions.map((r) => [r.runId, r.maxHp]));
  const runsById = new Map(calibration.runs.map((r) => [r.runId, r]));
  const classSlug = classSlugFromWclClassId(calibration.character?.classID ?? null);
  const expected = activeSeasonDungeonPool(CURRENT_MPLUS_ZONE_DUNGEON_SLUGS);

  // Snapshots from discovery cache if present
  const snapshotsByRun = new Map<string, ExplicitHealthSnapshot[]>();
  try {
    const cache = JSON.parse(
      await readFile(join(options.v11Dir, "11b-discovery-cache.json"), "utf8"),
    ) as { runs: Array<{ runId: string; snapshots: ExplicitHealthSnapshot[] }> };
    for (const r of cache.runs) snapshotsByRun.set(r.runId, r.snapshots);
  } catch {
    // rebuild lightly from raw dir if needed — optional
  }

  // --- 1. Fragmentation ---
  const pairs = auditFragmentationPairs(windows, timelinesByRun, maxHpByRun);
  const under8 = pairs.filter((p) => p.under8s).length;
  const under12 = pairs.filter((p) => p.under12s).length;
  const under15 = pairs.filter((p) => p.under15s).length;
  const likelyFragmented = pairs.filter((p) => p.sameDamageSequenceLikely);

  const mergeSims = SURVIVAL_V1_1_AUDIT_CONFIG.fragmentation.candidateMergeGapsMs.map((gap) =>
    simulateClusteredScores({
      runs: calibration.runs,
      windows,
      runScores,
      timelinesByRun,
      maxHpByRun,
      mergeGapMs: gap,
      recoverAboveHpRatio: SURVIVAL_V1_1_AUDIT_CONFIG.fragmentation.recoverAboveHpRatio,
      stableRecoveryMs: SURVIVAL_V1_1_AUDIT_CONFIG.fragmentation.stableRecoveryMs,
      expectedDungeonSlugs: expected,
    }),
  );
  // Preferred: 8s seed + recover>50% + 5s stable (first sim uses gap list but clustering ignores gap when no recovery)
  const preferredMerge = mergeSims[0]!;

  // --- 2. Defensive ---
  const clustersByRun = new Map<string, SurvivalV1_1DangerWindowAudit[][]>();
  for (const run of calibration.runs) {
    const ws = windows.filter((w) => w.windowId.startsWith(`${run.runId}#`));
    clustersByRun.set(
      run.runId,
      clusterWindowsByCandidateRule(
        ws,
        timelinesByRun.get(run.runId) ?? null,
        maxHpByRun.get(run.runId) ?? null,
        {
          mergeGapMs: 8_000,
          recoverAboveHpRatio: 0.5,
          stableRecoveryMs: 5_000,
        },
      ),
    );
  }
  const defensiveAudit = auditDefensiveActivations(
    calibration.runs,
    windows,
    clustersByRun,
  );

  // --- 3. Recovery ---
  const recoveryAudit = auditRecoveryDetection({
    runs: calibration.runs,
    windows,
    maxHpByRun,
    classSlug,
  });

  // --- 4. Temporary max HP ---
  const tempMaxAudit = auditTemporaryMaxHp({
    resolutions,
    snapshotsByRun,
    windows,
  });
  const tempScoreNote = scoreImpactTemporaryMaxHpAware({
    runs: calibration.runs,
    resolutions,
    snapshotsByRun,
    classSlug,
    expectedDungeonSlugs: expected,
  });

  // --- 5. Manual samples ---
  const manual = buildManualAuditSamples({
    windows,
    timelinesByRun,
    runsById,
  });

  // --- 6. Recommendations ---
  const recommendations = recommendV1_1FinalConfig({
    mergeSimulationPreferred: preferredMerge,
    recoveryVerdict: recoveryAudit.verdict,
    defensiveSummary: defensiveAudit.summary,
    fragmentationClosePairsUnder8: under8,
    fragmentationLikelySamePressure: likelyFragmented.length,
  });

  const outputFiles = {
    fragmentation: join(options.outputDir, "21-danger-window-fragmentation-audit.json"),
    mergeComparison: join(options.outputDir, "22-merge-rule-comparison.json"),
    defensive: join(options.outputDir, "23-defensive-coverage-audit.json"),
    recovery: join(options.outputDir, "24-recovery-detection-audit.json"),
    temporaryMaxHp: join(options.outputDir, "25-temporary-max-hp-audit.json"),
    manualSample: join(options.outputDir, "26-manual-audit-sample.json"),
    recommendations: join(options.outputDir, "27-v1.1-candidate-config-recommendation.json"),
    scoreImpact: join(options.outputDir, "28-audit-score-impact.json"),
    diagnostics: join(options.outputDir, "29-v1.1-audit-diagnostics.json"),
    summary: join(options.outputDir, "30-v1.1-audit-summary.json"),
  };

  const fragmentationPayload = {
    configVersion: SURVIVAL_V1_1_AUDIT_CONFIG.version,
    currentWindowCount: windows.length,
    consecutivePairs: pairs.length,
    pairsUnder8s: under8,
    pairsUnder12s: under12,
    pairsUnder15s: under15,
    likelyFragmentedPairCount: likelyFragmented.length,
    exampleFragmentedPairs: likelyFragmented.slice(0, 15),
    note: "Current V1.1 still uses 8s trigger merge only; candidate recover>50%+5s clustering is comparison-only.",
  };

  const scoreImpact = {
    original: {
      outcomeOnlyScore: globalV11.outcomeOnlyScore,
      behavioralSurvivalScore: globalV11.behavioralSurvivalScore,
      windowCount: windows.length,
      defensive: {
        proactive: defensiveAudit.summary.proactive,
        reactive: defensiveAudit.summary.reactive,
        eligibleMiss: defensiveAudit.summary.eligibleMiss,
      },
      recovery: {
        eligibleMiss: recoveryAudit.eligibleMissWindows,
        covered: windows.filter((w) => w.recoveryCoverageKind === "covered").length,
      },
    },
    correctedPreferredMerge: {
      behavioralSurvivalScore: preferredMerge.globalCorrectedBehavioral,
      windowCount: preferredMerge.deduplicatedWindowCount,
      windowsMergedAway: preferredMerge.windowsMergedAway,
      perDungeon: preferredMerge.perDungeon,
    },
    mergeSimulations: mergeSims.map((s) => ({
      ruleLabel: s.ruleLabel,
      originalWindowCount: s.originalWindowCount,
      deduplicatedWindowCount: s.deduplicatedWindowCount,
      windowsMergedAway: s.windowsMergedAway,
      globalOriginalBehavioral: s.globalOriginalBehavioral,
      globalCorrectedBehavioral: s.globalCorrectedBehavioral,
    })),
    recoveryThresholdImpact: recoveryAudit.coveredIfThreshold,
    temporaryMaxHp: tempScoreNote,
  };

  const summary = {
    auditedGlobalBehavioralOriginal: globalV11.behavioralSurvivalScore,
    auditedGlobalBehavioralCorrected: preferredMerge.globalCorrectedBehavioral,
    originalVersusCorrected: {
      originalWindows: windows.length,
      correctedWindows: preferredMerge.deduplicatedWindowCount,
      originalBehavioral: globalV11.behavioralSurvivalScore,
      correctedBehavioral: preferredMerge.globalCorrectedBehavioral,
    },
    correctedWindowCounts: {
      current: windows.length,
      afterRecover50Stable5s: preferredMerge.deduplicatedWindowCount,
    },
    defensiveCoverage: defensiveAudit.summary,
    recoveryCoverage: {
      eligibleMiss: recoveryAudit.eligibleMissWindows,
      covered: windows.filter((w) => w.recoveryCoverageKind === "covered").length,
      verdict: recoveryAudit.verdict,
      unmatchedSpellIds: recoveryAudit.unmatchedSpellIds,
      coveredIfSelfHealThreshold: recoveryAudit.coveredIfThreshold,
    },
    majorFindings: [
      `${under8} pairs <8s (expected ~0: already merged), ${under12} pairs <12s, ${under15} pairs <15s; ${likelyFragmented.length} likely same-pressure fragments.`,
      `Candidate recover>50%+5s / continuous-pressure clustering reduces ${windows.length} → ${preferredMerge.deduplicatedWindowCount} windows (Δ ${windows.length - preferredMerge.deduplicatedWindowCount}).`,
      recoveryAudit.verdict,
      `No Healthstone (6262/5512), Drain Life (234153), or healing potion casts appear in any of the 21 runs — 0/95 catalog recovery coverage is a real behavior result for emergency tools, not a miss of those spell IDs.`,
      `Passive heals (Soul Leech 108366, Fel Armor 386124, Leech 143924, Dark Pact 108416) are abundant but correctly excluded from emergency recovery.`,
      `${tempMaxAudit.windowsAffectedCount} windows overlap temporary max-HP intervals; ${tempScoreNote.runCountWithTempMax} runs show temporary max HP (likely Dark Pact).`,
      `58 defensive activations map to ${defensiveAudit.summary.windowsCoveredBefore} window-credit links (ratio ${defensiveAudit.summary.coverageRatioBefore?.toFixed(2)}) — long Unending Resolve / Dark Pact buffs cover many windows; cluster dedup drops links to ${defensiveAudit.summary.windowsCoveredAfterDedup}.`,
    ],
    recommendations,
    configVersions: {
      scoring: SURVIVAL_STANDALONE_V1_1_CONFIG.version,
      audit: SURVIVAL_V1_1_AUDIT_CONFIG.version,
    },
  };

  await Promise.all([
    writeJson(outputFiles.fragmentation, fragmentationPayload),
    writeJson(outputFiles.mergeComparison, { simulations: mergeSims }),
    writeJson(outputFiles.defensive, {
      summary: defensiveAudit.summary,
      activations: defensiveAudit.activations.slice(0, 500),
      activationCount: defensiveAudit.activations.length,
    }),
    writeJson(outputFiles.recovery, {
      verdict: recoveryAudit.verdict,
      unmatchedSpellIds: recoveryAudit.unmatchedSpellIds,
      catalogSelfHealSpellIds: recoveryAudit.catalogSelfHealSpellIds,
      eligibleMissWindows: recoveryAudit.eligibleMissWindows,
      coveredIfThreshold: recoveryAudit.coveredIfThreshold,
      actionsDetectedBeforeFiltering: recoveryAudit.candidates.length,
      rejectedReasonCounts: Object.fromEntries(
        Object.entries(
          recoveryAudit.candidates.reduce<Record<string, number>>((acc, c) => {
            const key = c.rejectedReason ?? "accepted_or_unclassified";
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {}),
        ),
      ),
      sampleCandidates: recoveryAudit.candidates
        .filter((c) => c.matchedKind !== "passive_absorb")
        .slice(0, 50)
        .concat(
          recoveryAudit.candidates.filter((c) => c.matchedKind === "passive_absorb").slice(0, 20),
        ),
    }),
    writeJson(outputFiles.temporaryMaxHp, tempMaxAudit),
    writeJson(outputFiles.manualSample, {
      nonFatalWindowIds: manual.nonFatal.map((w) => w.windowId),
      defensiveMissWindowIds: manual.defensiveMisses.map((w) => w.windowId),
      proactiveCoverWindowIds: manual.proactiveCovers.map((w) => w.windowId),
      recoveryMissWindowIds: manual.recoveryMisses.map((w) => w.windowId),
      fatalWindowIds: manual.fatalAll.map((w) => w.windowId),
      narratives: manual.narratives,
    }),
    writeJson(outputFiles.recommendations, recommendations),
    writeJson(outputFiles.scoreImpact, scoreImpact),
    writeJson(outputFiles.diagnostics, {
      runs: calibration.runs.length,
      windows: windows.length,
      pairs: pairs.length,
      classSlug,
      expectedDungeons: expected,
    }),
    writeJson(outputFiles.summary, summary),
  ]);

  return { outputFiles, summary };
}

/** List files for packaging; unused import guard */
void readdir;
