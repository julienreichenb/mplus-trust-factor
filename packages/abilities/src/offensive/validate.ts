import { dimensionTagsForRule } from "../catalog/rule.js";
import { SAME_FIGHT_PARTY_CLASS_SLUGS } from "../catalog/classes-matrix.js";
import { getAllRegisteredRules } from "../registry.js";
import type {
  AbilityRule,
  CatalogValidationReport,
  ValidationIssue,
} from "../types.js";
import {
  CATALOG_GAME_VERSION,
  CURRENT_CATALOG_VERSION,
  CURRENT_CATALOG_VERSION_ID,
} from "../version.js";
import type { OffensiveCandidateCatalog } from "./build.js";
import {
  buildOffensiveCoverageMatrix,
  type OffensiveCoverageMatrix,
} from "./coverage.js";
import { loadAuthoritativeBlizzardPlayableMatrix } from "./sources/blizzard-adapter.js";
import {
  OFFENSIVE_COVERAGE_EXEMPTIONS,
  exemptionFor,
} from "./tooling/exemptions.js";

export interface OffensiveSpecValidationRow {
  classSlug: string;
  specSlug: string;
  role: string;
  blizzardClassId: number;
  blizzardSpecId: number;
  supportState: string;
  discoveredCandidateCount: number;
  reviewedOffensiveCount: number;
  specializationScopedEntryCount: number;
  unresolvedCandidateCount: number;
  conflictingClassificationCount: number;
  duplicateSpellIdCount: number;
  orphanedCatalogEntryCount: number;
  missingProvenanceCount: number;
  observedWclSpellIdsNotRepresented: number[];
  entriesMissingFromGameBuild: number;
  exempt: boolean;
  exemptionReason: string | null;
  racialOnlyCoverage: boolean;
  inSameFightParty: boolean;
  coverageStatus: "COVERED" | "EXEMPT" | "UNCOVERED";
}

export interface OffensiveValidationReport extends CatalogValidationReport {
  schemaVersion: "offensive-validation-report-v2";
  gameVersion: string;
  catalogVersion: string;
  specs: OffensiveSpecValidationRow[];
  coverageMatrix: OffensiveCoverageMatrix;
  scopes: {
    fullRetailSpecializationCoverage: true;
    sameFightObservedValidation: {
      fight: string;
      partyClassSlugs: string[];
    };
    classesSpecsNotInFivePlayerTestParty: string[];
  };
  totals: {
    playableClasses: number;
    playableSpecializations: number;
    coveredSpecializations: number;
    exemptSpecializations: number;
    uncoveredSpecializations: number;
    reviewedCanonicalAbilities: number;
    reviewedOffensive: number;
    candidates: number;
    unresolved: number;
    conflicts: number;
    duplicateSpellIds: number;
    orphaned: number;
    missingProvenance: number;
    specsMissingCoverage: number;
  };
}

function isOffensiveRule(rule: AbilityRule): boolean {
  return dimensionTagsForRule(rule).includes("PERFORMANCE_OFFENSIVE_COOLDOWN");
}

function activationIds(rule: AbilityRule): number[] {
  const ids = [
    ...(rule.activationSpellIds ?? rule.spellIds),
    ...(rule.activationBuffIds ?? []),
    ...(rule.aliases ?? []),
  ];
  return [...new Set(ids.filter((id) => id > 0))];
}

function specializationScopedRules(
  rules: AbilityRule[],
  classSlug: string,
  specSlug: string,
): AbilityRule[] {
  return rules.filter((rule) => {
    if (!isOffensiveRule(rule)) return false;
    if (rule.classSlug == null) return false;
    if (rule.classSlug !== classSlug) return false;
    if (rule.specSlugs.length === 0) return true;
    return rule.specSlugs.includes(specSlug);
  });
}

/**
 * Validate offensive-tagged coverage against the full Blizzard playable matrix.
 * Uses the single canonical AbilityRule catalog (no parallel offensive registry).
 */
export function validateOffensiveCatalog(input?: {
  rules?: AbilityRule[];
  candidates?: OffensiveCandidateCatalog | null;
  observedWclSpellIds?: number[];
  nowIso?: string;
}): OffensiveValidationReport {
  const rules = input?.rules ?? getAllRegisteredRules();
  const offensive = rules.filter(isOffensiveRule);
  const candidates = input?.candidates?.candidates ?? [];
  const observedWcl = new Set(input?.observedWclSpellIds ?? []);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const generatedAt = input?.nowIso ?? new Date().toISOString();
  const blizzardMatrix = loadAuthoritativeBlizzardPlayableMatrix();
  const coverageMatrix = buildOffensiveCoverageMatrix({ rules, nowIso: generatedAt });
  const partySet = new Set<string>(SAME_FIGHT_PARTY_CLASS_SLUGS);

  if (!CURRENT_CATALOG_VERSION.gameVersion || !CURRENT_CATALOG_VERSION_ID) {
    errors.push({
      severity: "error",
      code: "MISSING_CATALOG_VERSION",
      message: "Catalog version or game build metadata is missing",
    });
  }

  if (blizzardMatrix.classes < 13 || blizzardMatrix.specializations < 40) {
    errors.push({
      severity: "error",
      code: "INCOMPLETE_BLIZZARD_MATRIX",
      message: `Blizzard playable matrix incomplete: ${blizzardMatrix.classes} classes / ${blizzardMatrix.specializations} specs (expected ≥13 / ≥40)`,
    });
  }

  const expectedClassSlugs = new Set(blizzardMatrix.rows.map((r) => r.classSlug));
  for (const required of [
    "death-knight",
    "demon-hunter",
    "druid",
    "evoker",
    "hunter",
    "mage",
    "monk",
    "paladin",
    "priest",
    "rogue",
    "shaman",
    "warlock",
    "warrior",
  ]) {
    if (!expectedClassSlugs.has(required)) {
      errors.push({
        severity: "error",
        code: "MISSING_RETAIL_CLASS",
        message: `Current Retail class missing from Blizzard matrix: ${required}`,
        classSlug: required,
      });
    }
  }

  const spellToKeys = new Map<number, Set<string>>();
  for (const rule of offensive) {
    if (
      !rule.classSlug &&
      rule.availability !== "SHARED" &&
      rule.category !== "OFFENSIVE_MINOR"
    ) {
      errors.push({
        severity: "error",
        code: "OFFENSIVE_MISSING_SCOPE",
        message: `Reviewed offensive entry ${rule.canonicalKey} has no class/spec scope`,
        canonicalKey: rule.canonicalKey,
      });
    }

    if (activationIds(rule).length === 0) {
      errors.push({
        severity: "error",
        code: "OFFENSIVE_MISSING_ACTIVATION",
        message: `Reviewed offensive entry ${rule.canonicalKey} has no activation signal`,
        canonicalKey: rule.canonicalKey,
      });
    }

    if (!rule.provenance?.source || !rule.provenance.gameVersion) {
      errors.push({
        severity: "error",
        code: "OFFENSIVE_MISSING_PROVENANCE",
        message: `Reviewed offensive entry ${rule.canonicalKey} is missing provenance`,
        canonicalKey: rule.canonicalKey,
      });
    }

    for (const spellId of [
      ...rule.spellIds,
      ...(rule.aliases ?? []),
      ...(rule.activationSpellIds ?? []),
      ...(rule.activationBuffIds ?? []),
    ]) {
      if (spellId <= 0) continue;
      const set = spellToKeys.get(spellId) ?? new Set();
      set.add(rule.canonicalKey);
      spellToKeys.set(spellId, set);
    }
  }

  let conflictingClassificationCount = 0;
  let duplicateSpellIdCount = 0;
  for (const [spellId, keys] of spellToKeys) {
    if (keys.size <= 1) continue;
    duplicateSpellIdCount += 1;
    const keyList = [...keys].sort();
    const mapped = keyList.map((k) => offensive.find((r) => r.canonicalKey === k)!);
    const categories = new Set(mapped.map((r) => r.category));
    const classes = new Set(mapped.map((r) => r.classSlug ?? "null"));
    if (categories.size > 1 || classes.size > 1) {
      conflictingClassificationCount += 1;
      errors.push({
        severity: "error",
        code: "OFFENSIVE_SPELL_INCOMPATIBLE_MAP",
        message: `Spell ${spellId} maps to incompatible canonical abilities: ${keyList.join(", ")}`,
        spellId,
      });
    } else {
      warnings.push({
        severity: "warning",
        code: "OFFENSIVE_DUPLICATE_SPELL",
        message: `Spell ${spellId} appears on multiple compatible offensive entries: ${keyList.join(", ")}`,
        spellId,
      });
    }
  }

  const catalogSpellIds = new Set<number>();
  for (const rule of offensive) {
    for (const id of [...rule.spellIds, ...(rule.aliases ?? [])]) catalogSpellIds.add(id);
  }

  const observedWclSpellIdsNotRepresented = [...observedWcl]
    .filter((id) => !catalogSpellIds.has(id))
    .sort((a, b) => a - b);

  const unresolvedCandidates = candidates.filter(
    (c) =>
      c.primarySpellId > 0 &&
      c.reviewStatus === "CANDIDATE" &&
      c.matchedCanonicalKey == null,
  );
  if (unresolvedCandidates.length > 0) {
    errors.push({
      severity: "error",
      code: "OFFENSIVE_UNREVIEWED_CANDIDATES",
      message: `${unresolvedCandidates.length} candidate entries were never reviewed (must promote or reject before validate passes)`,
    });
  }

  const candidateByClassSpec = new Map<string, typeof unresolvedCandidates>();
  for (const c of candidates) {
    if (!c.classSlug) continue;
    const specs = c.allowedSpecSlugs.length > 0 ? c.allowedSpecSlugs : ["*"];
    for (const spec of specs) {
      const key = `${c.classSlug}/${spec}`;
      const list = candidateByClassSpec.get(key) ?? [];
      list.push(c);
      candidateByClassSpec.set(key, list);
    }
  }

  const specs: OffensiveSpecValidationRow[] = [];
  let specsMissingCoverage = 0;

  for (const row of blizzardMatrix.rows) {
    if (!row.blizzardClassId || !row.blizzardSpecId) {
      errors.push({
        severity: "error",
        code: "INCOMPLETE_CLASS_SPEC_METADATA",
        message: `Specialization ${row.classSlug}/${row.specSlug} is missing Blizzard class/spec IDs`,
        classSlug: row.classSlug,
        specSlug: row.specSlug,
      });
    }

    const scoped = specializationScopedRules(rules, row.classSlug, row.specSlug);
    const exempt = exemptionFor(row.classSlug, row.specSlug);
    const racialOnly =
      scoped.length === 0 && offensive.some((r) => r.classSlug == null);

    const seedKey = `${row.classSlug}/${row.specSlug}`;
    const discovered = [
      ...(candidateByClassSpec.get(seedKey) ?? []),
      ...(candidateByClassSpec.get(`${row.classSlug}/*`) ?? []),
    ];
    const unresolved = discovered.filter(
      (c) =>
        c.primarySpellId > 0 &&
        c.reviewStatus === "CANDIDATE" &&
        c.matchedCanonicalKey == null,
    );

    let coverageStatus: OffensiveSpecValidationRow["coverageStatus"];
    if (exempt) coverageStatus = "EXEMPT";
    else if (scoped.length > 0) coverageStatus = "COVERED";
    else coverageStatus = "UNCOVERED";

    if (coverageStatus === "UNCOVERED") {
      specsMissingCoverage += 1;
      errors.push({
        severity: "error",
        code: "OFFENSIVE_SPEC_MISSING_COVERAGE",
        message: `Blizzard specialization ${row.classSlug}/${row.specSlug} (class ${row.blizzardClassId} / spec ${row.blizzardSpecId}) has zero reviewed offensive entries and no explicit exemption`,
        classSlug: row.classSlug,
        specSlug: row.specSlug,
      });
    }

    if (racialOnly && !exempt && scoped.length === 0) {
      errors.push({
        severity: "error",
        code: "OFFENSIVE_RACIAL_ONLY_COVERAGE",
        message: `Specialization ${row.classSlug}/${row.specSlug} has only racial offensive entries — specialization coverage is required`,
        classSlug: row.classSlug,
        specSlug: row.specSlug,
      });
    }

    if (exempt && scoped.length > 0) {
      warnings.push({
        severity: "warning",
        code: "OFFENSIVE_EXEMPT_BUT_COVERED",
        message: `Exemption ${row.classSlug}/${row.specSlug} is unnecessary — reviewed specialization entries exist`,
        classSlug: row.classSlug,
        specSlug: row.specSlug,
      });
    }

    specs.push({
      classSlug: row.classSlug,
      specSlug: row.specSlug,
      role: row.role,
      blizzardClassId: row.blizzardClassId,
      blizzardSpecId: row.blizzardSpecId,
      supportState: row.supportState,
      discoveredCandidateCount: discovered.length,
      reviewedOffensiveCount: scoped.length,
      specializationScopedEntryCount: scoped.length,
      unresolvedCandidateCount: unresolved.length,
      conflictingClassificationCount,
      duplicateSpellIdCount,
      orphanedCatalogEntryCount: scoped.filter((r) => {
        if (!r.validToBuild) return false;
        return r.validToBuild < CATALOG_GAME_VERSION;
      }).length,
      missingProvenanceCount: scoped.filter(
        (r) => !r.provenance?.source || !r.provenance.gameVersion,
      ).length,
      observedWclSpellIdsNotRepresented,
      entriesMissingFromGameBuild: 0,
      exempt: exempt != null,
      exemptionReason: exempt?.reason ?? null,
      racialOnlyCoverage: racialOnly && scoped.length === 0,
      inSameFightParty: partySet.has(row.classSlug),
      coverageStatus,
    });
  }

  for (const ex of OFFENSIVE_COVERAGE_EXEMPTIONS) {
    warnings.push({
      severity: "warning",
      code: "OFFENSIVE_SPEC_EXEMPT",
      message: `Exemption ${ex.classSlug}/${ex.specSlug}: ${ex.reason}`,
      classSlug: ex.classSlug,
      specSlug: ex.specSlug,
    });
  }

  const coveredSpecializations = specs.filter((s) => s.coverageStatus === "COVERED").length;
  const exemptSpecializations = specs.filter((s) => s.coverageStatus === "EXEMPT").length;
  const uncoveredSpecializations = specs.filter((s) => s.coverageStatus === "UNCOVERED").length;

  return {
    schemaVersion: "offensive-validation-report-v2",
    valid: errors.length === 0,
    errors,
    warnings,
    generatedAt,
    gameVersion: CATALOG_GAME_VERSION,
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    specs,
    coverageMatrix,
    scopes: {
      fullRetailSpecializationCoverage: true,
      sameFightObservedValidation: {
        fight: "1WKcCz2BnAQmbhfq:1:r1",
        partyClassSlugs: [...SAME_FIGHT_PARTY_CLASS_SLUGS],
      },
      classesSpecsNotInFivePlayerTestParty:
        coverageMatrix.scopes.classesSpecsNotInFivePlayerTestParty,
    },
    totals: {
      playableClasses: blizzardMatrix.classes,
      playableSpecializations: blizzardMatrix.specializations,
      coveredSpecializations,
      exemptSpecializations,
      uncoveredSpecializations,
      reviewedCanonicalAbilities: coverageMatrix.totals.reviewedCanonicalAbilities,
      reviewedOffensive: offensive.length,
      candidates: candidates.length,
      unresolved: unresolvedCandidates.length,
      conflicts: conflictingClassificationCount,
      duplicateSpellIds: duplicateSpellIdCount,
      orphaned: specs.reduce((n, s) => n + s.orphanedCatalogEntryCount, 0),
      missingProvenance: offensive.filter(
        (r) => !r.provenance?.source || !r.provenance.gameVersion,
      ).length,
      specsMissingCoverage: uncoveredSpecializations,
    },
  };
}
