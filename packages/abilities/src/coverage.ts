import type {
  AbilityCategory,
  CatalogCoverageReport,
  SpecCoverageRow,
} from "./types.js";
import { RETAIL_CLASS_MATRIX } from "./catalog/classes-matrix.js";
import { getAbilityCatalog, getAllRegisteredRules, RETAIL_ABILITY_CATALOG } from "./registry.js";
import { CURRENT_CATALOG_VERSION } from "./version.js";

const EXPECTED_BY_ROLE: Record<string, AbilityCategory[]> = {
  DPS: ["INTERRUPT", "HARD_CC", "SOFT_CC", "DEFENSIVE_MAJOR", "DEFENSIVE_MINOR", "SELF_HEAL"],
  TANK: ["INTERRUPT", "HARD_CC", "DEFENSIVE_MAJOR", "DEFENSIVE_MINOR", "SELF_HEAL"],
  HEALER: ["DISPEL", "EXTERNAL_DEFENSIVE", "DEFENSIVE_MAJOR", "DEFENSIVE_MINOR", "GROUP_UTILITY"],
};

export function buildCoverageReport(): CatalogCoverageReport {
  const allRules = getAllRegisteredRules();
  const spellIdSet = new Set<number>();
  let aliasCount = 0;
  let talentDependent = 0;
  let petDependent = 0;
  let uncertain = 0;

  for (const rule of allRules) {
    for (const id of rule.spellIds) spellIdSet.add(id);
    if (rule.aliases) {
      aliasCount += rule.aliases.length;
      for (const id of rule.aliases) spellIdSet.add(id);
    }
    if (rule.availability === "TALENT" || rule.availability === "CHOICE_NODE") talentDependent += 1;
    if (rule.availability === "PET_DEPENDENT" || rule.sourceOwnership === "PET") petDependent += 1;
    if (rule.supportCertainty === "uncertain" || rule.provenance.certainty === "uncertain") {
      uncertain += 1;
    }
  }

  const specs: SpecCoverageRow[] = [];
  const classRows: CatalogCoverageReport["classes"] = [];

  for (const cls of RETAIL_CLASS_MATRIX) {
    let classRuleCount = 0;
    let supportedSpecCount = 0;

    for (const spec of cls.specs) {
      if (spec.supportState === "SUPPORTED" || spec.supportState === "PARTIAL") {
        supportedSpecCount += 1;
      }
      const resolved = getAbilityCatalog({
        classSlug: cls.slug,
        specSlug: spec.slug,
        role: spec.role,
        includeShared: true,
        includeRacials: false,
      });
      const rules = resolved.ok ? resolved.catalog.rules.filter((r) => r.classSlug === cls.slug) : [];
      classRuleCount += rules.length;
      const categories = [...new Set(rules.map((r) => r.category))];
      const expected = EXPECTED_BY_ROLE[spec.role] ?? [];
      const missingCategories = expected.filter((c) => !categories.includes(c));

      specs.push({
        classSlug: cls.slug,
        className: cls.name,
        specSlug: spec.slug,
        specName: spec.name,
        role: spec.role,
        supportState: spec.supportState,
        categories,
        ruleCount: rules.length,
        talentDependentCount: rules.filter(
          (r) => r.availability === "TALENT" || r.availability === "CHOICE_NODE",
        ).length,
        petDependentCount: rules.filter(
          (r) => r.availability === "PET_DEPENDENT" || r.sourceOwnership === "PET",
        ).length,
        uncertainCount: rules.filter(
          (r) => r.supportCertainty === "uncertain" || r.provenance.certainty === "uncertain",
        ).length,
        missingCategories,
      });
    }

    classRows.push({
      classSlug: cls.slug,
      className: cls.name,
      supportState: cls.supportState,
      specCount: cls.specs.length,
      supportedSpecCount,
      ruleCount: classRuleCount,
    });
  }

  return {
    version: CURRENT_CATALOG_VERSION,
    classes: classRows,
    specs,
    totals: {
      classes: RETAIL_CLASS_MATRIX.length,
      specs: specs.length,
      canonicalRules: allRules.length,
      spellIds: spellIdSet.size,
      aliases: aliasCount,
      talentDependent,
      petDependent,
      uncertain,
    },
    generatedAt: new Date().toISOString(),
  };
}

export function formatCoverageReport(report: CatalogCoverageReport = buildCoverageReport()): string {
  const lines: string[] = [];
  lines.push(`Ability catalog coverage — ${report.version.gameVersion} / ${report.version.seasonSlug}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push(
    `Totals: ${report.totals.classes} classes, ${report.totals.specs} specs, ${report.totals.canonicalRules} rules, ${report.totals.spellIds} spell IDs, ${report.totals.aliases} aliases`,
  );
  lines.push(
    `Talent-dependent: ${report.totals.talentDependent}, pet-dependent: ${report.totals.petDependent}, uncertain: ${report.totals.uncertain}`,
  );
  lines.push("");
  for (const cls of report.classes) {
    lines.push(
      `${cls.className} (${cls.classSlug}) [${cls.supportState}] — ${cls.supportedSpecCount}/${cls.specCount} specs, ${cls.ruleCount} class rules`,
    );
    for (const spec of report.specs.filter((s) => s.classSlug === cls.classSlug)) {
      lines.push(
        `  - ${spec.specName} / ${spec.role} [${spec.supportState}] rules=${spec.ruleCount} cats=${spec.categories.join(",") || "—"} talent=${spec.talentDependentCount} pet=${spec.petDependentCount} uncertain=${spec.uncertainCount}`,
      );
      if (spec.missingCategories.length > 0) {
        lines.push(`    missing(expected): ${spec.missingCategories.join(", ")}`);
      }
    }
  }
  lines.push("");
  lines.push(`Registry catalogVersion: ${RETAIL_ABILITY_CATALOG.catalogVersion}`);
  return lines.join("\n");
}
