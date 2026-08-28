/**
 * Release-vs-release ability catalog shadow replay engine.
 * Reuses scoring adapters/calculators; never calls live providers.
 */

import { createHash } from "node:crypto";
import type { AbilityCatalogContext } from "@mplus/abilities";
import type { ParticipantScoringDigestV1 } from "@mplus/contracts";
import {
  computeUtilityV2,
  cooldownRunEvidenceFromDigest,
  DigestDimensionIncompleteError,
  scoreRunCooldownDiscipline,
  scoreSurvivalV2Run,
  survivalFactDocumentFromDigest,
  utilityRunFactSetFromDigest,
} from "@mplus/scoring";
import type { ReleaseDiffDocument, ReleaseDiffEntry } from "@mplus/abilities/release";
import { stableStringify } from "@mplus/abilities/release";
import {
  collectDigestSpellIds,
  type CorpusSelectResult,
  type ReplayCorpusCandidate,
} from "./ability-catalog-replay-corpus.js";
import {
  ABILITY_CATALOG_REPLAY_ENGINE_VERSION,
  ABILITY_CATALOG_REPLAY_REPORT_SCHEMA,
  type AbilityCatalogReplayAnalysisDetail,
  type AbilityCatalogReplayAssociation,
  type AbilityCatalogReplayFailureCode,
  type AbilityCatalogReplayReport,
  type AbilityCatalogReplayReportSummary,
  type AbilityCatalogReplayScorePair,
  type AbilityCatalogReplayTiming,
  type AbilityResolutionChangeKind,
  type AbilityResolutionDiffEntry,
} from "./ability-catalog-replay-types.js";

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function roundScore(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return roundScore((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return roundScore(sorted[mid]!);
}

function maxAbs(values: number[]): number | null {
  if (values.length === 0) return null;
  return roundScore(Math.max(...values.map((v) => Math.abs(v))));
}

function sortedNums(values: readonly number[] | undefined): number[] {
  return [...(values ?? [])].sort((a, b) => a - b);
}

function sortedStrings(values: readonly string[] | undefined): string[] {
  return [...(values ?? [])].sort((a, b) => a.localeCompare(b));
}

function resolutionSnapshot(
  catalog: AbilityCatalogContext,
  digest: ParticipantScoringDigestV1,
  spellId: number,
) {
  const resolved = catalog.resolveBySpellId({
    spellId,
    classSlug: digest.classSlug,
    specSlug: digest.specSlug,
  });
  if (resolved.status === "matched") {
    return {
      status: "matched" as const,
      canonicalKey: resolved.rule.canonicalKey,
      category: resolved.rule.category,
      dimensionTags: sortedStrings(resolved.rule.dimensionTags),
      cooldownSeconds: resolved.rule.cooldownSeconds ?? null,
      spellIds: sortedNums(resolved.rule.spellIds),
      aliases: sortedNums(resolved.rule.aliases),
      activationSpellIds: sortedNums(resolved.rule.activationSpellIds),
      activationBuffIds: sortedNums(resolved.rule.activationBuffIds),
      triggeredEffectIds: sortedNums(resolved.rule.triggeredEffectIds),
    };
  }
  if (resolved.status === "ambiguous") {
    return {
      status: "ambiguous" as const,
      canonicalKey: resolved.rules.map((r) => r.canonicalKey).join("|"),
      category: resolved.rules[0]?.category ?? null,
      dimensionTags: sortedStrings(resolved.rules[0]?.dimensionTags),
      cooldownSeconds: resolved.rules[0]?.cooldownSeconds ?? null,
      spellIds: sortedNums(resolved.rules[0]?.spellIds),
      aliases: sortedNums(resolved.rules[0]?.aliases),
      activationSpellIds: sortedNums(resolved.rules[0]?.activationSpellIds),
      activationBuffIds: sortedNums(resolved.rules[0]?.activationBuffIds),
      triggeredEffectIds: sortedNums(resolved.rules[0]?.triggeredEffectIds),
    };
  }
  return {
    status: "unmatched" as const,
    canonicalKey: null as string | null,
    category: null as string | null,
    dimensionTags: [] as string[],
    cooldownSeconds: null as number | null,
    spellIds: [] as number[],
    aliases: [] as number[],
    activationSpellIds: [] as number[],
    activationBuffIds: [] as number[],
    triggeredEffectIds: [] as number[],
  };
}

function classifyResolutionChange(
  before: ReturnType<typeof resolutionSnapshot>,
  after: ReturnType<typeof resolutionSnapshot>,
): AbilityResolutionChangeKind {
  if (before.status === after.status) {
    if (before.status === "unmatched") return "UNCHANGED";
    if (before.canonicalKey === after.canonicalKey) {
      if (before.category !== after.category) return "CATEGORY_CHANGED";
      if (stableStringify(before.dimensionTags) !== stableStringify(after.dimensionTags)) {
        return "DIMENSION_CHANGED";
      }
      if (
        stableStringify(before.spellIds) !== stableStringify(after.spellIds) ||
        stableStringify(before.aliases) !== stableStringify(after.aliases) ||
        stableStringify(before.activationSpellIds) !==
          stableStringify(after.activationSpellIds) ||
        stableStringify(before.activationBuffIds) !==
          stableStringify(after.activationBuffIds) ||
        stableStringify(before.triggeredEffectIds) !==
          stableStringify(after.triggeredEffectIds)
      ) {
        return "BINDING_CHANGED";
      }
      if (before.cooldownSeconds !== after.cooldownSeconds) return "COOLDOWN_CHANGED";
      return "UNCHANGED";
    }
    return "CANONICAL_KEY_CHANGED";
  }
  if (before.status === "unmatched" && after.status !== "unmatched") return "BECAME_RECOGNIZED";
  if (before.status !== "unmatched" && after.status === "unmatched") return "BECAME_UNRECOGNIZED";
  if (before.status === "ambiguous" && after.status !== "ambiguous") return "AMBIGUOUS_BEFORE";
  if (before.status !== "ambiguous" && after.status === "ambiguous") return "AMBIGUOUS_AFTER";
  return "AMBIGUOUS_BOTH";
}

function correlateDiff(
  changeKind: AbilityResolutionChangeKind,
  canonicalKeys: Array<string | null>,
  releaseDiff: ReleaseDiffDocument | null,
): { association: AbilityCatalogReplayAssociation; codes: string[] } {
  if (!releaseDiff || releaseDiff.kind !== "CURATED") {
    return { association: "UNATTRIBUTED", codes: [] };
  }
  const keys = new Set(canonicalKeys.filter(Boolean) as string[]);
  const matched: ReleaseDiffEntry[] = releaseDiff.entries.filter(
    (e) => e.canonicalKey && keys.has(e.canonicalKey),
  );
  if (matched.length === 0) {
    // Topology-only changes may still affect class/spec filtering.
    const topo = releaseDiff.entries.filter((e) => e.code === "TOPOLOGY_CHANGED");
    if (topo.length && changeKind !== "UNCHANGED") {
      return {
        association: "POSSIBLY_ASSOCIATED",
        codes: topo.map((e) => e.code),
      };
    }
    return { association: "UNATTRIBUTED", codes: [] };
  }
  const codes = [...new Set(matched.map((e) => e.code))];
  const directMap: Record<string, string[]> = {
    BECAME_RECOGNIZED: ["ADDED_RULE", "BINDING_CHANGED"],
    BECAME_UNRECOGNIZED: ["TOMBSTONED_RULE", "BINDING_CHANGED"],
    CANONICAL_KEY_CHANGED: ["BINDING_CHANGED", "METADATA_CHANGED"],
    CATEGORY_CHANGED: ["CATEGORY_CHANGED"],
    DIMENSION_CHANGED: ["DIMENSION_CHANGED"],
    BINDING_CHANGED: ["BINDING_CHANGED"],
    COOLDOWN_CHANGED: ["COOLDOWN_CHANGED", "CHARGES_CHANGED"],
  };
  const expected = directMap[changeKind] ?? [];
  const direct = codes.some((c) => expected.includes(c));
  return {
    association: direct ? "DIRECTLY_ASSOCIATED" : "POSSIBLY_ASSOCIATED",
    codes,
  };
}

function scoreDigestUnderCatalog(
  digest: ParticipantScoringDigestV1,
  catalog: AbilityCatalogContext,
): {
  scores: AbilityCatalogReplayScorePair;
  error: { code: AbilityCatalogReplayFailureCode; detail: string } | null;
} {
  const empty: AbilityCatalogReplayScorePair = {
    performanceCooldownDiscipline: null,
    utility: null,
    survival: null,
    experience: "INVARIANT_UNAFFECTED",
    trust: "TRUST_REPLAY_UNAVAILABLE",
    boost: "INVARIANT_UNAFFECTED",
  };

  try {
    let utility: number | null = null;
    let survival: number | null = null;
    let performanceCooldownDiscipline: number | null = null;

    if (digest.utility.completeness !== "UNAVAILABLE") {
      const facts = utilityRunFactSetFromDigest(digest, {
        slotId: "replay-slot-0",
        slotIndex: 0,
        catalog,
      });
      const identity = {
        reportCode: digest.reportCode,
        fightId: digest.fightId,
        reportRevision: digest.reportRevision,
      };
      const dungeonSlug = digest.dungeonSlug ?? "unknown";
      const result = computeUtilityV2({
        manifest: {
          contentHash: digest.contentHash,
          schemaVersion: "evidence-manifest-v2",
          expectedSlotCount: 1,
          selectedSlotCount: 1,
          activeDungeonSlugs: [dungeonSlug],
          slots: [
            {
              slotId: "replay-slot-0",
              dungeonSlug,
              slotIndex: 0,
              state: "SELECTED",
              identity,
            },
          ],
        },
        factSets: [facts],
      });
      utility = roundScore(result.score);
    }

    if (digest.survival.completeness !== "UNAVAILABLE") {
      const fact = survivalFactDocumentFromDigest(digest, 0, { catalog });
      const runScore = scoreSurvivalV2Run(fact, "off");
      survival = roundScore(runScore.behavioralScore);
    }

    if (digest.performance.completeness !== "UNAVAILABLE") {
      const evidence = cooldownRunEvidenceFromDigest({
        digest,
        slotId: "replay-slot-0",
      });
      const cd = scoreRunCooldownDiscipline(evidence, { catalog });
      performanceCooldownDiscipline = roundScore(cd.score);
    }

    return {
      scores: {
        ...empty,
        utility,
        survival,
        performanceCooldownDiscipline,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof DigestDimensionIncompleteError) {
      return {
        scores: empty,
        error: {
          code: "SCORING_ERROR",
          detail: err.message,
        },
      };
    }
    return {
      scores: empty,
      error: {
        code: "SCORING_ERROR",
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function buildHumanSummary(summary: AbilityCatalogReplayReportSummary): string {
  return [
    `Replayed: ${summary.artifactsReplayed} analyses`,
    `Changed: ${summary.changedAnalyses}`,
    `Exact matches: ${summary.exactMatches}`,
    `Failures: ${summary.replayFailures}`,
    `Utility changed: ${summary.utilityChanged} (max |Δ|=${summary.maxAbsUtilityDelta ?? "n/a"}, median Δ=${summary.medianUtilityDelta ?? "n/a"})`,
    `Survival changed: ${summary.survivalChanged} (max |Δ|=${summary.maxAbsSurvivalDelta ?? "n/a"}, median Δ=${summary.medianSurvivalDelta ?? "n/a"})`,
    `Performance CD changed: ${summary.performanceChanged} (max |Δ|=${summary.maxAbsPerformanceCdDelta ?? "n/a"}, median Δ=${summary.medianPerformanceCdDelta ?? "n/a"})`,
    `Experience: invariant (catalog-independent)`,
    `Trust: TRUST_REPLAY_UNAVAILABLE (needs character aggregate)`,
    `Boost: invariant (catalog-independent)`,
    `Affected: ${summary.affectedClassSpecs.slice(0, 12).join(", ") || "none"}`,
    `Resolver/scoring unresolved failures: ${summary.unresolvedFailures}`,
  ].join("\n");
}

export function runAbilityCatalogReplayComparison(input: {
  baseCatalog: AbilityCatalogContext;
  candidateCatalog: AbilityCatalogContext;
  corpus: CorpusSelectResult;
  baseMeta: AbilityCatalogReplayReport["base"];
  candidateMeta: AbilityCatalogReplayReport["candidate"];
  releaseDiff: ReleaseDiffDocument | null;
  /** When true, any semantic delta fails the replay (self-replay / static-vs-bootstrap). */
  expectZeroImpact?: boolean;
  timing?: Partial<AbilityCatalogReplayTiming>;
}): AbilityCatalogReplayReport {
  const t0 = Date.now();
  let baseReplayMs = 0;
  let candidateReplayMs = 0;
  let diffMs = 0;

  const details: AbilityCatalogReplayAnalysisDetail[] = [];
  const failures: AbilityCatalogReplayReport["failures"] = [];
  const utilityDeltas: number[] = [];
  const survivalDeltas: number[] = [];
  const perfDeltas: number[] = [];
  const affected = new Set<string>();

  let exactMatches = 0;
  let changedAnalyses = 0;
  let replayFailures = 0;
  let spellIdsEncountered = 0;
  let resolutionUnchanged = 0;
  let becameRecognized = 0;
  let becameUnrecognized = 0;
  let canonicalKeyChanged = 0;
  let ambiguousBeforeAfter = 0;
  let performanceChanged = 0;
  let survivalChanged = 0;
  let utilityChanged = 0;

  for (const item of input.corpus.selected) {
    const spellIds = collectDigestSpellIds(item.digest);
    spellIdsEncountered += spellIds.length;

    const tb = Date.now();
    const baseScored = scoreDigestUnderCatalog(item.digest, input.baseCatalog);
    baseReplayMs += Date.now() - tb;
    const tc = Date.now();
    const candScored = scoreDigestUnderCatalog(item.digest, input.candidateCatalog);
    candidateReplayMs += Date.now() - tc;

    const td = Date.now();
    const resolutionDiffs: AbilityResolutionDiffEntry[] = [];
    for (const spellId of spellIds) {
      const before = resolutionSnapshot(input.baseCatalog, item.digest, spellId);
      const after = resolutionSnapshot(input.candidateCatalog, item.digest, spellId);
      const changeKind = classifyResolutionChange(before, after);
      if (changeKind === "UNCHANGED") {
        resolutionUnchanged += 1;
        continue;
      }
      if (changeKind === "BECAME_RECOGNIZED") becameRecognized += 1;
      if (changeKind === "BECAME_UNRECOGNIZED") becameUnrecognized += 1;
      if (changeKind === "CANONICAL_KEY_CHANGED") canonicalKeyChanged += 1;
      if (
        changeKind === "AMBIGUOUS_BEFORE" ||
        changeKind === "AMBIGUOUS_AFTER" ||
        changeKind === "AMBIGUOUS_BOTH"
      ) {
        ambiguousBeforeAfter += 1;
      }
      const corr = correlateDiff(
        changeKind,
        [before.canonicalKey, after.canonicalKey],
        input.releaseDiff,
      );
      resolutionDiffs.push({
        spellId,
        beforeStatus: before.status,
        afterStatus: after.status,
        beforeCanonicalKey: before.canonicalKey,
        afterCanonicalKey: after.canonicalKey,
        beforeCategory: before.category,
        afterCategory: after.category,
        changeKind,
        association: corr.association,
        correlatedDiffCodes: corr.codes,
      });
    }

    let failureCode: AbilityCatalogReplayFailureCode | null = null;
    let failureDetail: string | null = null;
    if (baseScored.error || candScored.error) {
      failureCode =
        baseScored.error?.code ?? candScored.error?.code ?? "SCORING_ERROR";
      failureDetail =
        baseScored.error?.detail ?? candScored.error?.detail ?? "scoring failed";
      replayFailures += 1;
      failures.push({
        sourceDigestId: item.digestRowId,
        code: failureCode,
        detail: failureDetail,
      });
    }

    const deltas = {
      performanceCooldownDiscipline: deltaOrNull(
        baseScored.scores.performanceCooldownDiscipline,
        candScored.scores.performanceCooldownDiscipline,
      ),
      utility: deltaOrNull(baseScored.scores.utility, candScored.scores.utility),
      survival: deltaOrNull(baseScored.scores.survival, candScored.scores.survival),
    };

    const scoreChanged =
      (deltas.utility != null && deltas.utility !== 0) ||
      (deltas.survival != null && deltas.survival !== 0) ||
      (deltas.performanceCooldownDiscipline != null &&
        deltas.performanceCooldownDiscipline !== 0);

    if (deltas.utility != null && deltas.utility !== 0) {
      utilityChanged += 1;
      utilityDeltas.push(deltas.utility);
    }
    if (deltas.survival != null && deltas.survival !== 0) {
      survivalChanged += 1;
      survivalDeltas.push(deltas.survival);
    }
    if (
      deltas.performanceCooldownDiscipline != null &&
      deltas.performanceCooldownDiscipline !== 0
    ) {
      performanceChanged += 1;
      perfDeltas.push(deltas.performanceCooldownDiscipline);
    }

    const changed =
      scoreChanged || resolutionDiffs.length > 0 || failureCode != null;
    if (failureCode == null && !changed) {
      exactMatches += 1;
    } else if (failureCode == null && changed) {
      changedAnalyses += 1;
      const label =
        item.classSlugNorm && item.specSlugNorm
          ? `${item.classSlugNorm}/${item.specSlugNorm}`
          : "unknown/unknown";
      affected.add(label);
    }

    if (changed) {
      details.push({
        sourceDigestId: item.digestRowId,
        contentHash: item.digest.contentHash,
        classSlug: item.classSlugNorm,
        specSlug: item.specSlugNorm,
        role: item.role,
        reportCode: item.digest.reportCode,
        fightId: item.digest.fightId,
        scoresBefore: baseScored.scores,
        scoresAfter: candScored.scores,
        deltas,
        resolutionDiffs,
        changed: true,
        failureCode,
        failureDetail,
      });
    }
    diffMs += Date.now() - td;
  }

  const unresolvedFailures = failures.length;
  // Self-replay / static-vs-bootstrap: PASS requires zero semantic differences.
  // Changed candidate: PASS means completed with zero unresolved execution errors.
  const zeroImpact =
    changedAnalyses === 0 &&
    unresolvedFailures === 0 &&
    becameRecognized === 0 &&
    becameUnrecognized === 0 &&
    canonicalKeyChanged === 0 &&
    utilityChanged === 0 &&
    survivalChanged === 0 &&
    performanceChanged === 0;

  const expectZero =
    input.expectZeroImpact === true ||
    (input.baseMeta.kind === "RELEASE" &&
      input.baseMeta.contentDigest === input.candidateMeta.contentDigest);

  let status: "PASSED" | "FAILED" = "PASSED";
  if (unresolvedFailures > 0) status = "FAILED";
  if (expectZero && !zeroImpact) status = "FAILED";

  const summaryBase: AbilityCatalogReplayReportSummary = {
    artifactsSelected: input.corpus.selected.length,
    artifactsReplayed: input.corpus.selected.length,
    replayFailures,
    exactMatches,
    changedAnalyses,
    spellIdsEncountered,
    resolutionUnchanged,
    becameRecognized,
    becameUnrecognized,
    canonicalKeyChanged,
    ambiguousBeforeAfter,
    performanceChanged,
    survivalChanged,
    utilityChanged,
    experienceChanged: 0,
    trustChanged: 0,
    boostChanged: 0,
    maxAbsUtilityDelta: maxAbs(utilityDeltas),
    medianUtilityDelta: median(utilityDeltas),
    maxAbsSurvivalDelta: maxAbs(survivalDeltas),
    medianSurvivalDelta: median(survivalDeltas),
    maxAbsPerformanceCdDelta: maxAbs(perfDeltas),
    medianPerformanceCdDelta: median(perfDeltas),
    affectedClassSpecs: [...affected].sort(),
    unresolvedFailures,
    trustReplayStatus: "TRUST_REPLAY_UNAVAILABLE",
    humanSummary: "",
    publicationNote:
      "Replay PASS is diagnostic evidence only — it does not authorize publication or activation.",
  };
  summaryBase.humanSummary = buildHumanSummary(summaryBase);

  const timing: AbilityCatalogReplayTiming = {
    loadMs: input.timing?.loadMs ?? 0,
    baseReplayMs,
    candidateReplayMs,
    diffMs,
    totalMs: Date.now() - t0 + (input.timing?.loadMs ?? 0),
    corpusAvailableCount: input.corpus.available.length,
    selectedCount: input.corpus.selected.length,
  };

  const replayInputDigest = sha256Utf8(
    stableStringify({
      engine: ABILITY_CATALOG_REPLAY_ENGINE_VERSION,
      corpusDigest: input.corpus.corpusDigest,
      base: input.baseMeta,
      candidate: {
        releaseId: input.candidateMeta.releaseId,
        contentDigest: input.candidateMeta.contentDigest,
      },
      semantic: {
        exactMatches,
        changedAnalyses,
        replayFailures,
        becameRecognized,
        becameUnrecognized,
        canonicalKeyChanged,
        utilityChanged,
        survivalChanged,
        performanceChanged,
        affectedClassSpecs: summaryBase.affectedClassSpecs,
        maxAbsUtilityDelta: summaryBase.maxAbsUtilityDelta,
        maxAbsSurvivalDelta: summaryBase.maxAbsSurvivalDelta,
        maxAbsPerformanceCdDelta: summaryBase.maxAbsPerformanceCdDelta,
      },
    }),
  );

  // silence unused
  void zeroImpact;

  return {
    schemaVersion: ABILITY_CATALOG_REPLAY_REPORT_SCHEMA,
    replayEngineVersion: ABILITY_CATALOG_REPLAY_ENGINE_VERSION,
    base: input.baseMeta,
    candidate: input.candidateMeta,
    corpus: input.corpus.meta,
    corpusDigest: input.corpus.corpusDigest,
    replayInputDigest,
    status,
    summary: summaryBase,
    timing,
    details,
    failures,
  };
}

function deltaOrNull(before: number | null, after: number | null): number | null {
  if (before == null || after == null) return null;
  return roundScore(after - before);
}

/** Pure helper exported for unit tests with in-memory corpus. */
export function replayCorpusItems(input: {
  items: ReplayCorpusCandidate[];
  baseCatalog: AbilityCatalogContext;
  candidateCatalog: AbilityCatalogContext;
  corpusMeta: CorpusSelectResult["meta"];
  corpusDigest: string;
  baseMeta: AbilityCatalogReplayReport["base"];
  candidateMeta: AbilityCatalogReplayReport["candidate"];
  releaseDiff: ReleaseDiffDocument | null;
  expectZeroImpact?: boolean;
}): AbilityCatalogReplayReport {
  return runAbilityCatalogReplayComparison({
    baseCatalog: input.baseCatalog,
    candidateCatalog: input.candidateCatalog,
    corpus: {
      available: input.items,
      selected: input.items,
      unsupportedSchemaCount: 0,
      corruptCount: 0,
      meta: { ...input.corpusMeta, selectedCount: input.items.length },
      corpusDigest: input.corpusDigest,
    },
    baseMeta: input.baseMeta,
    candidateMeta: input.candidateMeta,
    releaseDiff: input.releaseDiff,
    expectZeroImpact: input.expectZeroImpact,
  });
}
