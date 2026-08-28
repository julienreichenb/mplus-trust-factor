/**
 * Release-artifact backed AbilityCatalogContext (shadow / replay only).
 */

import type { AbilityRule } from "../types.js";
import type { AbilityCatalogContext, AbilityCatalogTopologyView } from "../catalog-context.js";
import { createRulesAbilityCatalogContext } from "../catalog-context.js";
import type { AbilityCatalogReleaseArtifact } from "./types.js";

export function topologyViewFromReleaseArtifact(
  artifact: AbilityCatalogReleaseArtifact,
): AbilityCatalogTopologyView {
  return {
    classes: artifact.topology.classes.map((c) => ({
      slug: c.slug,
      supportState: c.supportState,
      specs: c.specs.map((s) => ({
        slug: s.slug,
        role: s.role,
        supportState: s.supportState,
      })),
    })),
    races: artifact.topology.races.map((r) => ({ slug: r.slug })),
  };
}

/** Active scoring pool — tombstoned/deprecated rules are excluded from resolution. */
export function activeRulesFromReleaseArtifact(
  rules: readonly AbilityRule[],
): AbilityRule[] {
  return rules.filter(
    (r) =>
      r.provenance?.certainty !== "deprecated" &&
      r.supportCertainty !== "deprecated" &&
      !r.validToBuild,
  );
}

export function createReleaseAbilityCatalogContext(input: {
  artifact: AbilityCatalogReleaseArtifact;
  releaseId?: string;
}): AbilityCatalogContext {
  return createRulesAbilityCatalogContext({
    identity: {
      kind: "release",
      releaseKey: input.artifact.releaseKey,
      contentDigest: input.artifact.contentDigest,
      releaseId: input.releaseId,
    },
    rules: activeRulesFromReleaseArtifact(input.artifact.rules),
    topology: topologyViewFromReleaseArtifact(input.artifact),
  });
}
