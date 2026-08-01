/**
 * Boost shadow Phase 2 backtest harness — read-only, shadow-only, deterministic.
 */

import { BOOST_EXTRACTOR_VERSION, HIGH_KEY_POLICY_VERSION } from "../constants.js";
import { extractBoostFeatureFactsV1 } from "../extract.js";
import { BOOST_SHADOW_ISOLATION } from "../isolation.js";
import {
  classifyPattern,
  buildBacktestAnalysis,
  isLabeledForSupervised,
} from "./analyze.js";
import {
  createMapEvidencePort,
  filterEvidenceAtCutoff,
  toExtractorInput,
  type BoostShadowEvidencePort,
  type BoostShadowMemberEvidenceV1,
} from "./evidence.js";
import { mergeExperimentParams } from "./experiment-params.js";
import type { BoostShadowCohortManifestV1 } from "./manifest.js";
import { unlabeledResearchLabel } from "./manifest.js";
import {
  assertNoCharacterLeakage,
  assertNoCohortLeakage,
  assignLeakageSafeSplits,
} from "./splits.js";
import {
  BOOST_SHADOW_BACKTEST_REPORT_SCHEMA,
  PHASE2_FEATURE_KEYS,
  type BoostShadowBacktestReportV1,
  type BoostShadowBacktestRunOptions,
  type BoostShadowFeatureRowV1,
  type Phase2FeatureKey,
  type ProductionAuthenticityCompareV1,
} from "./types.js";
import { createMutationGuard, type MutationGuard } from "./mutation-guard.js";

const DISCLAIMER =
  "Boost shadow Phase 2 offline backtest — shadow-only research output. " +
  "No production score effect, no authenticity write-back, no public flags, " +
  "no addon change, no provider calls, no database migration, no verified ownership usage, " +
  "no model activation. Experimental classifier is OFFLINE_NON_PRODUCT only.";

function emptyAuthenticity(): ProductionAuthenticityCompareV1 {
  return {
    authenticityScore: null,
    boostSuspected: null,
    atypicalProgression: null,
    redFlagKeys: [],
    snapshotId: null,
    calculatedAt: null,
    source: "none",
  };
}

function emptyFactsStub(
  characterId: string,
  seasonId: string,
  calculatedAt: string,
): BoostShadowFeatureRowV1["facts"] {
  return {
    schemaVersion: 1,
    extractorVersion: BOOST_EXTRACTOR_VERSION,
    highKeyPolicyVersion: HIGH_KEY_POLICY_VERSION,
    subjectCharacterId: characterId,
    seasonId,
    calculatedAt,
    sourceProvenance: { primary: "persisted_runs", runSourceCounts: {} },
    highKeySet: { runsEligible: 0, runsExcluded: 0, exclusionReasonCounts: {} },
    features: {},
    missing: PHASE2_FEATURE_KEYS.map((featureKey) => ({
      featureKey,
      reasonCode: "INSUFFICIENT_DATED_RUNS",
    })),
  };
}

function buildFeatureRow(args: {
  memberId: string;
  characterId: string;
  seasonId: string;
  role: string | null;
  keyBand: string | null;
  split: BoostShadowFeatureRowV1["split"];
  label: BoostShadowFeatureRowV1["label"];
  labeledForSupervised: boolean;
  facts: BoostShadowFeatureRowV1["facts"];
  productionAuthenticity: ProductionAuthenticityCompareV1;
  params: ReturnType<typeof mergeExperimentParams>;
  error: string | null;
}): BoostShadowFeatureRowV1 {
  const features: Partial<Record<Phase2FeatureKey, number | null>> = {};
  const featureConfidence: Partial<Record<Phase2FeatureKey, number | null>> = {};
  const featureCoverage: Partial<Record<Phase2FeatureKey, number | null>> = {};

  for (const key of PHASE2_FEATURE_KEYS) {
    const ev = args.facts.features[key];
    features[key] = ev?.value ?? null;
    featureConfidence[key] = ev?.confidence ?? null;
    featureCoverage[key] = ev?.coverage ?? null;
  }

  const omittedFeatures = args.facts.missing
    .filter((m) => (PHASE2_FEATURE_KEYS as readonly string[]).includes(m.featureKey))
    .map((m) => ({ featureKey: m.featureKey, reasonCode: m.reasonCode }));

  const rowBase = { features };
  return {
    memberId: args.memberId,
    characterId: args.characterId,
    seasonId: args.seasonId,
    role: args.role,
    keyBand: args.keyBand,
    split: args.split,
    label: args.label,
    labeledForSupervised: args.labeledForSupervised,
    features,
    featureConfidence,
    featureCoverage,
    omittedFeatures,
    highKeyRunsEligible: args.facts.highKeySet.runsEligible,
    highKeyRunsExcluded: args.facts.highKeySet.runsExcluded,
    patternClass: classifyPattern(rowBase, args.params),
    productionAuthenticity: args.productionAuthenticity,
    facts: args.facts,
    error: args.error,
  };
}

export interface RunBoostShadowBacktestResult {
  report: BoostShadowBacktestReportV1;
  mutationGuard: MutationGuard;
}

/**
 * Run Phase 2 offline backtest. Deterministic when generatedAt and inputs are fixed.
 */
export function runBoostShadowBacktest(
  manifest: BoostShadowCohortManifestV1,
  evidenceByMemberId: Record<string, BoostShadowMemberEvidenceV1>,
  options: BoostShadowBacktestRunOptions,
): RunBoostShadowBacktestResult {
  const guard = createMutationGuard();
  guard.assertReadOnlyContext();

  if (manifest.highKeyPolicyVersion !== HIGH_KEY_POLICY_VERSION) {
    throw new Error(
      `Manifest highKeyPolicyVersion must be ${HIGH_KEY_POLICY_VERSION}`,
    );
  }

  const params = mergeExperimentParams(options.experimentParams);
  const port: BoostShadowEvidencePort = createMapEvidencePort(evidenceByMemberId);

  // Reject ownership leakage into Phase 2.
  for (const [id, ev] of Object.entries(evidenceByMemberId)) {
    if (
      ev &&
      "ownershipEvidence" in ev &&
      Array.isArray((ev as { ownershipEvidence?: unknown[] }).ownershipEvidence) &&
      ((ev as { ownershipEvidence?: unknown[] }).ownershipEvidence?.length ?? 0) > 0
    ) {
      throw new Error(
        `Phase 2 rejects ownershipEvidence for member ${id} (verified-alt is Phase 4)`,
      );
    }
  }

  const { assignments } = assignLeakageSafeSplits({
    members: manifest.members,
    evidenceByMemberId,
    seasonId: manifest.seasonId,
    params,
  });
  assertNoCharacterLeakage(assignments);
  assertNoCohortLeakage(assignments);

  const splitByMember = new Map(assignments.map((a) => [a.memberId, a]));
  const rows: BoostShadowFeatureRowV1[] = [];

  for (const member of [...manifest.members].sort((a, b) =>
    a.memberId.localeCompare(b.memberId),
  )) {
    const assignment = splitByMember.get(member.memberId)!;
    const label = member.label ?? unlabeledResearchLabel();
    const cutoff = member.evaluationCutoff ?? options.generatedAt;

    guard.recordEvidenceRead(member.memberId);
    const raw = port.loadMember(member.memberId);

    if (!raw) {
      const facts = emptyFactsStub(member.characterId, manifest.seasonId, cutoff);
      const row = buildFeatureRow({
        memberId: member.memberId,
        characterId: member.characterId,
        seasonId: manifest.seasonId,
        role: member.role ?? null,
        keyBand: member.keyBand ?? null,
        split: assignment.split,
        label,
        labeledForSupervised: false,
        facts,
        productionAuthenticity: emptyAuthenticity(),
        params,
        error: "NO_EVIDENCE",
      });
      row.labeledForSupervised = isLabeledForSupervised(row, params);
      rows.push(row);
      continue;
    }

    if (raw.characterId !== member.characterId) {
      throw new Error(
        `Evidence characterId mismatch for ${member.memberId}: ${raw.characterId} vs ${member.characterId}`,
      );
    }

    const filtered = filterEvidenceAtCutoff(raw, cutoff);
    const extractorInput = toExtractorInput(filtered, cutoff);
    const facts = extractBoostFeatureFactsV1(extractorInput);

    // Phase 1 semantics: missing ratings stay omitted — never coerced to 0 by harness.
    const row = buildFeatureRow({
      memberId: member.memberId,
      characterId: member.characterId,
      seasonId: manifest.seasonId,
      role: member.role ?? null,
      keyBand: member.keyBand ?? null,
      split: assignment.split,
      label,
      labeledForSupervised: false,
      facts,
      productionAuthenticity: raw.productionAuthenticity ?? emptyAuthenticity(),
      params,
      error: null,
    });
    row.labeledForSupervised = isLabeledForSupervised(row, params);
    rows.push(row);
  }

  const analysis = buildBacktestAnalysis({
    rows,
    assignments,
    params,
    membersRequested: manifest.members.length,
  });

  const report: BoostShadowBacktestReportV1 = {
    schemaVersion: BOOST_SHADOW_BACKTEST_REPORT_SCHEMA,
    evaluationKind: "boost_shadow_phase2_backtest_v1",
    generatedAt: options.generatedAt,
    disclaimer: DISCLAIMER,
    isolation: {
      shadowOnly: true,
      productionScoreEffect: false,
      authenticityWriteBack: false,
      publicFlags: false,
      addonChange: false,
      providerCalls: false,
      databaseMigration: false,
      verifiedOwnershipUsage: false,
      modelActivation: false,
      persistsBoostFeatureSnapshot: false,
    },
    highKeyPolicyVersion: HIGH_KEY_POLICY_VERSION,
    extractorVersion: BOOST_EXTRACTOR_VERSION,
    experimentParams: params,
    cohort: {
      cohortId: manifest.cohortId,
      schemaVersion: manifest.schemaVersion,
      description: manifest.description,
      memberCount: manifest.members.length,
    },
    experimentalClassifier: {
      kind: "offline_non_product_rule_v1",
      label: "OFFLINE_NON_PRODUCT",
      ruleDescription:
        "Hypothesis rule: teammateScoreGap, repeatedStrongerTeammateCohort, and highKeyGroupConcentration " +
        "all above experiment thresholds. Not a production boost probability.",
      thresholds: { ...params.experimentalUnusualPattern },
    },
    rows,
    analysis,
    providerCallsMade: false,
    scoreSnapshotsWritten: false,
    characterRedFlagsWritten: false,
    authenticityInputsMutated: false,
  };

  // Prove isolation constants remain false.
  if (BOOST_SHADOW_ISOLATION.persistsToDatabase) {
    throw new Error("Isolation violated: persistsToDatabase");
  }
  guard.assertNoWrites();

  return { report, mutationGuard: guard };
}

export function runBoostShadowBacktestFromBundle(
  bundle: {
    manifest: BoostShadowCohortManifestV1;
    evidenceByMemberId: Record<string, BoostShadowMemberEvidenceV1>;
    generatedAt?: string;
  },
  options?: Partial<BoostShadowBacktestRunOptions>,
): RunBoostShadowBacktestResult {
  return runBoostShadowBacktest(bundle.manifest, bundle.evidenceByMemberId, {
    generatedAt: options?.generatedAt ?? bundle.generatedAt ?? bundle.manifest.createdAt,
    experimentParams: options?.experimentParams,
    publicSafe: options?.publicSafe,
  });
}
