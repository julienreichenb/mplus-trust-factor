import type { AbilityRule } from "../types.js";
import type {
  AbilityCatalogReleaseArtifact,
  CompiledCatalogChange,
  ReleaseCurationEntry,
  ReleaseTopology,
} from "./types.js";
import { normalizeAbilityRuleForContent, normalizeTopologyForContent } from "./normalize.js";
import { stableStringify } from "./canonicalize.js";

export type ReleaseDiffCode =
  | "ADDED_RULE"
  | "TOMBSTONED_RULE"
  | "METADATA_CHANGED"
  | "APPLICABILITY_CHANGED"
  | "CATEGORY_CHANGED"
  | "DIMENSION_CHANGED"
  | "BINDING_CHANGED"
  | "COOLDOWN_CHANGED"
  | "CHARGES_CHANGED"
  | "TOPOLOGY_CHANGED";

export interface ReleaseDiffEntry {
  code: ReleaseDiffCode;
  canonicalKey?: string;
  before?: unknown;
  after?: unknown;
  compiledOperation?: CompiledCatalogChange["op"];
  source?: ReleaseCurationEntry;
}

export type ReleaseDiffDocument =
  | { kind: "BOOTSTRAP"; entries: [] }
  | { kind: "CURATED"; baseReleaseKey: string; baseContentDigest: string; entries: ReleaseDiffEntry[] };

function ruleMap(rules: readonly AbilityRule[]): Map<string, AbilityRule> {
  return new Map(rules.map((r) => [r.canonicalKey, normalizeAbilityRuleForContent(r)]));
}

function classifyRuleChange(
  before: AbilityRule | undefined,
  after: AbilityRule | undefined,
): ReleaseDiffCode[] {
  if (!before && after) return ["ADDED_RULE"];
  if (before && after) {
    const codes: ReleaseDiffCode[] = [];
    if (
      before.validToBuild !== after.validToBuild ||
      before.provenance.certainty !== after.provenance.certainty ||
      before.supportCertainty !== after.supportCertainty
    ) {
      if (after.provenance.certainty === "deprecated" || after.validToBuild) {
        codes.push("TOMBSTONED_RULE");
      }
    }
    if (
      before.classSlug !== after.classSlug ||
      stableStringify(before.specSlugs) !== stableStringify(after.specSlugs) ||
      stableStringify(before.roles) !== stableStringify(after.roles) ||
      stableStringify(before.raceSlugs ?? []) !== stableStringify(after.raceSlugs ?? [])
    ) {
      codes.push("APPLICABILITY_CHANGED");
    }
    if (before.category !== after.category) codes.push("CATEGORY_CHANGED");
    if (stableStringify(before.dimensionTags ?? []) !== stableStringify(after.dimensionTags ?? [])) {
      codes.push("DIMENSION_CHANGED");
    }
    if (
      stableStringify(before.spellIds) !== stableStringify(after.spellIds) ||
      stableStringify(before.aliases ?? []) !== stableStringify(after.aliases ?? []) ||
      stableStringify(before.activationSpellIds ?? []) !==
        stableStringify(after.activationSpellIds ?? []) ||
      stableStringify(before.activationBuffIds ?? []) !==
        stableStringify(after.activationBuffIds ?? []) ||
      stableStringify(before.triggeredEffectIds ?? []) !==
        stableStringify(after.triggeredEffectIds ?? [])
    ) {
      codes.push("BINDING_CHANGED");
    }
    if (before.cooldownSeconds !== after.cooldownSeconds) codes.push("COOLDOWN_CHANGED");
    if (before.charges !== after.charges) codes.push("CHARGES_CHANGED");
    if (stableStringify(before) !== stableStringify(after) && codes.length === 0) {
      codes.push("METADATA_CHANGED");
    } else if (stableStringify(before) !== stableStringify(after) && !codes.includes("TOMBSTONED_RULE")) {
      // also flag metadata when other codes present but name/etc changed
      const beforeMeta = { ...before };
      const afterMeta = { ...after };
      delete (beforeMeta as { spellIds?: unknown }).spellIds;
      delete (afterMeta as { spellIds?: unknown }).spellIds;
      if (
        !codes.includes("BINDING_CHANGED") &&
        !codes.includes("APPLICABILITY_CHANGED") &&
        !codes.includes("CATEGORY_CHANGED") &&
        !codes.includes("DIMENSION_CHANGED") &&
        !codes.includes("COOLDOWN_CHANGED") &&
        !codes.includes("CHARGES_CHANGED") &&
        stableStringify(before) !== stableStringify(after)
      ) {
        codes.push("METADATA_CHANGED");
      }
    }
    return codes.length > 0 ? codes : [];
  }
  return [];
}

function findSource(
  key: string | undefined,
  op: CompiledCatalogChange["op"] | undefined,
  sources: readonly ReleaseCurationEntry[],
): ReleaseCurationEntry | undefined {
  return sources.find(
    (s) =>
      (op == null || s.operation === op) &&
      (key == null || s.canonicalKey == null || s.canonicalKey === key),
  );
}

/**
 * Diff candidate vs base. Bootstrap uses kind=BOOTSTRAP (not 311 ADDED_RULE noise).
 */
export function diffReleaseArtifacts(input: {
  base: AbilityCatalogReleaseArtifact | null;
  candidate: AbilityCatalogReleaseArtifact;
  curationEntries?: readonly ReleaseCurationEntry[];
  compiledOps?: readonly CompiledCatalogChange[];
}): ReleaseDiffDocument {
  if (!input.base) {
    return { kind: "BOOTSTRAP", entries: [] };
  }

  const sources = input.curationEntries ?? [];
  const beforeRules = ruleMap(input.base.rules);
  const afterRules = ruleMap(input.candidate.rules);
  const entries: ReleaseDiffEntry[] = [];

  const keys = new Set([...beforeRules.keys(), ...afterRules.keys()]);
  for (const key of [...keys].sort()) {
    const before = beforeRules.get(key);
    const after = afterRules.get(key);
    if (before && after && stableStringify(before) === stableStringify(after)) continue;
    const codes = classifyRuleChange(before, after);
    for (const code of codes) {
      const compiledOperation =
        code === "ADDED_RULE"
          ? "ADD_RULE"
          : code === "TOMBSTONED_RULE"
            ? "TOMBSTONE_RULE"
            : input.compiledOps?.find((c) => "canonicalKey" in c && c.canonicalKey === key)?.op ??
              (before && after ? "UPDATE_RULE" : undefined);
      entries.push({
        code,
        canonicalKey: key,
        before: before ?? null,
        after: after ?? null,
        compiledOperation,
        source: findSource(key, compiledOperation, sources),
      });
    }
  }

  const beforeTopo = normalizeTopologyForContent(input.base.topology);
  const afterTopo = normalizeTopologyForContent(input.candidate.topology);
  if (stableStringify(beforeTopo) !== stableStringify(afterTopo)) {
    entries.push({
      code: "TOPOLOGY_CHANGED",
      before: beforeTopo,
      after: afterTopo,
      compiledOperation: "UPDATE_TOPOLOGY",
      source: findSource(undefined, "UPDATE_TOPOLOGY", sources),
    });
  }

  return {
    kind: "CURATED",
    baseReleaseKey: input.base.releaseKey,
    baseContentDigest: input.base.contentDigest,
    entries,
  };
}

export function topologyEqual(a: ReleaseTopology, b: ReleaseTopology): boolean {
  return (
    stableStringify(normalizeTopologyForContent(a)) ===
    stableStringify(normalizeTopologyForContent(b))
  );
}
