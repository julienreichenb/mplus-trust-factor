import type {
  AbilityAvailability,
  AbilityCategory,
  AbilityExternalMetadata,
  AbilityRole,
  AbilityRule,
  CatalogCoverageReport,
  CatalogSupportState,
  CatalogValidationReport,
  SourceOwnership,
  ValidationIssue,
} from "./types.js";
import { buildCoverageReport } from "./coverage.js";
import { enrichRuleExternalMetadata } from "./external-metadata.js";
import { getRetailClassMatrix, RETAIL_ABILITY_CATALOG } from "./registry.js";
import { validateAbilityCatalog } from "./validation.js";

export type AdminSectionKind = "class" | "shared-consumable" | "shared-racial" | "shared-other";

export interface AdminAbilityEntry {
  rule: AbilityRule;
  section: AdminSectionKind;
  className: string | null;
  external: AbilityExternalMetadata;
  validationIssues: ValidationIssue[];
  badges: string[];
}

export interface AdminAbilityCatalogQuery {
  query?: string;
  classSlug?: string;
  specSlug?: string;
  role?: AbilityRole;
  category?: AbilityCategory;
  ownership?: SourceOwnership;
  availability?: AbilityAvailability;
  version?: string;
  validationState?: "error" | "warning" | "clean" | "uncertain" | "talent" | "pet" | "missing-metadata" | "deprecated";
  page?: number;
  limit?: number;
}

export interface AdminAbilityCatalogResponse {
  catalogSummary: {
    catalogVersion: string;
    gameVersion: string;
    seasonSlug?: string;
    generatedAt: string;
    lastVerified: string;
    classesCovered: number;
    specializationsCovered: number;
    canonicalRules: number;
    spellIds: number;
    aliases: number;
  };
  coverageSummary: CatalogCoverageReport;
  validationSummary: {
    valid: boolean;
    errorCount: number;
    warningCount: number;
    issues: ValidationIssue[];
  };
  classes: Array<{
    classSlug: string;
    className: string;
    supportState: CatalogSupportState;
    specCount: number;
    supportedSpecCount: number;
    ruleCount: number;
  }>;
  entries: AdminAbilityEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function sectionFor(rule: AbilityRule): AdminSectionKind {
  if (rule.classSlug == null) {
    if (rule.canonicalKey.startsWith("shared.consumable.")) return "shared-consumable";
    if (rule.canonicalKey.startsWith("shared.racial.")) return "shared-racial";
    return "shared-other";
  }
  return "class";
}

function badgesFor(rule: AbilityRule, issues: ValidationIssue[]): string[] {
  const badges: string[] = [];
  if (rule.supportCertainty === "verified" || rule.provenance.certainty === "verified") badges.push("verified");
  if (rule.supportCertainty === "uncertain" || rule.provenance.certainty === "uncertain") badges.push("uncertain");
  if (rule.supportCertainty === "deprecated" || rule.provenance.certainty === "deprecated") badges.push("deprecated");
  if (rule.availability === "TALENT" || rule.availability === "CHOICE_NODE") badges.push("talent-dependent");
  if (rule.availability === "PET_DEPENDENT" || rule.sourceOwnership === "PET") badges.push("pet-dependent");
  if ((rule.aliases?.length ?? 0) > 0) badges.push("alias");
  if (rule.classSlug == null || rule.availability === "SHARED") badges.push("shared");
  if (issues.some((i) => i.severity === "error")) badges.push("validation-error");
  return badges;
}

function matchesQuery(entry: AdminAbilityEntry, q: string): boolean {
  const hay = [
    entry.rule.name,
    entry.rule.canonicalKey,
    entry.rule.classSlug ?? "",
    entry.rule.specSlugs.join(" "),
    entry.rule.category,
    entry.rule.sourceOwnership,
    entry.rule.provenance.notes ?? "",
    ...entry.rule.spellIds.map(String),
    ...(entry.rule.aliases ?? []).map(String),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

/** Builds the admin explorer payload from the canonical registry + validator. */
export function queryAdminAbilityCatalog(
  input: AdminAbilityCatalogQuery = {},
): AdminAbilityCatalogResponse {
  const validation = validateAbilityCatalog();
  const coverage = buildCoverageReport();
  const issuesByKey = new Map<string, ValidationIssue[]>();
  for (const issue of [...validation.errors, ...validation.warnings]) {
    if (!issue.canonicalKey) continue;
    const list = issuesByKey.get(issue.canonicalKey) ?? [];
    list.push(issue);
    issuesByKey.set(issue.canonicalKey, list);
  }

  const matrix = getRetailClassMatrix();
  const classNameBySlug = new Map(matrix.map((c) => [c.slug, c.name]));

  let entries: AdminAbilityEntry[] = RETAIL_ABILITY_CATALOG.rules.map((rule) => {
    const issues = issuesByKey.get(rule.canonicalKey) ?? [];
    const external = enrichRuleExternalMetadata(rule);
    return {
      rule,
      section: sectionFor(rule),
      className: rule.classSlug ? (classNameBySlug.get(rule.classSlug) ?? rule.classSlug) : null,
      external,
      validationIssues: issues,
      badges: badgesFor(rule, issues),
    };
  });

  if (input.query?.trim()) {
    entries = entries.filter((e) => matchesQuery(e, input.query!.trim()));
  }
  if (input.classSlug) {
    entries = entries.filter((e) => e.rule.classSlug === input.classSlug);
  }
  if (input.specSlug) {
    entries = entries.filter(
      (e) =>
        e.rule.specSlugs.includes(input.specSlug!) ||
        (e.rule.classSlug != null && e.rule.specSlugs.length === 0),
    );
  }
  if (input.role) {
    entries = entries.filter((e) => e.rule.roles.includes(input.role!));
  }
  if (input.category) {
    entries = entries.filter((e) => e.rule.category === input.category);
  }
  if (input.ownership) {
    entries = entries.filter((e) => e.rule.sourceOwnership === input.ownership);
  }
  if (input.availability) {
    entries = entries.filter((e) => e.rule.availability === input.availability);
  }
  if (input.version) {
    entries = entries.filter(
      (e) =>
        e.rule.provenance.gameVersion === input.version ||
        RETAIL_ABILITY_CATALOG.catalogVersion === input.version,
    );
  }
  if (input.validationState === "error") {
    entries = entries.filter((e) => e.validationIssues.some((i) => i.severity === "error"));
  } else if (input.validationState === "warning") {
    entries = entries.filter((e) => e.validationIssues.some((i) => i.severity === "warning"));
  } else if (input.validationState === "clean") {
    entries = entries.filter((e) => e.validationIssues.length === 0);
  } else if (input.validationState === "uncertain") {
    entries = entries.filter((e) => e.badges.includes("uncertain"));
  } else if (input.validationState === "talent") {
    entries = entries.filter((e) => e.badges.includes("talent-dependent"));
  } else if (input.validationState === "pet") {
    entries = entries.filter((e) => e.badges.includes("pet-dependent"));
  } else if (input.validationState === "missing-metadata") {
    entries = entries.filter((e) => !e.external.wowheadUrl || !e.external.tooltipAvailable);
  } else if (input.validationState === "deprecated") {
    entries = entries.filter((e) => e.badges.includes("deprecated"));
  }

  const page = Math.max(1, input.page ?? 1);
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const total = entries.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const pageEntries = entries.slice(start, start + limit);

  return {
    catalogSummary: {
      catalogVersion: RETAIL_ABILITY_CATALOG.catalogVersion,
      gameVersion: coverage.version.gameVersion,
      seasonSlug: coverage.version.seasonSlug,
      generatedAt: coverage.version.generatedAt,
      lastVerified: coverage.version.generatedAt,
      classesCovered: coverage.totals.classes,
      specializationsCovered: coverage.totals.specs,
      canonicalRules: coverage.totals.canonicalRules,
      spellIds: coverage.totals.spellIds,
      aliases: coverage.totals.aliases,
    },
    coverageSummary: coverage,
    validationSummary: {
      valid: validation.valid,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
      issues: [...validation.errors, ...validation.warnings],
    },
    classes: coverage.classes,
    entries: pageEntries,
    pagination: { page, limit, total, totalPages },
  };
}

export type { CatalogValidationReport };
