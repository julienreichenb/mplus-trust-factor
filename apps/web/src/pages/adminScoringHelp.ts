/**
 * Product copy for scoring model tuning — plain language for admins.
 * No implementation jargon (fact hashes, provider capability names, etc.).
 */

export const DIMENSION_HELP = {
  performance: {
    title: "Performance",
    summary: "How strongly this player delivers damage, healing, or tank throughput in Mythic+.",
    whatItMeans:
      "Controls how much Performance contributes to the overall Trust Score relative to the other dimensions.",
  },
  utility: {
    title: "Utility",
    summary: "Interrupts, crowd control, dispels, and group-support actions that help the dungeon succeed.",
    whatItMeans:
      "Controls how much Utility contributes to the overall Trust Score relative to the other dimensions.",
  },
  survival: {
    title: "Survival",
    summary: "Staying alive: deaths avoided, defensives used, and recovery under pressure.",
    whatItMeans:
      "Controls how much Survival contributes to the overall Trust Score relative to the other dimensions.",
  },
  experience: {
    title: "Experience",
    summary:
      "Longer-term Mythic+ track record: prior-season strength, elite titles, and exceptional ranks.",
    whatItMeans:
      "Controls how much Experience contributes to the overall Trust Score. Experience scoring itself ships in a later release; these weights prepare the model.",
  },
} as const;

export const COMPONENT_HELP = {
  performance: {
    parseBestAverage: {
      label: "Best parse average",
      whatItMeans:
        "Controls how Best and Median Warcraft Logs throughput percentiles are combined.",
    },
    parseMedianAverage: {
      label: "Median parse average",
      whatItMeans:
        "Controls how Best and Median Warcraft Logs throughput percentiles are combined.",
    },
    dpsDamageParse: {
      label: "Damage parse",
      whatItMeans: "Damage parse measures throughput across the active dungeon pool.",
    },
    dpsCooldown: {
      label: "Offensive cooldown",
      whatItMeans:
        "Offensive cooldown discipline measures use of eligible offensive cooldowns.",
    },
    tankDamageParse: {
      label: "Damage parse",
      whatItMeans: "Tank Performance is based entirely on damage throughput parses.",
    },
    healerHealingParse: {
      label: "Healing parse",
      whatItMeans: "Healing parse measures healing throughput.",
    },
    healerDamageParse: {
      label: "Damage parse",
      whatItMeans:
        "Damage parse rewards healers who contribute damage while maintaining their healing role.",
    },
  },
  utility: {
    interrupt: {
      label: "Interrupts",
      whatItMeans: "Using the specialization's interrupt toolkit during combat.",
    },
    crowdControl: {
      label: "Crowd control",
      whatItMeans: "Hard and soft crowd-control usage from the available toolkit.",
    },
    dispelPurge: {
      label: "Dispel / purge",
      whatItMeans: "Defensive dispels and offensive purges when the spec can use them.",
    },
    groupSupport: {
      label: "External / group support",
      whatItMeans: "Externals, group utility, and other confirmed support for teammates.",
    },
    movement: {
      label: "Movement utility",
      whatItMeans: "Movement tools the catalog marks as Utility, not personal defensives.",
    },
    combatRes: {
      label: "Combat resurrection",
      whatItMeans: "Battle-rez usage. Unused optional group tools do not lower the score.",
    },
    bloodlust: {
      label: "Bloodlust / heroism",
      whatItMeans: "Bloodlust-equivalent group haste. Unused optional group tools do not lower the score.",
    },
  },
  survival: {
    outcome: {
      label: "Death outcome",
      whatItMeans: "How often the player dies in selected runs — fewer deaths score higher.",
    },
    defensive: {
      label: "Defensive response",
      whatItMeans: "Using defensives in anticipation of or reaction to dangerous moments.",
    },
    recovery: {
      label: "Emergency recovery",
      whatItMeans: "Self-heals and recovery tools after dangerous pressure windows.",
    },
    activeHealing: {
      title: "Active hybrid healing",
      whatItMeans:
        "Meaningful self and ally heals from Retribution, Protection, and Enhancement only. Healers are not scored here. Spell lists are not admin-editable.",
      enabled: "Include this recovery add-on in Survival.",
      minPct: "Minimum effective heal as a percent of the target’s max health.",
      selfWeight: "How strongly self-heals contribute.",
      allyWeight: "How strongly heals on other party players contribute.",
      diminishing: "Diminishing-returns exponent on summed event credit (lower = stronger falloff).",
      cap: "Maximum Survival score points added after the existing Survival mix (0–100).",
    },
  },
  experience: {
    previousSeasonScore: {
      label: "Previous-season Mythic+ score",
      whatItMeans:
        "How strong the character was last season. Expected to be the dominant Experience signal.",
    },
    historicalTitle: {
      label: "Historical 0.1% title",
      whatItMeans: "Evidence of earning a top 0.1% Mythic+ title in a past season.",
    },
    historicalRanking: {
      label: "Exceptional historical ranking",
      whatItMeans: "Rare class/spec regional or percentile rankings from prior seasons.",
    },
  },
} as const;
