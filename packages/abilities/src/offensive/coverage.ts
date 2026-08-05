import { dimensionTagsForRule } from "../catalog/rule.js";
import { SAME_FIGHT_PARTY_CLASS_SLUGS } from "../catalog/classes-matrix.js";
import { getAllRegisteredRules } from "../registry.js";
import type { AbilityRule } from "../types.js";
import {
  CATALOG_GAME_VERSION,
  CURRENT_CATALOG_VERSION_ID,
} from "../version.js";
import { exemptionFor } from "./tooling/exemptions.js";
import { loadAuthoritativeBlizzardPlayableMatrix } from "./sources/blizzard-adapter.js";

export interface OffensiveCoverageAbilityRow {
  canonicalKey: string;
  canonicalName: string;
  activationSpellIds: number[];
  category: string;
  provenanceSource: string;
}

export interface OffensiveCoverageSpecRow {
  classSlug: string;
  className: string;
  specSlug: string;
  specName: string;
  role: string;
  blizzardClassId: number;
  blizzardSpecId: number;
  supportState: string;
  reviewedOffensiveEntryCount: number;
  /** Spec-scoped or class-scoped reviewed entries (excludes racial-only). */
  specializationScopedEntryCount: number;
  racialOnlyCoverage: boolean;
  canonicalCooldownNames: string[];
  activationSpellIds: number[];
  abilities: OffensiveCoverageAbilityRow[];
  exemptionStatus: "NONE" | "EXEMPT";
  exemptionReason: string | null;
  sourceProvenance: string;
  coverageStatus: "COVERED" | "EXEMPT" | "UNCOVERED";
  inSameFightParty: boolean;
  sameFightObservedValidation: boolean;
}

export interface OffensiveCoverageMatrix {
  schemaVersion: "offensive-coverage-matrix-v1";
  gameVersion: string;
  catalogVersion: string;
  generatedAt: string;
  blizzardMatrix: {
    provenance: string;
    verifiedAt: string;
    playableClasses: number;
    playableSpecializations: number;
  };
  scopes: {
    fullRetailSpecializationCoverage: true;
    sameFightObservedValidation: {
      fight: string;
      partyClassSlugs: string[];
      note: string;
    };
    classesSpecsNotInFivePlayerTestParty: string[];
  };
  specs: OffensiveCoverageSpecRow[];
  totals: {
    playableClasses: number;
    playableSpecializations: number;
    coveredSpecializations: number;
    exemptSpecializations: number;
    uncoveredSpecializations: number;
    reviewedCanonicalAbilities: number;
    sameFightPartyClasses: number;
    classesNotInSameFightParty: number;
  };
}

function isOffensiveRule(rule: AbilityRule): boolean {
  return dimensionTagsForRule(rule).includes("PERFORMANCE_OFFENSIVE_COOLDOWN");
}

function activationIds(rule: AbilityRule): number[] {
  return [
    ...new Set(
      [
        ...(rule.activationSpellIds ?? rule.spellIds),
        ...(rule.activationBuffIds ?? []),
        ...(rule.aliases ?? []),
      ].filter((id) => id > 0),
    ),
  ];
}

/** Class/spec-scoped offensive rules (never racial/shared-only). */
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
 * Build the full Retail offensive coverage matrix from the Blizzard playable adapter.
 * Reads PERFORMANCE_OFFENSIVE_COOLDOWN entries from the single canonical catalog.
 */
export function buildOffensiveCoverageMatrix(input?: {
  rules?: AbilityRule[];
  nowIso?: string;
}): OffensiveCoverageMatrix {
  const matrix = loadAuthoritativeBlizzardPlayableMatrix();
  const rules = input?.rules ?? getAllRegisteredRules();
  const reviewedCanonicalAbilities = rules.filter(isOffensiveRule).length;
  const partySet = new Set<string>(SAME_FIGHT_PARTY_CLASS_SLUGS);
  const generatedAt = input?.nowIso ?? new Date().toISOString();

  const specs: OffensiveCoverageSpecRow[] = matrix.rows.map((row) => {
    const scoped = specializationScopedRules(rules, row.classSlug, row.specSlug);
    const exempt = exemptionFor(row.classSlug, row.specSlug);
    const racialOnly =
      scoped.length === 0 &&
      rules.some((r) => isOffensiveRule(r) && r.classSlug == null);
    let coverageStatus: OffensiveCoverageSpecRow["coverageStatus"];
    if (exempt) coverageStatus = "EXEMPT";
    else if (scoped.length > 0) coverageStatus = "COVERED";
    else coverageStatus = "UNCOVERED";

    const abilities: OffensiveCoverageAbilityRow[] = scoped.map((r) => ({
      canonicalKey: r.canonicalKey,
      canonicalName: r.name,
      activationSpellIds: activationIds(r),
      category: r.category,
      provenanceSource: r.provenance.source,
    }));

    return {
      classSlug: row.classSlug,
      className: row.className,
      specSlug: row.specSlug,
      specName: row.specName,
      role: row.role,
      blizzardClassId: row.blizzardClassId,
      blizzardSpecId: row.blizzardSpecId,
      supportState: row.supportState,
      reviewedOffensiveEntryCount: scoped.length,
      specializationScopedEntryCount: scoped.length,
      racialOnlyCoverage: racialOnly && scoped.length === 0,
      canonicalCooldownNames: abilities.map((a) => a.canonicalName),
      activationSpellIds: [...new Set(abilities.flatMap((a) => a.activationSpellIds))],
      abilities,
      exemptionStatus: exempt ? "EXEMPT" : "NONE",
      exemptionReason: exempt?.reason ?? null,
      sourceProvenance: matrix.provenance,
      coverageStatus,
      inSameFightParty: partySet.has(row.classSlug),
      sameFightObservedValidation: partySet.has(row.classSlug),
    };
  });

  const covered = specs.filter((s) => s.coverageStatus === "COVERED").length;
  const exempt = specs.filter((s) => s.coverageStatus === "EXEMPT").length;
  const uncovered = specs.filter((s) => s.coverageStatus === "UNCOVERED").length;
  const classesNotInParty = matrix.rows
    .map((r) => r.classSlug)
    .filter((slug, i, arr) => arr.indexOf(slug) === i && !partySet.has(slug));

  return {
    schemaVersion: "offensive-coverage-matrix-v1",
    gameVersion: CATALOG_GAME_VERSION,
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    generatedAt,
    blizzardMatrix: {
      provenance: matrix.provenance,
      verifiedAt: matrix.verifiedAt,
      playableClasses: matrix.classes,
      playableSpecializations: matrix.specializations,
    },
    scopes: {
      fullRetailSpecializationCoverage: true,
      sameFightObservedValidation: {
        fight: "1WKcCz2BnAQmbhfq:1:r1",
        partyClassSlugs: [...SAME_FIGHT_PARTY_CLASS_SLUGS],
        note: "Same-fight party validates digest matching for five classes only. Global catalog coverage is the Blizzard playable matrix below — not this party.",
      },
      classesSpecsNotInFivePlayerTestParty: matrix.rows
        .filter((r) => !partySet.has(r.classSlug))
        .map((r) => `${r.classSlug}/${r.specSlug}`),
    },
    specs,
    totals: {
      playableClasses: matrix.classes,
      playableSpecializations: matrix.specializations,
      coveredSpecializations: covered,
      exemptSpecializations: exempt,
      uncoveredSpecializations: uncovered,
      reviewedCanonicalAbilities,
      sameFightPartyClasses: SAME_FIGHT_PARTY_CLASS_SLUGS.length,
      classesNotInSameFightParty: classesNotInParty.length,
    },
  };
}

/** Render a human-readable Markdown coverage report. */
export function formatOffensiveCoverageReport(matrix: OffensiveCoverageMatrix): string {
  const lines: string[] = [];
  lines.push("# Offensive catalog Retail coverage report");
  lines.push("");
  lines.push(`Generated: ${matrix.generatedAt}`);
  lines.push(`Game version: ${matrix.gameVersion}`);
  lines.push(`Catalog version: ${matrix.catalogVersion}`);
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|---|---:|`);
  lines.push(`| Playable classes | ${matrix.totals.playableClasses} |`);
  lines.push(`| Playable specializations | ${matrix.totals.playableSpecializations} |`);
  lines.push(`| Covered specializations | ${matrix.totals.coveredSpecializations} |`);
  lines.push(`| Exempt specializations | ${matrix.totals.exemptSpecializations} |`);
  lines.push(`| Uncovered specializations | ${matrix.totals.uncoveredSpecializations} |`);
  lines.push(`| Reviewed canonical abilities | ${matrix.totals.reviewedCanonicalAbilities} |`);
  lines.push("");
  lines.push("## Scope distinction");
  lines.push("");
  lines.push(
    "- **Full Retail specialization coverage** — every Blizzard playable class/spec in the Game Data matrix.",
  );
  lines.push(
    `- **Same-fight observed validation** — ${matrix.scopes.sameFightObservedValidation.fight} party classes: ${matrix.scopes.sameFightObservedValidation.partyClassSlugs.join(", ")}.`,
  );
  lines.push(
    `- **Not in five-player test party** — ${matrix.scopes.classesSpecsNotInFivePlayerTestParty.length} specializations across ${matrix.totals.classesNotInSameFightParty} classes.`,
  );
  lines.push("");
  lines.push(`Blizzard matrix provenance: ${matrix.blizzardMatrix.provenance}`);
  lines.push("");
  lines.push("## Per-specialization coverage");
  lines.push("");
  lines.push(
    "| classSlug | specSlug | blizzardClassId | blizzardSpecId | reviewed | cooldowns | activationSpellIds | exemption | same-fight party | status |",
  );
  lines.push("|---|---|---:|---:|---:|---|---|---|---|---|");
  for (const s of matrix.specs) {
    const cds = s.canonicalCooldownNames.join("; ") || "—";
    const ids = s.activationSpellIds.join(", ") || "—";
    const ex = s.exemptionStatus === "EXEMPT" ? "EXEMPT" : "—";
    lines.push(
      `| ${s.classSlug} | ${s.specSlug} | ${s.blizzardClassId} | ${s.blizzardSpecId} | ${s.reviewedOffensiveEntryCount} | ${cds} | ${ids} | ${ex} | ${s.inSameFightParty ? "yes" : "no"} | ${s.coverageStatus} |`,
    );
  }
  lines.push("");
  const exemptRows = matrix.specs.filter((s) => s.exemptionStatus === "EXEMPT");
  if (exemptRows.length > 0) {
    lines.push("## Exemptions");
    lines.push("");
    for (const s of exemptRows) {
      lines.push(`### ${s.classSlug}/${s.specSlug}`);
      lines.push("");
      lines.push(s.exemptionReason ?? "");
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}
