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
    summary: "Interrupts, crowd control, and group-support actions that help the dungeon succeed.",
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
    phase1: {
      label: "Parse & profile score",
      whatItMeans:
        "Season parses and profile summary — peak and floor runs, difficulty-adjusted, with a profile stabilizer.",
    },
    cooldown: {
      label: "Offensive cooldown discipline",
      whatItMeans:
        "How consistently offensive cooldowns are used across selected dungeon runs.",
    },
    dungeonPeak: {
      label: "Dungeon peak parse",
      whatItMeans: "Weight of the stronger selected parse in each dungeon.",
    },
    dungeonFloor: {
      label: "Dungeon floor parse",
      whatItMeans:
        "Weight of the weaker selected parse — rewards a strong floor, not only a high peak.",
    },
    dungeonConsistency: {
      label: "Dungeon consistency",
      whatItMeans: "Reward for keeping peak and floor close at a high level.",
    },
    profileBestAverage: {
      label: "Profile best average",
      whatItMeans: "Season profile best-average contribution to the profile stabilizer.",
    },
    profileMedianAverage: {
      label: "Profile median average",
      whatItMeans: "Season profile median-average contribution to the profile stabilizer.",
    },
  },
  utility: {
    castStops: {
      label: "Cast stops / interrupts",
      whatItMeans: "Successful and attempted interrupts that stop dangerous enemy casts.",
    },
    support: {
      label: "Group support",
      whatItMeans: "Externals, utility buffs, and other confirmed support for teammates.",
    },
    strategicCc: {
      label: "Strategic crowd control",
      whatItMeans: "Meaningful crowd-control usage that helps control packs and bosses.",
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
