import type { AbilityRule } from "../types.js";
import { validateAbilityCatalog } from "../validation.js";
import type {
  AbilityCatalogReleaseArtifact,
  ArtifactValidationIssue,
  ArtifactValidationReport,
} from "./types.js";
import {
  ABILITY_CATALOG_RELEASE_SCHEMA_V1,
  SUPPORTED_ABILITY_CATALOG_RELEASE_SCHEMAS,
} from "./types.js";
import {
  buildReleaseContent,
  buildReleaseKey,
  contentDigestOf,
  topologyDigestOf,
} from "./normalize.js";

function pushError(
  errors: ArtifactValidationIssue[],
  code: string,
  message: string,
  canonicalKey?: string,
): void {
  errors.push({ severity: "error", code, message, canonicalKey });
}

/**
 * Strict release artifact validation (fail closed).
 * Separate from AbilityRule catalog validation; also reuses it for rules.
 */
export function validateAbilityCatalogReleaseArtifact(
  artifact: unknown,
): ArtifactValidationReport {
  const errors: ArtifactValidationIssue[] = [];
  const warnings: ArtifactValidationIssue[] = [];

  if (artifact == null || typeof artifact !== "object" || Array.isArray(artifact)) {
    return {
      valid: false,
      errors: [{ severity: "error", code: "NOT_AN_OBJECT", message: "Artifact must be an object" }],
      warnings,
    };
  }

  const a = artifact as Partial<AbilityCatalogReleaseArtifact>;

  if (
    !a.schemaVersion ||
    !(SUPPORTED_ABILITY_CATALOG_RELEASE_SCHEMAS as readonly string[]).includes(a.schemaVersion)
  ) {
    pushError(
      errors,
      "UNSUPPORTED_SCHEMA",
      `Unsupported schemaVersion: ${String(a.schemaVersion)}`,
    );
  }

  if (typeof a.contentDigest !== "string" || !/^[a-f0-9]{64}$/.test(a.contentDigest)) {
    pushError(errors, "INVALID_CONTENT_DIGEST", "contentDigest must be 64-char lowercase hex SHA-256");
  }
  if (typeof a.topologyDigest !== "string" || !/^[a-f0-9]{64}$/.test(a.topologyDigest)) {
    pushError(errors, "INVALID_TOPOLOGY_DIGEST", "topologyDigest must be 64-char lowercase hex SHA-256");
  }
  if (typeof a.releaseKey !== "string" || a.releaseKey.length === 0) {
    pushError(errors, "MISSING_RELEASE_KEY", "releaseKey is required");
  }
  if (typeof a.gameVersion !== "string" || !a.gameVersion) {
    pushError(errors, "MISSING_GAME_VERSION", "gameVersion is required");
  }
  if (typeof a.wowBuild !== "string" || !a.wowBuild) {
    pushError(errors, "MISSING_WOW_BUILD", "wowBuild is required");
  }
  if (typeof a.seasonSlug !== "string" || !a.seasonSlug) {
    pushError(errors, "MISSING_SEASON_SLUG", "seasonSlug is required");
  }
  if (!Array.isArray(a.rules)) {
    pushError(errors, "MISSING_RULES", "rules must be an array");
  }
  if (!a.topology || typeof a.topology !== "object" || !Array.isArray(a.topology.classes)) {
    pushError(errors, "INCOMPLETE_TOPOLOGY", "topology.classes is required");
  }
  if (!a.topology || typeof a.topology !== "object" || !Array.isArray(a.topology.races)) {
    pushError(errors, "INCOMPLETE_TOPOLOGY", "topology.races is required");
  }
  if (!a.manifest || typeof a.manifest !== "object") {
    pushError(errors, "MISSING_MANIFEST", "manifest is required");
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const typed = a as AbilityCatalogReleaseArtifact;
  const content = buildReleaseContent({
    gameVersion: typed.gameVersion,
    wowBuild: typed.wowBuild,
    seasonSlug: typed.seasonSlug,
    previousReleaseId: typed.previousReleaseId ?? null,
    topology: typed.topology,
    rules: typed.rules,
    manifest: typed.manifest,
  });

  const expectedDigest = contentDigestOf(content);
  if (expectedDigest !== typed.contentDigest) {
    pushError(
      errors,
      "CONTENT_DIGEST_MISMATCH",
      `contentDigest mismatch: expected ${expectedDigest}, got ${typed.contentDigest}`,
    );
  }

  const expectedTopologyDigest = topologyDigestOf(content.topology);
  if (expectedTopologyDigest !== typed.topologyDigest) {
    pushError(
      errors,
      "TOPOLOGY_DIGEST_MISMATCH",
      `topologyDigest mismatch: expected ${expectedTopologyDigest}, got ${typed.topologyDigest}`,
    );
  }

  const expectedKey = buildReleaseKey(typed.wowBuild, expectedDigest);
  if (typed.releaseKey !== expectedKey) {
    pushError(
      errors,
      "RELEASE_KEY_MISMATCH",
      `releaseKey mismatch: expected ${expectedKey}, got ${typed.releaseKey}`,
    );
  }

  if (typed.schemaVersion !== ABILITY_CATALOG_RELEASE_SCHEMA_V1) {
    pushError(errors, "UNSUPPORTED_SCHEMA", `schemaVersion ${typed.schemaVersion}`);
  }

  const classSlugs = new Set(typed.topology.classes.map((c) => c.slug));
  const specKeys = new Set(
    typed.topology.classes.flatMap((c) => c.specs.map((s) => `${c.slug}/${s.slug}`)),
  );
  const raceSlugs = new Set(typed.topology.races.map((r) => r.slug));

  const seenKeys = new Set<string>();
  for (const rule of typed.rules as AbilityRule[]) {
    if (seenKeys.has(rule.canonicalKey)) {
      pushError(errors, "DUPLICATE_CANONICAL_KEY", `Duplicate ${rule.canonicalKey}`, rule.canonicalKey);
    }
    seenKeys.add(rule.canonicalKey);

    for (const id of rule.spellIds ?? []) {
      if (!Number.isInteger(id) || id <= 0) {
        pushError(errors, "INVALID_SPELL_ID", `Invalid spellId ${id}`, rule.canonicalKey);
      }
    }

    if (rule.classSlug != null && !classSlugs.has(rule.classSlug)) {
      pushError(
        errors,
        "UNKNOWN_CLASS_REF",
        `Rule references unknown class ${rule.classSlug}`,
        rule.canonicalKey,
      );
    }
    if (rule.classSlug != null) {
      for (const spec of rule.specSlugs ?? []) {
        if (!specKeys.has(`${rule.classSlug}/${spec}`)) {
          pushError(
            errors,
            "UNKNOWN_SPEC_REF",
            `Rule references unknown spec ${rule.classSlug}/${spec}`,
            rule.canonicalKey,
          );
        }
      }
    }
    for (const race of rule.raceSlugs ?? []) {
      if (!raceSlugs.has(race)) {
        pushError(
          errors,
          "UNKNOWN_RACE_REF",
          `Rule references unknown race ${race}`,
          rule.canonicalKey,
        );
      }
    }
  }

  const catalogValidation = validateAbilityCatalog(typed.rules);
  for (const issue of catalogValidation.errors) {
    pushError(errors, issue.code, issue.message, issue.canonicalKey);
  }
  for (const issue of catalogValidation.warnings) {
    warnings.push({
      severity: "warning",
      code: issue.code,
      message: issue.message,
      canonicalKey: issue.canonicalKey,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Parse JSON text into an unknown value then validate. */
export function parseAndValidateReleaseArtifact(jsonText: string): {
  artifact: AbilityCatalogReleaseArtifact | null;
  validation: ArtifactValidationReport;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch (err) {
    return {
      artifact: null,
      validation: {
        valid: false,
        errors: [
          {
            severity: "error",
            code: "INVALID_JSON",
            message: err instanceof Error ? err.message : "JSON parse failed",
          },
        ],
        warnings: [],
      },
    };
  }
  const validation = validateAbilityCatalogReleaseArtifact(parsed);
  return {
    artifact: validation.valid ? (parsed as AbilityCatalogReleaseArtifact) : null,
    validation,
  };
}
