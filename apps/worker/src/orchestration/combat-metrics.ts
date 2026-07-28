import type { MetricObservationDTO } from "@mplus/contracts";
import type { RunCombatFacts } from "@mplus/provider-warcraftlogs";
import type { AbilityCatalog } from "@mplus/abilities";
import {
  CURRENT_CATALOG_VERSION,
  effectiveKickCooldownMs,
  rulesForSpell,
  spellIdsForCategory,
} from "@mplus/abilities";

export interface CombatMetricsContext {
  observedAt: string;
  dungeonSlug: string;
  runDurationMs: number;
  classSlug?: string | null;
  specSlug?: string | null;
  catalog: AbilityCatalog;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function coverageRatio(facts: RunCombatFacts): number {
  const flags = Object.values(facts.coverage);
  if (flags.length === 0) return 0;
  return flags.filter(Boolean).length / flags.length;
}

function isAttributed(facts: RunCombatFacts, sourceId: number): boolean {
  return facts.attributedSourceIds.includes(sourceId);
}

function isHostileTarget(facts: RunCombatFacts, targetId: number | null): boolean {
  if (targetId == null) return false;
  const actor = facts.actorMap.byId.get(targetId);
  if (!actor) return true;
  return actor.type !== "Player" && actor.type !== "Pet";
}

/** Derives survival/utility metric observations from normalized WCL combat facts. */
export function extractMetricsFromCombatFacts(
  facts: RunCombatFacts,
  observedAt: string,
  context?: Partial<CombatMetricsContext>,
): MetricObservationDTO[] {
  const ctx: CombatMetricsContext = {
    observedAt,
    dungeonSlug: context?.dungeonSlug ?? "unknown",
    runDurationMs: context?.runDurationMs ?? 1_800_000,
    classSlug: context?.classSlug ?? "warlock",
    specSlug: context?.specSlug ?? null,
    catalog: context?.catalog ?? {
      catalogVersion: "empty",
      version: CURRENT_CATALOG_VERSION,
      rules: [],
    },
  };

  const targetId = facts.targetSourceId;
  const deaths = facts.deaths.filter((event) => event.targetId === targetId).length;
  const coverage = coverageRatio(facts);

  const interruptSpellIds = spellIdsForCategory(ctx.catalog, "interrupt", {
    classSlug: ctx.classSlug ?? undefined,
    specSlug: ctx.specSlug,
  });
  const kickCasts = facts.casts.filter(
    (c) => isAttributed(facts, c.sourceId) && interruptSpellIds.has(c.abilityGameId),
  ).length;
  const successfulInterrupts = facts.interrupts.filter((event) =>
    isAttributed(facts, event.sourceId),
  ).length;

  const defensiveSpellIds = spellIdsForCategory(ctx.catalog, "personal_defensive", {
    classSlug: ctx.classSlug ?? undefined,
    specSlug: ctx.specSlug,
  });
  const defensiveCasts = facts.casts.filter(
    (c) => c.sourceId === targetId && defensiveSpellIds.has(c.abilityGameId),
  ).length;

  const selfHealSpellIds = spellIdsForCategory(ctx.catalog, "self_heal", {
    classSlug: ctx.classSlug ?? undefined,
    specSlug: ctx.specSlug,
  });
  const potionSpellIds = spellIdsForCategory(ctx.catalog, "health_potion", {
    classSlug: ctx.classSlug ?? undefined,
    specSlug: ctx.specSlug,
  });
  const consumableCasts = facts.casts.filter(
    (c) =>
      c.sourceId === targetId &&
      (potionSpellIds.has(c.abilityGameId) || selfHealSpellIds.has(c.abilityGameId)),
  ).length;
  const effectiveSelfHeal = facts.healing
    .filter((h) => h.sourceId === targetId && h.targetId === targetId)
    .reduce((sum, h) => sum + Math.max(0, h.amount - (h.overheal ?? 0)), 0);

  const ccSpellIds = spellIdsForCategory(ctx.catalog, "crowd_control", {
    classSlug: ctx.classSlug ?? undefined,
    specSlug: ctx.specSlug,
  });
  const ccTargets = new Set<number>();
  for (const cast of facts.casts) {
    if (!isAttributed(facts, cast.sourceId)) continue;
    if (!ccSpellIds.has(cast.abilityGameId)) continue;
    if (cast.targetId != null && isHostileTarget(facts, cast.targetId)) {
      ccTargets.add(cast.targetId);
    }
  }
  for (const aura of facts.auras) {
    if (!isAttributed(facts, aura.sourceId)) continue;
    if (!ccSpellIds.has(aura.abilityGameId)) continue;
    if (isHostileTarget(facts, aura.targetId)) {
      ccTargets.add(aura.targetId);
    }
  }

  const supportSpellIds = spellIdsForCategory(ctx.catalog, "group_support", {
    classSlug: ctx.classSlug ?? undefined,
    specSlug: ctx.specSlug,
  });
  const supportCasts = facts.casts.filter(
    (c) => c.sourceId === targetId && supportSpellIds.has(c.abilityGameId),
  ).length;

  const defensiveDispelIds = spellIdsForCategory(ctx.catalog, "defensive_dispel", {
    classSlug: ctx.classSlug ?? undefined,
    specSlug: ctx.specSlug,
  });
  const offensiveDispelIds = spellIdsForCategory(ctx.catalog, "offensive_dispel", {
    classSlug: ctx.classSlug ?? undefined,
    specSlug: ctx.specSlug,
  });
  const defensiveDispels = facts.dispels.filter(
    (d) => isAttributed(facts, d.sourceId) && defensiveDispelIds.has(d.abilityGameId),
  ).length;
  const offensiveDispels = facts.dispels.filter(
    (d) => isAttributed(facts, d.sourceId) && offensiveDispelIds.has(d.abilityGameId),
  ).length;

  let avoidableDamage = 0;
  let totalDamage = 0;
  if (facts.coverage.damageTaken) {
    for (const hit of facts.damageTaken.filter((d) => d.targetId === targetId)) {
      totalDamage += hit.amount;
      const rules = rulesForSpell(ctx.catalog, hit.abilityGameId);
      if (rules.some((r) => r.category === "INTERRUPT")) continue;
      // Without mechanic catalog coverage, avoidable damage stays unavailable.
    }
  }

  const kickCooldownMs = effectiveKickCooldownMs(
    ctx.catalog,
    ctx.classSlug ?? "warlock",
    ctx.specSlug ?? null,
  );
  const availableKickWindows =
    kickCooldownMs != null ? Math.max(1, ctx.runDurationMs / kickCooldownMs) : null;
  const kickActivity =
    availableKickWindows != null ? clamp01(kickCasts / availableKickWindows) : null;
  const kickSuccess = kickCasts > 0 ? successfulInterrupts / kickCasts : null;
  const interruptScore =
    kickActivity != null && kickSuccess != null
      ? clamp01(0.7 * kickActivity + 0.3 * kickSuccess) * 100
      : kickCasts > 0 && successfulInterrupts > 0
        ? clamp01(successfulInterrupts / kickCasts) * 100
        : null;

  const spellAudit = buildSpellAudit(facts, ctx);

  const observations: MetricObservationDTO[] = [
    {
      metricKey: "survival.death_rate",
      dimension: "SURVIVAL",
      rawValue: deaths,
      normalizedValue: facts.coverage.deaths ? clamp01(1 - deaths / 5) * 100 : null,
      confidence: facts.coverage.deaths ? 0.75 : 0,
      observedAt: ctx.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: facts.coverage.deaths ? 1 : 0,
        expected: 1,
        ratio: facts.coverage.deaths ? 1 : 0,
      },
      context: {
        reportCode: facts.reportCode,
        fightId: facts.fightId,
        revision: facts.revision,
        limitations: facts.limitations.notes,
        spellAudit: spellAudit.survival,
      },
    },
    {
      metricKey: "survival.avoidable_damage",
      dimension: "SURVIVAL",
      rawValue: avoidableDamage > 0 ? avoidableDamage : null,
      normalizedValue: null,
      confidence: 0,
      observedAt: ctx.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: 0,
        expected: 1,
        ratio: 0,
      },
      context: {
        totalDamageTaken: totalDamage,
        unavailable: "mechanic_catalog_not_seeded_for_dungeon",
        spellAudit: spellAudit.survival,
      },
    },
    {
      metricKey: "survival.defensive_usage",
      dimension: "SURVIVAL",
      rawValue: defensiveCasts > 0 ? defensiveCasts : null,
      normalizedValue:
        defensiveCasts > 0 && facts.coverage.casts
          ? clamp01(defensiveCasts / Math.max(1, ctx.runDurationMs / 60_000)) * 100
          : null,
      confidence: facts.coverage.casts ? 0.65 : 0,
      observedAt: ctx.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: defensiveCasts,
        expected: 1,
        ratio: facts.coverage.casts ? 1 : 0,
      },
      context: { defensiveCasts, spellAudit: spellAudit.survival },
    },
    {
      metricKey: "survival.consumable_usage",
      dimension: "SURVIVAL",
      rawValue:
        consumableCasts > 0 || effectiveSelfHeal > 0
          ? consumableCasts + effectiveSelfHeal / 10_000
          : null,
      normalizedValue:
        consumableCasts > 0 || effectiveSelfHeal > 0
          ? clamp01((consumableCasts + effectiveSelfHeal / 50_000) / 3) * 100
          : null,
      confidence: facts.coverage.casts || facts.coverage.healing ? 0.6 : 0,
      observedAt: ctx.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: consumableCasts + (effectiveSelfHeal > 0 ? 1 : 0),
        expected: 1,
        ratio: facts.coverage.casts || facts.coverage.healing ? 1 : 0,
      },
      context: { consumableCasts, effectiveSelfHeal, spellAudit: spellAudit.survival },
    },
    {
      metricKey: "utility.interrupts",
      dimension: "UTILITY",
      rawValue: kickCasts,
      normalizedValue: interruptScore,
      confidence: facts.coverage.interrupts || facts.coverage.casts ? 0.7 : 0,
      observedAt: ctx.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: kickCasts,
        expected: Math.max(1, Math.ceil(availableKickWindows ?? 1)),
        ratio: coverage,
      },
      context: {
        kickCasts,
        successfulInterrupts,
        kickActivity,
        kickSuccess,
        availableKickWindows,
        spellAudit: spellAudit.utility,
      },
    },
    {
      metricKey: "utility.crowd_control",
      dimension: "UTILITY",
      rawValue: ccTargets.size > 0 ? ccTargets.size : null,
      normalizedValue:
        ccTargets.size > 0 ? clamp01(ccTargets.size / 8) * 100 : null,
      confidence: facts.coverage.casts || facts.coverage.auras ? 0.65 : 0,
      observedAt: ctx.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: ccTargets.size,
        expected: 4,
        ratio: facts.coverage.casts || facts.coverage.auras ? 1 : 0,
      },
      context: { distinctCcTargets: ccTargets.size, spellAudit: spellAudit.utility },
    },
    {
      metricKey: "utility.externals",
      dimension: "UTILITY",
      rawValue: supportCasts > 0 ? supportCasts : null,
      normalizedValue: supportCasts > 0 ? clamp01(supportCasts / 4) * 100 : null,
      confidence: facts.coverage.casts ? 0.6 : 0,
      observedAt: ctx.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: supportCasts,
        expected: 2,
        ratio: facts.coverage.casts ? 1 : 0,
      },
      context: { supportCasts, spellAudit: spellAudit.utility },
    },
    {
      metricKey: "utility.dispels",
      dimension: "UTILITY",
      rawValue:
        defensiveDispels + offensiveDispels > 0 ? defensiveDispels + offensiveDispels : null,
      normalizedValue:
        defensiveDispels + offensiveDispels > 0
          ? clamp01((defensiveDispels + offensiveDispels) / 6) * 100
          : null,
      confidence: facts.coverage.dispels ? 0.65 : 0,
      observedAt: ctx.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: defensiveDispels + offensiveDispels,
        expected: 1,
        ratio: facts.coverage.dispels ? 1 : 0,
      },
      context: { defensiveDispels, offensiveDispels, spellAudit: spellAudit.utility },
    },
  ];

  return observations.filter((obs) => obs.confidence > 0 || obs.normalizedValue != null);
}

function buildSpellAudit(facts: RunCombatFacts, ctx: CombatMetricsContext) {
  const targetId = facts.targetSourceId;
  const countBySpell = (spellIds: Set<number>, useAttributed = false) => {
    const out: Record<string, number> = {};
    for (const id of spellIds) {
      const casts = facts.casts.filter(
        (c) =>
          c.abilityGameId === id && (useAttributed ? isAttributed(facts, c.sourceId) : c.sourceId === targetId),
      ).length;
      const interrupts = facts.interrupts.filter(
        (i) =>
          i.abilityGameId === id && (useAttributed ? isAttributed(facts, i.sourceId) : i.sourceId === targetId),
      ).length;
      const dispels = facts.dispels.filter(
        (d) =>
          d.abilityGameId === id && (useAttributed ? isAttributed(facts, d.sourceId) : d.sourceId === targetId),
      ).length;
      if (casts + interrupts + dispels > 0) {
        out[String(id)] = casts + interrupts + dispels;
      }
    }
    return out;
  };

  const survivalIds = new Set([
    ...spellIdsForCategory(ctx.catalog, "personal_defensive", { classSlug: ctx.classSlug ?? undefined }),
    ...spellIdsForCategory(ctx.catalog, "self_heal", { classSlug: ctx.classSlug ?? undefined }),
    ...spellIdsForCategory(ctx.catalog, "health_potion", { classSlug: ctx.classSlug ?? undefined }),
  ]);
  const utilityIds = new Set([
    ...spellIdsForCategory(ctx.catalog, "interrupt", { classSlug: ctx.classSlug ?? undefined }),
    ...spellIdsForCategory(ctx.catalog, "crowd_control", { classSlug: ctx.classSlug ?? undefined }),
    ...spellIdsForCategory(ctx.catalog, "group_support", { classSlug: ctx.classSlug ?? undefined }),
    ...spellIdsForCategory(ctx.catalog, "defensive_dispel", { classSlug: ctx.classSlug ?? undefined }),
  ]);

  return {
    survival: {
      deaths: facts.deaths.filter((d) => d.targetId === targetId).length,
      defensiveCasts: countBySpell(survivalIds),
      truncatedPages: facts.limitations.truncatedPages,
    },
    utility: {
      kicks: countBySpell(
        spellIdsForCategory(ctx.catalog, "interrupt", { classSlug: ctx.classSlug ?? undefined }),
        true,
      ),
      cc: countBySpell(
        spellIdsForCategory(ctx.catalog, "crowd_control", { classSlug: ctx.classSlug ?? undefined }),
        true,
      ),
      support: countBySpell(
        spellIdsForCategory(ctx.catalog, "group_support", { classSlug: ctx.classSlug ?? undefined }),
      ),
      dispels: countBySpell(
        spellIdsForCategory(ctx.catalog, "defensive_dispel", { classSlug: ctx.classSlug ?? undefined }),
        true,
      ),
      attributedSourceIds: facts.attributedSourceIds,
      truncatedPages: facts.limitations.truncatedPages,
    },
  };
}
