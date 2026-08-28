import { getAbilityCatalog, resolveAbilityRuleBySpellId, RETAIL_ABILITY_CATALOG } from "../registry.js";
import { validateAbilityCatalog } from "../validation.js";
import { RETAIL_CLASS_MATRIX } from "../catalog/classes-matrix.js";
import type { AbilityRule } from "../types.js";
import { compileAbilityCatalogRelease } from "./compile.js";
import { normalizeAbilityRuleForContent, normalizeRulesForContent } from "./normalize.js";
import { stableStringify } from "./canonicalize.js";
import {
  allResolvableSpellIdsFromRules,
  getAbilityCatalogFromArtifact,
  resolveAbilityRuleBySpellIdFromArtifact,
} from "./shadow-catalog.js";
import { validateAbilityCatalogReleaseArtifact } from "./validate-artifact.js";
import type { AbilityCatalogReleaseArtifact } from "./types.js";
import { topologyCounts } from "./topology.js";

export type ParityVerdict = "PASS" | "FAIL";

export interface AbilityCatalogParityReport {
  artifact: {
    schemaVersion: string;
    releaseKey: string;
    contentDigest: string;
    topologyDigest: string;
    ruleCount: number;
    topology: ReturnType<typeof topologyCounts>;
    wowBuild: string;
    gameVersion: string;
    seasonSlug: string;
    byteSize?: number;
  };
  fieldParity: {
    equal: boolean;
    ruleCountStatic: number;
    ruleCountArtifact: number;
    canonicalKeySetEqual: boolean;
    mismatches: string[];
  };
  resolverParity: {
    spellIdsChecked: number;
    exactMatches: number;
    mismatches: string[];
  };
  scopeParity: {
    classSpecScopesChecked: number;
    mismatches: string[];
  };
  racialParity: {
    scopesChecked: number;
    mismatches: string[];
  };
  validationParity: {
    equal: boolean;
    mismatches: string[];
  };
  roundTripParity: {
    equal: boolean;
    mismatches: string[];
  };
  overall: ParityVerdict;
}

function resolutionSignature(
  result: ReturnType<typeof resolveAbilityRuleBySpellId>,
): string {
  if (result.status === "matched") {
    return `matched:${result.rule.canonicalKey}`;
  }
  if (result.status === "ambiguous") {
    return `ambiguous:${result.rules.map((r) => r.canonicalKey).sort().join(",")}`;
  }
  return "unmatched";
}

function validationSignature(report: ReturnType<typeof validateAbilityCatalog>): string[] {
  const rows = [
    ...report.errors.map((i) => normalizeValidationIssue("E", i)),
    ...report.warnings.map((i) => normalizeValidationIssue("W", i)),
  ];
  return rows.sort();
}

/** Walk-order-independent validation compare (duplicate-spell warnings cite either owner). */
function normalizeValidationIssue(
  prefix: "E" | "W",
  issue: { code: string; message: string; canonicalKey?: string },
): string {
  let message = issue.message;
  let key = issue.canonicalKey ?? "";
  const dup = /^Spell (\d+) appears on both (.+) and (.+)$/.exec(message);
  if (issue.code === "DUPLICATE_SPELL_SAME_SEMANTICS" && dup) {
    const spell = dup[1]!;
    const [a, b] = [dup[2]!, dup[3]!].sort();
    message = `Spell ${spell} appears on both ${a} and ${b}`;
    key = "";
  }
  return `${prefix}:${issue.code}:${key}:${message}`;
}

/** Key-set signature — registration order is not a runtime contract. */
function catalogSliceKeySet(rules: readonly AbilityRule[]): string {
  return [...rules.map((r) => r.canonicalKey)].sort().join("\n");
}

/**
 * Strict semantic parity: static RETAIL_ABILITY_CATALOG vs Bootstrap artifact.
 */
export function compareStaticCatalogToReleaseArtifact(
  artifact: AbilityCatalogReleaseArtifact,
  options?: { serializedByteSize?: number },
): AbilityCatalogParityReport {
  const staticRules = RETAIL_ABILITY_CATALOG.rules;
  const artifactRules = artifact.rules;

  const fieldMismatches: string[] = [];
  const staticNorm = normalizeRulesForContent(staticRules);
  const artifactNorm = normalizeRulesForContent(artifactRules);

  if (staticNorm.length !== artifactNorm.length) {
    fieldMismatches.push(
      `ruleCount static=${staticNorm.length} artifact=${artifactNorm.length}`,
    );
  }

  const staticKeys = staticNorm.map((r) => r.canonicalKey);
  const artifactKeys = artifactNorm.map((r) => r.canonicalKey);
  const keySetEqual =
    staticKeys.length === artifactKeys.length &&
    staticKeys.every((k, i) => k === artifactKeys[i]);

  if (!keySetEqual) {
    const s = new Set(staticKeys);
    const a = new Set(artifactKeys);
    for (const k of s) {
      if (!a.has(k)) fieldMismatches.push(`missingInArtifact:${k}`);
    }
    for (const k of a) {
      if (!s.has(k)) fieldMismatches.push(`extraInArtifact:${k}`);
    }
  }

  const byArtifact = new Map(artifactNorm.map((r) => [r.canonicalKey, r]));
  for (const rule of staticNorm) {
    const other = byArtifact.get(rule.canonicalKey);
    if (!other) continue;
    const left = stableStringify(normalizeAbilityRuleForContent(rule));
    const right = stableStringify(normalizeAbilityRuleForContent(other));
    if (left !== right) {
      fieldMismatches.push(`fieldMismatch:${rule.canonicalKey}`);
    }
  }

  const resolverMismatches: string[] = [];
  const spellIds = allResolvableSpellIdsFromRules(staticRules);
  // Also probe an unknown id
  const probeIds = [...spellIds, 9_999_999_001];
  let exactMatches = 0;
  for (const spellId of probeIds) {
    const staticRes = resolveAbilityRuleBySpellId({ spellId });
    const artifactRes = resolveAbilityRuleBySpellIdFromArtifact(artifact, { spellId });
    const left = resolutionSignature(staticRes);
    const right = resolutionSignature(artifactRes);
    if (left === right) {
      exactMatches += 1;
    } else {
      resolverMismatches.push(`spellId=${spellId} static=${left} artifact=${right}`);
    }

    // Class/spec filtered probes for matched rules
    if (staticRes.status === "matched" && staticRes.rule.classSlug) {
      const classSlug = staticRes.rule.classSlug;
      const specSlug = staticRes.rule.specSlugs[0];
      const filteredStatic = resolveAbilityRuleBySpellId({ spellId, classSlug, specSlug });
      const filteredArtifact = resolveAbilityRuleBySpellIdFromArtifact(artifact, {
        spellId,
        classSlug,
        specSlug,
      });
      const fl = resolutionSignature(filteredStatic);
      const fr = resolutionSignature(filteredArtifact);
      if (fl !== fr) {
        resolverMismatches.push(
          `filtered spellId=${spellId} ${classSlug}/${specSlug ?? "*"} static=${fl} artifact=${fr}`,
        );
      }
    }
  }

  const scopeMismatches: string[] = [];
  let classSpecScopesChecked = 0;
  for (const cls of RETAIL_CLASS_MATRIX) {
    for (const spec of cls.specs) {
      classSpecScopesChecked += 1;
      const lookup = {
        classSlug: cls.slug,
        specSlug: spec.slug,
        role: spec.role,
        includeShared: true,
        includeRacials: false,
      };
      const staticCat = getAbilityCatalog(lookup);
      const artifactCat = getAbilityCatalogFromArtifact(artifact, lookup);
      if (staticCat.supported !== artifactCat.supported) {
        scopeMismatches.push(
          `${cls.slug}/${spec.slug} supported static=${staticCat.supported} artifact=${artifactCat.supported}`,
        );
        continue;
      }
      if (staticCat.supportState !== artifactCat.supportState) {
        scopeMismatches.push(
          `${cls.slug}/${spec.slug} supportState static=${staticCat.supportState} artifact=${artifactCat.supportState}`,
        );
      }
      const leftKeys = catalogSliceKeySet(staticCat.rules);
      const rightKeys = catalogSliceKeySet(artifactCat.rules);
      if (leftKeys !== rightKeys || staticCat.rules.length !== artifactCat.rules.length) {
        scopeMismatches.push(
          `${cls.slug}/${spec.slug} keySet/count static=${staticCat.rules.length} artifact=${artifactCat.rules.length}`,
        );
      }
    }
  }

  const racialMismatches: string[] = [];
  let racialScopesChecked = 0;
  for (const cls of RETAIL_CLASS_MATRIX) {
    for (const spec of cls.specs) {
      if (spec.supportState === "UNSUPPORTED") continue;
      racialScopesChecked += 1;
      const lookup = {
        classSlug: cls.slug,
        specSlug: spec.slug,
        role: spec.role,
        includeShared: true,
        includeRacials: true,
      };
      const staticCat = getAbilityCatalog(lookup);
      const artifactCat = getAbilityCatalogFromArtifact(artifact, lookup);
      const leftRacial = staticCat.rules
        .filter((r) => r.canonicalKey.startsWith("shared.racial."))
        .map((r) => r.canonicalKey)
        .sort()
        .join(",");
      const rightRacial = artifactCat.rules
        .filter((r) => r.canonicalKey.startsWith("shared.racial."))
        .map((r) => r.canonicalKey)
        .sort()
        .join(",");
      if (leftRacial !== rightRacial) {
        racialMismatches.push(`${cls.slug}/${spec.slug} racial keys differ`);
      }
    }
  }

  const validationMismatches: string[] = [];
  const staticValidation = validateAbilityCatalog(staticRules);
  const artifactValidation = validateAbilityCatalog(artifactRules);
  const leftVal = validationSignature(staticValidation);
  const rightVal = validationSignature(artifactValidation);
  if (leftVal.join("\n") !== rightVal.join("\n")) {
    validationMismatches.push("validation report signatures differ");
    const leftSet = new Set(leftVal);
    const rightSet = new Set(rightVal);
    for (const row of leftSet) {
      if (!rightSet.has(row)) validationMismatches.push(`onlyStatic:${row}`);
    }
    for (const row of rightSet) {
      if (!leftSet.has(row)) validationMismatches.push(`onlyArtifact:${row}`);
    }
  }

  const roundTripMismatches: string[] = [];
  const artifactValidationReport = validateAbilityCatalogReleaseArtifact(artifact);
  if (!artifactValidationReport.valid) {
    roundTripMismatches.push(
      ...artifactValidationReport.errors.map((e) => `artifactInvalid:${e.code}:${e.message}`),
    );
  }

  const roundTrip = compileAbilityCatalogRelease({
    baseRules: artifact.rules,
    baseTopology: artifact.topology,
    changes: [],
    gameVersion: artifact.gameVersion,
    wowBuild: artifact.wowBuild,
    seasonSlug: artifact.seasonSlug,
    previousReleaseId: artifact.previousReleaseId,
    manifest: artifact.manifest,
    generatedAt: "2099-01-01T00:00:00.000Z",
  });
  if (roundTrip.contentDigest !== artifact.contentDigest) {
    roundTripMismatches.push(
      `contentDigest roundTrip=${roundTrip.contentDigest} original=${artifact.contentDigest}`,
    );
  }
  if (roundTrip.releaseKey !== artifact.releaseKey) {
    roundTripMismatches.push(
      `releaseKey roundTrip=${roundTrip.releaseKey} original=${artifact.releaseKey}`,
    );
  }

  const fieldEqual = fieldMismatches.length === 0 && keySetEqual;
  const overall: ParityVerdict =
    fieldEqual &&
    resolverMismatches.length === 0 &&
    scopeMismatches.length === 0 &&
    racialMismatches.length === 0 &&
    validationMismatches.length === 0 &&
    roundTripMismatches.length === 0
      ? "PASS"
      : "FAIL";

  return {
    artifact: {
      schemaVersion: artifact.schemaVersion,
      releaseKey: artifact.releaseKey,
      contentDigest: artifact.contentDigest,
      topologyDigest: artifact.topologyDigest,
      ruleCount: artifact.rules.length,
      topology: topologyCounts(artifact.topology),
      wowBuild: artifact.wowBuild,
      gameVersion: artifact.gameVersion,
      seasonSlug: artifact.seasonSlug,
      ...(options?.serializedByteSize !== undefined
        ? { byteSize: options.serializedByteSize }
        : {}),
    },
    fieldParity: {
      equal: fieldEqual,
      ruleCountStatic: staticRules.length,
      ruleCountArtifact: artifactRules.length,
      canonicalKeySetEqual: keySetEqual,
      mismatches: fieldMismatches,
    },
    resolverParity: {
      spellIdsChecked: probeIds.length,
      exactMatches,
      mismatches: resolverMismatches,
    },
    scopeParity: {
      classSpecScopesChecked,
      mismatches: scopeMismatches,
    },
    racialParity: {
      scopesChecked: racialScopesChecked,
      mismatches: racialMismatches,
    },
    validationParity: {
      equal: validationMismatches.length === 0,
      mismatches: validationMismatches,
    },
    roundTripParity: {
      equal: roundTripMismatches.length === 0,
      mismatches: roundTripMismatches,
    },
    overall,
  };
}

export function formatParityReportHuman(report: AbilityCatalogParityReport): string {
  const lines = [
    `Bootstrap parity: ${report.overall}`,
    `releaseKey=${report.artifact.releaseKey}`,
    `contentDigest=${report.artifact.contentDigest}`,
    `schemaVersion=${report.artifact.schemaVersion}`,
    `ruleCount=${report.artifact.ruleCount}`,
    `topology classes=${report.artifact.topology.classCount} specs=${report.artifact.topology.specCount} races=${report.artifact.topology.raceCount}`,
    `fieldParity equal=${report.fieldParity.equal} mismatches=${report.fieldParity.mismatches.length}`,
    `resolverParity checked=${report.resolverParity.spellIdsChecked} exact=${report.resolverParity.exactMatches} mismatches=${report.resolverParity.mismatches.length}`,
    `scopeParity checked=${report.scopeParity.classSpecScopesChecked} mismatches=${report.scopeParity.mismatches.length}`,
    `racialParity checked=${report.racialParity.scopesChecked} mismatches=${report.racialParity.mismatches.length}`,
    `validationParity equal=${report.validationParity.equal}`,
    `roundTripParity equal=${report.roundTripParity.equal}`,
  ];
  const samples = [
    ...report.fieldParity.mismatches.slice(0, 10),
    ...report.resolverParity.mismatches.slice(0, 10),
    ...report.scopeParity.mismatches.slice(0, 10),
    ...report.racialParity.mismatches.slice(0, 10),
    ...report.validationParity.mismatches.slice(0, 10),
    ...report.roundTripParity.mismatches.slice(0, 10),
  ];
  if (samples.length > 0) {
    lines.push("sampleMismatches:");
    for (const s of samples) lines.push(`  - ${s}`);
  }
  return lines.join("\n");
}
