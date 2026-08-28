import type { AbilityRule } from "../types.js";
import { projectCurrentRuleBindings } from "./bindings.js";
import { assessCatalogEligibility } from "./eligibility.js";
import { dedupeBindings } from "./bindings.js";
import type {
  AbilitySpellBindingCandidate,
  ExternalAbilityCandidate,
  ExternalSourceSnapshot,
  RefreshCertainty,
} from "./types.js";

/** Per-spell temporal classification for racial variant collapse. */
export type RacialVariantValidity =
  | "CURRENT_FOR_TARGET_BUILD"
  | "CURRENT_VARIANT"
  | "HISTORICAL_VARIANT"
  | "AMBIGUOUS_VALIDITY";

export interface RacialVariantMember {
  spellId: number;
  validity: RacialVariantValidity;
  candidateKey: string;
  name: string;
  reasons: string[];
}

export interface RacialVariantGroupAudit {
  groupKey: string;
  raceSlugs: string[];
  name: string;
  members: RacialVariantMember[];
  currentSpellIds: number[];
  historicalSpellIds: number[];
  ambiguousSpellIds: number[];
  resultingCandidateKey: string | null;
}

export interface RacialVariantCollapseReport {
  rawRacialCandidates: number;
  conceptualGroups: number;
  historicalVariantsExcluded: number;
  currentSingleIdGroups: number;
  currentMultiIdGroups: number;
  ambiguousGroups: number;
  groups: RacialVariantGroupAudit[];
}

function normalizeNameSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isRacialCandidate(candidate: ExternalAbilityCandidate): boolean {
  return candidate.raceSlugs.length > 0 && candidate.classSlug == null;
}

/**
 * Conceptual racial identity: race set + ability name (or curated shared.racial key).
 * Never crosses races — raceSlugs are part of the key.
 */
export function racialConceptualGroupKey(candidate: ExternalAbilityCandidate): string {
  const curated =
    candidate.candidateKey.startsWith("shared.racial.") &&
    !/-\d+$/.test(candidate.candidateKey)
      ? candidate.candidateKey
      : null;
  const raceKey = [...candidate.raceSlugs].sort().join("+") || "unknown-race";
  const nameKey =
    curated ?? (normalizeNameSlug(candidate.name) || `spell-${candidate.primarySpellId}`);
  return `racial:${raceKey}:${nameKey}`;
}

/**
 * Spell-level build window only. Snapshot-wide validFrom/validTo copied onto every
 * candidate is NOT spell evidence — treat as unknown unless marked spell-specific.
 */
export function spellBuildIsCurrentForTarget(input: {
  validFromBuild?: string | null;
  validToBuild?: string | null;
  targetBuild?: string | null;
  spellSpecific?: boolean;
}): boolean | null {
  if (!input.spellSpecific) return null;
  const target = input.targetBuild?.trim();
  if (!target) return null;
  const from = input.validFromBuild?.trim() || null;
  const to = input.validToBuild?.trim() || null;
  if (!from && !to) return null;
  if (from && compareBuildTokens(from, target) > 0) return false;
  if (to && compareBuildTokens(target, to) > 0) return false;
  return true;
}

/** Compare dotted or integer build tokens lexicographically by numeric segments. */
export function compareBuildTokens(a: string, b: string): number {
  const pa = a.split(/[.\-_]/).map((p) => Number.parseInt(p, 10));
  const pb = b.split(/[.\-_]/).map((p) => Number.parseInt(p, 10));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const av = Number.isFinite(pa[i]) ? pa[i]! : 0;
    const bv = Number.isFinite(pb[i]) ? pb[i]! : 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

function ruleSpellIdSet(rule: AbilityRule): Set<number> {
  const ids = new Set<number>();
  for (const id of rule.spellIds) ids.add(id);
  for (const id of rule.aliases ?? []) ids.add(id);
  for (const id of rule.activationSpellIds ?? []) ids.add(id);
  for (const b of projectCurrentRuleBindings(rule)) ids.add(b.spellId);
  return ids;
}

function racesOverlap(candidateRaces: string[], ruleRaces: string[] | undefined): boolean {
  const rr = ruleRaces ?? [];
  if (candidateRaces.length === 0 || rr.length === 0) return true;
  return candidateRaces.some((r) => rr.includes(r));
}

function catalogRulesForRacial(
  candidate: ExternalAbilityCandidate,
  currentRules: AbilityRule[],
): AbilityRule[] {
  return currentRules.filter((rule) => {
    if (rule.classSlug != null) return false;
    if (!racesOverlap(candidate.raceSlugs, rule.raceSlugs)) return false;
    const ids = ruleSpellIdSet(rule);
    if (ids.has(candidate.primarySpellId)) return true;
    return candidate.bindings.some((b) => ids.has(b.spellId));
  });
}

function hasLiveSimcPresence(candidate: ExternalAbilityCandidate): boolean {
  return candidate.sourceObservations.some(
    (o) =>
      o.source === "SIMULATIONCRAFT" &&
      (o.state === "PRESENT" || o.state === "IDENTITY_ONLY") &&
      (o.identity.dataMode === "LIVE" || o.identity.dataMode == null),
  );
}

function hasBlizzardIdentity(candidate: ExternalAbilityCandidate): boolean {
  return candidate.sourceObservations.some(
    (o) => o.source === "BLIZZARD" && (o.state === "PRESENT" || o.state === "IDENTITY_ONLY"),
  );
}

function spellSpecificValidity(candidate: ExternalAbilityCandidate): {
  from?: string;
  to?: string;
  specific: boolean;
} {
  const note = candidate.notes.find((n) => n.startsWith("spell-validity:"));
  if (note) {
    // spell-validity:from=X;to=Y
    const from = note.match(/from=([^;]+)/)?.[1];
    const to = note.match(/to=([^;]*)/)?.[1];
    return { from, to: to || undefined, specific: true };
  }
  const extraFrom = (candidate as { spellValidFromBuild?: string }).spellValidFromBuild;
  const extraTo = (candidate as { spellValidToBuild?: string }).spellValidToBuild;
  if (extraFrom || extraTo) {
    return { from: extraFrom, to: extraTo, specific: true };
  }
  return { specific: false };
}

export function classifyRacialVariantMember(input: {
  candidate: ExternalAbilityCandidate;
  currentRules: AbilityRule[];
  targetBuild?: string | null;
}): RacialVariantMember {
  const { candidate, currentRules, targetBuild } = input;
  const reasons: string[] = [];
  const catalogHits = catalogRulesForRacial(candidate, currentRules);
  if (catalogHits.length > 0) {
    reasons.push(
      `Matched current catalog rule(s): ${catalogHits.map((r) => r.canonicalKey).join(", ")}`,
    );
    return {
      spellId: candidate.primarySpellId,
      validity: "CURRENT_VARIANT",
      candidateKey: candidate.candidateKey,
      name: candidate.name,
      reasons,
    };
  }

  const spellWindow = spellSpecificValidity(candidate);
  const buildCurrent = spellBuildIsCurrentForTarget({
    validFromBuild: spellWindow.from ?? candidate.validFromBuild,
    validToBuild: spellWindow.to ?? candidate.validToBuild,
    targetBuild,
    spellSpecific: spellWindow.specific,
  });
  if (buildCurrent === false) {
    reasons.push("Explicit spell build window is outside the target build");
    return {
      spellId: candidate.primarySpellId,
      validity: "HISTORICAL_VARIANT",
      candidateKey: candidate.candidateKey,
      name: candidate.name,
      reasons,
    };
  }
  if (buildCurrent === true) {
    reasons.push("Explicit spell build window includes the target build");
    if (hasLiveSimcPresence(candidate)) reasons.push("Present in LIVE SimC snapshot");
    if (hasBlizzardIdentity(candidate)) reasons.push("Present in Blizzard identity");
    return {
      spellId: candidate.primarySpellId,
      validity: "CURRENT_FOR_TARGET_BUILD",
      candidateKey: candidate.candidateKey,
      name: candidate.name,
      reasons,
    };
  }

  reasons.push("No spell-specific build window; temporal validity unknown");
  if (hasLiveSimcPresence(candidate)) {
    reasons.push("Observed in LIVE SimC race inventory (not sufficient alone to prove currency)");
  }
  if (hasBlizzardIdentity(candidate)) {
    reasons.push("Blizzard identity observed (not sufficient alone to prove currency)");
  }
  return {
    spellId: candidate.primarySpellId,
    validity: "AMBIGUOUS_VALIDITY",
    candidateKey: candidate.candidateKey,
    name: candidate.name,
    reasons,
  };
}

function pickPrimarySpellId(
  members: ExternalAbilityCandidate[],
  catalogRules: AbilityRule[],
): number {
  for (const rule of catalogRules) {
    const primary = rule.spellIds[0];
    if (primary != null && members.some((m) => m.primarySpellId === primary)) {
      return primary;
    }
  }
  // Stable identity only — not a claim of "newest" or "best".
  return [...members].sort((a, b) => a.primarySpellId - b.primarySpellId)[0]!.primarySpellId;
}

function mergeRacialGroup(input: {
  groupKey: string;
  members: ExternalAbilityCandidate[];
  classifications: RacialVariantMember[];
  currentRules: AbilityRule[];
}): ExternalAbilityCandidate | null {
  const { members, classifications, currentRules } = input;
  const byId = new Map(members.map((m) => [m.primarySpellId, m]));
  const currentIds = new Set(
    classifications
      .filter(
        (c) => c.validity === "CURRENT_VARIANT" || c.validity === "CURRENT_FOR_TARGET_BUILD",
      )
      .map((c) => c.spellId),
  );
  const historicalIds = new Set(
    classifications.filter((c) => c.validity === "HISTORICAL_VARIANT").map((c) => c.spellId),
  );
  const ambiguousIds = new Set(
    classifications.filter((c) => c.validity === "AMBIGUOUS_VALIDITY").map((c) => c.spellId),
  );

  const keepIds = [...currentIds, ...ambiguousIds];
  if (keepIds.length === 0) return null;

  const keepMembers = keepIds.map((id) => byId.get(id)!).filter(Boolean);
  const catalogHits = keepMembers.flatMap((m) => catalogRulesForRacial(m, currentRules));
  const uniqueCatalog = [...new Map(catalogHits.map((r) => [r.canonicalKey, r])).values()];
  const primarySpellId = pickPrimarySpellId(keepMembers, uniqueCatalog);
  const primary = byId.get(primarySpellId)!;

  const bindings: AbilitySpellBindingCandidate[] = [];
  for (const m of keepMembers) {
    if (m.primarySpellId === primarySpellId) {
      bindings.push({
        spellId: m.primarySpellId,
        role: "PRIMARY_ACTIVATION",
        source: "SIMULATIONCRAFT",
        certainty: "unverified",
        evidence: "racial-variant-collapse:primary",
      });
    } else if (currentIds.has(m.primarySpellId)) {
      bindings.push({
        spellId: m.primarySpellId,
        role: "CAST_ALIAS",
        source: "SIMULATIONCRAFT",
        certainty: "unverified",
        evidence: "racial-variant-collapse:current-alias",
      });
    } else {
      bindings.push({
        spellId: m.primarySpellId,
        role: "CAST_ALIAS",
        source: "SIMULATIONCRAFT",
        certainty: "unverified",
        evidence: "racial-variant-collapse:ambiguous-competing-id",
      });
    }
    for (const b of m.bindings) {
      if (b.spellId === m.primarySpellId) continue;
      bindings.push(b);
    }
  }

  const observations = keepMembers.flatMap((m) => m.sourceObservations);
  const notes = [
    ...new Set(keepMembers.flatMap((m) => m.notes)),
    `racial-variant-group:${input.groupKey}`,
    currentIds.size
      ? `current-retail-ids:${[...currentIds].sort((a, b) => a - b).join(",")}`
      : "current-retail-ids:",
    historicalIds.size
      ? `historical-ids-excluded:${[...historicalIds].sort((a, b) => a - b).join(",")}`
      : "historical-ids-excluded:",
    ambiguousIds.size
      ? `ambiguous-ids:${[...ambiguousIds].sort((a, b) => a - b).join(",")}`
      : "ambiguous-ids:",
    ...classifications.flatMap((c) =>
      c.reasons.map((r) => `variant:${c.spellId}:${c.validity}:${r}`),
    ),
  ];

  const groupValidity: RacialVariantValidity =
    ambiguousIds.size > 0
      ? "AMBIGUOUS_VALIDITY"
      : currentIds.size > 0
        ? classifications.some((c) => c.validity === "CURRENT_VARIANT" && currentIds.has(c.spellId))
          ? "CURRENT_VARIANT"
          : "CURRENT_FOR_TARGET_BUILD"
        : "AMBIGUOUS_VALIDITY";

  const candidateKey =
    uniqueCatalog[0]?.canonicalKey ??
    (primary.candidateKey.startsWith("shared.racial.") && !/-\d+$/.test(primary.candidateKey)
      ? primary.candidateKey
      : `shared.racial.${normalizeNameSlug(primary.name)}`);

  const merged: ExternalAbilityCandidate = {
    ...primary,
    candidateKey,
    primarySpellId,
    raceSlugs: [...new Set(keepMembers.flatMap((m) => m.raceSlugs))].sort(),
    bindings: dedupeBindings(bindings),
    sourceObservations: observations,
    notes,
    cooldownSeconds: keepMembers.map((m) => m.cooldownSeconds).find((v) => v != null) ?? null,
    charges: keepMembers.map((m) => m.charges).find((v) => v != null) ?? null,
    stacks: keepMembers.map((m) => m.stacks).find((v) => v != null) ?? null,
    isPassive: keepMembers.every((m) => m.isPassive === true)
      ? true
      : keepMembers.some((m) => m.isPassive === false)
        ? false
        : primary.isPassive,
    certainty: (observations.length > 1 ? "unverified" : primary.certainty) as RefreshCertainty,
    catalogRelevance: keepMembers.some((m) => m.catalogRelevance === "ACTIVE_CANDIDATE")
      ? "ACTIVE_CANDIDATE"
      : primary.catalogRelevance,
  };

  const eligibility = assessCatalogEligibility(merged, currentRules);
  return {
    ...merged,
    ...eligibility,
    notes: [
      ...merged.notes,
      `racial-variant-validity:${groupValidity}`,
    ],
  };
}

/**
 * Collapse same-race conceptual racial spell variants into one candidate where appropriate.
 * Historical variants are dropped; ambiguous multi-ID groups become one reviewable candidate.
 */
export function collapseRacialSpellVariants(
  candidates: ExternalAbilityCandidate[],
  options: {
    currentRules?: AbilityRule[];
    targetBuild?: string | null;
    snapshots?: ExternalSourceSnapshot[];
  } = {},
): { candidates: ExternalAbilityCandidate[]; report: RacialVariantCollapseReport } {
  const currentRules = options.currentRules ?? [];
  const targetBuild =
    options.targetBuild ??
    options.snapshots?.find((s) => s.identity.source === "SIMULATIONCRAFT")?.simulationCraft?.wowBuild ??
    options.snapshots?.find((s) => s.identity.source === "SIMULATIONCRAFT")?.identity.validFromBuild ??
    options.snapshots?.[0]?.identity.validFromBuild ??
    null;

  const racials = candidates.filter(isRacialCandidate);
  const others = candidates.filter((c) => !isRacialCandidate(c));

  const groups = new Map<string, ExternalAbilityCandidate[]>();
  for (const c of racials) {
    const key = racialConceptualGroupKey(c);
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const out: ExternalAbilityCandidate[] = [...others];
  const auditGroups: RacialVariantGroupAudit[] = [];
  let historicalExcluded = 0;
  let currentSingle = 0;
  let currentMulti = 0;
  let ambiguousGroups = 0;

  for (const [groupKey, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const classifications = members.map((candidate) =>
      classifyRacialVariantMember({ candidate, currentRules, targetBuild }),
    );
    const currentSpellIds = classifications
      .filter(
        (c) => c.validity === "CURRENT_VARIANT" || c.validity === "CURRENT_FOR_TARGET_BUILD",
      )
      .map((c) => c.spellId)
      .sort((a, b) => a - b);
    const historicalSpellIds = classifications
      .filter((c) => c.validity === "HISTORICAL_VARIANT")
      .map((c) => c.spellId)
      .sort((a, b) => a - b);
    const ambiguousSpellIds = classifications
      .filter((c) => c.validity === "AMBIGUOUS_VALIDITY")
      .map((c) => c.spellId)
      .sort((a, b) => a - b);

    historicalExcluded += historicalSpellIds.length;

    if (members.length === 1 && historicalSpellIds.length === 1) {
      auditGroups.push({
        groupKey,
        raceSlugs: members[0]!.raceSlugs,
        name: members[0]!.name,
        members: classifications,
        currentSpellIds,
        historicalSpellIds,
        ambiguousSpellIds,
        resultingCandidateKey: null,
      });
      continue;
    }

    if (members.length === 1 && ambiguousSpellIds.length === 1) {
      // Sole LIVE observation for this racial concept — treat as current-for-target
      // while keeping unknown windows explicit in notes.
      const only = {
        ...members[0]!,
        notes: [
          ...members[0]!.notes,
          "racial-variant-validity:CURRENT_FOR_TARGET_BUILD",
          "sole-conceptual-observation-in-target-snapshot",
        ],
      };
      const withElig = { ...only, ...assessCatalogEligibility(only, currentRules) };
      out.push(withElig);
      currentSingle += 1;
      auditGroups.push({
        groupKey,
        raceSlugs: only.raceSlugs,
        name: only.name,
        members: [
          {
            ...classifications[0]!,
            validity: "CURRENT_FOR_TARGET_BUILD",
            reasons: [
              ...classifications[0]!.reasons,
              "Sole conceptual observation in target snapshot",
            ],
          },
        ],
        currentSpellIds: [only.primarySpellId],
        historicalSpellIds,
        ambiguousSpellIds: [],
        resultingCandidateKey: withElig.candidateKey,
      });
      continue;
    }

    if (members.length === 1) {
      out.push(members[0]!);
      currentSingle += 1;
      auditGroups.push({
        groupKey,
        raceSlugs: members[0]!.raceSlugs,
        name: members[0]!.name,
        members: classifications,
        currentSpellIds,
        historicalSpellIds,
        ambiguousSpellIds,
        resultingCandidateKey: members[0]!.candidateKey,
      });
      continue;
    }

    const merged = mergeRacialGroup({
      groupKey,
      members,
      classifications,
      currentRules,
    });
    if (merged) {
      out.push(merged);
      if (ambiguousSpellIds.length > 0 && currentSpellIds.length === 0) ambiguousGroups += 1;
      else if (currentSpellIds.length > 1 || (currentSpellIds.length >= 1 && ambiguousSpellIds.length > 0))
        currentMulti += 1;
      else if (currentSpellIds.length === 1 && ambiguousSpellIds.length === 0) currentSingle += 1;
      else ambiguousGroups += 1;
    } else {
      // all historical
    }

    auditGroups.push({
      groupKey,
      raceSlugs: [...new Set(members.flatMap((m) => m.raceSlugs))].sort(),
      name: members[0]!.name,
      members: classifications,
      currentSpellIds,
      historicalSpellIds,
      ambiguousSpellIds,
      resultingCandidateKey: merged?.candidateKey ?? null,
    });
  }

  return {
    candidates: out.sort((a, b) => a.candidateKey.localeCompare(b.candidateKey)),
    report: {
      rawRacialCandidates: racials.length,
      conceptualGroups: groups.size,
      historicalVariantsExcluded: historicalExcluded,
      currentSingleIdGroups: currentSingle,
      currentMultiIdGroups: currentMulti,
      ambiguousGroups,
      groups: auditGroups,
    },
  };
}
