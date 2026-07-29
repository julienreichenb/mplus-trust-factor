import type { AbilityCatalog, AbilityCategory } from "@mplus/abilities";
import {
  getAbilityCatalog,
  rulesForSpell,
  spellIdsForCategory,
} from "@mplus/abilities";
import { CURRENT_MPLUS_ZONE_DUNGEON_SLUGS } from "../discovery/run-discovery.js";
import { activeSeasonDungeonPool } from "./survival-probe-logic.js";
import { equalWeightMean, median } from "./survival-calibration-logic.js";
import {
  auditCatalogSpellOnStream,
  collectCatalogAuditsFromNormalizedRun,
  type UtilityCatalogSpellAudit,
} from "./utility-catalog-audit.js";
import {
  UTILITY_STANDALONE_V1_CONFIG,
  type UtilityStandaloneV1Config,
  type UtilityV1ComponentKey,
  type UtilityV1DiminishingCurve,
} from "./utility-v1-config.js";
import type {
  UtilityNormalizedRun,
  UtilityEventDataType,
} from "./utility-probe-types.js";
import type {
  UtilityV1CatalogAuditSummary,
  UtilityV1ComponentResult,
  UtilityV1ConfidenceDiagnostics,
  UtilityV1DungeonScore,
  UtilityV1GlobalScore,
  UtilityV1RunScore,
  UtilityV1ScoredAction,
} from "./utility-v1-types.js";

const GROUP_CATEGORIES: AbilityCategory[] = [
  "EXTERNAL_DEFENSIVE",
  "GROUP_UTILITY",
  "MOVEMENT_UTILITY",
  "BATTLE_REZ",
  "BLOODLUST",
];

const COMPONENT_CATEGORY_MAP: Record<
  UtilityV1ComponentKey,
  AbilityCategory[]
> = {
  interrupts: ["INTERRUPT"],
  dispelsPurges: ["DISPEL", "PURGE"],
  crowdControl: ["HARD_CC", "SOFT_CC"],
  groupUtility: GROUP_CATEGORIES,
};

export function diminishingReturnsScore(
  count: number,
  curve: UtilityV1DiminishingCurve,
): { score: number; cappedCount: number } {
  if (count <= 0) return { score: 0, cappedCount: 0 };
  const cappedCount = Math.min(count, curve.capAtCount);
  const score = Math.min(
    100,
    curve.meaningfulAt + (cappedCount - 1) * curve.incrementalPerUse,
  );
  return { score, cappedCount };
}

export function pointsBeforeCapForActionIndex(
  index: number,
  curve: UtilityV1DiminishingCurve,
): number {
  if (index === 0) return curve.meaningfulAt;
  return curve.incrementalPerUse;
}

function hasToolkit(
  catalog: AbilityCatalog,
  categories: AbilityCategory[],
  classSlug: string | null,
  specSlug: string | null,
): boolean {
  if (!catalog.supported) return false;
  return categories.some(
    (cat) => spellIdsForCategory(catalog, cat, { classSlug, specSlug }).size > 0,
  );
}

function datasetsAvailable(
  normalized: UtilityNormalizedRun,
  required: readonly UtilityEventDataType[],
): boolean {
  return required.every((t) => normalized.datasetStates[t] === "OK");
}

function componentApplicability(
  component: UtilityV1ComponentKey,
  normalized: UtilityNormalizedRun,
  catalog: AbilityCatalog,
  config: UtilityStandaloneV1Config = UTILITY_STANDALONE_V1_CONFIG,
): { applicable: boolean; reason: string | null } {
  const classSlug = normalized.classSlug;
  const specSlug = normalized.specialization;
  const categories = COMPONENT_CATEGORY_MAP[component];

  if (!datasetsAvailable(normalized, config.requiredDatasets[component])) {
    return {
      applicable: false,
      reason: `required_dataset_unavailable:${config.requiredDatasets[component].join(",")}`,
    };
  }

  if (!hasToolkit(catalog, categories, classSlug, specSlug)) {
    return { applicable: false, reason: "no_applicable_catalog_ability" };
  }

  return { applicable: true, reason: null };
}

function isScoreableGroupEvent(classification: string): boolean {
  return (
    classification === "CONFIRMED_USEFUL" ||
    classification === "POSSIBLY_USEFUL"
  );
}

/** Group/class utility eligibility — observability-aware. */
export function assessGroupUtilityEligibility(input: {
  normalized: UtilityNormalizedRun;
  catalog: AbilityCatalog;
  scoreableActionCount: number;
}): {
  outcome: "SCORED" | "ZERO_CONFIRMED_CONTRIBUTION" | "NOT_APPLICABLE";
  reason: string | null;
} {
  const classSlug = input.normalized.classSlug;
  const specSlug = input.normalized.specialization;
  const groupIds = new Set(
    GROUP_CATEGORIES.flatMap((cat) => [
      ...spellIdsForCategory(input.catalog, cat, { classSlug, specSlug }),
    ]),
  );

  const groupEvents = [
    ...input.normalized.externalGroupUtilityEvents,
    ...input.normalized.classSpecificEvents,
  ].filter((e) => groupIds.has(e.abilityGameID));

  if (input.scoreableActionCount > 0) {
    return { outcome: "SCORED", reason: null };
  }

  if (groupEvents.length === 0) {
    return {
      outcome: "ZERO_CONFIRMED_CONTRIBUTION",
      reason: "applicable_toolkit_no_group_utility_casts_observed",
    };
  }

  const observabilityLimited = groupEvents.every(
    (e) => e.classification === "RAW_USE_ONLY" || e.classification === "UNRESOLVED",
  );
  if (observabilityLimited) {
    return {
      outcome: "NOT_APPLICABLE",
      reason: "wcl_cannot_confirm_group_utility_application_or_value",
    };
  }

  return {
    outcome: "ZERO_CONFIRMED_CONTRIBUTION",
    reason: "applicable_toolkit_no_confirmed_group_utility_actions_observed",
  };
}

export function extractConfirmedActions(input: {
  normalized: UtilityNormalizedRun;
  catalog: AbilityCatalog;
  config?: UtilityStandaloneV1Config;
}): UtilityV1ScoredAction[] {
  const config = input.config ?? UTILITY_STANDALONE_V1_CONFIG;
  const { normalized, catalog } = input;
  const classSlug = normalized.classSlug;
  const specSlug = normalized.specialization;
  const interruptIds = spellIdsForCategory(catalog, "INTERRUPT", { classSlug, specSlug });
  const dispelIds = spellIdsForCategory(catalog, "DISPEL", { classSlug, specSlug });
  const purgeIds = spellIdsForCategory(catalog, "PURGE", { classSlug, specSlug });
  const ccIds = new Set([
    ...spellIdsForCategory(catalog, "HARD_CC", { classSlug, specSlug }),
    ...spellIdsForCategory(catalog, "SOFT_CC", { classSlug, specSlug }),
  ]);
  const groupIds = new Set(
    GROUP_CATEGORIES.flatMap((cat) => [
      ...spellIdsForCategory(catalog, cat, { classSlug, specSlug }),
    ]),
  );

  const actions: UtilityV1ScoredAction[] = [];
  let actionSeq = 0;

  const pushAction = (params: {
    component: UtilityV1ComponentKey;
    timestamp: number;
    sourceActorId: number;
    sourceKind: "PLAYER" | "OWNED_PET";
    targetId: number | null;
    spellId: number;
    category: AbilityCategory;
    evidence: string[];
    crossStream: UtilityV1ScoredAction["crossStreamMatch"];
  }) => {
    const rules = rulesForSpell(catalog, params.spellId);
    const rule = rules.find((r) => r.category === params.category) ?? rules[0];
    if (!rule) return;

    const componentActions = actions.filter((a) => a.component === params.component);
    const points = pointsBeforeCapForActionIndex(
      componentActions.length,
      config.diminishingReturns[params.component],
    );

    actions.push({
      actionId: `${normalized.reportCode}:${normalized.fightId}:act:${actionSeq += 1}`,
      reportCode: normalized.reportCode,
      fightId: normalized.fightId,
      dungeonSlug: normalized.dungeonSlug,
      timestamp: params.timestamp,
      sourceActorId: params.sourceActorId,
      sourceOwnership: params.sourceKind,
      targetId: params.targetId,
      rawSpellId: params.spellId,
      canonicalKey: rule.canonicalKey,
      canonicalName: rule.name,
      category: params.category,
      component: params.component,
      evidence: params.evidence,
      pointsBeforeCategoryCap: points,
      crossStreamMatch: params.crossStream,
    });
  };

  for (const event of normalized.interruptEvents) {
    if (event.timestamp == null || event.abilityGameID == null) continue;
    const audit = auditCatalogSpellOnStream(event.abilityGameID, "Interrupts", catalog, {
      classSlug,
      specSlug,
    });
    if (audit.kind === "CROSS_STREAM_MATCH") continue;
    if (!interruptIds.has(event.abilityGameID)) continue;
    pushAction({
      component: "interrupts",
      timestamp: event.timestamp,
      sourceActorId: event.sourceID,
      sourceKind: event.sourceKind,
      targetId: event.targetID,
      spellId: event.abilityGameID,
      category: "INTERRUPT",
      evidence: [
        "wcl_interrupts_stream",
        event.interruptedSpellId != null
          ? `interrupted_spell:${event.interruptedSpellId}`
          : "interrupt_success",
        `source:${event.sourceKind}`,
      ],
      crossStream: null,
    });
  }

  for (const event of normalized.dispelPurgeEvents) {
    if (event.kind === "DISPEL" && event.targetSide === "FRIENDLY" && dispelIds.has(event.abilityGameID)) {
      pushAction({
        component: "dispelsPurges",
        timestamp: event.timestamp,
        sourceActorId: event.sourceID,
        sourceKind: event.sourceKind,
        targetId: event.targetID,
        spellId: event.abilityGameID,
        category: "DISPEL",
        evidence: [
          "wcl_dispels_stream",
          "friendly_target",
          event.removedSpellId != null ? `removed_spell:${event.removedSpellId}` : "dispel_success",
        ],
        crossStream: null,
      });
    }
    if (event.kind === "PURGE" && event.targetSide === "HOSTILE" && purgeIds.has(event.abilityGameID)) {
      pushAction({
        component: "dispelsPurges",
        timestamp: event.timestamp,
        sourceActorId: event.sourceID,
        sourceKind: event.sourceKind,
        targetId: event.targetID,
        spellId: event.abilityGameID,
        category: "PURGE",
        evidence: [
          "wcl_dispels_stream",
          "hostile_target",
          event.removedSpellId != null ? `removed_spell:${event.removedSpellId}` : "purge_success",
        ],
        crossStream: null,
      });
    }
  }

  for (const event of normalized.ccEvents) {
    if (!event.debuffApplied || !event.hostileTarget) continue;
    if (!ccIds.has(event.abilityGameID)) continue;
    pushAction({
      component: "crowdControl",
      timestamp: event.timestamp,
      sourceActorId: event.sourceID,
      sourceKind: event.sourceKind,
      targetId: event.targetID,
      spellId: event.abilityGameID,
      category: event.category,
      evidence: [
        "catalog_matched_cc_cast",
        event.debuffApplied ? "debuff_application_confirmed" : "hostile_target_cast",
        event.nonBossTarget === true ? "non_boss_target" : "boss_target_unknown",
      ],
      crossStream: null,
    });
  }

  const groupEvents = [
    ...normalized.externalGroupUtilityEvents,
    ...normalized.classSpecificEvents,
  ];
  for (const event of groupEvents) {
    if (!groupIds.has(event.abilityGameID)) continue;
    if (!isScoreableGroupEvent(event.classification)) continue;
    pushAction({
      component: "groupUtility",
      timestamp: event.timestamp,
      sourceActorId: event.sourceID,
      sourceKind: event.sourceKind,
      targetId: event.targetID,
      spellId: event.abilityGameID,
      category: event.category,
      evidence: [...event.evidence, `classification:${event.classification}`],
      crossStream: null,
    });
  }

  return actions.sort((a, b) => a.timestamp - b.timestamp);
}

export function buildCatalogAuditSummary(
  normalizedRuns: UtilityNormalizedRun[],
  catalog: AbilityCatalog,
): UtilityV1CatalogAuditSummary {
  const allAudits: UtilityCatalogSpellAudit[] = [];
  for (const run of normalizedRuns) {
    allAudits.push(
      ...collectCatalogAuditsFromNormalizedRun({
        interruptSpellIds: run.interruptEvents.map((e) => e.abilityGameID),
        dispelSpellIds: run.dispelPurgeEvents.map((e) => e.abilityGameID),
        castSpellIds: [],
        catalog,
        classSlug: run.classSlug,
        specSlug: run.specialization,
      }),
    );
  }

  const bySpell = new Map<number, UtilityCatalogSpellAudit>();
  for (const audit of allAudits) bySpell.set(audit.spellId, audit);

  const crossStreamMatches = [...bySpell.values()].filter((a) => a.kind === "CROSS_STREAM_MATCH");
  const aliasMatches = [...bySpell.values()].filter((a) => a.kind === "ALIAS_MATCH");
  const unresolvedSpellIds = [...bySpell.values()]
    .filter((a) => a.kind === "UNRESOLVED")
    .map((a) => a.spellId)
    .sort((a, b) => a - b);

  return {
    crossStreamMatches,
    aliasMatches,
    unresolvedSpellIds,
    investigations: [
      {
        spellId: 710,
        finding: "Banish (SOFT_CC) appears on WCL Interrupts stream — cross-stream, not unmatched",
        catalogAction: "classified_as_CROSS_STREAM_MATCH",
      },
      {
        spellId: 30283,
        finding: "Shadowfury (HARD_CC) appears on WCL Interrupts stream — cross-stream, not unmatched",
        catalogAction: "classified_as_CROSS_STREAM_MATCH",
      },
      {
        spellId: 347008,
        finding: "WCL reports Felguard Axe Toss as spell 347008 on Interrupts stream",
        catalogAction: "verified_alias_added_to_warlock.interrupt.axe-toss",
      },
      {
        spellId: 132411,
        finding: "WCL reports Imp Singe Magic as spell 132411 on Dispels stream",
        catalogAction: "verified_alias_added_to_warlock.dispel.singe-magic",
      },
    ],
  };
}

function redistributeWeights(
  baseWeights: Record<UtilityV1ComponentKey, number>,
  notApplicable: UtilityV1ComponentKey[],
): Record<UtilityV1ComponentKey, number> {
  const applicable = (Object.keys(baseWeights) as UtilityV1ComponentKey[]).filter(
    (k) => !notApplicable.includes(k),
  );
  const removed = notApplicable.reduce((s, k) => s + baseWeights[k], 0);
  if (applicable.length === 0) return { ...baseWeights };
  const applicableBaseSum = applicable.reduce((s, k) => s + baseWeights[k], 0);
  if (applicableBaseSum <= 0) return { ...baseWeights };

  const out = { ...baseWeights };
  for (const k of notApplicable) out[k] = 0;
  for (const k of applicable) {
    out[k] = baseWeights[k] + removed * (baseWeights[k] / applicableBaseSum);
  }
  return out;
}

export function scoreUtilityV1Run(input: {
  normalized: UtilityNormalizedRun;
  catalog: AbilityCatalog;
  config?: UtilityStandaloneV1Config;
}): { runScore: UtilityV1RunScore; actions: UtilityV1ScoredAction[] } {
  const config = input.config ?? UTILITY_STANDALONE_V1_CONFIG;
  const actions = extractConfirmedActions(input);
  const components = {} as Record<UtilityV1ComponentKey, UtilityV1ComponentResult>;
  const notApplicableComponents: UtilityV1ComponentKey[] = [];
  const zeroContributionComponents: UtilityV1ComponentKey[] = [];
  const confirmedEventCounts = {} as Record<UtilityV1ComponentKey, number>;

  for (const component of Object.keys(config.weights) as UtilityV1ComponentKey[]) {
    const applicability = componentApplicability(component, input.normalized, input.catalog, config);
    const count = actions.filter((a) => a.component === component).length;
    confirmedEventCounts[component] = count;
    const curve = config.diminishingReturns[component];

    if (!applicability.applicable) {
      notApplicableComponents.push(component);
      components[component] = {
        component,
        state: "NOT_APPLICABLE",
        score: null,
        baseWeight: config.weights[component],
        weightUsed: 0,
        confirmedCount: count,
        reason: applicability.reason,
        diminishingReturnsApplied: null,
        evidence: { confirmedCount: count },
      };
      continue;
    }

    // Group/class utility: RAW_USE_ONLY-only evidence is an observability limitation → N/A.
    if (component === "groupUtility") {
      const groupEligibility = assessGroupUtilityEligibility({
        normalized: input.normalized,
        catalog: input.catalog,
        scoreableActionCount: count,
      });
      if (groupEligibility.outcome === "NOT_APPLICABLE") {
        notApplicableComponents.push(component);
        components[component] = {
          component,
          state: "NOT_APPLICABLE",
          score: null,
          baseWeight: config.weights[component],
          weightUsed: 0,
          confirmedCount: count,
          reason: groupEligibility.reason,
          diminishingReturnsApplied: null,
          evidence: {
            note: "WCL cannot confirm application/value — weight redistributed, not scored as zero",
          },
        };
        continue;
      }
    }

    const { score, cappedCount } = diminishingReturnsScore(count, curve);
    if (count === 0) {
      zeroContributionComponents.push(component);
      components[component] = {
        component,
        state: "ZERO_CONFIRMED_CONTRIBUTION",
        score: 0,
        baseWeight: config.weights[component],
        weightUsed: config.weights[component],
        confirmedCount: 0,
        reason: "applicable_toolkit_no_confirmed_actions_observed",
        diminishingReturnsApplied: {
          meaningfulAt: curve.meaningfulAt,
          incrementalPerUse: curve.incrementalPerUse,
          capAtCount: curve.capAtCount,
          rawCount: 0,
          cappedCount: 0,
        },
        evidence: { note: "Not a missed opportunity — zero confirmed uses only" },
      };
    } else {
      components[component] = {
        component,
        state: "SCORED",
        score,
        baseWeight: config.weights[component],
        weightUsed: config.weights[component],
        confirmedCount: count,
        reason: null,
        diminishingReturnsApplied: {
          meaningfulAt: curve.meaningfulAt,
          incrementalPerUse: curve.incrementalPerUse,
          capAtCount: curve.capAtCount,
          rawCount: count,
          cappedCount,
        },
        evidence: {
          actionsBeyondCap: Math.max(0, count - curve.capAtCount),
        },
      };
    }
  }

  const weightsApplied = redistributeWeights(config.weights, notApplicableComponents);
  for (const key of Object.keys(components) as UtilityV1ComponentKey[]) {
    components[key]!.weightUsed = weightsApplied[key];
  }

  let score = 0;
  for (const key of Object.keys(components) as UtilityV1ComponentKey[]) {
    const comp = components[key]!;
    if (comp.state === "NOT_APPLICABLE") continue;
    score += (comp.score ?? 0) * weightsApplied[key];
  }

  const runScore: UtilityV1RunScore = {
    runId: `${input.normalized.reportCode}:${input.normalized.fightId}`,
    reportCode: input.normalized.reportCode,
    fightId: input.normalized.fightId,
    dungeonSlug: input.normalized.dungeonSlug,
    keyLevel: input.normalized.keyLevel,
    durationMs: input.normalized.durationMs,
    specialization: input.normalized.specialization,
    classSlug: input.normalized.classSlug,
    components,
    notApplicableComponents,
    zeroContributionComponents,
    confirmedEventCounts,
    score: Math.round(score * 100) / 100,
    weightsApplied,
    actionIds: actions.map((a) => a.actionId),
  };

  return { runScore, actions };
}

export function aggregateUtilityV1Dungeons(
  runScores: UtilityV1RunScore[],
  allActions: UtilityV1ScoredAction[],
  expectedDungeonSlugs: string[],
): { perDungeon: UtilityV1DungeonScore[]; global: UtilityV1GlobalScore } {
  const perDungeon: UtilityV1DungeonScore[] = expectedDungeonSlugs.map((slug) => {
    const runs = runScores.filter((r) => r.dungeonSlug === slug);
    const scores = runs.map((r) => r.score);
    const componentMedians = {} as Record<UtilityV1ComponentKey, number | null>;
    const confirmedCountMedians = {} as Record<UtilityV1ComponentKey, number | null>;
    for (const key of Object.keys(UTILITY_STANDALONE_V1_CONFIG.weights) as UtilityV1ComponentKey[]) {
      componentMedians[key] = median(
        runs.map((r) => r.components[key]?.score ?? null).filter((v): v is number => v != null),
      );
      confirmedCountMedians[key] = median(runs.map((r) => r.confirmedEventCounts[key] ?? 0));
    }
    return {
      dungeonSlug: slug,
      runCount: runs.length,
      medianScore: median(scores),
      runScores: scores,
      componentMedians,
      confirmedCountMedians,
    };
  });

  const withScores = perDungeon.filter((d) => d.medianScore != null);
  const globalScore =
    withScores.length === 0
      ? null
      : withScores.reduce((s, d) => s + (d.medianScore ?? 0), 0) / withScores.length;

  const equalWeightComponentAverages = {} as Record<UtilityV1ComponentKey, number | null>;
  const contributionByCategory = {} as Record<UtilityV1ComponentKey, number | null>;
  for (const key of Object.keys(UTILITY_STANDALONE_V1_CONFIG.weights) as UtilityV1ComponentKey[]) {
    equalWeightComponentAverages[key] = equalWeightMean(
      withScores.map((d) => d.componentMedians[key]),
    );
    contributionByCategory[key] =
      equalWeightComponentAverages[key] != null
        ? equalWeightComponentAverages[key]! * UTILITY_STANDALONE_V1_CONFIG.weights[key]
        : null;
  }

  return {
    perDungeon,
    global: {
      score: globalScore != null ? Math.round(globalScore * 100) / 100 : null,
      availableDungeonCount: withScores.length,
      expectedDungeonCount: expectedDungeonSlugs.length,
      dungeonMedians: perDungeon.map((d) => ({
        dungeonSlug: d.dungeonSlug,
        medianScore: d.medianScore,
        runCount: d.runCount,
      })),
      equalWeightComponentAverages,
      contributionByCategory,
      note:
        "Equal-weight average of dungeon median run scores. Sample sizes separate. Confirmed contribution only.",
    },
  };
}

export function buildUtilityV1Diagnostics(input: {
  runScores: UtilityV1RunScore[];
  allActions: UtilityV1ScoredAction[];
  normalizedRuns: UtilityNormalizedRun[];
  catalog: AbilityCatalog;
  expectedDungeonSlugs: string[];
}): UtilityV1ConfidenceDiagnostics {
  const sampleSizeByDungeon: Record<string, number> = {};
  for (const slug of input.expectedDungeonSlugs) {
    sampleSizeByDungeon[slug] = input.runScores.filter((r) => r.dungeonSlug === slug).length;
  }

  const notApplicableCounts = {} as Record<UtilityV1ComponentKey, number>;
  const zeroContributionCounts = {} as Record<UtilityV1ComponentKey, number>;
  for (const key of Object.keys(UTILITY_STANDALONE_V1_CONFIG.weights) as UtilityV1ComponentKey[]) {
    notApplicableCounts[key] = input.runScores.filter((r) =>
      r.notApplicableComponents.includes(key),
    ).length;
    zeroContributionCounts[key] = input.runScores.filter((r) =>
      r.zeroContributionComponents.includes(key),
    ).length;
  }

  const diminishingReturnsEffect = {} as UtilityV1ConfidenceDiagnostics["diminishingReturnsEffect"];
  for (const key of Object.keys(UTILITY_STANDALONE_V1_CONFIG.weights) as UtilityV1ComponentKey[]) {
    const cap = UTILITY_STANDALONE_V1_CONFIG.diminishingReturns[key].capAtCount;
    const counts = input.runScores.map((r) => r.confirmedEventCounts[key] ?? 0);
    diminishingReturnsEffect[key] = {
      totalConfirmedActions: counts.reduce((a, b) => a + b, 0),
      actionsBeyondCap: counts.reduce((s, c) => s + Math.max(0, c - cap), 0),
      averageCappedCount: median(counts.map((c) => Math.min(c, cap))),
    };
  }

  const auditedExamples: UtilityV1ConfidenceDiagnostics["auditedExamples"] = {};
  for (const key of Object.keys(UTILITY_STANDALONE_V1_CONFIG.weights) as UtilityV1ComponentKey[]) {
    auditedExamples[key] = input.allActions.filter((a) => a.component === key).slice(0, 3);
  }

  return {
    configVersion: UTILITY_STANDALONE_V1_CONFIG.version,
    runCount: input.runScores.length,
    dungeonCoverage: {
      available: input.runScores.reduce(
        (s, r) => s + (input.expectedDungeonSlugs.includes(r.dungeonSlug) ? 0 : 0),
        0,
      ),
      expected: input.expectedDungeonSlugs.length,
      missing: input.expectedDungeonSlugs.filter((s) => (sampleSizeByDungeon[s] ?? 0) === 0),
      sampleSizeByDungeon,
    },
    notApplicableCounts,
    zeroContributionCounts,
    incompleteDatasetRuns: input.normalizedRuns
      .filter((r) => r.incompleteDatasets.length > 0)
      .map((r) => ({
        runId: `${r.reportCode}:${r.fightId}`,
        missing: r.incompleteDatasets,
      })),
    catalogAudit: buildCatalogAuditSummary(input.normalizedRuns, input.catalog),
    diminishingReturnsEffect,
    auditedExamples,
    note: "Utility V1 scores confirmed actions only — no missed-opportunity inference.",
  };
}

export function scoreUtilityV1FromNormalizedRuns(
  normalizedRuns: UtilityNormalizedRun[],
  options: {
    classSlug: string | null;
    specSlug?: string | null;
    expectedDungeonSlugs?: string[];
    scoredAt?: string;
    config?: UtilityStandaloneV1Config;
  },
): {
  runs: UtilityV1RunScore[];
  actions: UtilityV1ScoredAction[];
  perDungeon: UtilityV1DungeonScore[];
  global: UtilityV1GlobalScore;
  diagnostics: UtilityV1ConfidenceDiagnostics;
} {
  const expected = activeSeasonDungeonPool(
    options.expectedDungeonSlugs ?? CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
  );
  const allRuns: UtilityV1RunScore[] = [];
  const allActions: UtilityV1ScoredAction[] = [];

  for (const normalized of normalizedRuns) {
    const catalog = getAbilityCatalog({
      classSlug: options.classSlug ?? normalized.classSlug,
      specSlug: normalized.specialization ?? options.specSlug ?? null,
      role: "DPS",
    });
    const scored = scoreUtilityV1Run({ normalized, catalog, config: options.config });
    allRuns.push(scored.runScore);
    allActions.push(...scored.actions);
  }

  const catalog = getAbilityCatalog({
    classSlug: options.classSlug ?? normalizedRuns[0]?.classSlug ?? null,
    specSlug: normalizedRuns[0]?.specialization ?? options.specSlug ?? null,
    role: "DPS",
  });

  const { perDungeon, global } = aggregateUtilityV1Dungeons(allRuns, allActions, expected);
  const diagnostics = buildUtilityV1Diagnostics({
    runScores: allRuns,
    allActions,
    normalizedRuns,
    catalog,
    expectedDungeonSlugs: expected,
  });
  diagnostics.dungeonCoverage.available = perDungeon.filter((d) => d.runCount > 0).length;

  return { runs: allRuns, actions: allActions, perDungeon, global, diagnostics };
}
