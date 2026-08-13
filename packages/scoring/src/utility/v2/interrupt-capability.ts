/**
 * Capability-aware interrupt opportunity metadata derived from Ability Catalog.
 */

import {
  resolveAbilityRuleBySpellId,
  resolveInterruptProfile,
  type InterruptCapabilityProfile,
} from "@mplus/abilities";
import type { UtilityV2ModelConfig } from "./constants.js";
import type { ClassifiedInterruptAttempt, UtilityV2RunFactSet } from "./types.js";

export interface InterruptCapabilityMeta {
  canonicalKeys: string[];
  cooldownSeconds: number;
  profile: InterruptCapabilityProfile;
  sourceOwnership: string | null;
}

function profileRank(profile: InterruptCapabilityProfile): number {
  switch (profile) {
    case "CONSTRAINED_CONTROL":
      return 4;
    case "LONG_COOLDOWN":
      return 3;
    case "PET_DEPENDENT":
      return 2;
    default:
      return 1;
  }
}

/**
 * Resolve the strongest interrupt capability across opportunity runs.
 * Uses catalog metadata for observed interrupt spell IDs when present;
 * otherwise falls back to STANDARD @ reference CD.
 */
export function resolveInterruptCapabilityMeta(
  factSets: UtilityV2RunFactSet[],
  attempts: ClassifiedInterruptAttempt[],
  config: UtilityV2ModelConfig,
): InterruptCapabilityMeta {
  const ref = config.interruptReferenceCooldownSeconds;
  const classSlug = null;
  const specSlug = null;

  let best: InterruptCapabilityMeta | null = null;
  const consider = (
    cooldownSeconds: number | null | undefined,
    profile: InterruptCapabilityProfile,
    canonicalKey: string | null,
    sourceOwnership: string | null,
  ) => {
    const cd = cooldownSeconds != null && cooldownSeconds > 0 ? cooldownSeconds : ref;
    const next: InterruptCapabilityMeta = {
      canonicalKeys: canonicalKey ? [canonicalKey] : [],
      cooldownSeconds: cd,
      profile,
      sourceOwnership,
    };
    if (best == null) {
      best = next;
      return;
    }
    // Prefer longer CD / more constrained profile for normalization fairness.
    const score =
      next.cooldownSeconds * 10 + profileRank(next.profile) -
      (best.cooldownSeconds * 10 + profileRank(best.profile));
    if (score > 0) {
      best = {
        ...next,
        canonicalKeys: [...new Set([...best.canonicalKeys, ...next.canonicalKeys])],
      };
    } else if (canonicalKey && !best.canonicalKeys.includes(canonicalKey)) {
      best.canonicalKeys.push(canonicalKey);
    }
  };

  for (const attempt of attempts) {
    const resolved = resolveAbilityRuleBySpellId({
      spellId: attempt.abilityGameId,
      classSlug,
      specSlug,
    });
    const rule =
      resolved.status === "matched"
        ? resolved.rule
        : resolved.status === "ambiguous"
          ? resolved.rules[0]
          : null;
    if (rule == null || rule.category !== "INTERRUPT") {
      consider(ref, "STANDARD", null, null);
      continue;
    }
    consider(
      rule.cooldownSeconds ?? ref,
      resolveInterruptProfile(rule),
      rule.canonicalKey,
      rule.sourceOwnership,
    );
  }

  // Also inspect toolkit-bearing fact limitations via first fact with interrupt attempts.
  for (const fs of factSets) {
    for (const a of fs.interruptAttempts) {
      const resolved = resolveAbilityRuleBySpellId({
        spellId: a.abilityGameId,
        classSlug,
        specSlug,
      });
      const rule =
        resolved.status === "matched"
          ? resolved.rule
          : resolved.status === "ambiguous"
            ? resolved.rules[0]
            : null;
      if (rule?.category === "INTERRUPT") {
        consider(
          rule.cooldownSeconds ?? ref,
          resolveInterruptProfile(rule),
          rule.canonicalKey,
          rule.sourceOwnership,
        );
      }
    }
  }

  return (
    best ?? {
      canonicalKeys: [],
      cooldownSeconds: ref,
      profile: "STANDARD",
      sourceOwnership: null,
    }
  );
}

/**
 * Normalize credited interrupt rate by capability constraints.
 * Longer CD / constrained profiles map the same raw rate to a higher
 * effective intensity so they are not scored as short-CD kicks.
 */
export function normalizeInterruptRatePerHour(
  creditedPerHour: number,
  meta: InterruptCapabilityMeta,
  config: UtilityV2ModelConfig,
): number {
  const ref = Math.max(1, config.interruptReferenceCooldownSeconds);
  const cd = Math.max(1, meta.cooldownSeconds);
  const profileFactor = config.interruptProfileFactor[meta.profile] ?? 1;
  return Math.max(0, creditedPerHour) * (cd / ref) * profileFactor;
}
