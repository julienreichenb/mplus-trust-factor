import type { AbilityRule } from "../types.js";
import type { AbilityCatalogReleaseContent, ReleaseTopology } from "./types.js";
import { ABILITY_CATALOG_RELEASE_SCHEMA_V1 } from "./types.js";
import { stableSha256 } from "./canonicalize.js";

const SCHEMA_MAJOR = 1;

/** Locale-independent ascending string compare. */
export function compareAscii(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortNumbers(values: readonly number[] | undefined): number[] | undefined {
  if (values == null) return undefined;
  return [...values].sort((x, y) => x - y);
}

function sortStrings(values: readonly string[] | undefined): string[] | undefined {
  if (values == null) return undefined;
  return [...values].sort(compareAscii);
}

/**
 * Normalize one AbilityRule for digest / semantic compare.
 * Preserves spellIds order (primary = [0]). Sorts set-like arrays only.
 * Omits undefined optional fields (stable null vs absent).
 */
export function normalizeAbilityRuleForContent(rule: AbilityRule): AbilityRule {
  const out: AbilityRule = {
    canonicalKey: rule.canonicalKey,
    name: rule.name,
    spellIds: [...rule.spellIds],
    classSlug: rule.classSlug,
    specSlugs: sortStrings(rule.specSlugs) ?? [],
    roles: (sortStrings(rule.roles) as AbilityRule["roles"]) ?? [],
    category: rule.category,
    sourceOwnership: rule.sourceOwnership,
    sharedAcrossSpecs: rule.sharedAcrossSpecs,
    availability: rule.availability,
    provenance: {
      source: rule.provenance.source,
      verifiedAt: rule.provenance.verifiedAt,
      gameVersion: rule.provenance.gameVersion,
      ...(rule.provenance.sourceId !== undefined ? { sourceId: rule.provenance.sourceId } : {}),
      ...(rule.provenance.notes !== undefined ? { notes: rule.provenance.notes } : {}),
      ...(rule.provenance.certainty !== undefined ? { certainty: rule.provenance.certainty } : {}),
    },
  };

  if (rule.iconName !== undefined) out.iconName = rule.iconName;
  if (rule.dimensionTags !== undefined) {
    out.dimensionTags = sortStrings(rule.dimensionTags) as AbilityRule["dimensionTags"];
  }
  if (rule.cooldownSeconds !== undefined) out.cooldownSeconds = rule.cooldownSeconds;
  if (rule.charges !== undefined) out.charges = rule.charges;
  if (rule.raceSlugs !== undefined) out.raceSlugs = sortStrings(rule.raceSlugs);
  if (rule.interruptProfile !== undefined) out.interruptProfile = rule.interruptProfile;
  if (rule.requiresSuccessfulTarget !== undefined) {
    out.requiresSuccessfulTarget = rule.requiresSuccessfulTarget;
  }
  if (rule.survivalActiveHeal !== undefined) out.survivalActiveHeal = rule.survivalActiveHeal;
  if (rule.replacementFor !== undefined) out.replacementFor = rule.replacementFor;
  if (rule.aliases !== undefined) out.aliases = sortNumbers(rule.aliases);
  if (rule.activationSpellIds !== undefined) {
    out.activationSpellIds = sortNumbers(rule.activationSpellIds);
  }
  if (rule.activationBuffIds !== undefined) {
    out.activationBuffIds = sortNumbers(rule.activationBuffIds);
  }
  if (rule.triggeredEffectIds !== undefined) {
    out.triggeredEffectIds = sortNumbers(rule.triggeredEffectIds);
  }
  if (rule.activationEventTypes !== undefined) {
    out.activationEventTypes = sortStrings(
      rule.activationEventTypes,
    ) as AbilityRule["activationEventTypes"];
  }
  if (rule.activationSource !== undefined) out.activationSource = rule.activationSource;
  if (rule.activationEffectDurationMs !== undefined) {
    out.activationEffectDurationMs = rule.activationEffectDurationMs;
  }
  if (rule.supportCertainty !== undefined) out.supportCertainty = rule.supportCertainty;
  if (rule.petRequirement !== undefined) out.petRequirement = rule.petRequirement;
  if (rule.talentRequirements !== undefined) {
    out.talentRequirements = sortNumbers(rule.talentRequirements);
  }
  if (rule.validFromBuild !== undefined) out.validFromBuild = rule.validFromBuild;
  if (rule.validToBuild !== undefined) out.validToBuild = rule.validToBuild;

  return out;
}

export function normalizeRulesForContent(rules: readonly AbilityRule[]): AbilityRule[] {
  return [...rules]
    .map(normalizeAbilityRuleForContent)
    .sort((a, b) => compareAscii(a.canonicalKey, b.canonicalKey));
}

export function normalizeTopologyForContent(topology: ReleaseTopology): ReleaseTopology {
  const classes = [...topology.classes]
    .map((cls) => ({
      slug: cls.slug,
      name: cls.name,
      supportState: cls.supportState,
      blizzardClassId: cls.blizzardClassId,
      ...(cls.notes !== undefined ? { notes: cls.notes } : {}),
      specs: [...cls.specs]
        .map((spec) => ({
          slug: spec.slug,
          name: spec.name,
          role: spec.role,
          supportState: spec.supportState,
          blizzardSpecId: spec.blizzardSpecId,
          ...(spec.notes !== undefined ? { notes: spec.notes } : {}),
        }))
        .sort((a, b) => compareAscii(a.slug, b.slug)),
    }))
    .sort((a, b) => compareAscii(a.slug, b.slug));

  const races = [...topology.races]
    .map((race) => ({
      slug: race.slug,
      blizzardRaceIds: [...race.blizzardRaceIds].sort((x, y) => x - y),
    }))
    .sort((a, b) => compareAscii(a.slug, b.slug));

  return { classes, races };
}

export function buildReleaseContent(input: {
  gameVersion: string;
  wowBuild: string;
  seasonSlug: string;
  previousReleaseId: string | null;
  topology: ReleaseTopology;
  rules: readonly AbilityRule[];
  manifest: AbilityCatalogReleaseContent["manifest"];
}): AbilityCatalogReleaseContent {
  const topology = normalizeTopologyForContent(input.topology);
  const rules = normalizeRulesForContent(input.rules);
  const curatedChangeIds = [...input.manifest.curatedChangeIds].sort(compareAscii);
  return {
    schemaVersion: ABILITY_CATALOG_RELEASE_SCHEMA_V1,
    gameVersion: input.gameVersion,
    wowBuild: input.wowBuild,
    seasonSlug: input.seasonSlug,
    previousReleaseId: input.previousReleaseId,
    topology,
    rules,
    manifest: {
      origin: input.manifest.origin,
      curatedChangeIds,
      ...(input.manifest.staticCatalogVersionId !== undefined
        ? { staticCatalogVersionId: input.manifest.staticCatalogVersionId }
        : {}),
      ...(input.manifest.sourceSnapshot !== undefined
        ? { sourceSnapshot: input.manifest.sourceSnapshot }
        : {}),
      ...(input.manifest.curationEntries !== undefined
        ? {
            curationEntries: [...input.manifest.curationEntries].sort((a, b) =>
              compareAscii(
                `${a.operation}:${a.canonicalKey ?? ""}:${a.draftRuleId ?? a.draftTopologyId ?? ""}`,
                `${b.operation}:${b.canonicalKey ?? ""}:${b.draftRuleId ?? b.draftTopologyId ?? ""}`,
              ),
            ),
          }
        : {}),
      ...(input.manifest.notes !== undefined ? { notes: input.manifest.notes } : {}),
    },
  };
}

export function contentDigestOf(content: AbilityCatalogReleaseContent): string {
  return stableSha256(content);
}

export function topologyDigestOf(topology: ReleaseTopology): string {
  return stableSha256(normalizeTopologyForContent(topology));
}

export function buildReleaseKey(wowBuild: string, contentDigest: string): string {
  const prefix = contentDigest.slice(0, 8).toLowerCase();
  return `wow-${wowBuild}/catalog-v${SCHEMA_MAJOR}/${prefix}`;
}
