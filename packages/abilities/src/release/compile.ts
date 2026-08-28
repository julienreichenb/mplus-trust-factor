import type { AbilityRule } from "../types.js";
import type {
  AbilityCatalogReleaseArtifact,
  CompiledCatalogChange,
  CompileAbilityCatalogReleaseInput,
  ReleaseTopology,
} from "./types.js";
import { ABILITY_CATALOG_RELEASE_SCHEMA_V1 } from "./types.js";
import {
  buildReleaseContent,
  buildReleaseKey,
  contentDigestOf,
  normalizeRulesForContent,
  normalizeTopologyForContent,
  topologyDigestOf,
} from "./normalize.js";

function cloneRules(rules: readonly AbilityRule[]): AbilityRule[] {
  return rules.map((r) => structuredClone(r));
}

function applyTombstone(rule: AbilityRule, validToBuild: string): AbilityRule {
  return {
    ...rule,
    validToBuild,
    provenance: {
      ...rule.provenance,
      certainty: "deprecated",
    },
    supportCertainty: rule.supportCertainty ?? "deprecated",
  };
}

/**
 * Apply explicit curated changes. Every mutation must be listed — no implicit
 * rebuild from review queues.
 */
export function applyCompiledCatalogChanges(
  baseRules: readonly AbilityRule[],
  baseTopology: ReleaseTopology,
  changes: readonly CompiledCatalogChange[],
): { rules: AbilityRule[]; topology: ReleaseTopology } {
  const byKey = new Map<string, AbilityRule>();
  for (const rule of cloneRules(baseRules)) {
    if (byKey.has(rule.canonicalKey)) {
      throw new Error(`Duplicate canonicalKey in base catalog: ${rule.canonicalKey}`);
    }
    byKey.set(rule.canonicalKey, rule);
  }
  let topology = structuredClone(baseTopology);

  for (const change of changes) {
    switch (change.op) {
      case "ADD_RULE": {
        if (byKey.has(change.rule.canonicalKey)) {
          throw new Error(`ADD_RULE collides with existing key: ${change.rule.canonicalKey}`);
        }
        byKey.set(change.rule.canonicalKey, structuredClone(change.rule));
        break;
      }
      case "UPDATE_RULE": {
        if (!byKey.has(change.canonicalKey)) {
          throw new Error(`UPDATE_RULE missing key: ${change.canonicalKey}`);
        }
        if (change.rule.canonicalKey !== change.canonicalKey) {
          throw new Error(
            `UPDATE_RULE canonicalKey mismatch: ${change.canonicalKey} vs ${change.rule.canonicalKey}`,
          );
        }
        byKey.set(change.canonicalKey, structuredClone(change.rule));
        break;
      }
      case "TOMBSTONE_RULE": {
        const existing = byKey.get(change.canonicalKey);
        if (!existing) {
          throw new Error(`TOMBSTONE_RULE missing key: ${change.canonicalKey}`);
        }
        byKey.set(change.canonicalKey, applyTombstone(existing, change.validToBuild));
        break;
      }
      case "UPDATE_TOPOLOGY": {
        topology = structuredClone(change.topology);
        break;
      }
      default: {
        const _exhaustive: never = change;
        throw new Error(`Unsupported change op: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  return {
    rules: [...byKey.values()],
    topology,
  };
}

/**
 * Pure release compiler. Inputs are curated/runtime domain state only —
 * never SimC / Blizzard / WCL / Wowhead network extracts.
 */
export function compileAbilityCatalogRelease(
  input: CompileAbilityCatalogReleaseInput,
): AbilityCatalogReleaseArtifact {
  const changes = input.changes ?? [];
  const { rules, topology } = applyCompiledCatalogChanges(
    input.baseRules,
    input.baseTopology,
    changes,
  );

  const content = buildReleaseContent({
    gameVersion: input.gameVersion,
    wowBuild: input.wowBuild,
    seasonSlug: input.seasonSlug,
    previousReleaseId: input.previousReleaseId ?? null,
    topology,
    rules,
    manifest: input.manifest,
  });

  const contentDigest = contentDigestOf(content);
  const topologyDigest = topologyDigestOf(content.topology);
  const releaseKey = buildReleaseKey(input.wowBuild, contentDigest);
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  return {
    schemaVersion: ABILITY_CATALOG_RELEASE_SCHEMA_V1,
    releaseKey,
    contentDigest,
    topologyDigest,
    gameVersion: content.gameVersion,
    wowBuild: content.wowBuild,
    seasonSlug: content.seasonSlug,
    previousReleaseId: content.previousReleaseId,
    generatedAt,
    topology: content.topology,
    rules: content.rules,
    manifest: content.manifest,
  };
}

/** Deserialize rules from a validated artifact (AbilityRule contract preserved). */
export function rulesFromReleaseArtifact(
  artifact: AbilityCatalogReleaseArtifact,
): AbilityRule[] {
  return normalizeRulesForContent(artifact.rules);
}

export function topologyFromReleaseArtifact(
  artifact: AbilityCatalogReleaseArtifact,
): ReleaseTopology {
  return normalizeTopologyForContent(artifact.topology);
}
